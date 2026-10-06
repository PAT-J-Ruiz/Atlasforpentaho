/**
 * performance-view.js — Root-job performance ranking
 *
 * One row per root job (not per thread), aggregating all its executions:
 * how many ran, how long they usually take, how often they fail or hang.
 * The point is spotting chronically slow or unstable processes across the
 * whole day, which a single execution's detail view can't show on its own.
 */

'use strict';

const PKAPerformanceView = (() => {

  const COLUMNS = [
    ['rootJob', 'Job raíz'],
    ['count', 'Ejecuciones'],
    ['avgDuration', 'Duración prom.'],
    ['maxDuration', 'Duración máx.'],
    ['errorRatePct', '% con error'],
    ['incompleteCount', 'Incompletas'],
  ];

  let _rows = [];
  let _sort = { col: 'avgDuration', dir: -1 };

  async function render() {
    const container = document.getElementById('view-performance');
    if (!container) return;

    await PKAStorage.open();
    const executions = await PKAStorage.getAll('executions');
    _rows = PKAReportData.byRootJob(executions); // same aggregation as the exports
    _sort = { col: 'avgDuration', dir: -1 };
    _applySort();

    container.innerHTML = `
      <div class="view-header">
        <h2>⏱️ Rendimiento</h2>
        <span class="badge">${_rows.length} jobs raíz</span>
        <div class="view-controls">
          <input type="text" id="perf-filter" class="filter-input" placeholder="Filtrar por job..." />
        </div>
      </div>
      <p class="view-hint">Un resumen por proceso de todas sus ejecuciones del día. Haz clic en un job para ver sus ejecuciones.</p>
      <div class="table-wrapper">
        <table class="data-table" id="perf-table">
          <thead><tr>${_headerCells()}</tr></thead>
          <tbody id="perf-tbody"></tbody>
        </table>
      </div>`;

    _renderRows(container);
    _wireEvents(container);
  }

  function _headerCells() {
    return COLUMNS.map(([col, label]) => {
      const arrow = _sort.col === col ? (_sort.dir === 1 ? ' ▲' : ' ▼') : '';
      return `<th class="sortable" data-col="${col}">${label}${arrow}</th>`;
    }).join('');
  }

  function _applySort() {
    const { col, dir } = _sort;
    _rows.sort((a, b) => {
      const va = a[col], vb = b[col];
      if (typeof va === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  function _renderRows(container, filterTerm = '') {
    const term = filterTerm.toLowerCase();
    const filtered = term ? _rows.filter(r => r.rootJob.toLowerCase().includes(term)) : _rows;
    const tbody = container.querySelector('#perf-tbody');
    const maxAvg = Math.max(1, ..._rows.map(r => r.avgDuration));

    tbody.innerHTML = filtered.length === 0
      ? '<tr><td colspan="6" class="empty">No hay jobs que coincidan.</td></tr>'
      : filtered.map(r => `
        <tr class="perf-row" data-root="${_esc(r.rootJob)}">
          <td class="perf-name">${_esc(r.rootJob)}</td>
          <td>${r.count}</td>
          <td>
            <div class="perf-duration">
              <span>${_fmtMs(r.avgDuration)}</span>
              <span class="perf-bar"><span style="width:${Math.round((r.avgDuration / maxAvg) * 100)}%"></span></span>
            </div>
          </td>
          <td>${_fmtMs(r.maxDuration)}</td>
          <td>${r.errorRatePct > 0 ? `<span class="badge badge-danger">${r.errorRatePct}%</span>` : '<span class="muted">0%</span>'}</td>
          <td>${r.incompleteCount > 0 ? `<span class="badge badge-warn">${r.incompleteCount}</span>` : '<span class="muted">0</span>'}</td>
        </tr>`).join('');
  }

  function _wireEvents(container) {
    const filterInput = container.querySelector('#perf-filter');
    filterInput?.addEventListener('input', () => _renderRows(container, filterInput.value));

    const table = container.querySelector('#perf-table');
    table?.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (th) {
        const col = th.dataset.col;
        _sort = { col, dir: _sort.col === col ? -_sort.dir : -1 };
        _applySort();
        table.querySelector('thead tr').innerHTML = _headerCells();
        _renderRows(container, filterInput?.value || '');
        return;
      }

      const row = e.target.closest('.perf-row');
      if (row) {
        PKAApp.navigateTo('executions').then(() => PKAExecutionsView.searchFor(row.dataset.root));
      }
    });
  }

  function _fmtMs(ms) {
    if (!ms) return '—';
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { render };
})();

if (typeof window !== 'undefined') window.PKAPerformanceView = PKAPerformanceView;
