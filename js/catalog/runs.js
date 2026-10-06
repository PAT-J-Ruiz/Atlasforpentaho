/* Catálogo Pentaho — Fase 3: foto de un día de ejecuciones.
   Carga el JSON exportado por el Log Analyzer v2 (version 2, con "ejecuciones") y lo cruza
   con el catálogo. No se guarda nada: vive mientras la página esté abierta. */
'use strict';

let RUNS = null;
const fmtDur = (ms) => { if (ms == null) return '—'; if (ms < 1000) return Math.round(ms) + ' ms'; if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + 'h ' + m + 'm' : m + 'm ' + (s % 60) + 's'; };
const fmtT = (ts) => ts ? new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const runBadge = (r) => r.err ? '<span class="b bad">' + (r.st === 'I' ? 'Error · incompleta' : 'Error') + '</span>' : r.st === 'C' ? '<span class="b activo">OK</span>' : '<span class="b pausado">Incompleta</span>';

/* ---------- carga ---------- */
function loadRuns(json, fileName) {
  const out = { file: fileName, partial: false, runs: [], unmapped: new Map() };
  let rows = [];
  if (Array.isArray(json.ejecuciones)) rows = json.ejecuciones.map(a => ({ job: a[0], s: a[1], e: a[2], d: a[3], st: a[4], err: a[5] || 0, msg: a[6] }));
  else {
    // export antiguo: solo trae ejecuciones con error o incompletas
    out.partial = true;
    const seen = new Set();
    for (const x of (json.ejecucionesConError || []).concat(json.ejecucionesIncompletas || [])) {
      const k = x.job + '|' + x.inicio; if (seen.has(k)) continue; seen.add(k);
      rows.push({ job: x.job, s: x.inicio ? Date.parse(x.inicio) : null, e: x.fin ? Date.parse(x.fin) : null, d: x.duracionMs, st: /incompleta/i.test(x.estado) ? 'I' : 'C', err: x.incidentes || 0, msg: x.primerError });
    }
  }
  // advertencias conocidas (mismo criterio que KNOWN_WARNINGS del Log Analyzer): cubre exports anteriores al filtro
  const KNOWN = window.ADVERTENCIAS_CONOCIDAS || [/InsecureRequestWarning/i, /Unverified HTTPS request is being made/i, /urllib3\.readthedocs\.io/i, /^\s*No hay archivos\s*$/i];
  out.warned = 0;
  for (const r of rows) if (r.err && r.msg && KNOWN.some(re => re.test(r.msg))) { r.err = 0; r.warn = 1; out.warned++; }
  const byPath = new Map(); for (const p of M.P) byPath.set(p.path.toLowerCase(), p.i);
  for (const r of rows) {
    const key = String(r.job || '').replace(/\\/g, '/').replace(/\.(kjb|ktr)$/i, '').toLowerCase();
    let pi = byPath.get(key);
    if (pi === undefined) { const base = key.split('/').pop(); const c = M.P.filter(p => p.n.toLowerCase() === base); if (c.length === 1) pi = c[0].i; }
    if (pi === undefined) { out.unmapped.set(r.job, (out.unmapped.get(r.job) || 0) + 1); continue; }
    r.pi = pi; out.runs.push(r);
  }
  // día predominante del log
  const days = new Map(); for (const r of out.runs) if (r.s) { const d = new Date(r.s); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); days.set(k, (days.get(k) || 0) + 1); }
  out.day = [...days.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  if (out.day) { const [y, m, d] = out.day.split('-').map(Number); out.dayDate = new Date(y, m - 1, d); out.dow = out.dayDate.getDay(); }
  out.summary = json.kpis || null;
  // índices: ejecuciones por proceso raíz, y por cada proceso del árbol
  const k = kmodel();
  out.byRoot = new Map(); for (const r of out.runs) (out.byRoot.get(r.pi) || out.byRoot.set(r.pi, []).get(r.pi)).push(r);
  out.inTree = new Map(); // pi → [rootPi que lo ejecutaron]
  for (const root of out.byRoot.keys()) for (const x of k.treeOf(root)) (out.inTree.get(x) || out.inTree.set(x, []).get(x)).push(root);
  RUNS = out;
  $('#runs-pill').innerHTML = '<a href="#/ejecuciones" class="b k" title="' + esc(fileName) + '">Log ' + esc(out.day || '?') + ' · ' + out.runs.length + ' ejec.</a>';
  return out;
}

