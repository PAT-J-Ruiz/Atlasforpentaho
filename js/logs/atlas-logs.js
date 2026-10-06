/* Atlas — módulo Logs. Integra el motor del Log Analyzer v2 (js/logs/*) dentro de Atlas:
   - procesa el log en un Web Worker (Live Server / http) o en la página (abierto desde disco);
   - al terminar, cruza las ejecuciones con el catálogo (Ejecuciones del día) sin exportar JSON;
   - reemplaza el dashboard de Chart.js por gráficos propios (100% offline). */
'use strict';

const LOG_VIEWS = [['resumen', 'Resumen'], ['executions', 'Ejecuciones'], ['errors', 'Errores'], ['performance', 'Rendimiento'], ['dependencies', 'Dependencias']];
let _logWorker = null, _logBusy = false;

/* ---------- advertencias conocidas (editables en Configuración) ---------- */
function knownWarningSources() {
  try { const s = JSON.parse(localStorage.getItem('atlas-known-warnings') || 'null'); if (Array.isArray(s)) return s; } catch (e) {}
  return (PKA_CONFIG.KNOWN_WARNINGS || []).map(r => r.source);
}
function applyKnownWarnings() {
  const res = []; for (const s of knownWarningSources()) { try { res.push(new RegExp(s, 'i')); } catch (e) {} }
  PKA_CONFIG.KNOWN_WARNINGS.length = 0; PKA_CONFIG.KNOWN_WARNINGS.push(...res);
  window.ADVERTENCIAS_CONOCIDAS = res; // también para los JSON importados en Ejecuciones del día
}

/* ---------- compatibilidad con las vistas del Log Analyzer ---------- */
window.PKAApp = {
  navigateTo: async (view) => {
    history.pushState(null, '', '#/logs/' + view);
    await renderLogs(view === 'dashboard' ? 'resumen' : view);
  },
};

/* ---------- puente Logs → Catálogo ---------- */
async function syncRunsFromLogs() {
  if (!M) return false;
  await PKAStorage.open();
  const [execs, file] = await Promise.all([PKAStorage.getAll('executions'), PKAStorage.getMeta('lastFile')]);
  if (!execs.length) return false;
  const ST = { complete: 'C', incomplete: 'I', open: 'A' };
  loadRuns({ version: 2, ejecuciones: execs.map(e => [e.rootJob, e.startTime, e.endTime, e.duration, ST[e.status] || e.status, e.hasError ? (e.errorCount || 1) : 0, e.firstErrorMessage]) }, file || 'log');
  return true;
}
const procOfJob = (job) => { if (!M || !job) return -1; const k = String(job).replace(/\.(kjb|ktr)$/i, '').toLowerCase(); const i = M.byPath.get(k); return i === undefined ? -1 : i; };
const jobLink = (job) => { const i = procOfJob(job); const name = String(job || '(sin job raíz)').split('/').pop().replace(/\.(kjb|ktr)$/i, '');
  return (i >= 0 ? plink(i) : '<span title="' + esc(job) + '">' + esc(name) + '</span>') + ' <a class="muted" href="#/logs/executions" data-job="' + esc(job) + '" title="Ver en Ejecuciones del log">log</a>'; };

