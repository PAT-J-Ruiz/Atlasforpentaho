/**
 * dependencies-view.js — Infrastructure dependencies, linked to executions
 *
 * Same detection as before (SMB shares, DB connections, API endpoints,
 * servers, stored procedures, local paths) but each item now points at the
 * execution (root job) that referenced it, instead of a flat global list
 * with no execution context.
 */

'use strict';

const PKADependenciesView = (() => {

  async function render() {
    const container = document.getElementById('view-dependencies');
    if (!container) return;

    await PKAStorage.open();
    const [deps, executions] = await Promise.all([
      PKAStorage.getAll('dependencies'),
      PKAStorage.getAll('executions'),
    ]);

    const execById = new Map(executions.map(e => [e.executionId, e]));

    // Drops the ETL's own job paths picked up by the path detector — same
    // rule the exports use (js/core/report-data.js).
    const real = PKAReportData.externalDependencies(deps, executions);
    const groups = PKAFileParser.groupByType(real);

    container.innerHTML = `
      <div class="view-header">
        <h2>🔗 Dependencias</h2>
        <span class="badge">${real.length} externas detectadas</span>
        <div class="view-controls">
          <input type="text" id="deps-filter" class="filter-input" placeholder="Filtrar por valor o job..." />
        </div>
      </div>
      <div class="deps-grid" id="deps-grid">
        ${Object.entries(groups).map(([type, items]) => _typeCard(type, items, execById)).join('')
          || '<p class="empty">No se detectaron dependencias externas.</p>'}
      </div>`;

    _wireEvents(container, execById, groups);
  }

  function _typeCard(type, items, execById) {
    return `
      <div class="deps-card" data-type="${_esc(type)}">
        <h4>${_esc(type)} <span class="badge">${items.length}</span></h4>
        <ul class="deps-list">
          ${items.slice(0, 200).map(d => _depItem(d, execById)).join('')}
        </ul>
      </div>`;
  }

  function _depItem(d, execById) {
    const exec = execById.get(d.executionId);
    const rootJob = exec ? exec.rootJob : null;
    return `
      <li class="deps-item" data-exec-id="${_esc(d.executionId || '')}" title="${_esc(rootJob || '')}">
        <span class="deps-value">${_esc(d.value)}</span>
        ${rootJob ? `<span class="deps-source">↳ usada por ${_esc(_shortLabel(rootJob))}</span>` : ''}
      </li>`;
  }

  /** Last path segment, keeping the parent folder when the job file is
   * unresolved ("…/null"), since "null" alone identifies nothing. */
  function _shortLabel(rootJob) {
    const parts = rootJob.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || rootJob;
    return last === 'null' && parts.length > 1 ? `${parts[parts.length - 2]}/null` : last;
  }

  function _wireEvents(container, execById, groups) {
    const filterInput = container.querySelector('#deps-filter');
    filterInput?.addEventListener('input', () => {
      const term = filterInput.value.toLowerCase();
      const grid = container.querySelector('#deps-grid');
      grid.innerHTML = Object.entries(groups)
        .map(([type, items]) => {
          const filtered = term
            ? items.filter(d => d.value.toLowerCase().includes(term)
                || (execById.get(d.executionId)?.rootJob || '').toLowerCase().includes(term))
            : items;
          return filtered.length ? _typeCard(type, filtered, execById) : '';
        })
        .join('') || '<p class="empty">Sin coincidencias.</p>';
    });

    container.querySelector('#deps-grid')?.addEventListener('click', async (e) => {
      const item = e.target.closest('.deps-item');
      if (!item || !item.dataset.execId) return;
      await PKAApp.navigateTo('executions');
      PKAExecutionsView.openExecution(item.dataset.execId, { jumpTo: 'start' });
    });
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { render };
})();

if (typeof window !== 'undefined') window.PKADependenciesView = PKADependenciesView;
