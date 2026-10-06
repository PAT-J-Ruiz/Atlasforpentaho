/**
 * errors-view.js — Cross-execution error triage
 *
 * Shows every EXECUTION that has a genuine detected failure (PKAErrorDetector,
 * see js/core/error-detector.js), grouped by root job, so support can see at
 * a glance which processes are failing across the whole file and jump
 * straight into the offending log — one click, not a search.
 */

'use strict';

const PKAErrorsView = (() => {

  async function render() {
    const container = document.getElementById('view-errors');
    if (!container) return;

    await PKAStorage.open();
    const executions = (await PKAStorage.getAll('executions')).filter(e => e.hasError);
    executions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

    const groups = new Map();
    for (const e of executions) {
      const key = e.rootJob || '(sin job raíz)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    // Jobs that fail most often first — a job failing in 3 runs is a bigger
    // support problem than one run with a long cascade of incidents.
    const sortedGroups = Array.from(groups.entries())
      .sort((a, b) => (b[1].length - a[1].length) || (_totalErrors(b[1]) - _totalErrors(a[1])));

    const totalErrors = executions.reduce((s, e) => s + (e.errorCount || 1), 0);

    container.innerHTML = `
      <div class="view-header">
        <h2>❌ Errores</h2>
        <span class="badge">${executions.length} ejecución(es) fallida(s) · ${groups.size} job(s) · ${totalErrors} incidente(s)</span>
      </div>
      <p class="view-hint">Un incidente agrupa el mensaje de error y su traza completa. Haz clic en una fila para abrir el log justo en el error.</p>
      ${executions.length === 0
        ? '<p class="empty">🎉 Ninguna ejecución con error detectado.</p>'
        : `<div class="errors-groups">${sortedGroups.map(([rootJob, execs]) => _groupCard(rootJob, execs)).join('')}</div>`}
    `;

    _wireClicks(container);
  }

  function _totalErrors(execs) {
    return execs.reduce((s, e) => s + (e.errorCount || 1), 0);
  }

  function _groupCard(rootJob, execs) {
    return `
      <div class="error-group">
        <div class="error-group-header">
          <span class="root-group-icon">📁</span>
          <span class="root-group-name">${_esc(rootJob)}</span>
          <span class="badge badge-danger">${execs.length} ejecución(es) · ${_totalErrors(execs)} incidente(s)</span>
        </div>
        <div class="error-exec-list">
          ${execs.map(_execRow).join('')}
        </div>
      </div>`;
  }

  function _execRow(e) {
    const date = e.startTime ? new Date(e.startTime).toLocaleString(undefined, {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) : '—';
    const preview = e.firstErrorMessage || 'Abre el log para ver el detalle del error.';
    return `
      <div class="error-exec-row" data-exec-id="${_esc(e.executionId)}" title="${_esc(e.thread)}">
        <span class="status-dot status-dot-error"></span>
        <span class="error-exec-time">${date}</span>
        <span class="error-exec-msg">${_esc(preview)}</span>
        <span class="badge badge-danger">${e.errorCount || 1} incidente(s)</span>
        ${e.status === 'incomplete' ? '<span class="badge badge-warn">⚠️ incompleta</span>' : ''}
        <span class="error-exec-action">Ver log →</span>
      </div>`;
  }

  function _wireClicks(container) {
    container.querySelectorAll('.error-exec-row').forEach(row => {
      row.addEventListener('click', async () => {
        const execId = row.dataset.execId;
        await PKAApp.navigateTo('executions');
        PKAExecutionsView.openExecution(execId, { jumpTo: 'error' });
      });
    });
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { render };
})();

if (typeof window !== 'undefined') window.PKAErrorsView = PKAErrorsView;