/* ---------- vista ---------- */
function logsShell(view, hasData, file) {
  return '<div class="row" style="justify-content:space-between"><div><h1>Logs</h1><div class="muted">' + (hasData ? 'Log cargado: <b>' + esc(file || '?') + '</b> · se guarda en este navegador hasta que cargues otro.' : 'Carga el log de Pentaho del servidor (pdi.AAAA-MM-DD.log).') + '</div></div>' +
    '<div class="row"><button class="btn pri" id="lg-open">Cargar log</button>' + (hasData ? '<button class="btn" id="lg-json">JSON</button><button class="btn" id="lg-csv">CSV</button><button class="btn" id="lg-pdf">PDF</button><button class="btn" id="lg-reset" title="Borrar el log cargado">Borrar</button>' : '') + '</div></div>' +
    '<input type="file" id="lg-file" accept=".log,.txt,.out" hidden>' +
    '<div id="lg-prog" class="panel" hidden><div class="row" style="justify-content:space-between"><b id="lg-msg">Procesando…</b><span id="lg-pct" class="muted"></span></div><div class="bar" style="margin-top:8px"><i id="lg-bar"></i></div></div>' +
    (hasData ? '<div class="tabs">' + LOG_VIEWS.map(([id, t]) => '<a class="' + (id === view ? 'on' : '') + '" href="#/logs/' + id + '">' + t + '</a>').join('') + '<a href="#/ejecuciones">Cruce con catálogo →</a></div>' : '');
}
async function renderLogs(view) {
  view = view || 'resumen';
  const main = $('main');
  document.querySelectorAll('.side a.nv').forEach(x => x.classList.toggle('on', x.getAttribute('href') === '#/logs'));
  await PKAStorage.open();
  const n = await PKAStorage.count('executions');
  const file = await PKAStorage.getMeta('lastFile');
  main.innerHTML = logsShell(view, n > 0, file) + (n > 0 ? '<div class="lx" id="lx"></div>' : dropZone());
  bindLogsShell();
  if (!n) return;
  if (view === 'resumen') { $('#lx').innerHTML = await logsSummaryHtml(); bindJobLinks(); return; }
  $('#lx').innerHTML = '<section id="view-' + view + '" class="view-section"></section>';
  const mod = { executions: window.PKAExecutionsView, errors: window.PKAErrorsView, performance: window.PKAPerformanceView, dependencies: window.PKADependenciesView }[view];
  if (mod) await mod.render();
}
function dropZone() {
  return '<div class="panel" id="lg-drop" style="text-align:center;padding:40px 20px;border-style:dashed;cursor:pointer"><svg width="34" height="34" style="stroke:var(--accent);fill:none;stroke-width:1.6"><use href="#i-log"/></svg>' +
    '<h2 style="margin:10px 0 4px">Arrastra aquí el log de Pentaho</h2><div class="muted">o haz clic para elegirlo · .log, .txt, .out · admite archivos de más de 1 GB · se procesa en este equipo</div></div>';
}
function bindLogsShell() {
  const fi = $('#lg-file');
  $('#lg-open').onclick = () => fi.click();
  fi.onchange = () => { if (fi.files[0]) startLog(fi.files[0]); };
  const dz = $('#lg-drop');
  if (dz) {
    dz.onclick = () => fi.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; };
    dz.ondragleave = () => { dz.style.borderColor = ''; };
    dz.ondrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) startLog(f); };
  }
  if ($('#lg-json')) {
    $('#lg-json').onclick = () => PKAExportJSON.exportAll();
    $('#lg-csv').onclick = () => PKAExportExcel.exportKPIs();
    $('#lg-pdf').onclick = () => PKAExportPDF.exportReport();
    $('#lg-reset').onclick = async () => {
      if (!confirm('¿Borrar el log cargado? Se eliminan sus ejecuciones, bloques y errores guardados en este navegador.')) return;
      await PKAStorage.open(); await PKAStorage.clearAll(); location.hash = '#/logs'; location.reload();
    };
  }
  bindJobLinks();
}
function bindJobLinks() {
  document.querySelectorAll('a[data-job]').forEach(a => a.onclick = async (e) => { e.preventDefault(); await PKAApp.navigateTo('executions'); PKAExecutionsView.searchFor(a.dataset.job); });
}

/* ---------- procesamiento ---------- */
function startLog(file) {
  if (_logBusy) return;
  _logBusy = true;
  applyKnownWarnings();
  const prog = $('#lg-prog'); prog.hidden = false;
  const set = (pct, msg) => { $('#lg-bar').style.width = pct + '%'; $('#lg-pct').textContent = pct + '%'; if (msg) $('#lg-msg').textContent = msg; };
  set(0, 'Cargando ' + file.name + ' (' + (file.size / 1048576).toFixed(1) + ' MB)…');
  const PH = { reading: 'Leyendo el log…', organizing: 'Organizando ejecuciones…', saving: 'Guardando resultados…' };
  const onMsg = async (d) => {
    if (d.type === 'PROGRESS') set(d.pct, (PH[d.phase] || 'Procesando…') + ' ' + (d.linesProcessed || 0).toLocaleString('es') + ' líneas');
    else if (d.type === 'ERROR') { _logBusy = false; set(0, 'Error: ' + d.message); }
    else if (d.type === 'DONE') {
      _logBusy = false; if (_logWorker) { _logWorker.terminate(); _logWorker = null; }
      set(100, 'Listo: ' + d.stats.executions.toLocaleString('es') + ' ejecuciones de ' + d.stats.rootJobs + ' jobs raíz. Cruzando con el catálogo…');
      await syncRunsFromLogs();
      toast('Log procesado y cruzado con el catálogo');
      history.pushState(null, '', '#/logs/resumen'); renderLogs('resumen');
    }
  };
  const opts = { knownWarnings: knownWarningSources() };
  if (/^https?:$/.test(location.protocol)) {
    try {
      _logWorker = new Worker('js/logs/workers/log-worker.js');
      _logWorker.onmessage = (e) => onMsg(e.data);
      _logWorker.onerror = (e) => { _logBusy = false; set(0, 'Error del worker: ' + (e.message || '')); };
      _logWorker.postMessage({ type: 'START', file, options: opts });
      return;
    } catch (e) { /* cae al modo en la página */ }
  }
  // Abierto desde disco (file://): el navegador no permite workers con importScripts; se procesa en la página.
  window.__pkaPost = onMsg;
  set(0, 'Procesando en esta página (abierto desde disco: puede tardar más y la pestaña responder lento)…');
  setTimeout(() => pkaRun(file, opts), 50);
}

