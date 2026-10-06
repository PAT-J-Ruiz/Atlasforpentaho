/**
 * metrics-parser.js — Row metrics & performance extractor
 *
 * Extracts (I=,O=,R=,W=,U=,E=) tuples and computes derived metrics.
 */

'use strict';

const PKAMetricsParser = (() => {

  const R = PKA_CONFIG.REGEX;

  /**
   * @param {object} line           — normalized line
   * @param {Array}  metrics        — accumulator
   * @param {string} executionId
   * @param {string} transformationName
   * @param {number} trfStart       — epoch ms when transformation started
   */
  function parseLine(line, metrics, executionId, transformationName, trfStart) {
    if (!line || line.isContinuation) return;

    const m = line.message.match(R.METRICS);
    if (!m) return;

    const rowsIn      = parseInt(m[1], 10);
    const rowsOut     = parseInt(m[2], 10);
    const rowsRead    = parseInt(m[3], 10);
    const rowsWritten = parseInt(m[4], 10);
    const rowsUpdated = parseInt(m[5], 10);
    const rowsErrors  = parseInt(m[6], 10);

    const duration  = trfStart && line.ts ? (line.ts - trfStart) : null;
    const totalRows = rowsRead + rowsWritten;
    const timePerRow = (duration && totalRows > 0) ? (duration / totalRows) : null;

    metrics.push({
      executionId,
      transformation: transformationName || 'Unknown',
      timestamp:      line.ts,
      thread:         line.thread,
      rowsIn,
      rowsOut,
      rowsRead,
      rowsWritten,
      rowsUpdated,
      rowsErrors,
      totalRows,
      duration,
      timePerRow,        // ms/row — key optimization KPI
    });
  }

  /**
   * Aggregate metrics across all transformations.
   * @param {object[]} metrics
   * @returns {object} summary
   */
  function aggregate(metrics) {
    let totalRows  = 0;
    let totalIn    = 0;
    let totalOut   = 0;
    let totalErr   = 0;
    let totalUpd   = 0;

    for (const m of metrics) {
      totalRows += m.totalRows  || 0;
      totalIn   += m.rowsIn     || 0;
      totalOut  += m.rowsOut    || 0;
      totalErr  += m.rowsErrors || 0;
      totalUpd  += m.rowsUpdated|| 0;
    }

    return { totalRows, totalIn, totalOut, totalErr, totalUpd, count: metrics.length };
  }

  /**
   * Top N slowest transformations by timePerRow (ms/row).
   * @param {object[]} metrics
   * @param {number}   n
   */
  function topSlowestByTimePerRow(metrics, n = 10) {
    return [...metrics]
      .filter(m => m.timePerRow !== null && m.timePerRow > 0)
      .sort((a, b) => b.timePerRow - a.timePerRow)
      .slice(0, n);
  }

  return { parseLine, aggregate, topSlowestByTimePerRow };
})();

if (typeof window !== 'undefined') window.PKAMetricsParser = PKAMetricsParser;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAMetricsParser = PKAMetricsParser;
