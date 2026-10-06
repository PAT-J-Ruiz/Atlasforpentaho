/**
 * export-pdf.js — Concise printable report (PDF via the browser's print)
 *
 * Same KPIs as the dashboard (PKAReportData), then only what support needs
 * to act on: which jobs failed and why, what hung, what was slowest.
 */

'use strict';

const PKAExportPDF = (() => {

  async function exportReport() {
    const { executions, dependencies, stats, fileName } = await PKAReportData.load();
    if (executions.length === 0) { alert('No hay datos para exportar. Carga un log primero.'); return; }

    const R = PKAReportData;
    const k = R.summarize(executions);
    const jobs = R.byRootJob(executions);

    const failedJobs = jobs.filter(g => g.failedExecs > 0)
      .sort((a, b) => (b.failedExecs - a.failedExecs) || (b.incidents - a.incidents));
    const incomplete = executions.filter(e => e.status === 'incomplete')
      .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    const slowest = executions.filter(e => e.duration)
      .sort((a, b) => b.duration - a.duration).slice(0, 10);
    const deps = R.externalDependencies(dependencies, executions);

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${_esc(R.fileBase(fileName))} — Informe de ejecuciones</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1e293b; margin: 14mm; }
  h1 { font-size: 16pt; margin: 0 0 2px; }
  .meta { color: #64748b; font-size: 9pt; margin-bottom: 14px; }
  h2 { font-size: 11.5pt; color: #1e40af; margin: 20px 0 6px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .kpi { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .kpi b { display: block; font-size: 17pt; }
  .kpi span { font-size: 8.5pt; color: #64748b; }
  .kpi.ok b { color: #16a34a; } .kpi.err b { color: #dc2626; } .kpi.warn b { color: #ca8a04; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8.5pt; color: #475569; border-bottom: 1.5px solid #94a3b8; padding: 4px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; font-size: 9pt; vertical-align: top; }
  .path { font-family: Consolas, monospace; font-size: 8.5pt; word-break: break-all; }
  .err-msg { font-family: Consolas, monospace; font-size: 8pt; color: #b91c1c; word-break: break-word; }
  .num { text-align: right; white-space: nowrap; }
  .none { color: #64748b; font-style: italic; }
  tr { page-break-inside: avoid; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>Informe de ejecuciones Pentaho</h1>
<div class="meta">
  Archivo: <strong>${_esc(fileName || '—')}</strong> ·
  ${stats?.linesTotal ? `${stats.linesTotal.toLocaleString()} líneas analizadas · ` : ''}
  Generado: ${new Date().toLocaleString()}
</div>

<div class="kpis">
  <div class="kpi"><b>${k.total.toLocaleString()}</b><span>Ejecuciones de ${k.rootJobs} jobs raíz</span></div>
  <div class="kpi ok"><b>${k.completeOk.toLocaleString()}</b><span>Completas sin error · ${k.completeOkPct}%</span></div>
  <div class="kpi err"><b>${k.withError.toLocaleString()}</b><span>Con error · ${k.withErrorPct}%</span></div>
  <div class="kpi err"><b>${k.failedJobs}</b><span>Jobs con al menos una falla</span></div>
  <div class="kpi warn"><b>${k.incomplete}</b><span>Incompletas (sin cierre)</span></div>
</div>

<h2>Jobs con ejecuciones fallidas</h2>
${failedJobs.length === 0 ? '<p class="none">Ninguna ejecución con error detectado.</p>' : `
<table>
  <thead><tr><th>Job raíz</th><th class="num">Fallidas / total</th><th class="num">Incidentes</th><th>Primer error</th></tr></thead>
  <tbody>${failedJobs.map(g => `<tr>
    <td class="path">${_esc(g.rootJob)}</td>
    <td class="num">${g.failedExecs} / ${g.count}</td>
    <td class="num">${g.incidents}</td>
    <td class="err-msg">${_esc((g.firstError || '—').slice(0, 220))}</td>
  </tr>`).join('')}</tbody>
</table>`}

<h2>Ejecuciones incompletas (sin "Job execution finished")</h2>
${incomplete.length === 0 ? '<p class="none">Todas las ejecuciones cerraron correctamente.</p>' : `
<table>
  <thead><tr><th>Job raíz</th><th>Thread</th><th>Inicio</th><th>Última actividad</th></tr></thead>
  <tbody>${incomplete.map(e => `<tr>
    <td class="path">${_esc(e.rootJob)}</td>
    <td>${_esc(e.thread)}</td>
    <td>${R.fmtDateTime(e.startTime)}</td>
    <td>${R.fmtDateTime(e.endTime)}</td>
  </tr>`).join('')}</tbody>
</table>`}

<h2>Las 10 ejecuciones más lentas</h2>
<table>
  <thead><tr><th>Job raíz</th><th>Inicio</th><th class="num">Duración</th><th>Estado</th></tr></thead>
  <tbody>${slowest.map(e => `<tr>
    <td class="path">${_esc(e.rootJob)}</td>
    <td>${R.fmtDateTime(e.startTime)}</td>
    <td class="num">${R.fmtDuration(e.duration)}</td>
    <td>${R.statusLabel(e)}</td>
  </tr>`).join('')}</tbody>
</table>

<h2>Dependencias externas detectadas</h2>
${deps.length === 0 ? '<p class="none">No se detectaron dependencias externas.</p>' : `
<table>
  <thead><tr><th>Tipo</th><th>Valor</th></tr></thead>
  <tbody>${deps.map(d => `<tr><td>${_esc(d.type)}</td><td class="path">${_esc(d.value)}</td></tr>`).join('')}</tbody>
</table>`}

</body></html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('El navegador bloqueó la ventana del informe. Permite ventanas emergentes para este sitio.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { exportReport };
})();

if (typeof window !== 'undefined') window.PKAExportPDF = PKAExportPDF;