/* ---------- resumen (sin Chart.js) ---------- */
async function logsSummaryHtml() {
  await PKAStorage.open();
  const [ex, st] = await Promise.all([PKAStorage.getAll('executions'), PKAStorage.getMeta('lastIngestStats')]);
  const k = PKAReportData.summarize(ex), by = PKAReportData.byRootJob(ex);
  const ok = Array(24).fill(0), bad = Array(24).fill(0);
  for (const e of ex) if (e.startTime) { const h = new Date(e.startTime).getHours(); (e.hasError ? bad : ok)[h]++; }
  const mx = Math.max(...ok.map((v, i) => v + bad[i]), 1);
  const bars = '<div class="hours">' + ok.map((v, h) => '<div class="hcol" title="' + String(h).padStart(2, '0') + ':00 — ' + v + ' sin error · ' + bad[h] + ' con error"><div class="hstack"><i class="e" style="height:' + (bad[h] / mx * 100) + '%"></i><i class="o" style="height:' + (v / mx * 100) + '%"></i></div><span>' + String(h).padStart(2, '0') + '</span></div>').join('') + '</div>' +
    '<div class="legend"><span><i class="o"></i>Sin error</span><span><i class="e"></i>Con error</span></div>';
  const hbar = (rows, val, fmt, cls) => { const m = Math.max(...rows.map(val), 1); return '<div class="tw"><table><tbody>' + rows.map(r => '<tr><td>' + jobLink(r.rootJob) + '</td><td style="width:45%"><div class="hb' + (cls ? ' ' + cls : '') + '"><i style="width:' + Math.max(2, val(r) / m * 100) + '%"></i><span>' + fmt(r) + '</span></div></td></tr>').join('') + '</tbody></table></div>'; };
  const errJobs = by.filter(g => g.failedExecs).sort((a, b) => b.failedExecs - a.failedExecs).slice(0, 10);
  const slow = ex.filter(e => e.duration).sort((a, b) => b.duration - a.duration).slice(0, 10).map(e => ({ rootJob: e.rootJob, d: e.duration, t: e.startTime }));
  const freq = [...by].sort((a, b) => b.count - a.count).slice(0, 10);
  const mapped = new Set(ex.map(e => e.rootJob)).size, inCat = [...new Set(ex.map(e => e.rootJob))].filter(j => procOfJob(j) >= 0).length;
  return '<div class="grid" style="margin-top:6px">' + [[k.total, 'Ejecuciones'], [k.completeOk, 'Completas sin error · ' + k.completeOkPct + '%'], [k.withError, 'Con error · ' + k.failedJobs + ' jobs'], [k.incomplete, 'Incompletas'], [k.rootJobs, 'Jobs raíz'], [inCat + '/' + mapped, 'Jobs encontrados en el catálogo']]
      .map(([v, l]) => '<div class="kpi"><b>' + (typeof v === 'number' ? v.toLocaleString('es') : v) + '</b><span>' + l + '</span></div>').join('') + '</div>' +
    (RUNS ? '<div class="alert ok">Cruzado con el catálogo: revisa qué no corrió, tablas en riesgo y concurrencia por BD en <a href="#/ejecuciones">Ejecuciones del día</a>.</div>' : '') +
    '<h2>Ejecuciones por hora</h2><div class="panel">' + bars + '</div>' +
    '<div class="cols"><div><h2>Jobs con más ejecuciones fallidas</h2>' + (errJobs.length ? hbar(errJobs, r => r.failedExecs, r => r.failedExecs + ' de ' + r.count, 'bad') : '<p class="muted">Sin errores detectados.</p>') + '</div>' +
    '<div><h2>Ejecuciones más lentas</h2>' + hbar(slow, r => r.d, r => fmtDur(r.d) + ' · ' + fmtT(r.t)) + '</div></div>' +
    '<h2>Jobs que más se ejecutan</h2>' + hbar(freq, r => r.count, r => r.count.toLocaleString('es') + ' ejecuciones') +
    (st ? '<p class="muted">Líneas procesadas: ' + (st.linesTotal || 0).toLocaleString('es') + ' · bloques no emparejados: ' + (st.blocksUnmatched ?? '—') + ' · no atribuidos: ' + (st.blocksUnattributed ?? '—') + '</p>' : '');
}

