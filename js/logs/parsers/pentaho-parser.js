/**
 * pentaho-parser.js — Job & Transformation entity extractor
 *
 * Identifies:
 *  - Job start / end / result
 *  - Transformation dispatch / finish
 *  - Nested job entry results
 */

'use strict';

const PKAPentahoParser = (() => {

  const R = PKA_CONFIG.REGEX;
  const S = PKA_CONFIG.STATUS;

  /**
   * Process a normalized line and update mutable state maps.
   *
   * Jobs/transformations are keyed by their full path-chain (the
   * invocation stack up to and including that node), not by thread — two
   * nodes can share a thread but are distinct tree positions, and a node's
   * role (job vs transformation) is decided by its file extension
   * (.kjb / .ktr), never by its position in the chain. See
   * PDI_LOG_ANALYSIS_SPECIFICATION.md §6.
   *
   * @param {object}  line         — normalized line from PKANormalizer
   * @param {Map}     openJobs     — pathKey→Job currently open
   * @param {Map}     openTrfs     — pathKey→Transformation currently open
   * @param {Array}   jobs         — accumulator for closed Job objects
   * @param {Array}   trfs         — accumulator for closed Transformation objects
   * @param {string}  executionId  — current execution context
   */
  function parseLine(line, openJobs, openTrfs, jobs, trfs, executionId) {
    if (!line || line.isContinuation) return;

    const msg       = line.message;
    const thread    = line.thread;
    const ts        = line.ts;
    const pathChain = line.pathChain || [];
    const pathKey   = pathChain.join('>');

    // ── Job Start ──────────────────────────────────────────────
    if (R.JOB_START.test(msg)) {
      const name = _extractName(pathChain, '.kjb');
      if (name) {
        openJobs.set(pathKey, {
          name,
          path:        pathChain.slice(),
          thread,
          start:       ts,
          end:         null,
          duration:    null,
          status:      S.RUNNING,
          executionId,
          steps:       [],
          errors:      0,
        });
      }
      return;
    }

    // ── Job Entry Finished ──────────────────────────────────────
    const jobFinish = msg.match(R.JOB_FINISH);
    if (jobFinish) {
      const entryName = jobFinish[1];
      const success   = jobFinish[2] === 'true';

      // Close the matching open job by its path-chain position.
      const jobByPath = openJobs.get(pathKey);
      if (jobByPath) {
        jobByPath.end      = ts;
        jobByPath.duration = ts - jobByPath.start;
        jobByPath.status   = success ? S.SUCCESS : S.FAILED;
        jobs.push({ ...jobByPath });
        openJobs.delete(pathKey);
      } else {
        // Orphaned finish — create a synthetic record
        jobs.push({
          name:        entryName,
          path:        pathChain.slice(),
          thread,
          start:       null,
          end:         ts,
          duration:    null,
          status:      success ? S.SUCCESS : S.FAILED,
          executionId,
          steps:       [],
          errors:      0,
        });
      }
      return;
    }

    // ── Transformation Dispatch (start) ────────────────────────
    const trfStart = msg.match(R.TRF_START);
    if (trfStart) {
      const name = trfStart[1];
      openTrfs.set(pathKey, {
        name,
        path:        pathChain.slice(),
        thread,
        start:       ts,
        end:         null,
        duration:    null,
        status:      S.RUNNING,
        executionId,
        rowsIn:      0,
        rowsOut:     0,
        rowsRead:    0,
        rowsWritten: 0,
        rowsUpdated: 0,
        rowsErrors:  0,
        timePerRow:  null,
      });
      return;
    }

    // ── Transformation Finish ──────────────────────────────────
    const trfFinish = msg.match(R.TRF_FINISH);
    if (trfFinish) {
      const trf = openTrfs.get(pathKey);
      if (trf) {
        trf.end      = ts;
        trf.duration = ts - trf.start;
        trf.status   = S.SUCCESS;
        trfs.push({ ...trf });
        openTrfs.delete(pathKey);
      }
      return;
    }
  }

  /**
   * Flush any remaining open jobs/transformations at end of file.
   * Mark them as UNKNOWN (incomplete).
   */
  function flush(openJobs, openTrfs, jobs, trfs) {
    for (const job of openJobs.values()) {
      job.status = PKA_CONFIG.STATUS.UNKNOWN;
      jobs.push(job);
    }
    for (const trf of openTrfs.values()) {
      trf.status = PKA_CONFIG.STATUS.UNKNOWN;
      trfs.push(trf);
    }
    openJobs.clear();
    openTrfs.clear();
  }

  /**
   * The node's name is the last element of its path-chain; role (job vs
   * transformation) is decided by that element's extension, never by
   * position — a transformation can invoke a job and vice versa.
   */
  function _extractName(pathChain, ext) {
    const last = pathChain[pathChain.length - 1];
    if (!last) return null;
    const extRe = new RegExp(ext.replace('.', '\\.') + '$', 'i');
    if (extRe.test(last)) return last.replace(extRe, '');
    return last.trim() || null;
  }

  return { parseLine, flush };
})();

if (typeof window !== 'undefined') window.PKAPentahoParser = PKAPentahoParser;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAPentahoParser = PKAPentahoParser;
