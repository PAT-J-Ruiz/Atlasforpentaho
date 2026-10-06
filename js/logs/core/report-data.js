/**
 * report-data.js — Single source of truth for KPIs and summaries
 *
 * The dashboard and every export (JSON / CSV / PDF) compute their numbers
 * here, so a KPI can never mean one thing on screen and another in a file.
 * Everything is per EXECUTION (one run of one root job), never per thread.
 */

'use strict';

const PKAReportData = (() => {

  async function load() {
    await PKAStorage.open();
    const [executions, dependencies, stats, fileName] = await Promise.all([
      PKAStorage.getAll('executions'),
      PKAStorage.getAll('dependencies'),
      PKAStorage.getMeta('lastIngestStats'),
      PKAStorage.getMeta('lastFile'),
    ]);
    return { executions, dependencies, stats, fileName };
  }

  /** Headline KPIs. "Completas sin error" excludes failed runs; an execution
   * can be both incomplete and failed, so the three buckets may overlap. */
  function summarize(executions) {
    const total      = executions.length;
    const completeOk = executions.filter(e => e.status === 'complete' && !e.hasError).length;
    const incomplete = executions.filter(e => e.status === 'incomplete').length;
    const withError  = executions.filter(e => e.hasError).length;
    const incidents  = executions.reduce((s, e) => s + (e.hasError ? (e.errorCount || 1) : 0), 0);
    const rootJobs   = new Set(executions.map(e => e.rootJob || '(sin job raíz)')).size;
    const failedJobs = new Set(executions.filter(e => e.hasError).map(e => e.rootJob || '(sin job raíz)')).size;
    return {
      total, completeOk, incomplete, withError, incidents, rootJobs, failedJobs,
      completeOkPct: pct(completeOk, total),
      withErrorPct:  pct(withError, total),
    };
  }

  /** One row per root job, aggregating all its executions. */
  function byRootJob(executions) {
    const map = new Map();
    for (const e of executions) {
      const key = e.rootJob || '(sin job raíz)';
      if (!map.has(key)) {
        map.set(key, { rootJob: key, count: 0, totalDuration: 0, maxDuration: 0,
          failedExecs: 0, incidents: 0, incompleteCount: 0, firstError: null });
      }
      const g = map.get(key);
      g.count++;
      if (e.duration) {
        g.totalDuration += e.duration;
        g.maxDuration = Math.max(g.maxDuration, e.duration);
      }
      if (e.hasError) {
        g.failedExecs++;
        g.incidents += (e.errorCount || 1);
        if (!g.firstError && e.firstErrorMessage) g.firstError = e.firstErrorMessage;
      }
      if (e.status === 'incomplete') g.incompleteCount++;
    }
    return Array.from(map.values()).map(g => ({
      ...g,
      avgDuration:  g.count ? g.totalDuration / g.count : 0,
      errorRatePct: pct(g.failedExecs, g.count),
    }));
  }

  /** Drops what the path detector picks up from the ETL's own job paths
   * (.kjb/.ktr files, and fragments of job paths cut at a space). */
  function externalDependencies(dependencies, executions) {
    const rootJobs = [...new Set(executions.map(e => e.rootJob).filter(Boolean))];
    return dependencies
      .filter(d => !/\.(kjb|ktr)$/i.test(d.value))
      .filter(d => !rootJobs.some(r => r.startsWith(d.value)))
      .sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
  }

  function pct(n, total) {
    return total ? Math.round((n / total) * 1000) / 10 : 0;
  }

  function statusLabel(e) {
    if (e.hasError) return e.status === 'incomplete' ? 'Con error · incompleta' : 'Con error';
    return e.status === 'incomplete' ? 'Incompleta' : 'Completa';
  }

  function fmtDuration(ms) {
    if (!ms) return '—';
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  }

  function fmtDateTime(ts) {
    return ts ? new Date(ts).toLocaleString() : '—';
  }

  /** Base name for export files: "pka-<log name without extension>". */
  function fileBase(fileName) {
    const clean = (fileName || 'log').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
    return `pka-${clean}`;
  }

  return { load, summarize, byRootJob, externalDependencies, statusLabel, fmtDuration, fmtDateTime, fileBase, pct };
})();

if (typeof window !== 'undefined') window.PKAReportData = PKAReportData;