/* ---------- qué se esperaba ese día ---------- */
function expectedToday() {
  const R = RUNS; if (!R || R.dow == null) return [];
  const out = [];
  for (const s of M.sched) {
    if (s.id < 0 || s.pausado) continue;
    const r = parseRep(s.rep); if (!r.ok) continue;
    let n = 0, hours = [];
    if (r.mensual) { if (String(r.mensual.dia).split(',').map(Number).includes(R.dayDate.getDate())) { n = 1; hours = [r.mensual.hora]; } }
    else for (const [d, h, per] of r.slots) if (d === R.dow) { n += per; hours.push(h); }
    if (n) out.push({ s, n, hours, freq: r.freq, ran: (R.byRoot.get(s.id) || []).length });
  }
  return out;
}

/* ---------- vista principal ---------- */
function viewRuns() {
  let h = '<h1>Ejecuciones del día</h1><p class="muted">Carga el JSON exportado por el Log Analyzer v2 ("Exportar JSON"). Se cruza con el catálogo solo en esta sesión; al cerrar la página se descarta.</p>' +
    '<div class="panel"><input type="file" id="rn-f" accept=".json"> <span id="rn-msg" class="muted"></span></div>';
  if (!RUNS) return h;
  const R = RUNS, k = kmodel();
  // filtro global de estado (barra superior)
  const runs = R.runs.filter(r => okI(r.pi));
  if (runs.length < R.runs.length) h += hiddenNote(new Set(R.runs.filter(r => !okI(r.pi)).map(r => r.pi)).size);
  const failed = runs.filter(r => r.err);
  const incompl = runs.filter(r => r.st !== 'C');
  const exp = expectedToday().filter(x => okI(x.s.id));
  const missing = exp.filter(x => !x.ran);
  const pausedRan = [...R.byRoot.keys()].filter(pi => { const rows = M.schedBy.get(pi); return rows && rows.every(r => r.pausado); });
  const unsched = [...R.byRoot.keys()].filter(pi => !M.schedBy.has(pi));
  // solapes: duración mayor al intervalo del calendario, o dos ejecuciones del mismo job a la vez
  const overlaps = [];
  for (const [pi, rs] of R.byRoot) {
    const srt = rs.filter(r => r.s).sort((a, b) => a.s - b.s);
    for (let i = 1; i < srt.length; i++) if (srt[i - 1].e && srt[i].s < srt[i - 1].e) { overlaps.push([pi, srt[i - 1], srt[i]]); break; }
  }
  // tablas posiblemente desactualizadas: escritas dentro del árbol de un job raíz que falló
  const stale = new Map();
  for (const r of failed) for (const x of k.treeOf(r.pi)) for (const t of M.P[x].w || []) (stale.get(t) || stale.set(t, new Set()).get(t)).add(r.pi);
  const slow = [...R.byRoot.entries()].map(([pi, rs]) => ({ pi, n: rs.length, tot: rs.reduce((a, r) => a + (r.d || 0), 0), max: Math.max(...rs.map(r => r.d || 0)), err: rs.filter(r => r.err).length }))
    .filter(x => okI(x.pi)).sort((a, b) => b.tot - a.tot);
  const mxTot = Math.max(...slow.map(x => x.tot), 1);

  h += (R.partial ? '<div class="alert bad">Este JSON es del export antiguo del Log Analyzer: solo trae ejecuciones con error o incompletas. Vuelve a exportar con la versión actualizada para ver todas las ejecuciones.</div>' : '') +
    '<div class="muted">Archivo: ' + esc(R.file) + ' · día: <b>' + esc(R.day || '?') + '</b> (' + (R.dow != null ? DIAS[R.dow] : '?') + ')' + (R.unmapped.size ? ' · ' + R.unmapped.size + ' jobs del log no están en el HOME' : '') +
    (R.warned ? ' · ' + R.warned + ' ejecuciones marcadas con error solo por advertencias conocidas (AWS CLI, "No hay archivos"): no se cuentan como error' : '') + '</div>' +
    '<div class="grid" style="margin-top:10px">' + [[runs.length, 'Ejecuciones'], [R.byRoot.size, 'Jobs raíz distintos'], [failed.length, 'Con error'], [incompl.length, 'Incompletas'], [missing.length, 'Calendarizados que no corrieron'],
      [overlaps.length, 'Jobs que se solaparon consigo mismos'], [pausedRan.length, 'Corrieron estando pausados'], [stale.size, 'Tablas posiblemente desactualizadas']].map(([v, l]) => '<div class="kpi"><b>' + v + '</b><span>' + l + '</span></div>').join('') + '</div>';

  h += '<h2>Ejecuciones con error (' + failed.length + ')</h2>' + (failed.length ? tbl('rn-err', ['Job', 'Inicio', 'Duración', 'Estado', 'Error', 'Tablas que escribe su árbol'], failed.map(r => {
    const ws = new Set(); for (const x of k.treeOf(r.pi)) (M.P[x].w || []).forEach(t => ws.add(t));
    return '<tr><td>' + plink(r.pi) + ' ' + badge(M.P[r.pi]) + '</td><td data-v="' + r.s + '">' + fmtT(r.s) + '</td><td data-v="' + (r.d || 0) + '">' + fmtDur(r.d) + '</td><td>' + runBadge(r) + '</td><td class="mono">' + esc(r.msg || '') + '</td><td data-v="' + ws.size + '">' + [...ws].slice(0, 4).map(tlink).join('<br>') + (ws.size > 4 ? '<br><span class="muted">+' + (ws.size - 4) + '</span>' : '') + '</td></tr>'; })) : '<p class="muted">Ninguna.</p>');

  h += '<h2>Calendarizados para este día que no aparecen en el log (' + missing.length + ')</h2><div class="muted">Según el calendario (no pausado) debían correr un ' + (R.dow != null ? DIAS[R.dow] : '?') + '. Puede ser que no corrieran, que el log esté cortado o que corrieran en otro servidor.</div>' +
    (missing.length ? tbl('rn-mis', ['Calendario', 'Repetición', 'Job', 'Tablas que escribe su árbol'], missing.map(x => { const ws = new Set(); for (const y of k.treeOf(x.s.id)) (M.P[y].w || []).forEach(t => ws.add(t));
      return '<tr><td>' + esc(x.s.name) + '</td><td>' + esc(x.s.rep) + '</td><td>' + plink(x.s.id) + '</td><td data-v="' + ws.size + '">' + ws.size + '</td></tr>'; })) : '<p class="muted">Todos los calendarizados aparecen.</p>');

  h += '<h2>Tablas posiblemente desactualizadas (' + stale.size + ')</h2><div class="muted">Las escribe algún proceso dentro de un job raíz que falló. Que el job falle no garantiza que esa rama específica haya fallado: confírmalo en el log.</div>' +
    (stale.size ? tbl('rn-st', ['Tabla', 'Job raíz con error', 'Lectores productivos'], [...stale.entries()].map(([t, roots]) => { const tt = M.tables.get(t);
      return '<tr><td>' + tlink(t) + '</td><td>' + plist(roots, 3) + '</td><td>' + (tt ? uniqN(tt.r.map(x => x[0]).filter(isAct)) : 0) + '</td></tr>'; })) : '');

  h += '<h2>Concurrencia real por base de datos</h2><div class="muted">Minutos de ejecución por hora sobre cada BD, sumando todos los jobs que corrían (60 = un job ocupó la hora completa; 180 = tres a la vez). El pico es la mayor cantidad de jobs simultáneos.</div>' + concurrencyHtml();

  h += '<h2>Tiempo total por job (' + slow.length + ')</h2>' + tbl('rn-sl', ['Job', 'Estado', 'Ejecuciones', 'Tiempo total', 'Máxima', 'Con error'], slow.slice(0, 150).map(x => '<tr><td>' + plink(x.pi) + '</td><td>' + badge(M.P[x.pi]) + '</td><td data-v="' + x.n + '">' + x.n + '</td>' + barCell(x.tot, mxTot, fmtDur(x.tot)) +
    '<td data-v="' + x.max + '">' + fmtDur(x.max) + '</td><td data-v="' + x.err + '">' + (x.err ? '<span class="b bad">' + x.err + '</span>' : 0) + '</td></tr>'));

  if (overlaps.length) h += '<h2>Jobs que se solaparon consigo mismos (' + overlaps.length + ')</h2><div class="muted">Una ejecución empezó antes de que terminara la anterior: el job tarda más que su intervalo de calendario.</div>' +
    tbl('rn-ov', ['Job', 'Ejecución 1', 'Ejecución 2'], overlaps.map(([pi, a, b]) => '<tr><td>' + plink(pi) + '</td><td>' + fmtT(a.s) + ' – ' + fmtT(a.e) + ' (' + fmtDur(a.d) + ')</td><td>' + fmtT(b.s) + ' – ' + fmtT(b.e) + '</td></tr>'));
  if (pausedRan.length) h += '<h2>Corrieron estando pausados en el calendario (' + pausedRan.length + ')</h2><div class="muted">Se ejecutaron a mano o desde otro calendario.</div>' + tbl('rn-pr', ['Job', 'Ejecuciones'], pausedRan.map(pi => '<tr><td>' + plink(pi) + '</td><td>' + R.byRoot.get(pi).length + '</td></tr>'));
  if (unsched.length) h += '<h2>Corrieron sin estar calendarizados como raíz (' + unsched.length + ')</h2><div class="muted">Ejecuciones manuales o lanzadas desde otro lugar.</div>' + tbl('rn-us', ['Job', 'Estado', 'Ejecuciones'], unsched.map(pi => '<tr><td>' + plink(pi) + '</td><td>' + badge(M.P[pi]) + '</td><td>' + R.byRoot.get(pi).length + '</td></tr>'));
  if (R.unmapped.size) h += '<h2>Jobs del log que no están en el HOME (' + R.unmapped.size + ')</h2>' + tbl('rn-um', ['Job en el log', 'Ejecuciones'], [...R.unmapped.entries()].map(([j, n]) => '<tr><td class="mono">' + esc(j) + '</td><td>' + n + '</td></tr>'));
  return h;
}
function concurrencyHtml() {
  const R = RUNS, k = kmodel();
  if (!R.dayDate) return '<p class="muted">Sin horas en el log.</p>';
  const t0 = R.dayDate.getTime();
  const rows = new Map();
  for (const r of R.runs) {
    if (!r.s) continue; const e = r.e || r.s;
    for (const db of k.dbsOfTree(r.pi)) {
      const row = rows.get(db) || rows.set(db, { min: Array(24).fill(0), ev: [] }).get(db);
      for (let hh = 0; hh < 24; hh++) { const a = Math.max(r.s, t0 + hh * 3600000), b = Math.min(e, t0 + (hh + 1) * 3600000); if (b > a) row.min[hh] += (b - a) / 60000; }
      row.ev.push([r.s, 1], [e, -1]);
    }
  }
  const L = [...rows.entries()].map(([db, o]) => { o.ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c = 0, pk = 0; for (const [, d] of o.ev) { c += d; pk = Math.max(pk, c); } return { db, min: o.min.map(Math.round), pk, tot: o.min.reduce((a, b) => a + b, 0) }; })
    .sort((a, b) => b.tot - a.tot).slice(0, 20);
  const mx = Math.max(...L.flatMap(x => x.min), 1);
  return '<div class="tw"><table class="heat"><thead><tr><th>BD</th>' + range(0, 23).map(x => '<th>' + String(x).padStart(2, '0') + '</th>').join('') + '<th>Pico simult.</th><th>Total</th></tr></thead><tbody>' +
    L.map(x => '<tr><th class="mono">' + esc(x.db) + '</th>' + x.min.map((v, hh) => '<td style="' + heat(v, mx) + '" title="' + esc(x.db) + ' ' + String(hh).padStart(2, '0') + ':00 — ' + v + ' min de ejecución">' + (v || '') + '</td>').join('') +
      '<td><b>' + x.pk + '</b></td><td>' + fmtDur(x.tot * 60000) + '</td></tr>').join('') + '</tbody></table></div>';
}
function bindRuns() {
  $('#rn-f').onchange = async () => {
    const f = $('#rn-f').files[0]; if (!f) return;
    $('#rn-msg').textContent = 'Leyendo…';
    try { loadRuns(JSON.parse(await f.text()), f.name); route(); }
    catch (e) { $('#rn-msg').textContent = 'No se pudo leer: ' + e.message; }
  };
  document.querySelectorAll('.tw table[id]').forEach(t => sortable(t.id));
}

