/**
 * export-json.js — Concise JSON report (KPIs + per-job summary + problems)
 *
 * Not a raw dump of the internal stores: just what's needed to report on a
 * day's runs, computed by PKAReportData so it matches the dashboard.
 */

'use strict';

const PKAExportJSON = (() => {

  async function exportAll() {
    const { executions, dependencies, stats, fileName } = await PKAReportData.load();
    if (executions.length === 0) { alert('No hay datos para exportar. Carga un log primero.'); return; }

    const R = PKAReportData;
    const execRow = e => ({
      job:          e.rootJob,
      thread:       e.thread,
      inicio:       e.startTime ? new Date(e.startTime).toISOString() : null,
      fin:          e.endTime ? new Date(e.endTime).toISOString() : null,
      duracionMs:   e.duration || null,
      estado:       R.statusLabel(e),
      incidentes:   e.hasError ? (e.errorCount || 1) : 0,
      primerError:  e.firstErrorMessage || null,
    });

    // v2: every execution (not just failed ones), compact tuples so a full day stays light.
    // Read by the "Catálogo Pentaho" tool to cross runs with the repository catalog.
    const ESTADO = { complete: 'C', incomplete: 'I', open: 'A' };
    const compact = e => [
      e.rootJob || null,
      e.startTime || null,
      e.endTime || null,
      e.duration || null,
      ESTADO[e.status] || e.status || null,
      e.hasError ? (e.errorCount || 1) : 0,
      e.firstErrorMessage ? String(e.firstErrorMessage).slice(0, 300) : null,
    ];

    const payload = {
      version: 2,
      generado: new Date().toISOString(),
      archivo:  fileName || null,
      lineasProcesadas: stats?.linesTotal ?? null,
      kpis: R.summarize(executions),
      jobs: R.byRootJob(executions)
        .sort((a, b) => (b.failedExecs - a.failedExecs) || (b.avgDuration - a.avgDuration))
        .map(g => ({
          job: g.rootJob,
          ejecuciones: g.count,
          conError: g.failedExecs,
          porcentajeError: g.errorRatePct,
          incompletas: g.incompleteCount,
          duracionPromedioMs: Math.round(g.avgDuration),
          duracionMaximaMs: g.maxDuration,
          primerError: g.firstError,
        })),
      ejecucionesConError: executions.filter(e => e.hasError).map(execRow),
      ejecucionesIncompletas: executions.filter(e => e.status === 'incomplete').map(execRow),
      dependenciasExternas: R.externalDependencies(dependencies, executions)
        .map(d => ({ tipo: d.type, valor: d.value })),
      ejecucionesFormato: ['job', 'inicioMs', 'finMs', 'duracionMs', 'estado(C=completa,I=incompleta,A=abierta)', 'incidentes', 'primerError'],
      ejecuciones: executions
        .slice()
        .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
        .map(compact),
    };

    _download(JSON.stringify(payload, null, 2), `${R.fileBase(fileName)}.json`, 'application/json');
  }

  function _download(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return { exportAll };
})();

if (typeof window !== 'undefined') window.PKAExportJSON = PKAExportJSON;
