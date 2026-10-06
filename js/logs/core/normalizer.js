/**
 * normalizer.js — Line object normalizer for PKA
 * Converts raw log line objects into a consistent shape.
 */

'use strict';

const PKANormalizer = (() => {

  /**
   * Normalizes a raw parsed line into a standard line object.
   * @param {object} raw — output from PKAParser._parseLine
   * @returns {object} normalized line
   */
  function normalizeLine(raw) {
    if (!raw) return null;

    const rawComponent = (raw.component || '').trim();
    const pathChain     = rawComponent
      ? rawComponent.split(PKA_CONFIG.REGEX.PATH_SEPARATOR).map(p => p.trim()).filter(Boolean)
      : [];

    const line = {
      lineNo:    raw.lineNo    || 0,
      raw:       (raw.raw      || ''),
      timestamp: normalizeTimestamp(raw.timestamp),
      ts:        0,            // epoch ms — set below
      level:     normalizeLevel(raw.level),
      // Legacy flat fields kept for the untouched domain parsers.
      thread:    normalizeThread(raw.thread),
      component: pathChain.join('  '),
      message:   (raw.message   || '').trim(),
      isContinuation: raw.isContinuation || false,
      isEmpty:   raw.isEmpty || false,

      // New identifier/path-chain model (PDI spec §2.0-2.3, §6).
      identifier:     raw.isContinuation ? null : (raw.thread || null),
      identifierType: null,   // 'thread' | 'uuid' | 'step' | null
      uuid:           null,
      stepInfo:       null,   // { trfName, stepName }
      pathChain,
    };

    line.ts = line.timestamp ? new Date(line.timestamp).getTime() : 0;

    if (!raw.isContinuation && line.identifier) {
      _classifyIdentifier(line);
    }

    return line;
  }

  /**
   * Classifies a header line's identifier into thread / uuid / step,
   * per PDI_LOG_ANALYSIS_SPECIFICATION.md §2.1-2.3.
   */
  function _classifyIdentifier(line) {
    const R = PKA_CONFIG.REGEX;
    const id = line.identifier;

    if (R.THREAD_ID.test(id)) {
      line.identifierType = 'thread';
      line.thread = id;
      return;
    }

    const uuidMatch = id.match(R.UUID_IDENTIFIER);
    if (uuidMatch) {
      line.identifierType = 'uuid';
      line.uuid = uuidMatch[1].toLowerCase();
      return;
    }

    // Step pattern: "TransformationName - StepName". The transformation name
    // is the text up to the FIRST ' - '; the rest (which may itself contain
    // ' - ') is the step name.
    line.identifierType = 'step';
    const sepIdx = id.indexOf(' - ');
    if (sepIdx === -1) {
      line.stepInfo = { trfName: id, stepName: '' };
    } else {
      line.stepInfo = {
        trfName:  id.slice(0, sepIdx).trim(),
        stepName: id.slice(sepIdx + 3).trim(),
      };
    }
  }

  /**
   * ISO 8601 normalisation: "2026-09-14 12:01:27.557" → "2026-09-14T12:01:27.557"
   */
  function normalizeTimestamp(ts) {
    if (!ts) return null;
    // Replace space separator with T
    return ts.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
  }

  function normalizeLevel(level) {
    if (!level) return 'INFO';
    const l = level.toUpperCase().trim();
    if (['INFO','WARN','ERROR','DEBUG','FATAL','TRACE'].includes(l)) return l;
    return 'INFO';
  }

  function normalizeThread(thread) {
    if (!thread) return 'unknown';
    return thread.trim();
  }

  /**
   * Merge continuation lines (stack traces, multi-line messages) onto
   * the previous line object.
   * @param {object[]} lineBuffer — ordered array of line objects
   * @returns {object[]} merged lines
   */
  function mergeContinuations(lineBuffer) {
    const result = [];
    let current  = null;

    for (const line of lineBuffer) {
      if (!line) continue;

      if (line.isContinuation && current) {
        // Append to previous line's continuation payload
        current.continuation = current.continuation || [];
        current.continuation.push(line.raw);
        current.hasContinuation = true;
      } else {
        if (current) result.push(current);
        current = { ...line };
      }
    }

    if (current) result.push(current);
    return result;
  }

  return { normalizeLine, normalizeTimestamp, normalizeLevel, normalizeThread, mergeContinuations };
})();

if (typeof window !== 'undefined') window.PKANormalizer = PKANormalizer;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKANormalizer = PKANormalizer;