/* ---------- secciones para ficha de proceso y vista de tabla ---------- */
function runsForProc(pi) {
  if (!RUNS) return '';
  const roots = RUNS.inTree.get(pi) || [];
  const rs = roots.flatMap(r => RUNS.byRoot.get(r).map(x => [r, x])).sort((a, b) => (a[1].s || 0) - (b[1].s || 0));
  return '<h2>Ejecuciones en el log del ' + esc(RUNS.day || '?') + ' (' + rs.length + ')</h2>' + (rs.length ? tbl('rp-' + pi, ['Job raíz', 'Inicio', 'Fin', 'Duración', 'Estado', 'Error'], rs.map(([r, x]) =>
    '<tr><td>' + (r === pi ? '<b>este proceso</b>' : plink(r)) + '</td><td data-v="' + x.s + '">' + fmtT(x.s) + '</td><td>' + fmtT(x.e) + '</td><td data-v="' + (x.d || 0) + '">' + fmtDur(x.d) + '</td><td>' + runBadge(x) + '</td><td class="mono">' + esc(x.msg || '') + '</td></tr>')) :
    '<div class="alert">No corrió ese día' + (M.P[pi].estado === 'activo' ? ', aunque está bajo un calendario activo.' : '.') + '</div>');
}
function runsForTable(key) {
  if (!RUNS) return '<div class="panel muted">Carga el log del día en <a href="#/ejecuciones">Ejecuciones</a> para ver aquí si los escritores corrieron y si fallaron.</div>';
  const t = M.tables.get(key); const writers = [...new Set(t.w.map(x => x[0]))];
  const rows = writers.map(pi => { const roots = RUNS.inTree.get(pi) || []; const rs = roots.flatMap(r => RUNS.byRoot.get(r).map(x => [r, x])); const last = rs.sort((a, b) => (b[1].e || 0) - (a[1].e || 0))[0]; return { pi, rs, last }; })
    .sort((a, b) => (b.rs.length > 0) - (a.rs.length > 0));
  const anyOk = rows.some(r => r.rs.some(([, x]) => !x.err && x.st === 'C'));
  const anyErr = rows.some(r => r.rs.some(([, x]) => x.err));
  const alert = !rows.some(r => r.rs.length) ? '<div class="alert bad">Ningún escritor de esta tabla corrió en el log del ' + esc(RUNS.day) + '.</div>' :
    anyErr && !anyOk ? '<div class="alert bad">Los escritores que corrieron terminaron con error.</div>' : anyErr ? '<div class="alert">Hubo ejecuciones con error entre los escritores; revisa cuál corresponde a la carga del dato.</div>' : '<div class="alert ok">Los escritores que corrieron terminaron bien.</div>';
  return '<h2>Ejecuciones en el log del ' + esc(RUNS.day) + '</h2>' + alert + tbl('rt-runs', ['Escritor', 'Corrió vía', 'Última ejecución', 'Duración', 'Estado', 'Ejecuciones', 'Error'], rows.map(({ pi, rs, last }) =>
    '<tr><td>' + plink(pi) + ' ' + badge(M.P[pi]) + '</td><td>' + (last ? (last[0] === pi ? 'directo' : plink(last[0])) : '—') + '</td><td>' + (last ? fmtT(last[1].s) + ' – ' + fmtT(last[1].e) : '<span class="muted">no corrió</span>') + '</td><td>' + (last ? fmtDur(last[1].d) : '') +
    '</td><td>' + (last ? runBadge(last[1]) : '') + '</td><td>' + rs.length + '</td><td class="mono">' + esc(last && last[1].msg || '') + '</td></tr>'));
}
function llmRuns(pi) {
  if (!RUNS) return '';
  const roots = RUNS.inTree.get(pi) || [];
  const rs = roots.flatMap(r => RUNS.byRoot.get(r).map(x => [r, x]));
  return '\n## Ejecuciones ' + RUNS.day + '\n' + (rs.length ? rs.slice(0, 20).map(([r, x]) => '- ' + (r === pi ? 'directo' : 'vía ' + M.P[r].n) + ' ' + fmtT(x.s) + '–' + fmtT(x.e) + ' ' + fmtDur(x.d) + ' ' + (x.err ? 'ERROR: ' + (x.msg || '') : x.st === 'C' ? 'OK' : 'incompleta')).join('\n') : 'No corrió ese día.');
}