/* ---------- configuración ---------- */
function viewConfig() {
  return '<h1>Configuración</h1><p class="muted">Se guarda en este navegador.</p>' +
    '<h2>Advertencias conocidas</h2><div class="muted">Mensajes que Pentaho registra con nivel ERROR pero que no son fallas (por ejemplo, avisos de AWS CLI). Una expresión regular por línea, sin distinguir mayúsculas. Se aplican al próximo log que cargues y a los JSON importados.</div>' +
    '<textarea id="cf-kw" spellcheck="false" style="width:100%;min-height:160px;margin-top:8px;font:12px/1.5 var(--mono);background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px">' + esc(knownWarningSources().join('\n')) + '</textarea>' +
    '<div class="row" style="margin-top:8px"><button class="btn pri" id="cf-save">Guardar</button><button class="btn" id="cf-def">Restaurar valores por defecto</button><span id="cf-msg" class="muted"></span></div>' +
    '<h2>Índice guardado en este navegador</h2><div class="panel"><p class="muted" style="margin-top:0">El índice del catálogo cargado desde un archivo se guarda aquí. Bórralo si quieres cargar otro desde cero.</p>' +
    '<div class="row"><span>' + (M ? '<b>' + esc(IX.fuente && IX.fuente.home || '?') + '</b> · ' + IX.procs.length.toLocaleString('es') + ' procesos' : 'No hay índice cargado') + '</span><button class="btn" id="cf-delidx">Borrar el índice guardado</button></div></div>' +
    '<h2>Archivos de datos</h2><div class="panel"><dl class="dl"><dt>Catálogo</dt><dd class="mono">data/indice.js — se regenera en "Generar índice"</dd>' +
    '<dt>Aplicativos y proveedores</dt><dd class="mono">data/aplicativos.js — APLICATIVOS y PROVEEDORES</dd><dt>Log</dt><dd>Se guarda en este navegador (IndexedDB) hasta que cargues otro o lo borres.</dd></dl></div>';
}
function bindConfig() {
  $('#cf-save').onclick = () => {
    const lines = $('#cf-kw').value.split('\n').map(s => s.trim()).filter(Boolean);
    const bad = lines.filter(s => { try { new RegExp(s); return false; } catch (e) { return true; } });
    if (bad.length) { $('#cf-msg').textContent = 'Expresiones inválidas: ' + bad.join(' · '); return; }
    try { localStorage.setItem('atlas-known-warnings', JSON.stringify(lines)); } catch (e) {}
    applyKnownWarnings(); $('#cf-msg').textContent = 'Guardado (' + lines.length + ' patrones).';
  };
  $('#cf-def').onclick = () => { try { localStorage.removeItem('atlas-known-warnings'); } catch (e) {} location.reload(); };
  $('#cf-delidx').onclick = async () => { if (!confirm('¿Borrar el índice guardado en este navegador?')) return; await idbDelIndex(); location.hash = '#/'; location.reload(); };
}

/* ---------- arranque: si ya hay un log guardado, cruzarlo con el catálogo ---------- */
document.addEventListener('DOMContentLoaded', () => {
  applyKnownWarnings();
  setTimeout(() => { syncRunsFromLogs().then(ok => { if (ok && /^#\/(ejecuciones)?$/.test(location.hash || '#/')) route(); }).catch(() => {}); }, 0);
});
