/**
 * variable-parser.js — Variable entity extractor
 *
 * Detects:
 *  - Set variable X to value [Y]
 *  - Get variable X
 *  - Environment variable references
 */

'use strict';

const PKAVariableParser = (() => {

  const R = PKA_CONFIG.REGEX;

  /**
   * @param {object} line        — normalized line
   * @param {Array}  variables   — accumulator
   * @param {string} executionId
   */
  function parseLine(line, variables, executionId) {
    if (!line || line.isContinuation) return;

    const msg = line.message;

    // Set variable X to value [Y]
    const set = msg.match(R.VAR_SET);
    if (set) {
      variables.push({
        name:        set[1].trim(),
        value:       set[2].trim(),
        operation:   'SET',
        timestamp:   line.ts,
        thread:      line.thread,
        executionId,
      });
      return;
    }

    // Get variable X
    const get = msg.match(R.VAR_GET);
    if (get) {
      variables.push({
        name:        get[1].trim(),
        value:       get[2] ? get[2].trim() : null,
        operation:   'GET',
        timestamp:   line.ts,
        thread:      line.thread,
        executionId,
      });
      return;
    }

    // Environment variable
    const env = msg.match(R.VAR_ENV);
    if (env) {
      variables.push({
        name:        env[1].trim(),
        value:       env[2].trim(),
        operation:   'ENV',
        timestamp:   line.ts,
        thread:      line.thread,
        executionId,
      });
    }
  }

  /**
   * Build a variable timeline — groups all changes per variable name,
   * sorted chronologically.
   * @param {object[]} variables — all variable records
   * @returns {Map<string, object[]>} name → sorted events
   */
  function buildTimeline(variables) {
    const timeline = new Map();
    for (const v of variables) {
      if (!timeline.has(v.name)) timeline.set(v.name, []);
      timeline.get(v.name).push(v);
    }
    for (const events of timeline.values()) {
      events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }
    return timeline;
  }

  /**
   * Count variable usage (for "most used variables" KPI).
   * @returns {Array<{name, count}>} sorted descending
   */
  function usageRanking(variables) {
    const counts = {};
    for (const v of variables) {
      counts[v.name] = (counts[v.name] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  return { parseLine, buildTimeline, usageRanking };
})();

if (typeof window !== 'undefined') window.PKAVariableParser = PKAVariableParser;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAVariableParser = PKAVariableParser;
