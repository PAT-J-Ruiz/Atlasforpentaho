/**
 * file-parser.js — Infrastructure dependency extractor
 *
 * Detects from log lines:
 *  - SMB Shares  (\\SERVER\SHARE)
 *  - Windows local paths (C:\...)
 *  - Unix local paths (/mnt/...)
 *  - API URLs (http/https)
 *  - Server hostnames (pattern-matched)
 *  - Stored Procedures (EXEC PRC_/SP_/USP_)
 *  - Database connection strings (JDBC)
 */

'use strict';

const PKAFileParser = (() => {

  const R = PKA_CONFIG.REGEX;

  // Dependency type labels
  const TYPE = {
    SMB:    'SMB Share',
    WIN:    'Local Path (Windows)',
    UNIX:   'Local Path (Unix)',
    API:    'API Endpoint',
    SERVER: 'Server',
    PROC:   'Stored Procedure',
    DB:     'Database Connection',
  };

  /**
   * @param {object} line          — normalized line
   * @param {Map}    seen          — dedup map: type+value → true
   * @param {Array}  dependencies  — accumulator
   * @param {string} executionId
   */
  function parseLine(line, seen, dependencies, executionId) {
    if (!line) return;

    const src = `${line.raw || ''} ${line.message || ''}`;

    _extract(src, R.SMB_SHARE,       TYPE.SMB,    seen, dependencies, line, executionId);
    _extract(src, R.LOCAL_PATH_WIN,  TYPE.WIN,    seen, dependencies, line, executionId);
    _extract(src, R.LOCAL_PATH_UNIX, TYPE.UNIX,   seen, dependencies, line, executionId);
    _extract(src, R.API_URL,         TYPE.API,    seen, dependencies, line, executionId);
    _extract(src, R.STORED_PROC,     TYPE.PROC,   seen, dependencies, line, executionId);
    _extract(src, R.DB_CONN,         TYPE.DB,     seen, dependencies, line, executionId);
    _extractServers(src,             seen, dependencies, line, executionId);
  }

  function _extract(src, regex, type, seen, deps, line, executionId) {
    // Reset lastIndex for global regexes
    const re = new RegExp(regex.source, regex.flags);
    let m;
    while ((m = re.exec(src)) !== null) {
      const value = m[0].trim();
      const key   = `${type}|${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      deps.push({ type, value, timestamp: line.ts, thread: line.thread, executionId });
    }
  }

  function _extractServers(src, seen, deps, line, executionId) {
    const re = new RegExp(R.SERVER_NAME.source, R.SERVER_NAME.flags);
    let m;
    while ((m = re.exec(src)) !== null) {
      const value = m[1];
      const key   = `${TYPE.SERVER}|${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      deps.push({ type: TYPE.SERVER, value, timestamp: line.ts, thread: line.thread, executionId });
    }
  }

  /**
   * Group dependencies by type for display.
   * @param {object[]} dependencies
   * @returns {object} { 'SMB Share': [...], 'API Endpoint': [...], ... }
   */
  function groupByType(dependencies) {
    const groups = {};
    for (const d of dependencies) {
      if (!groups[d.type]) groups[d.type] = [];
      groups[d.type].push(d);
    }
    return groups;
  }

  /**
   * Count usage of each dependency (for "most used servers" KPI).
   */
  function usageRanking(dependencies, type) {
    const filtered = type ? dependencies.filter(d => d.type === type) : dependencies;
    const counts   = {};
    const typeOf   = {};
    for (const d of filtered) {
      counts[d.value] = (counts[d.value] || 0) + 1;
      typeOf[d.value] = d.type;
    }
    return Object.entries(counts)
      .map(([value, count]) => ({ value, count, type: typeOf[value] || type || '' }))
      .sort((a, b) => b.count - a.count);
  }

  return { parseLine, groupByType, usageRanking, TYPE };
})();

if (typeof window !== 'undefined') window.PKAFileParser = PKAFileParser;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAFileParser = PKAFileParser;
