/**
 * error-detector.js — Real execution-failure detection
 *
 * A job entry finishing with result=[false] is NOT by itself reliable: some
 * entries (e.g. "Simple evaluation") legitimately return false as normal
 * control flow, not a failure. Conversely, a completed execution can still
 * have silently swallowed a real error (a deadlock, a step that failed to
 * initialize) without any single job entry making that obvious at a glance.
 *
 * The signal that IS reliable is the log's own content: the level column
 * (ERROR/FATAL) and a curated set of known Kettle/PDI/Java/DB failure
 * phrases. These are matched ONLY against message text — never against
 * identifiers, step/job names or path-chain elements — so a transformation
 * or step literally named "...SIN_ERROR..." or "...ERROR_HANDLING..." can
 * never trigger a false positive just because "error" appears in its name.
 */

'use strict';

const PKAErrorDetector = (() => {

  const R = PKA_CONFIG.REGEX;

  const REAL_ERROR_PATTERNS = [
    R.ERROR_PROCESSING_STOPPED,
    R.ERROR_STEP_INIT_FAILED,
    R.ERROR_INIT_FAILED,
    R.ERROR_PREPARE_FAILED,
    R.ERROR_STEPS_INIT_FAILED,
    R.ERROR_JAVA_EXCEPTION,
    R.ERROR_STACK_FRAME_INLINE,
    R.ORA_ERROR,
    R.SQL_EXCEPTION,
    R.DEADLOCK,
    R.TIMEOUT,
    R.CONN_REFUSED,
    R.HOST_UNREACH,
    R.PERM_DENIED,
    R.FILE_NOT_FOUND,
  ];

  const KNOWN_WARNINGS = PKA_CONFIG.KNOWN_WARNINGS || [];

  /** True for messages the team has confirmed are harmless (see config KNOWN_WARNINGS). */
  function isKnownWarning(text) {
    return !!text && KNOWN_WARNINGS.some(re => re.test(text));
  }

  /** @param {string|null} level — the line's own INFO/WARN/ERROR/FATAL level, if any */
  function isErrorText(level, text) {
    if (isKnownWarning(text)) return false;
    if (level === 'ERROR' || level === 'FATAL') return true;
    if (!text) return false;
    return REAL_ERROR_PATTERNS.some(re => re.test(text));
  }

  /**
   * Scans a block's header message and continuation lines for a genuine
   * failure signal. Returns true/false — never mutates the block.
   */
  function checkBlock(block) {
    const header = block.headerLine;
    if (header && isErrorText(header.level, header.message)) return true;
    for (const line of (block.continuationRaw || [])) {
      if (isErrorText(null, line)) return true;
    }
    return false;
  }

  return { isErrorText, checkBlock, isKnownWarning };
})();

if (typeof window !== 'undefined') window.PKAErrorDetector = PKAErrorDetector;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAErrorDetector = PKAErrorDetector;
