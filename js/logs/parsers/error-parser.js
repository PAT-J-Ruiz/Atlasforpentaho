/**
 * error-parser.js — Error entity extractor
 *
 * Classifies errors by:
 *  - Severity (FATAL / ERROR / WARN)
 *  - Category (DB / INFRA / FILE / HTTP / JAVA / PENTAHO / UNKNOWN)
 *  - Captures stack traces from continuation lines
 */

'use strict';

const PKAErrorParser = (() => {

  const R  = PKA_CONFIG.REGEX;
  const SV = PKA_CONFIG.SEVERITY;

  // Category labels
  const CAT = {
    DB:      'Database',
    INFRA:   'Infrastructure',
    FILE:    'File System',
    HTTP:    'HTTP / API',
    JAVA:    'Java Exception',
    PENTAHO: 'Pentaho',
    UNKNOWN: 'Unknown',
  };

  /**
   * @param {object} line          — normalized line
   * @param {object|null} prevError— last opened error (for continuation)
   * @param {Array}  errors        — accumulator
   * @param {string} executionId
   * @param {string} currentJob
   * @param {string} currentTrf
   * @returns {object|null} updatedPrevError
   */
  function parseLine(line, prevError, errors, executionId, currentJob, currentTrf) {
    if (!line) return prevError;

    const msg = line.message;

    // Continuation — append to previous error's stack trace
    if (line.isContinuation && prevError) {
      if (R.STACK_FRAME.test(line.raw) || R.CAUSED_BY.test(line.raw)) {
        prevError.stackTrace = prevError.stackTrace || [];
        prevError.stackTrace.push(line.raw.trim());
      }
      return prevError;
    }

    // Known warnings (config KNOWN_WARNINGS) are not errors
    if (typeof PKAErrorDetector !== 'undefined' && PKAErrorDetector.isKnownWarning && PKAErrorDetector.isKnownWarning(msg)) return null;

    // Detect severity
    const sev = _detectSeverity(line.level, msg);
    if (!sev) return null;  // not an error line

    const errObj = {
      severity:    sev,
      category:    _detectCategory(msg),
      message:     msg.trim(),
      timestamp:   line.ts,
      thread:      line.thread,
      component:   line.component,
      executionId,
      job:         currentJob  || null,
      transformation: currentTrf || null,
      stackTrace:  [],
    };

    errors.push(errObj);
    return errObj;
  }

  function _detectSeverity(level, msg) {
    if (!level && !msg) return null;

    const l = (level || '').toUpperCase();
    if (l === 'FATAL' || /\bFATAL\b/.test(msg)) return SV.FATAL.label;
    if (l === 'ERROR' || /\bERROR\b/.test(msg))  return SV.ERROR.label;
    if (l === 'WARN'  || /\bWARN(?:ING)?\b/i.test(msg)) return SV.WARN.label;

    // Exception keywords at any level
    if (/\bException\b|\bCaused by\b/i.test(msg)) return SV.ERROR.label;

    return null;
  }

  function _detectCategory(msg) {
    if (R.ORA_ERROR.test(msg) || R.SQL_EXCEPTION.test(msg) ||
        R.DEADLOCK.test(msg)  || R.TIMEOUT.test(msg))      return CAT.DB;
    if (R.PERM_DENIED.test(msg) || R.CONN_REFUSED.test(msg) ||
        R.HOST_UNREACH.test(msg))                           return CAT.INFRA;
    if (R.FILE_NOT_FOUND.test(msg))                        return CAT.FILE;
    if (R.HTTP_ERROR.test(msg))                            return CAT.HTTP;
    if (/\bException\b/i.test(msg))                        return CAT.JAVA;
    if (/pentaho|kettle|hop/i.test(msg))                   return CAT.PENTAHO;
    return CAT.UNKNOWN;
  }

  /**
   * Build a recurring-errors map: groups errors by normalised message
   * and counts occurrences.
   * @param {object[]} errors
   * @returns {Array<{message, count, category, severity}>} sorted desc
   */
  function recurringErrors(errors) {
    const counts = {};
    for (const e of errors) {
      // Normalise: strip timestamps/IDs from message
      const key = e.message.replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\s]*/g, '<TS>')
                            .replace(/\b\d{5,}\b/g, '<ID>')
                            .trim();
      if (!counts[key]) {
        counts[key] = { message: key, count: 0, category: e.category, severity: e.severity };
      }
      counts[key].count++;
    }
    return Object.values(counts).sort((a, b) => b.count - a.count);
  }

  return { parseLine, recurringErrors, CAT };
})();

if (typeof window !== 'undefined') window.PKAErrorParser = PKAErrorParser;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAErrorParser = PKAErrorParser;
