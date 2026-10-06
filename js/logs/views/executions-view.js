/**
 * executions-view.js — Execution reconstruction view
 *
 * Groups executions by root job (path-chain element 0), and lets the user
 * read a single execution's deduplicated, attributed log in order, with
 * multi-line blocks kept intact and indented by nesting depth.
 */

'use strict';

const PKAExecutionsView = (() => {

  const STATUS_LABEL = { complete: 'Completa', incomplete: 'Incompleta', open: 'Abierta' };

  let _executions = [];
  let _groups      = new Map();   // rootJob → executions[]
  let _collapsed   = new Set();   // rootJob values collapsed by the user
  let _groupSort   = 'recent';    // 'recent' | 'name' | 'count'
  let _execSort    = 'asc';       // 'asc' (chronological, by hour) | 'desc' (newest first)
  let _selectedExecId = null;
  let _blocks       = [];         // blocks of the currently selected execution
  let _currentExec  = null;       // the currently displayed execution record
  let _searchTerm   = '';
  let _searchDebounce = null;

  // Global content search — matches any execution whose LOG (not just its
  // job name / thread) contains the search term anywhere.
  let _globalMatchIds  = null;    // Set<executionId> | null (no active global search)
  let _globalSearching = false;
  let _globalSearchDebounce = null;
  let _globalSearchSeq = 0;       // guards against out-of-order async responses

  async function render() {
    const container = document.getElementById('view-executions');
    if (!container) return;

    await PKAStorage.open();
    _executions = await PKAStorage.getAll('executions');
    _executions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

    _groups = new Map();
    for (const exec of _executions) {
      const key = exec.rootJob || '(sin job raíz)';
      if (!_groups.has(key)) _groups.set(key, []);
      _groups.get(key).push(exec);
    }

    const ingestStats = await PKAStorage.getMeta('lastIngestStats');

    container.innerHTML = `
      <div class="view-header">
        <h2>🔁 Ejecuciones</h2>
        <span class="badge" id="exec-count">${_executions.length} ejecuciones · ${_groups.size} jobs raíz</span>
        <div class="view-controls">
          <span class="search-wrap">
            <input type="text" id="exec-search" class="filter-input" placeholder="🔍 Buscar palabra clave en todo el log..." />
            <span id="exec-search-status" class="search-status"></span>
          </span>
          <select id="exec-status" class="filter-select">
            <option value="">Todos los estados</option>
            <option value="complete">Completas</option>
            <option value="incomplete">Incompletas</option>
            <option value="error">Con errores</option>
          </select>
          <select id="exec-group-sort" class="filter-select">
            <option value="recent">Jobs: más recientes primero</option>
            <option value="name">Jobs: A-Z</option>
            <option value="count">Jobs: más ejecuciones primero</option>
          </select>
          <select id="exec-time-sort" class="filter-select">
            <option value="asc" selected>Horas: por orden del día (más antigua primero)</option>
            <option value="desc">Horas: más reciente primero</option>
          </select>
          <select id="exec-jump" class="filter-select">
            <option value="">📁 Saltar a un job...</option>
            ${_jumpOptions()}
          </select>
        </div>
      </div>
      ${ingestStats ? _contrastsPanel(ingestStats) : ''}
      <div class="exec-layout">
        <div class="exec-list" id="exec-group-list">
          ${_renderGroups()}
        </div>
        <div class="exec-detail" id="exec-detail">
          <p class="empty">Selecciona una ejecución para ver su log.</p>
        </div>
      </div>`;

    _wireEvents(container);
  }

  function _contrastsPanel(s) {
    return `
      <div class="mini-table-wrap" style="max-height:none; margin-bottom:14px;">
        <div class="block-toolbar" style="font-size:0.8em; color:var(--color-text-muted); flex-wrap:wrap;">
          <span>Líneas: <strong>${s.linesTotal?.toLocaleString() ?? '—'}</strong>
            (cabecera ${s.linesHeader?.toLocaleString() ?? '—'} ·
             continuación ${s.linesContinuation?.toLocaleString() ?? '—'} ·
             vacías ${s.linesEmpty?.toLocaleString() ?? '—'})</span>
          <span>Ejecuciones: <strong>${s.executions ?? '—'}</strong>
            (abiertas ${s.executionsOpened ?? '—'} · cerradas ${s.executionsClosed ?? '—'} ·
             incompletas ${s.executionsIncomplete ?? '—'} ·
             <strong style="color:var(--color-danger)">con error ${s.executionsWithError ?? '—'}</strong>)</span>
          <span>Jobs raíz: <strong>${s.rootJobs ?? '—'}</strong></span>
          <span>Bloques no emparejados: <strong>${s.blocksUnmatched ?? '—'}</strong></span>
          <span>Bloques no atribuidos: <strong>${s.blocksUnattributed ?? '—'}</strong></span>
        </div>
      </div>`;
  }

  function _jumpOptions() {
    const roots = Array.from(_groups.keys()).sort((a, b) => a.localeCompare(b));
    return roots.map(r => `<option value="${_esc(r)}">${_esc(r)}</option>`).join('');
  }

  function _renderGroups(filterTerm = '', filterStatus = '') {
    const term = filterTerm.toLowerCase();

    let entries = Array.from(_groups.entries()).map(([rootJob, execs]) => {
      let filtered = execs;
      if (term) {
        filtered = filtered.filter(e =>
          rootJob.toLowerCase().includes(term) ||
          (e.thread || '').toLowerCase().includes(term) ||
          (_globalMatchIds && _globalMatchIds.has(e.executionId)));
      }
      if (filterStatus === 'error') {
        filtered = filtered.filter(e => e.hasError);
      } else if (filterStatus) {
        filtered = filtered.filter(e => e.status === filterStatus);
      }
      return { rootJob, filtered };
    }).filter(g => g.filtered.length > 0);

    // Order executions inside each group by time.
    const timeDir = _execSort === 'asc' ? 1 : -1;
    for (const g of entries) {
      g.filtered = [...g.filtered].sort((a, b) => ((a.startTime || 0) - (b.startTime || 0)) * timeDir);
    }

    // Order the groups themselves.
    if (_groupSort === 'name') {
      entries.sort((a, b) => a.rootJob.localeCompare(b.rootJob));
    } else if (_groupSort === 'count') {
      entries.sort((a, b) => b.filtered.length - a.filtered.length);
    } else { // 'recent' — by that group's most recent execution
      entries.sort((a, b) => {
        const aMax = Math.max(...a.filtered.map(e => e.startTime || 0));
        const bMax = Math.max(...b.filtered.map(e => e.startTime || 0));
        return bMax - aMax;
      });
    }

    if (entries.length === 0) return '<p class="empty">No hay ejecuciones que coincidan.</p>';

    return entries.map(({ rootJob, filtered }) => {
      const collapsed = _collapsed.has(rootJob) ? 'collapsed' : '';
      return `
        <div class="root-group ${collapsed}" data-root="${_esc(rootJob)}">
          <div class="root-group-header">
            <span class="caret">▾</span>
            <span class="root-group-icon">📁</span>
            <span class="root-group-name">${_esc(rootJob)}</span>
            <span class="badge">${filtered.length}</span>
          </div>
          <div class="exec-list">
            ${filtered.map(_execCard).join('')}
          </div>
        </div>`;
    }).join('');
  }

  function _execCard(e) {
    const dur  = e.duration ? _fmtMs(e.duration) : '?';
    const date = e.startTime ? new Date(e.startTime).toLocaleString(undefined, {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) : '—';
    const flags = [];
    if (e.hasError) flags.push('❌');
    if (e.status === 'incomplete') flags.push('⚠️');
    if (e.lowConfidence) flags.push('❓');
    const dotClass = e.hasError ? 'status-dot-error' : `status-dot-${e.status}`;
    return `
      <div class="exec-card status-${e.status} ${e.hasError ? 'has-error' : ''} ${e.executionId === _selectedExecId ? 'selected' : ''}"
           data-exec-id="${_esc(e.executionId)}" title="${_esc(e.thread)}">
        <span class="status-dot ${dotClass}"></span>
        <div class="exec-card-body">
          <div class="exec-card-time">${date} ${flags.join(' ')}</div>
          <div class="exec-card-meta">${dur} · ${e.blockCount ?? 0} líneas${e.hasError ? ` · ${e.errorCount} incidente(s)` : ''}</div>
        </div>
      </div>`;
  }

  function _wireEvents(container) {
    const search       = container.querySelector('#exec-search');
    const searchStatus = container.querySelector('#exec-search-status');
    const status    = container.querySelector('#exec-status');
    const groupSort = container.querySelector('#exec-group-sort');
    const timeSort  = container.querySelector('#exec-time-sort');
    const jump      = container.querySelector('#exec-jump');
    const groupList = container.querySelector('#exec-group-list');

    function refreshGroups() {
      groupList.innerHTML = _renderGroups(search.value, status.value);
    }

    // Global content search: looks inside every execution's actual log
    // (message/identifier/continuation text), not just the job path or
    // thread name, so e.g. "CargaExcel" finds every execution that ever
    // mentions it anywhere in its blocks.
    search?.addEventListener('input', () => {
      clearTimeout(_globalSearchDebounce);
      const value = search.value.trim();

      if (value.length < 3) {
        // Too short for a full-store scan — fall back to the cheap
        // rootJob/thread match only, and clear any previous global result.
        _globalMatchIds = null;
        if (searchStatus) searchStatus.textContent = '';
        refreshGroups();
        return;
      }

      if (searchStatus) searchStatus.textContent = 'Buscando…';
      const seq = ++_globalSearchSeq;
      _globalSearchDebounce = setTimeout(async () => {
        _globalSearching = true;
        const matches = await PKAStorage.searchBlockExecutions(value);
        if (seq !== _globalSearchSeq) return; // a newer search superseded this one
        _globalSearching = false;
        _globalMatchIds = matches;
        if (searchStatus) {
          searchStatus.textContent = matches.size
            ? `${matches.size} ejecución(es) contienen "${value}"`
            : `Sin coincidencias para "${value}"`;
        }
        refreshGroups();
      }, 350);
    });

    status?.addEventListener('change', refreshGroups);
    groupSort?.addEventListener('change', () => { _groupSort = groupSort.value; refreshGroups(); });
    timeSort?.addEventListener('change', () => { _execSort = timeSort.value; refreshGroups(); });

    jump?.addEventListener('change', () => {
      const root = jump.value;
      if (!root) return;
      _collapsed.delete(root);
      const group = groupList.querySelector(`.root-group[data-root="${CSS.escape(root)}"]`);
      if (group) {
        group.classList.remove('collapsed');
        group.scrollIntoView({ behavior: 'smooth', block: 'start' });
        group.classList.add('flash');
        setTimeout(() => group.classList.remove('flash'), 1600);
      }
      jump.value = '';
    });

    groupList.addEventListener('click', async (e) => {
      const header = e.target.closest('.root-group-header');
      if (header) {
        const group = header.closest('.root-group');
        const root = group.dataset.root;
        if (_collapsed.has(root)) _collapsed.delete(root);
        else _collapsed.add(root);
        group.classList.toggle('collapsed');
        return;
      }

      const card = e.target.closest('.exec-card');
      if (!card) return;
      groupList.querySelectorAll('.exec-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _selectedExecId = card.dataset.execId;
      await _showDetail(_selectedExecId, container);
    });
  }

  async function _showDetail(execId, container) {
    const exec = _executions.find(e => e.executionId === execId) || {};
    _currentExec = exec;
    clearTimeout(_searchDebounce);
    _blocks = await PKAStorage.getBlocksByExecution(execId);
    _searchTerm = '';

    const detail = container.querySelector('#exec-detail');
    detail.innerHTML = `
      <div class="detail-header">
        <h3 class="detail-title">${_esc(exec.rootJob || 'Ejecución')}</h3>
      </div>
      <div class="detail-meta">
        <span class="badge ${exec.status === 'incomplete' ? 'badge-warn' : 'badge-success'}">${STATUS_LABEL[exec.status] || exec.status}</span>
        ${exec.hasError ? `<span class="badge badge-danger">❌ ${exec.errorCount} incidente(s) de error</span>` : ''}
        <span>${_esc(exec.thread)}</span>
        <span>Inicio: ${exec.startTime ? new Date(exec.startTime).toLocaleString() : '—'}</span>
        <span>Duración: ${_fmtMs(exec.duration)}</span>
        <span>${_blocks.length.toLocaleString()} líneas</span>
        <button id="btn-jump-start" class="btn-evidence btn-jump">⤒ Ver inicio (Start of job execution)</button>
        ${exec.hasError
          ? '<button id="btn-jump-error" class="btn-evidence btn-error">❌ Ver primer error</button>'
          : ''}
        ${exec.status === 'incomplete'
          ? '<button id="btn-evidence" class="btn-evidence">⚠️ Ver por qué quedó incompleta</button>'
          : '<button id="btn-jump-end" class="btn-evidence btn-jump">⤓ Ver cierre (Job execution finished)</button>'}
      </div>
      <div class="block-search-bar">
        <input type="text" id="block-search" class="filter-input" placeholder="🔍 Buscar en este log..." />
        <span id="block-search-count" class="block-search-count"></span>
      </div>
      <div class="block-log" id="block-log"></div>`;

    _renderBlocks(container);
    _wireSearch(container);
    _wireJumpButtons(container);
  }

  /** Jump-to-evidence buttons: "start" scrolls to and flashes the first
   * line of the execution (its "Start of job execution"); "end" does the
   * same for the last line — either the real "Job execution finished"
   * (complete executions) or the end-of-file marker explaining there
   * genuinely is none (incomplete executions, per the raw file — not a
   * parser miss). Clearing any active search first guarantees the target
   * is actually in the rendered list. */
  function _wireJumpButtons(container) {
    function jumpTo(selector) {
      const searchInput = container.querySelector('#block-search');
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        _searchTerm = '';
        _renderBlocks(container);
      }
      requestAnimationFrame(() => {
        const target = container.querySelector(selector);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1600);
      });
    }

    container.querySelector('#btn-jump-start')?.addEventListener('click', () => jumpTo('.log-start-marker'));
    container.querySelector('#btn-jump-end')?.addEventListener('click', () => jumpTo('.log-tail-block'));
    container.querySelector('#btn-evidence')?.addEventListener('click', () => jumpTo('#log-end-marker'));
    container.querySelector('#btn-jump-error')?.addEventListener('click', () => {
      const blockId = _currentExec && _currentExec.firstErrorBlockId;
      if (blockId) jumpTo(`[data-block-id="${CSS.escape(blockId)}"]`);
    });
  }

  function _wireSearch(container) {
    const input = container.querySelector('#block-search');
    input?.addEventListener('input', () => {
      clearTimeout(_searchDebounce);
      const value = input.value;
      _searchDebounce = setTimeout(() => {
        _searchTerm = value.trim();
        _renderBlocks(container);
      }, 150);
    });
  }

  function _blockMatches(b, termLower) {
    if (b.message && b.message.toLowerCase().includes(termLower)) return true;
    if (b.identifier && b.identifier.toLowerCase().includes(termLower)) return true;
    return (b.continuationRaw || []).some(c => c.toLowerCase().includes(termLower));
  }

  /** Renders the chronological log for the selected execution — no
   * pagination, the panel just scrolls. When there's a search term, only
   * matching lines are shown (and highlighted) so huge executions (tens of
   * thousands of lines) stay fast and easy to scan. */
  function _renderBlocks(container) {
    const log   = container.querySelector('#block-log');
    const count = container.querySelector('#block-search-count');
    const term  = _searchTerm.toLowerCase();

    const visible = term ? _blocks.filter(b => _blockMatches(b, term)) : _blocks;

    log.innerHTML = visible.map((b, i) => _blockRow(b, {
      isFirst: i === 0,
      isLast:  i === visible.length - 1,
    })).join('') || '<p class="empty">' + (term ? 'Sin coincidencias.' : 'Sin líneas.') + '</p>';

    if (count) {
      count.textContent = term ? `${visible.length.toLocaleString()} de ${_blocks.length.toLocaleString()} líneas` : '';
    }

    if (_currentExec && _currentExec.status === 'incomplete' && visible.length) {
      log.insertAdjacentHTML('beforeend', `
        <div class="log-end-marker" id="log-end-marker">
          ⚠️ Fin del archivo para <strong>${_esc(_currentExec.thread)}</strong> —
          "Job execution finished" no aparece en ninguna línea de este thread en
          todo el archivo. No es un fallo del analizador: la ausencia se verificó
          contra el log completo. La ejecución quedó abierta aquí, sin cierre.
        </div>`);
    }
  }

  /**
   * Renders a block as one or more plain, chronological log lines —
   * "HH:mm:ss.SSS  identifier  message" — mirroring the original log's
   * readable shape instead of exposing internal block bookkeeping.
   * Continuation lines repeat the same timestamp/identifier so a multi-line
   * Write to Log payload still reads as a continuous trace.
   */
  function _blockRow(b, { isFirst = false, isLast = false } = {}) {
    const indent = Math.min(Math.max(0, (b.depth || 1) - 1), 8) * 10;
    const anomalyClass = b.anomaly ? `anomaly-${b.anomaly}` : '';
    const errorClass = b.isError ? 'error-block' : '';
    const markerClass = [isFirst ? 'log-start-marker' : '', isLast ? 'log-tail-block' : ''].filter(Boolean).join(' ');
    const time  = _fmtTime(b.ts);
    const ident = b.identifier || '';

    const badges = [];
    if (b.isError)                    badges.push('<span class="badge badge-error">❌ error</span>');
    if (b.anomaly === 'unmatched')    badges.push('<span class="badge badge-anomaly">no emparejado</span>');
    if (b.anomaly === 'unattributed') badges.push('<span class="badge badge-anomaly">no atribuido</span>');
    if (b.lowConfidence)              badges.push('<span class="badge badge-low-confidence">/null</span>');

    const lines = [_logLine(time, ident, b.message)];
    for (const c of (b.continuationRaw || [])) {
      lines.push(_logLine(time, ident, c));
    }

    return `<div class="block-row ${anomalyClass} ${errorClass} ${markerClass}" style="margin-left:${indent}px" data-block-id="${_esc(b.blockId)}">`
      + lines.join('')
      + (badges.length ? `<span class="block-badges">${badges.join('')}</span>` : '')
      + `</div>`;
  }

  function _logLine(time, ident, message) {
    return `<div class="log-line"><span class="log-time">${time}</span> `
      + `<span class="log-ident">${_highlight(ident)}</span> - ${_highlight(message)}</div>`;
  }

  /** Escapes text for HTML, then wraps case-insensitive matches of the
   * current search term in <mark> so hits stand out inline. */
  function _highlight(text) {
    const escaped = _esc(text);
    if (!_searchTerm) return escaped;
    const escTerm = _searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(`(${escTerm})`, 'ig'), '<mark>$1</mark>');
  }

  function _fmtTime(ts) {
    if (!ts) return '--:--:--.---';
    const d = new Date(ts);
    const p2 = n => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  }

  /** Formats a duration as ms / s / m+s / h+m, escalating the unit so a
   * multi-hour run reads as hours+minutes instead of an unreadable minute
   * count. */
  function _fmtMs(ms) {
    if (!ms) return '—';
    if (ms < 1000) return ms + 'ms';
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

  /** Deep-link: run this view's global content search for `term` — used by
   * the header search bar, which now just hands off to this view instead of
   * duplicating a separate cross-entity search screen. Call after render(). */
  function searchFor(term) {
    const container = document.getElementById('view-executions');
    const input = container?.querySelector('#exec-search');
    if (!input) return;
    input.value = term;
    input.dispatchEvent(new Event('input'));
  }

  /** Deep-link: open a specific execution's log directly — used by the
   * Errors / Performance / Dependencies views so "go look at this one" is a
   * single click instead of "find it again in the sidebar". Call after
   * render(). `jumpTo` optionally clicks one of the evidence buttons once
   * the detail panel is up ('error' | 'start' | 'end'). */
  async function openExecution(executionId, { jumpTo } = {}) {
    const container = document.getElementById('view-executions');
    if (!container) return;

    const exec = _executions.find(e => e.executionId === executionId);
    if (exec) _collapsed.delete(exec.rootJob || '(sin job raíz)');

    _selectedExecId = executionId;
    const groupList = container.querySelector('#exec-group-list');
    if (groupList) groupList.innerHTML = _renderGroups();

    await _showDetail(executionId, container);

    const cardEl = container.querySelector(`.exec-card[data-exec-id="${CSS.escape(executionId)}"]`);
    cardEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (jumpTo === 'error') container.querySelector('#btn-jump-error')?.click();
    else if (jumpTo === 'end') container.querySelector('#btn-jump-end, #btn-evidence')?.click();
    else if (jumpTo === 'start') container.querySelector('#btn-jump-start')?.click();
  }

  /** Deep-link: pre-select a status filter ('complete' | 'incomplete' |
   * 'error') — used by the dashboard's KPI cards. Call after render(). */
  function filterStatus(status) {
    const select = document.getElementById('view-executions')?.querySelector('#exec-status');
    if (!select) return;
    select.value = status;
    select.dispatchEvent(new Event('change'));
  }

  return { render, searchFor, openExecution, filterStatus };
})();

if (typeof window !== 'undefined') window.PKAExecutionsView = PKAExecutionsView;
