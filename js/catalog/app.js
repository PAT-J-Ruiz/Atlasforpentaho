/* Catálogo Pentaho — interfaz. Lee window.INDICE (data/indice.js) y window.APLICATIVOS (data/aplicativos.js). */
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
let IX = null, M = null;

/* ================= modelo derivado ================= */
const ESTADOS = { activo: 'Activo', pausado: 'Pausado', manual: 'Manual', sin: 'Sin calendarizar' };
const OPS_W = { TableOutput: 'insert', InsertUpdate: 'insert/update', Update: 'update', Delete: 'delete', SynchronizeAfterMerge: 'merge', TRUNCATE_TABLES: 'truncate' };

function buildModel(ix) {
  const P = ix.procs;
  const m = { P, callers: P.map(() => []), tables: new Map(), sps: new Map(), files: new Map(), ext: new Map(), dbs: new Map(),
    sched: ix.sched || [], schedBy: new Map(), byPath: new Map(), varGlobal: {}, apps: [], appByKey: new Map() };
  for (const p of P) {
    m.byPath.set(p.path.toLowerCase(), p.i); for (const c of p.cs || []) m.callers[c].push(p.i);
    for (const c of p.cx || []) if (c.svr) c.svr = c.svr.toUpperCase();
  }
  for (const k in ix.props) for (const [n, v] of Object.entries(ix.props[k].kv)) if (v !== '') (m.varGlobal[n] || (m.varGlobal[n] = new Map())).set(k, v);
  // calendarización → procesos
  for (const s of m.sched) {
    let id = m.byPath.get(String(s.src).toLowerCase().replace(/\.(kjb|ktr)$/i, ''));
    if (id === undefined) { const base = String(s.src).split('/').pop().toLowerCase(); const c = P.filter(p => p.n.toLowerCase() === base); if (c.length === 1) id = c[0].i; }
    s.id = id === undefined ? -1 : id;
    s.pausado = /pause|pausad/i.test(s.st);
    if (s.id >= 0) (m.schedBy.get(s.id) || m.schedBy.set(s.id, []).get(s.id)).push(s);
  }
  // estado: propagación desde raíces calendarizadas / jobs MANUAL
  const act = P.map(() => new Set()), pau = P.map(() => new Set()), man = P.map(() => new Set());
  const spread = (root, arr) => { const st = [root]; const seen = new Set(); while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); arr[x].add(root); for (const c of P[x].cs || []) st.push(c); } };
  for (const [id, rows] of m.schedBy) spread(id, rows.some(r => !r.pausado) ? act : pau);
  for (const p of P) if (p.k === 'J' && /manual/i.test(p.n)) spread(p.i, man);
  for (const p of P) {
    p._act = [...act[p.i]]; p._pau = [...pau[p.i]]; p._man = [...man[p.i]];
    p.estado = p._act.length ? 'activo' : p._man.length ? 'manual' : p._pau.length ? 'pausado' : 'sin';
    // Master = job principal: nadie lo llama y ejecuta otros procesos (o está calendarizado como raíz)
    p.master = p.k === 'J' && !m.callers[p.i].length && ((p.cs || []).length > 0 || m.schedBy.has(p.i));
  }
  // tablas, SP, archivos, externos
  const tab = (k) => m.tables.get(k) || m.tables.set(k, { k, w: [], r: [], srv: new Set(), cn: new Set() }).get(k);
  for (const p of P) {
    const cx = {}; for (const c of p.cx || []) cx[c.n] = c;
    p.st.forEach((s, si) => {
      const c = s.c ? cx[s.c] : null;
      for (const k of s.w || []) { const t = tab(k); t.w.push([p.i, si]); if (c) { if (c.svr) t.srv.add(c.svr); t.cn.add(c.n); } }
      for (const k of s.r || []) { const t = tab(k); t.r.push([p.i, si]); if (c) { if (c.svr) t.srv.add(c.svr); t.cn.add(c.n); } }
      for (const k of s.p || []) (m.sps.get(k) || m.sps.set(k, []).get(k)).push([p.i, si]);
      for (const [f, op] of s.f || []) (m.files.get(f) || m.files.set(f, []).get(f)).push([p.i, si, op]);
      for (const [kind, target, det] of s.x || []) { const k = kind + '|' + target; (m.ext.get(k) || m.ext.set(k, []).get(k)).push([p.i, si, det]); }
    });
    for (const c of p.cx || []) {
      const db = (c.dbr || c.n).toUpperCase();
      const d = m.dbs.get(db) || m.dbs.set(db, { db, srv: new Set(), cn: new Set(), procs: new Set(), ty: new Set() }).get(db);
      if (c.svr) d.srv.add(c.svr); d.cn.add(c.n); d.procs.add(p.i); if (c.ty) d.ty.add(c.ty);
    }
  }
  for (const t of m.tables.values()) {
    const db = t.k.split('.')[0];
    const d = m.dbs.get(db) || m.dbs.set(db, { db, srv: new Set(), cn: new Set(), procs: new Set(), ty: new Set() }).get(db);
    d.tables = (d.tables || 0) + 1; t.srv.forEach(s => d.srv.add(s));
  }
  // aplicativos
  m.apps = (window.APLICATIVOS || []).filter(a => a && a.app);
  for (const a of m.apps) {
    const bds = (a.bd || []).map(x => String(x).toUpperCase()), tbs = (a.tablas || []).map(x => String(x).toUpperCase());
    for (const t of m.tables.values()) {
      const [db, sc, tb] = t.k.split('.');
      if (tbs.length ? tbs.some(x => t.k === x || (db + '.' + sc + '.' + tb).endsWith('.' + x) || tb === x) : bds.includes(db))
        (m.appByKey.get(t.k) || m.appByKey.set(t.k, []).get(t.k)).push(a.app);
    }
  }
  return m;
}

/* ================= variables ================= */
function resolveVar(p, v) {
  for (const x of p.par || []) if (x[0] === v && x[1]) return { v: x[1], src: 'parámetro' };
  for (const s of p.st) for (const [n, val] of s.vd || []) if (n === v && val && val[0] !== '(') return { v: val, src: 'definida en paso "' + s.n + '"' };
  for (const k of p.pe || []) { const f = IX.props[k]; if (f && v in f.kv && f.kv[v] !== '') return { v: f.kv[v], src: f.file + (p.pf && p.pf.includes(k) ? '' : ' (heredado)') }; }
  const g = M.varGlobal[v];
  if (g && g.size) {
    const vals = [...new Set(g.values())];
    if (vals.length === 1) return { v: vals[0], src: 'inferido: ' + [...g.keys()].map(k => IX.props[k].file).join(', ') };
    return { v: null, amb: [...g.entries()].map(([k, val]) => IX.props[k].file + ' = ' + val) };
  }
  if (/^(MASTER_HOST|MASTER_PORT|java\..+|user\..+|os\..+|file\.separator|line\.separator|path\.separator|KETTLE_.+|PENTAHO_.+)$/.test(v)) return { v: '(entorno Pentaho/Java)', src: 'variable del sistema', sys: 1 };
  for (const k of p.pe || []) if (IX.props[k] && v in IX.props[k].kv) return { v: '(vacía)', src: IX.props[k].file + ' — sin valor en la copia sin contraseñas', sys: 1 };
  for (const k in IX.props) if (v in IX.props[k].kv) return { v: '(vacía)', src: IX.props[k].file + ' — sin valor en la copia sin contraseñas', sys: 1 };
  const rt = runtimeVars().get(v);
  if (rt) return { v: '(se asigna en ejecución)', src: 'paso "' + rt[1] + '" en ' + M.P[rt[0]].n, sys: 1 };
  return { v: null };
}
let _rt = null;
function runtimeVars() {
  if (_rt && _rt.M === M) return _rt.map;
  const map = new Map();
  for (const p of M.P) for (const s of p.st) for (const [n] of s.vd || []) if (!map.has(n)) map.set(n, [p.i, s.n]);
  _rt = { M, map }; return map;
}
function resolveStr(p, str, d) {
  if (!str || (str.indexOf('${') < 0 && str.indexOf('%%') < 0)) return str;
  d = d || 0; if (d > 4) return str;
  const out = str.replace(/\$\{([^}\s]+)\}|%%([A-Za-z_][\w.]*)%%/g, (all, a, b) => {
    const n = a || b; if (/^Internal\./i.test(n)) return n === 'Internal.Entry.Current.Directory' || /Directory$/.test(n) ? p.d : all;
    const r = resolveVar(p, n); return r.v != null && !r.sys ? r.v : all;
  });
  return out !== str ? resolveStr(p, out, d + 1) : out;
}

/* ================= filtro global de estado ================= */
let EST_ON = new Set(Object.keys(ESTADOS));
try { const s = JSON.parse(localStorage.getItem('atlas-estados') || 'null'); if (Array.isArray(s) && s.length) EST_ON = new Set(s); } catch (e) {}
const okE = (p) => EST_ON.has(p.estado);
const okI = (i) => EST_ON.has(M.P[i].estado);
const allE = () => EST_ON.size === Object.keys(ESTADOS).length;
function renderEstFilter() {
  const el = $('#est-filter'); if (!el) return;
  el.innerHTML = Object.entries(ESTADOS).map(([k, v]) => '<button class="chip ' + k + (EST_ON.has(k) ? ' on' : '') + '" data-e="' + k + '" title="Mostrar/ocultar procesos ' + v.toLowerCase() + '">' + v + '</button>').join('');
  el.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const k = b.dataset.e; if (EST_ON.has(k)) { if (EST_ON.size > 1) EST_ON.delete(k); } else EST_ON.add(k);
    try { localStorage.setItem('atlas-estados', JSON.stringify([...EST_ON])); } catch (e) {}
    renderEstFilter(); route();
  });
}
const hiddenNote = (n) => n > 0 ? '<div class="muted" style="margin:4px 0">' + n + ' proceso(s) ocultos por el filtro de estado (barra superior).</div>' : '';

/* ================= masters y árbol ================= */
const _desc = new Map();
function descOf(i) {
  if (_desc.has(i)) return _desc.get(i);
  const seen = new Set(), st = [i];
  while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); for (const c of M.P[x].cs || []) st.push(c); }
  seen.delete(i); _desc.set(i, seen); return seen;
}
function treeHtml(i) {
  const path = new Set();
  const node = (x, depth, via) => {
    const p = M.P[x]; const kids = [];
    p.st.forEach(s => { if (s.call && s.to >= 0) kids.push([s.to, s.n]); });
    const label = '<span class="tag">' + (p.k === 'J' ? 'Job' : 'Trans') + '</span>' + plink(x) + ' ' + badge(p) +
      (via ? ' <span class="muted">· paso "' + esc(via) + '"</span>' : '') + ((p.w || []).length ? ' <span class="muted">· escribe ' + p.w.length + ' tabla(s)</span>' : '');
    if (!kids.length || depth > 10) return '<li>' + label + '</li>';
    if (path.has(x)) return '<li>' + label + ' <span class="muted">(ciclo)</span></li>';
    path.add(x);
    const inner = '<ul>' + kids.map(([k, n]) => node(k, depth + 1, n)).join('') + '</ul>';
    path.delete(x);
    return '<li><details' + (depth < 2 ? ' open' : '') + '><summary>' + label + ' <span class="muted">(' + kids.length + ')</span></summary>' + inner + '</details></li>';
  };
  return '<ul class="tree">' + node(i, 0, null) + '</ul>';
}

/* ================= helpers de render ================= */
const badge = (p) => '<span class="b ' + p.estado + '">' + ESTADOS[p.estado] + '</span>';
const kindTag = (p) => '<span class="tag">' + (p.k === 'J' ? 'Job' : 'Trans') + '</span>';
const plink = (i) => { const p = M.P[i]; return '<a href="#/p/' + i + '" title="' + esc(p.path) + '">' + esc(p.n) + '</a>'; };
const tlink = (k) => '<a class="mono" href="#/t/' + enc(k) + '">' + esc(k) + '</a>';
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1600); };
const copy = (txt) => navigator.clipboard.writeText(txt).then(() => toast('Copiado al portapapeles (' + txt.length + ' caracteres)'), () => {
  const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copiado');
});
function schedText(p) {
  const out = [];
  const roots = [...new Set([...p._act, ...p._pau])];
  for (const r of roots) for (const s of M.schedBy.get(r) || []) out.push({ root: r, s });
  return out;
}
function schedHtml(p, compact) {
  const list = schedText(p);
  if (!list.length) return p._man.length ? '<span class="muted">Ejecución manual' + (p._man[0] !== p.i ? ' vía ' + plink(p._man[0]) : '') + '</span>' : '<span class="muted">—</span>';
  return list.slice(0, compact ? 2 : 50).map(({ root, s }) =>
    '<div>' + (s.pausado ? '<span class="b pausado">Pausado</span> ' : '<span class="b activo">Normal</span> ') + esc(s.rep) +
    (root !== p.i ? ' <span class="muted">vía</span> ' + plink(root) : '') +
    (compact ? '' : ' <span class="muted">· última: ' + esc(s.last || '—') + ' · próxima: ' + esc(s.next || '—') + '</span>') + '</div>').join('') +
    (compact && list.length > 2 ? '<div class="muted">+' + (list.length - 2) + ' más</div>' : '');
}
function sortable(id) {
  const tb = document.getElementById(id); if (!tb) return;
  tb.querySelectorAll('th.s').forEach((th, ci) => th.addEventListener('click', () => {
    const idx = [...th.parentNode.children].indexOf(th);
    const rows = [...tb.tBodies[0].rows]; const dir = th.dataset.dir = th.dataset.dir === 'a' ? 'd' : 'a';
    rows.sort((a, b) => { const x = a.cells[idx].dataset.v ?? a.cells[idx].textContent, y = b.cells[idx].dataset.v ?? b.cells[idx].textContent;
      const nx = +x, ny = +y; const c = !isNaN(nx) && !isNaN(ny) && x !== '' && y !== '' ? nx - ny : String(x).localeCompare(String(y)); return dir === 'a' ? c : -c; });
    rows.forEach(r => tb.tBodies[0].appendChild(r));
  }));
}

/* ================= vistas ================= */
function viewHome() {
  const P = M.P;
  const cnt = (e) => P.filter(p => p.estado === e).length;
  const roots = M.sched.length, rootsOk = M.sched.filter(s => s.id >= 0).length;
  const topW = [...M.tables.values()].sort((a, b) => new Set(b.w.map(x => x[0])).size - new Set(a.w.map(x => x[0])).size).slice(0, 12);
  const dbs = [...M.dbs.values()].sort((a, b) => b.procs.size - a.procs.size).slice(0, 12);
  const errs = (IX.errores || []).length;
  const mod = (href, icon, t, d, dis) => '<a class="mod' + (dis ? ' dis' : '') + '" href="' + href + '"><svg><use href="#' + icon + '"/></svg><b>' + t + '</b><span>' + d + '</span></a>';
  return '<div class="hero"><div><h1>Atlas Pentaho</h1><p>El mapa completo de los procesos, datos, calendarios y ejecuciones de la plataforma. Offline: nada sale de este equipo.</p></div>' +
    '<div class="row"><a class="btn pri" href="#/logs">Cargar log del día</a><a class="btn" href="#/kpis">Ver indicadores</a></div></div>' +
    '<div class="mods">' + mod('#/procesos', 'i-list', 'Catálogo', 'Fichas, linaje, SQL, archivos y variables de cada proceso.') + mod('#/ejecuciones', 'i-play', 'Ejecuciones del día', 'Qué corrió, qué falló y qué no corrió, cruzado con el catálogo.') +
    mod('#/kpis', 'i-chart', 'Indicadores', 'Carga por BD, dependencias, riesgo, ventana horaria e higiene.') + mod('#/logs', 'i-log', 'Logs', 'Carga el log del servidor: ejecuciones, errores, rendimiento y dependencias.') + mod('#/auditoria', 'i-shield', 'Auditoría de secretos', 'Credenciales expuestas en ETL (próximamente).', 1) + '</div>' +
    '<h2>Catálogo</h2><div class="muted">Fuente: ' + esc(IX.fuente && IX.fuente.home || '?') + ' · índice generado ' + esc((IX.generado || '').slice(0, 16).replace('T', ' ')) +
    ' · ' + (IX.fuente ? IX.fuente.properties.length : 0) + ' properties · ' + roots + ' calendarizaciones (' + rootsOk + ' vinculadas)</div>' +
    (errs ? '<div class="alert bad">' + errs + ' objetos del HOME no se pudieron leer. Revisa la consola.</div>' : '') +
    (roots === 0 ? '<div class="alert">No se cargó la calendarización: todos los procesos aparecerán como "Sin calendarizar" o "Manual".</div>' : '') +
    '<h2>Resumen</h2><div class="grid">' +
    [[IX.resumen.jobs, 'Jobs'], [IX.resumen.trans, 'Transformaciones'], [cnt('activo'), 'Activos (por calendario)'], [cnt('pausado'), 'Solo en calendarios pausados'],
     [cnt('manual'), 'Manuales'], [cnt('sin'), 'Sin calendarizar'], [M.tables.size, 'Tablas tocadas'], [M.dbs.size, 'Bases de datos'],
     [M.files.size, 'Rutas de archivos'], [M.ext.size, 'Destinos externos']].map(([v, l]) => '<div class="kpi"><b>' + v.toLocaleString('es') + '</b><span>' + l + '</span></div>').join('') + '</div>' +
    '<div class="cols"><div><h2>Tablas escritas por más procesos</h2><div class="tw"><table><thead><tr><th>Tabla</th><th>Escriben</th><th>Leen</th></tr></thead><tbody>' +
    topW.map(t => '<tr><td>' + tlink(t.k) + '</td><td>' + new Set(t.w.map(x => x[0])).size + '</td><td>' + new Set(t.r.map(x => x[0])).size + '</td></tr>').join('') + '</tbody></table></div></div>' +
    '<div><h2>Bases de datos con más procesos</h2><div class="tw"><table><thead><tr><th>BD</th><th>Servidor</th><th>Procesos</th><th>Tablas</th></tr></thead><tbody>' +
    dbs.map(d => '<tr><td><a href="#/bd/' + enc(d.db) + '">' + esc(d.db) + '</a></td><td class="mono">' + esc([...d.srv].join(', ')) + '</td><td>' + d.procs.size + '</td><td>' + (d.tables || 0) + '</td></tr>').join('') + '</tbody></table></div></div></div>' +
    '<h2>¿Cómo usarlo en un ticket?</h2><div class="panel">Escribe arriba el nombre de la <b>tabla</b>, <b>BD</b>, <b>aplicativo</b>, <b>carpeta</b>, <b>variable</b> o un texto del <b>SQL</b>. ' +
    'En la tabla verás <b>quién la escribe</b>, cuándo corre (calendario, última y próxima ejecución), de dónde saca los datos y qué revisar.</div>';
}

function viewSearch(q) {
  const ql = q.toLowerCase().trim();
  if (!ql) return '<h1>Buscar</h1><p class="muted">Escribe algo en el buscador.</p>';
  const P = M.P, lim = 80;
  const procs = P.filter(p => p.path.toLowerCase().includes(ql) || (p.ds || '').toLowerCase().includes(ql))
    .sort((a, b) => (b.n.toLowerCase().startsWith(ql) - a.n.toLowerCase().startsWith(ql)) || ({ activo: 0, manual: 1, pausado: 2, sin: 3 }[a.estado] - { activo: 0, manual: 1, pausado: 2, sin: 3 }[b.estado]));
  const qn = ql.replace(/[\[\]"`]/g, '');
  const tabs = [...M.tables.values()].filter(t => t.k.toLowerCase().includes(qn));
  const sps = [...M.sps.keys()].filter(k => k.toLowerCase().includes(qn));
  const dbs = [...M.dbs.values()].filter(d => d.db.toLowerCase().includes(ql) || [...d.srv].some(s => s.toLowerCase().includes(ql)) || [...d.cn].some(c => c.toLowerCase().includes(ql)));
  const files = [...M.files.keys()].filter(f => f.toLowerCase().includes(ql));
  const exts = [...M.ext.keys()].filter(k => k.toLowerCase().includes(ql));
  const apps = M.apps.filter(a => a.app.toLowerCase().includes(ql));
  const vars = [];
  for (const k in IX.props) for (const [n, v] of Object.entries(IX.props[k].kv)) if (n.toLowerCase().includes(ql) || String(v).toLowerCase().includes(ql)) vars.push([IX.props[k].file, n, v]);
  const sql = [];
  if (ql.length >= 3) for (const p of P) { if (!okE(p)) continue; p.st.forEach((s, si) => { if ((s.q && s.q.toLowerCase().includes(ql)) || (s.code && s.code.toLowerCase().includes(ql))) sql.push([p.i, si]); }); if (sql.length > 400) break; }
  const sec = (title, n, html) => n ? '<h2>' + title + ' <span class="muted">(' + n + ')</span></h2>' + html : '';
  const more = (n) => n > lim ? '<div class="muted">Mostrando ' + lim + ' de ' + n + '. Refina la búsqueda.</div>' : '';
  let h = '<h1>Resultados para "' + esc(q) + '"</h1>';
  h += sec('Aplicativos', apps.length, '<div class="panel">' + apps.map(a => '<div><b>' + esc(a.app) + '</b> — BD: ' + esc((a.bd || []).join(', ')) +
    ((a.tablas || []).length ? ' · tablas: ' + esc(a.tablas.join(', ')) : '') + (a.notas ? ' <span class="muted">· ' + esc(a.notas) + '</span>' : '') +
    ' · <a href="#/app/' + enc(a.app) + '">ver tablas y procesos</a></div>').join('') + '</div>');
  h += sec('Tablas', tabs.length, '<div class="tw"><table><thead><tr><th>Tabla</th><th>Escriben</th><th>Leen</th><th>Servidor</th></tr></thead><tbody>' +
    tabs.slice(0, lim).map(t => '<tr><td>' + tlink(t.k) + '</td><td>' + new Set(t.w.map(x => x[0])).size + '</td><td>' + new Set(t.r.map(x => x[0])).size + '</td><td class="mono">' + esc([...t.srv].join(', ')) + '</td></tr>').join('') + '</tbody></table></div>' + more(tabs.length));
  h += sec('Procesos', procs.length, procTable(procs.slice(0, lim), 'sr-p') + more(procs.length));
  h += sec('Procedimientos almacenados', sps.length, '<div class="panel">' + sps.slice(0, lim).map(k => '<div><span class="mono">' + esc(k) + '</span> ← ' + [...new Set(M.sps.get(k).map(x => x[0]))].slice(0, 8).map(plink).join(', ') + '</div>').join('') + '</div>');
  h += sec('Bases de datos / conexiones', dbs.length, '<div class="panel">' + dbs.slice(0, lim).map(d => '<div><a href="#/bd/' + enc(d.db) + '">' + esc(d.db) + '</a> <span class="muted">' + esc([...d.srv].join(', ')) + ' · conexiones: ' + esc([...d.cn].join(', ')) + '</span></div>').join('') + '</div>');
  h += sec('Archivos y carpetas', files.length, filesTable(files.slice(0, lim)) + more(files.length));
  h += sec('Destinos externos (SFTP, HTTP, mail, Mongo, shell)', exts.length, '<div class="tw"><table><thead><tr><th>Tipo</th><th>Destino</th><th>Procesos</th></tr></thead><tbody>' +
    exts.slice(0, lim).map(k => { const [kind, tg] = k.split('|'); return '<tr><td>' + esc(kind) + '</td><td class="mono">' + esc(tg) + '</td><td>' + [...new Set(M.ext.get(k).map(x => x[0]))].slice(0, 10).map(plink).join(', ') + '</td></tr>'; }).join('') + '</tbody></table></div>');
  h += sec('Variables en .properties', vars.length, '<div class="tw"><table><thead><tr><th>Archivo</th><th>Variable</th><th>Valor</th><th>Procesos que la usan</th></tr></thead><tbody>' +
    vars.slice(0, lim).map(([f, n, v]) => { const us = P.filter(p => (p.v || []).includes(n)); return '<tr><td>' + esc(f) + '</td><td class="mono">' + esc(n) + '</td><td class="mono">' + esc(v) + '</td><td>' + us.length + (us.length ? ': ' + us.slice(0, 5).map(p => plink(p.i)).join(', ') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' + more(vars.length));
  h += sec('Texto encontrado en SQL / código', sql.length, '<div class="tw"><table><thead><tr><th>Proceso</th><th>Paso</th><th>Fragmento</th></tr></thead><tbody>' +
    sql.slice(0, lim).map(([pi, si]) => { const s = M.P[pi].st[si]; const t = s.q || s.code; const ix = t.toLowerCase().indexOf(ql);
      return '<tr><td>' + plink(pi) + ' ' + badge(M.P[pi]) + '</td><td>' + esc(s.n) + ' <span class="tag">' + esc(s.t) + '</span></td><td class="mono">…' + esc(t.slice(Math.max(0, ix - 60), ix)) + '<mark>' + esc(t.substr(ix, ql.length)) + '</mark>' + esc(t.substr(ix + ql.length, 80)) + '…</td></tr>'; }).join('') + '</tbody></table></div>' + more(sql.length));
  if (h.indexOf('<h2>') < 0) h += '<p class="muted">Sin resultados.</p>';
  return h;
}

function procTable(list, id) {
  const all = list.length; list = list.filter(okE);
  return hiddenNote(all - list.length) + '<div class="tw"><table id="' + id + '"><thead><tr><th class="s">Proceso</th><th class="s">Tipo</th><th class="s">Estado</th><th>Calendario</th><th class="s">Carpeta</th><th class="s">Pasos</th><th class="s">Modificado</th></tr></thead><tbody>' +
    list.map(p => '<tr><td>' + plink(p.i) + '</td><td>' + (p.k === 'J' ? 'Job' : 'Trans') + '</td><td data-v="' + p.estado + '">' + badge(p) + '</td><td>' + schedHtml(p, true) +
      '</td><td class="mono">' + esc(p.d) + '</td><td>' + p.st.length + '</td><td data-v="' + esc(p.md) + '">' + esc((p.md || '').slice(0, 10)) + ' <span class="muted">' + esc(p.mu || '') + '</span></td></tr>').join('') + '</tbody></table></div>';
}
function filesTable(list) {
  return '<div class="tw"><table><thead><tr><th>Ruta</th><th>Operaciones</th><th>Procesos</th></tr></thead><tbody>' +
    list.map(f => { const u = M.files.get(f).filter(x => okI(x[0])); if (!u.length) return ''; return '<tr><td class="mono">' + esc(f) + '</td><td>' + [...new Set(u.map(x => x[2]))].map(o => '<span class="tag">' + esc(o) + '</span>').join('') +
      '</td><td>' + [...new Set(u.map(x => x[0]))].slice(0, 8).map(i => plink(i) + ' ' + badge(M.P[i])).join(', ') + '</td></tr>'; }).join('') + '</tbody></table></div>';
}

function chainUp(i, depth) {
  // caminos hacia arriba hasta las raíces (máx. 6 niveles, 12 caminos)
  const out = []; const walk = (x, path) => { if (out.length >= 12) return; const cs = M.callers[x]; if (!cs.length || path.length > 6) { out.push(path); return; }
    for (const c of cs) if (!path.includes(c)) walk(c, path.concat(c)); };
  walk(i, [i]); return out;
}

function viewProc(i) {
  const p = M.P[i]; if (!p) return '<p>Proceso no encontrado.</p>';
  const cx = p.cx || [];
  const steps = p.st;
  const callees = steps.map((s, si) => [s, si]).filter(([s]) => s.call);
  const files = steps.flatMap((s, si) => (s.f || []).map(f => [f[0], f[1], s.n]));
  const ext = steps.flatMap(s => (s.x || []).map(x => [...x, s.n]));
  const sqlSteps = steps.filter(s => s.q).length, codeSteps = steps.filter(s => s.code).length;
  const vars = p.v || [];
  let h = '<div class="row"><h1>' + esc(p.n) + '</h1>' + kindTag(p) + badge(p) + (p.master ? '<span class="b master" title="Job principal: nadie lo llama y ejecuta otros procesos">Master</span>' : '') + '</div><div class="mono muted">' + esc(p.path) + '</div>' +
    (p.ds ? '<p>' + esc(p.ds) + '</p>' : '') +
    '<div class="row" style="margin:10px 0"><button class="btn pri" id="cp-llm">Copiar ficha para LLM</button><button class="btn" id="cp-llm-sql">Copiar ficha + SQL</button><button class="btn" id="cp-path">Copiar ruta</button><a class="btn" href="#/linaje/p/' + i + '">Ver linaje</a></div>';
  h += '<div class="cols"><div class="panel"><h3 style="margin-top:0">Ejecución</h3>' + schedHtml(p, false) +
    (p.loop ? '<div class="alert">El job tiene repetición interna en su paso START (tipo ' + esc(p.loop[0]) + '): se re-ejecuta solo mientras esté corriendo.</div>' : '') +
    '<h3>Llamado por</h3>' + (M.callers[i].length ? chainUp(i).map(path => '<div>' + path.slice().reverse().map(x => plink(x) + (x !== i ? ' ' + badge(M.P[x]) : '')).join(' → ') + '</div>').join('') : '<span class="muted">Nadie lo llama (es raíz o está huérfano).</span>') +
    '</div><div class="panel"><h3 style="margin-top:0">Datos generales</h3><dl class="dl">' +
    '<dt>Pasos / entradas</dt><dd>' + steps.length + (p.nh != null ? ' · ' + p.nh + ' saltos' + (p.hoff ? ' (' + p.hoff + ' deshabilitados)' : '') : '') + '</dd>' +
    '<dt>SQL / código</dt><dd>' + sqlSteps + ' pasos con SQL · ' + codeSteps + ' con código JS/Java/shell</dd>' +
    '<dt>Creado</dt><dd>' + esc(p.cd || '—') + ' ' + esc(p.cu || '') + '</dd><dt>Modificado</dt><dd>' + esc(p.md || '—') + ' ' + esc(p.mu || '') + '</dd>' +
    '<dt>Properties</dt><dd>' + ((p.pe || []).map(k => '<span class="tag" title="' + ((p.pf || []).includes(k) ? 'referenciado por este proceso' : 'heredado de quien lo llama') + '">' + esc(IX.props[k].file) + ((p.pf || []).includes(k) ? '' : ' ↑') + '</span>').join('') || '<span class="muted">ninguno detectado</span>') + '</dd>' +
    (p.lg ? '<dt>Tabla de log</dt><dd class="mono">' + esc(p.lg) + '</dd>' : '') +
    (p.eh ? '<dt>Manejo de error</dt><dd>' + p.eh + ' pasos con flujo de error</dd>' : '') +
    '</dl></div></div>';
  if (typeof runsForProc === 'function') h += runsForProc(i);
  // BD
  h += '<h2>Conexiones a base de datos (' + cx.length + ')</h2>' + (cx.length ? '<div class="tw"><table><thead><tr><th>Conexión</th><th>Tipo</th><th>Servidor</th><th>Base de datos</th><th>Pasos que la usan</th></tr></thead><tbody>' +
    cx.map(c => '<tr><td>' + esc(c.n) + (c.nd ? ' <span class="b bad" title="La conexión no está definida en el HOME">sin definición</span>' : '') + '</td><td>' + esc(c.ty) + (c.ac && c.ac !== 'Native' ? ' / ' + esc(c.ac) : '') + '</td><td class="mono">' + esc(c.svr) + (c.sv !== c.svr ? ' <span class="muted">(' + esc(c.sv) + ')</span>' : '') +
      '</td><td class="mono"><a href="#/bd/' + enc((c.dbr || c.n).toUpperCase()) + '">' + esc(c.dbr) + '</a>' + (c.db !== c.dbr ? ' <span class="muted">(' + esc(c.db) + ')</span>' : '') + '</td><td>' + steps.filter(s => s.c === c.n).length + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No usa conexiones de BD.</p>');
  // tablas
  const tabRows = (keys, kind) => keys.map(k => { const ss = steps.filter(s => (s[kind] || []).includes(k)); const t = M.tables.get(k);
    const others = t ? new Set((kind === 'w' ? t.w : t.r).map(x => x[0])).size - 1 : 0;
    return '<tr><td>' + tlink(k) + '</td><td>' + ss.map(s => esc(s.n) + ' <span class="tag">' + esc(OPS_W[s.t] || s.t) + (s.tr ? ' + truncate' : '') + '</span>').join('<br>') + '</td><td>' + (others > 0 ? others : '') + '</td></tr>'; }).join('');
  h += '<div class="cols"><div><h2>Escribe en (' + (p.w || []).length + ')</h2>' + ((p.w || []).length ? '<div class="tw"><table><thead><tr><th>Tabla</th><th>Paso</th><th>Otros que escriben</th></tr></thead><tbody>' + tabRows(p.w, 'w') + '</tbody></table></div>' : '<p class="muted">—</p>') +
    '</div><div><h2>Lee de (' + (p.r || []).length + ')</h2>' + ((p.r || []).length ? '<div class="tw"><table><thead><tr><th>Tabla</th><th>Paso</th><th>Otros que leen</th></tr></thead><tbody>' + tabRows(p.r, 'r') + '</tbody></table></div>' : '<p class="muted">—</p>') + '</div></div>';
  if ((p.sp || []).length) h += '<h2>Procedimientos almacenados (' + p.sp.length + ')</h2><div class="panel">' + p.sp.map(k => '<div class="mono">' + esc(k) + '</div>').join('') + '</div>';
  // árbol de ejecución completo (todo lo que corre por debajo)
  if ((p.cs || []).length) {
    const d = descOf(i); let nj = 0, nt = 0; const tw = new Set(p.w || []);
    for (const x of d) { M.P[x].k === 'J' ? nj++ : nt++; (M.P[x].w || []).forEach(k => tw.add(k)); }
    h += '<h2>Árbol de ejecución <span class="muted">(' + nj + ' jobs y ' + nt + ' transformaciones debajo · escribe ' + tw.size + ' tablas en total)</span></h2>' +
      '<div class="panel">' + treeHtml(i) + '</div>';
  }
  // llamadas
  if (callees.length) h += '<h2>Llama a (' + callees.length + ')</h2><div class="tw"><table><thead><tr><th>Paso</th><th>Proceso llamado</th><th>Estado</th><th>Escribe en</th></tr></thead><tbody>' +
    callees.map(([s]) => '<tr><td>' + esc(s.n) + '</td><td>' + (s.to >= 0 ? plink(s.to) : '<span class="b bad">no encontrado</span> <span class="mono">' + esc(s.tp) + '</span>') + '</td><td>' + (s.to >= 0 ? badge(M.P[s.to]) : '') + '</td><td>' +
      (s.to >= 0 ? (M.P[s.to].w || []).slice(0, 4).map(tlink).join('<br>') + ((M.P[s.to].w || []).length > 4 ? '<br><span class="muted">+' + (M.P[s.to].w.length - 4) + '</span>' : '') : '') + '</td></tr>').join('') + '</tbody></table></div>';
  // archivos
  if (files.length) h += '<h2>Archivos y carpetas (' + files.length + ')</h2><div class="tw"><table><thead><tr><th>Operación</th><th>Ruta</th><th>Resuelta</th><th>Paso</th></tr></thead><tbody>' +
    files.map(([f, op, sn]) => { const r = resolveStr(p, f); return '<tr><td><span class="tag">' + esc(op) + '</span></td><td class="mono">' + esc(f) + '</td><td class="mono">' + (r !== f ? esc(r) : '') + '</td><td>' + esc(sn) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  if (ext.length) h += '<h2>Destinos externos (' + ext.length + ')</h2><div class="tw"><table><thead><tr><th>Tipo</th><th>Destino</th><th>Detalle</th><th>Paso</th></tr></thead><tbody>' +
    ext.map(([k, t, d, sn]) => '<tr><td>' + esc(k) + '</td><td class="mono">' + esc(resolveStr(p, t)) + (resolveStr(p, t) !== t ? ' <span class="muted">(' + esc(t) + ')</span>' : '') + '</td><td class="mono">' + esc(resolveStr(p, d || '')) + '</td><td>' + esc(sn) + '</td></tr>').join('') + '</tbody></table></div>';
  // variables
  if (vars.length || (p.par || []).length) {
    h += '<h2>Variables y parámetros (' + vars.length + ')</h2>';
    if ((p.par || []).length) h += '<div class="panel"><b>Parámetros:</b> ' + p.par.map(x => '<span class="tag">' + esc(x[0]) + (x[1] ? ' = ' + esc(x[1]) : '') + '</span>').join('') + '</div>';
    h += '<div class="tw"><table><thead><tr><th>Variable</th><th>Valor resuelto</th><th>Origen</th></tr></thead><tbody>' +
      vars.map(v => { const r = resolveVar(p, v); return '<tr><td class="mono">' + esc(v) + '</td><td class="mono">' + (r.v != null ? esc(r.v) : r.amb ? '<span class="b pausado">ambigua</span>' : '<span class="b bad">sin resolver</span>') +
        '</td><td class="muted">' + esc(r.src || '') + (r.amb ? r.amb.slice(0, 6).map(a => '<div class="mono">' + esc(a) + '</div>').join('') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  // pasos
  h += '<h2>' + (p.k === 'J' ? 'Entradas del job' : 'Pasos') + ' (' + steps.length + ')</h2><div class="filters"><input id="stf" placeholder="Filtrar pasos por nombre o tipo…"><label><input type="checkbox" id="stsql"> solo con SQL/código</label></div>' +
    '<div class="tw"><table id="steps"><thead><tr><th>#</th><th>Nombre</th><th>Tipo</th><th>Conexión</th><th>Detalle</th>' + (p.k === 'J' ? '<th>Siguiente</th>' : '') + '</tr></thead><tbody>' +
    steps.map((s, si) => {
      const det = [];
      if (s.w) det.push('escribe ' + s.w.map(tlink).join(', '));
      if (s.r) det.push('lee ' + s.r.map(tlink).join(', '));
      if (s.p) det.push('SP ' + s.p.map(k => '<span class="mono">' + esc(k) + '</span>').join(', '));
      if (s.call) det.push('llama ' + (s.to >= 0 ? plink(s.to) : '<span class="mono">' + esc(s.tp) + '</span>'));
      if (s.f) det.push(s.f.map(f => '<span class="tag">' + esc(f[1]) + '</span><span class="mono">' + esc(f[0]) + '</span>').join('<br>'));
      if (s.x) det.push(s.x.map(x => esc(x[0]) + ': <span class="mono">' + esc(resolveStr(p, x[1])) + '</span>').join('<br>'));
      if (s.er) det.push('<span class="b pausado">SQL por cada fila</span>');
      if (s.cm) det.push('commit ' + esc(s.cm));
      if (s.dy) det.push('<span class="tag">SQL dinámico</span>');
      if (s.q) det.push('<details><summary>SQL (' + s.q.length + ' car.)</summary><pre class="code">' + esc(s.q) + '</pre></details>');
      if (s.code) det.push('<details><summary>Código (' + s.cl + ' car.)</summary><pre class="code">' + esc(s.code) + '</pre></details>');
      const next = p.k === 'J' ? (p.hp || []).filter(hh => hh[0] === si).map(hh => '<span class="hop-' + hh[2] + '">' + ({ O: '✔', E: '✖', S: '→' }[hh[2]]) + '</span> ' + esc(steps[hh[1]].n) + (hh[3] === 0 ? ' <span class="muted">(deshab.)</span>' : '')).join('<br>') : '';
      return '<tr data-f="' + esc((s.n + ' ' + s.t).toLowerCase()) + '" data-c="' + (s.q || s.code ? 1 : 0) + '"><td>' + (si + 1) + '</td><td>' + esc(s.n) + '</td><td><span class="tag">' + esc(s.t) + '</span></td><td>' + esc(s.c || '') + '</td><td>' + det.join('<br>') + '</td>' + (p.k === 'J' ? '<td class="flow">' + next + '</td>' : '') + '</tr>';
    }).join('') + '</tbody></table></div>' +
    (p.k === 'J' ? '<p class="muted">Siguiente: <span class="hop-O">✔</span> si termina bien · <span class="hop-E">✖</span> si falla · <span class="hop-S">→</span> siempre.</p>' : '');
  return h;
}
function bindProc(i) {
  const p = M.P[i];
  $('#cp-llm').onclick = () => copy(llmProc(p, false));
  $('#cp-llm-sql').onclick = () => copy(llmProc(p, true));
  $('#cp-path').onclick = () => copy(p.path);
  const f = () => { const q = $('#stf').value.toLowerCase(), c = $('#stsql').checked; document.querySelectorAll('#steps tbody tr').forEach(tr => { tr.style.display = (!q || tr.dataset.f.includes(q)) && (!c || tr.dataset.c === '1') ? '' : 'none'; }); };
  $('#stf').oninput = f; $('#stsql').onchange = f;
}

function viewTable(k) {
  const t = M.tables.get(k); if (!t) return '<p>Tabla no encontrada en el índice.</p>';
  const by = (arr) => { const g = new Map(); for (const [pi, si] of arr) (g.get(pi) || g.set(pi, []).get(pi)).push(si); return [...g.entries()]; };
  const order = { activo: 0, manual: 1, pausado: 2, sin: 3 };
  const W = by(t.w).sort((a, b) => order[M.P[a[0]].estado] - order[M.P[b[0]].estado]);
  const R0 = by(t.r).sort((a, b) => order[M.P[a[0]].estado] - order[M.P[b[0]].estado]);
  const R = R0.filter(([pi]) => okI(pi));
  const apps = M.appByKey.get(k) || [];
  const wAct = W.filter(([pi]) => M.P[pi].estado === 'activo');
  let alert = '';
  if (!W.length) alert = '<div class="alert">Ningún proceso del HOME escribe en esta tabla. La carga podría venir de otro sistema (SP, job de SQL Agent, aplicativo) o de un ETL que no está en el repositorio.</div>';
  else if (!wAct.length) alert = '<div class="alert bad"><b>Ningún escritor está activo.</b> Los procesos que la alimentan son manuales, están pausados o no están calendarizados. Si el dato no aparece, esta es la primera causa a revisar.</div>';
  else alert = '<div class="alert ok">' + wAct.length + ' proceso(s) activo(s) escriben esta tabla. Revisa su última ejecución y su log.</div>';
  const rowsOf = (G, kind) => G.map(([pi, sis]) => { const p = M.P[pi];
    return '<tr><td>' + plink(pi) + ' ' + kindTag(p) + '</td><td>' + badge(p) + '</td><td>' + schedHtml(p, false) + '</td><td>' + sis.map(si => { const s = p.st[si]; return esc(s.n) + ' <span class="tag">' + esc(OPS_W[s.t] || s.t) + (s.tr ? ' + truncate' : '') + '</span>' + (s.c ? ' <span class="muted">' + esc(s.c) + '</span>' : ''); }).join('<br>') +
      '</td>' + (kind === 'w' ? '<td>' + (p.r || []).filter(x => x !== k).slice(0, 6).map(tlink).join('<br>') + ((p.r || []).length > 6 ? '<br><span class="muted">+' + (p.r.length - 6) + '</span>' : '') +
      (p.st.some(s => (s.f || []).some(f => /lee|descarga/.test(f[1]))) ? '<br><span class="muted">+ archivos de entrada</span>' : '') + '</td>' : '') + '</tr>'; }).join('');
  return '<div class="row"><h1 class="mono">' + esc(k) + '</h1>' + apps.map(a => '<span class="b k">' + esc(a) + '</span>').join(' ') + '</div>' +
    '<div class="muted">Servidor(es): <span class="mono">' + esc([...t.srv].join(', ') || '?') + '</span> · conexiones: ' + esc([...t.cn].join(', ')) + '</div>' +
    '<div class="row" style="margin:10px 0"><button class="btn pri" id="cp-llm">Copiar diagnóstico para LLM</button><a class="btn" href="#/linaje/t/' + enc(k) + '">Ver linaje</a></div>' + alert +
    '<h2>Quién escribe (' + W.length + ')</h2>' + hiddenNote(W.length - W.filter(([pi]) => okI(pi)).length) + (W.some(([pi]) => okI(pi)) ? '<div class="tw"><table><thead><tr><th>Proceso</th><th>Estado</th><th>Cuándo corre</th><th>Paso / operación</th><th>De dónde saca los datos</th></tr></thead><tbody>' + rowsOf(W.filter(([pi]) => okI(pi)), 'w') + '</tbody></table></div>' : '') +
    (typeof runsForTable === 'function' ? runsForTable(k) : '') +
    '<h2>Quién lee (' + R0.length + ')</h2>' + hiddenNote(R0.length - R.length) + (R.length ? '<div class="tw"><table><thead><tr><th>Proceso</th><th>Estado</th><th>Cuándo corre</th><th>Paso</th></tr></thead><tbody>' + rowsOf(R, 'r') + '</tbody></table></div>' : '<p class="muted">Ningún proceso del HOME la lee.</p>') +
    '<h2>Qué revisar en un ticket</h2><div class="panel"><ol style="margin:0;padding-left:18px">' +
    '<li>Confirma que el escritor activo corrió: compara "última" del calendario con la fecha del dato faltante y revisa su log (Log Analyzer).</li>' +
    '<li>Si el escritor hace <b>truncate</b> antes de insertar, una falla a mitad deja la tabla vacía o incompleta.</li>' +
    '<li>Revisa las fuentes del escritor (columna "De dónde saca los datos"): si la fuente no se actualizó, el dato tampoco llega.</li>' +
    '<li>Si hay varios escritores, revisa que no se pisen (mismo horario o truncate de uno sobre la carga del otro).</li></ol></div>';
}

function masterTable(list) {
  const all = list.length; list = list.filter(okE);
  return hiddenNote(all - list.length) + '<div class="tw"><table id="lt"><thead><tr><th class="s">Master</th><th class="s">Estado</th><th>Calendario</th><th class="s">Jobs debajo</th><th class="s">Trans debajo</th><th class="s">Tablas que escribe el árbol</th>' +
    (typeof RUNS !== 'undefined' && RUNS ? '<th class="s">Log ' + esc(RUNS.day || '') + '</th>' : '') + '<th class="s">Carpeta</th></tr></thead><tbody>' +
    list.map(p => { const d = descOf(p.i); let j = 0, t = 0; const w = new Set(p.w || []); for (const x of d) { M.P[x].k === 'J' ? j++ : t++; (M.P[x].w || []).forEach(k => w.add(k)); }
      let run = '';
      if (typeof RUNS !== 'undefined' && RUNS) { const rs = RUNS.byRoot.get(p.i) || []; const er = rs.filter(r => r.err).length;
        run = '<td data-v="' + rs.length + '">' + (rs.length ? rs.length + ' ejec.' + (er ? ' <span class="b bad">' + er + ' error</span>' : ' <span class="b activo">OK</span>') : '<span class="muted">no corrió</span>') + '</td>'; }
      return '<tr><td>' + plink(p.i) + '</td><td data-v="' + p.estado + '">' + badge(p) + '</td><td>' + schedHtml(p, true) + '</td><td data-v="' + j + '">' + j + '</td><td data-v="' + t + '">' + t + '</td><td data-v="' + w.size + '">' + w.size + '</td>' + run + '<td class="mono">' + esc(p.d) + '</td></tr>'; }).join('') + '</tbody></table></div>';
}
function viewList() {
  return '<h1>Procesos</h1><div class="filters"><select id="lf-m"><option value="m">Masters (jobs principales)</option><option value="">Todos los procesos</option></select><input id="lf-q" placeholder="Nombre o carpeta…" style="min-width:260px"><select id="lf-k"><option value="">Jobs y transformaciones</option><option value="J">Solo jobs</option><option value="T">Solo transformaciones</option></select>' +
    '<select id="lf-e"><option value="">Todos los estados</option>' + Object.entries(ESTADOS).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('') + '</select>' +
    '<select id="lf-x"><option value="">Cualquier característica</option><option value="w">Escribe en BD</option><option value="sql">Tiene SQL</option><option value="code">Tiene código JS/Java</option><option value="ext">Usa SFTP/HTTP/mail</option><option value="files">Mueve archivos</option><option value="root">Es raíz calendarizada</option><option value="orph">Nadie lo llama</option></select>' +
    '<span id="lf-n" class="muted"></span></div><div id="lf-out"></div>';
}
function bindList() {
  const run = () => {
    const q = $('#lf-q').value.toLowerCase(), k = $('#lf-k').value, e = $('#lf-e').value, x = $('#lf-x').value, mm = $('#lf-m').value;
    $('#lf-k').disabled = !!mm;
    const L = M.P.filter(p => (!mm || p.master) && (!q || p.path.toLowerCase().includes(q)) && (!k || mm || p.k === k) && (!e || p.estado === e) &&
      (!x || (x === 'w' && p.w) || (x === 'sql' && p.st.some(s => s.q)) || (x === 'code' && p.st.some(s => s.code)) || (x === 'ext' && p.st.some(s => s.x)) ||
        (x === 'files' && p.st.some(s => s.f)) || (x === 'root' && M.schedBy.has(p.i)) || (x === 'orph' && !M.callers[p.i].length && !M.schedBy.has(p.i))));
    const shown = L.filter(okE).length;
    $('#lf-n').textContent = shown + (mm ? ' masters' : ' procesos') + (shown > 500 ? ' (mostrando 500)' : '');
    if (mm) L.sort((a, b) => ({ activo: 0, manual: 1, pausado: 2, sin: 3 }[a.estado] - { activo: 0, manual: 1, pausado: 2, sin: 3 }[b.estado]) || a.n.localeCompare(b.n));
    $('#lf-out').innerHTML = mm ? masterTable(L.slice(0, 500)) : procTable(L.slice(0, 500), 'lt'); sortable('lt');
  };
  ['#lf-m', '#lf-q', '#lf-k', '#lf-e', '#lf-x'].forEach(s => $(s).addEventListener('input', run)); run();
}

function viewAgenda() {
  if (!M.sched.length) return '<h1>Calendarización</h1><div class="alert">El índice no incluye la calendarización. Regenera el índice cargando "Etls scheduleds.xlsx".</div>';
  return '<h1>Calendarización (' + M.sched.length + ')</h1><div class="filters"><input id="ag-q" placeholder="Filtrar…"><select id="ag-s"><option value="">Todos</option><option value="n">Normal</option><option value="p">Pausado</option><option value="x">Sin vincular al HOME</option></select></div>' +
    '<div class="tw"><table id="ag"><thead><tr><th class="s">Calendario</th><th class="s">Estado</th><th class="s">Repetición</th><th class="s">Job en HOME</th><th class="s">Última</th><th class="s">Próxima</th><th class="s">Procesos debajo</th><th class="s">Tablas escritas</th></tr></thead><tbody>' +
    M.sched.filter(s => s.id < 0 || okI(s.id)).map(s => { let sub = 0, tw = 0;
      if (s.id >= 0) { const seen = new Set(), st = [s.id], w = new Set(); while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); (M.P[x].w || []).forEach(k => w.add(k)); for (const c of M.P[x].cs || []) st.push(c); } sub = seen.size; tw = w.size; }
      return '<tr data-f="' + esc((s.name + ' ' + s.src + ' ' + s.rep).toLowerCase()) + '" data-s="' + (s.id < 0 ? 'x' : s.pausado ? 'p' : 'n') + '"><td>' + esc(s.name) + '</td><td>' + (s.pausado ? '<span class="b pausado">' : '<span class="b activo">') + esc(s.st || '?') + '</span></td><td>' + esc(s.rep) + '</td><td>' +
        (s.id >= 0 ? plink(s.id) : '<span class="b bad">no encontrado</span> <span class="mono">' + esc(s.src) + '</span>') + '</td><td>' + esc(s.last) + '</td><td>' + esc(s.next) + '</td><td>' + sub + '</td><td>' + tw + '</td></tr>'; }).join('') + '</tbody></table></div>';
}
function bindAgenda() {
  if (!$('#ag')) return; sortable('ag');
  const f = () => { const q = $('#ag-q').value.toLowerCase(), s = $('#ag-s').value; document.querySelectorAll('#ag tbody tr').forEach(tr => { tr.style.display = (!q || tr.dataset.f.includes(q)) && (!s || tr.dataset.s === s) ? '' : 'none'; }); };
  $('#ag-q').oninput = f; $('#ag-s').onchange = f;
}

function viewDbs() {
  const L = [...M.dbs.values()].sort((a, b) => b.procs.size - a.procs.size);
  const srvs = [...new Set(L.flatMap(d => [...d.srv]))].sort(), tys = [...new Set(L.flatMap(d => [...d.ty]))].sort();
  return '<h1>Bases de datos</h1><div class="filters"><input id="db-q" placeholder="BD, servidor o conexión…" style="min-width:240px">' +
    '<select id="db-s"><option value="">Todos los servidores / hosts</option>' + srvs.map(s => '<option>' + esc(s) + '</option>').join('') + '</select>' +
    '<select id="db-t"><option value="">Todos los motores</option>' + tys.map(s => '<option>' + esc(s) + '</option>').join('') + '</select>' +
    '<label><input type="checkbox" id="db-u"> solo BD usadas por procesos del filtro de estado</label><label><input type="checkbox" id="db-v"> ocultar servidores sin resolver (${…})</label><span id="db-n" class="muted"></span></div>' +
    '<div class="tw"><table id="dbt"><thead><tr><th class="s">BD</th><th class="s">Servidor(es)</th><th class="s">Tipo</th><th class="s">Conexiones</th><th class="s">Procesos</th><th class="s">En el filtro de estado</th><th class="s">Activos</th><th class="s">Tablas</th></tr></thead><tbody>' +
    L.map(d => { const inF = [...d.procs].filter(okI).length;
      return '<tr data-f="' + esc((d.db + ' ' + [...d.srv].join(' ') + ' ' + [...d.cn].join(' ')).toLowerCase()) + '" data-s="' + esc([...d.srv].join('|')) + '" data-t="' + esc([...d.ty].join('|')) + '" data-u="' + inF + '" data-v="' + ([...d.srv].length && [...d.srv].every(s => s.includes('${')) ? 1 : 0) + '">' +
        '<td><a href="#/bd/' + enc(d.db) + '">' + esc(d.db) + '</a></td><td class="mono">' + esc([...d.srv].join(', ')) + '</td><td>' + esc([...d.ty].join(', ')) + '</td><td>' + esc([...d.cn].slice(0, 6).join(', ')) + (d.cn.size > 6 ? ' +' + (d.cn.size - 6) : '') +
        '</td><td>' + d.procs.size + '</td><td>' + inF + '</td><td>' + [...d.procs].filter(i => M.P[i].estado === 'activo').length + '</td><td>' + (d.tables || 0) + '</td></tr>'; }).join('') + '</tbody></table></div>';
}
function bindDbs() {
  sortable('dbt');
  const run = () => {
    const q = $('#db-q').value.toLowerCase(), s = $('#db-s').value, t = $('#db-t').value, u = $('#db-u').checked, v = $('#db-v').checked; let n = 0;
    document.querySelectorAll('#dbt tbody tr').forEach(tr => {
      const ok = (!q || tr.dataset.f.includes(q)) && (!s || tr.dataset.s.split('|').includes(s)) && (!t || tr.dataset.t.split('|').includes(t)) && (!u || +tr.dataset.u > 0) && (!v || tr.dataset.v !== '1');
      tr.style.display = ok ? '' : 'none'; if (ok) n++;
    });
    $('#db-n').textContent = n + ' bases de datos';
  };
  ['#db-q', '#db-s', '#db-t', '#db-u', '#db-v'].forEach(x => $(x).addEventListener('input', run)); run();
}
function viewDb(db) {
  const d = M.dbs.get(db); if (!d) return '<p>BD no encontrada.</p>';
  const T = [...M.tables.values()].filter(t => t.k.split('.')[0] === db).sort((a, b) => b.w.length - a.w.length);
  return '<h1>' + esc(db) + '</h1><div class="muted">Servidor(es): <span class="mono">' + esc([...d.srv].join(', ')) + '</span> · conexiones: ' + esc([...d.cn].join(', ')) + '</div>' +
    '<h2>Tablas (' + T.length + ')</h2><div class="filters"><input id="dbq" placeholder="Filtrar tablas…"></div><div class="tw"><table id="dbtab"><thead><tr><th class="s">Tabla</th><th class="s">Procesos que escriben</th><th class="s">Escritores activos</th><th class="s">Procesos que leen</th></tr></thead><tbody>' +
    T.map(t => { const w = new Set(t.w.map(x => x[0])); return '<tr data-f="' + esc(t.k.toLowerCase()) + '"><td>' + tlink(t.k) + '</td><td>' + w.size + '</td><td>' + [...w].filter(i => M.P[i].estado === 'activo').length + '</td><td>' + new Set(t.r.map(x => x[0])).size + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<h2>Procesos que se conectan (' + d.procs.size + ')</h2>' + procTable([...d.procs].map(i => M.P[i]).sort((a, b) => a.n.localeCompare(b.n)), 'dbp');
}
function bindDb() { sortable('dbtab'); sortable('dbp'); const q = $('#dbq'); if (q) q.oninput = () => document.querySelectorAll('#dbtab tbody tr').forEach(tr => { tr.style.display = tr.dataset.f.includes(q.value.toLowerCase()) ? '' : 'none'; }); }

function viewApp(name) {
  const a = M.apps.find(x => x.app === name); if (!a) return '<p>Aplicativo no encontrado en data/aplicativos.js.</p>';
  const T = [...M.appByKey.entries()].filter(([, v]) => v.includes(name)).map(([k]) => M.tables.get(k));
  return '<h1>' + esc(a.app) + '</h1><div class="muted">' + esc(a.notas || '') + '</div><h2>Tablas del aplicativo (' + T.length + ')</h2><div class="tw"><table><thead><tr><th>Tabla</th><th>Escritores</th><th>Activos</th></tr></thead><tbody>' +
    T.map(t => { const w = [...new Set(t.w.map(x => x[0]))]; return '<tr><td>' + tlink(t.k) + '</td><td>' + w.slice(0, 6).map(i => plink(i) + ' ' + badge(M.P[i])).join(', ') + '</td><td>' + w.filter(i => M.P[i].estado === 'activo').length + '</td></tr>'; }).join('') + '</tbody></table></div>';
}

function viewFiles() {
  return '<h1>Archivos y carpetas (' + M.files.size + ')</h1><div class="filters"><input id="ff" placeholder="Filtrar por ruta…" style="min-width:320px"><select id="fo"><option value="">Cualquier operación</option>' +
    [...new Set([...M.files.values()].flatMap(u => u.map(x => x[2])))].sort().map(o => '<option>' + esc(o) + '</option>').join('') + '</select><span id="fn" class="muted"></span></div><div id="fout"></div>';
}
function bindFiles() {
  const keys = [...M.files.keys()].sort();
  const run = () => { const q = $('#ff').value.toLowerCase(), o = $('#fo').value; const L = keys.filter(f => (!q || f.toLowerCase().includes(q)) && (!o || M.files.get(f).some(x => x[2] === o)));
    $('#fn').textContent = L.length + ' rutas' + (L.length > 400 ? ' (mostrando 400)' : ''); $('#fout').innerHTML = filesTable(L.slice(0, 400)); };
  $('#ff').oninput = run; $('#fo').onchange = run; run();
}

/* ================= exportación compacta para LLM ================= */
function llmProc(p, withSql) {
  const L = [];
  L.push('# ' + (p.k === 'J' ? 'Job' : 'Transformación') + ' ' + p.n, 'Ruta: ' + p.path, 'Estado: ' + ESTADOS[p.estado]);
  const sc = schedText(p); if (sc.length) L.push('Calendario: ' + sc.slice(0, 4).map(({ root, s }) => (root !== p.i ? 'vía ' + M.P[root].n + ' ' : '') + s.rep + ' [' + s.st + '; última ' + s.last + ']').join(' | '));
  if (p.ds) L.push('Descripción: ' + p.ds);
  if (M.callers[p.i].length) L.push('Llamado por: ' + M.callers[p.i].map(i => M.P[i].n).join(', '));
  const cl = p.st.filter(s => s.call); if (cl.length) L.push('Llama a: ' + cl.map(s => s.to >= 0 ? M.P[s.to].n : s.tp + ' (no encontrado)').join(', '));
  if ((p.cx || []).length) L.push('Conexiones: ' + p.cx.map(c => c.n + ' (' + c.ty + ' ' + c.svr + '/' + c.dbr + ')').join('; '));
  if (p.w) L.push('Escribe: ' + p.w.join(', '));
  if (p.r) L.push('Lee: ' + p.r.join(', '));
  if (p.sp) L.push('SP: ' + p.sp.join(', '));
  const fs = p.st.flatMap(s => (s.f || []).map(f => f[1] + ' ' + resolveStr(p, f[0]))); if (fs.length) L.push('Archivos: ' + [...new Set(fs)].slice(0, 30).join('; '));
  const xs = p.st.flatMap(s => (s.x || []).map(x => x[0] + ' ' + resolveStr(p, x[1]))); if (xs.length) L.push('Externos: ' + [...new Set(xs)].slice(0, 15).join('; '));
  const vs = (p.v || []).map(v => { const r = resolveVar(p, v); return v + '=' + (r.v != null ? r.v : '?'); }); if (vs.length) L.push('Variables: ' + vs.slice(0, 40).join('; '));
  if (typeof llmRuns === 'function' && RUNS) L.push(llmRuns(p.i));
  L.push('', '## Pasos (' + p.st.length + ')');
  p.st.forEach((s, si) => {
    const nx = p.k === 'J' ? (p.hp || []).filter(h => h[0] === si).map(h => ({ O: 'ok→', E: 'error→', S: '→' }[h[2]]) + p.st[h[1]].n).join(', ') : '';
    const bits = [s.c && 'con ' + s.c, s.w && 'W ' + s.w.join(','), s.r && 'R ' + s.r.join(','), s.call && 'llama ' + (s.to >= 0 ? M.P[s.to].n : s.tp), s.tr && 'truncate', s.er && 'SQL por fila', nx].filter(Boolean);
    if (/^(Dummy|SelectValues|Constant|SortRows|SPECIAL|SUCCESS)$/.test(s.t) && !bits.length) return;
    L.push('- ' + s.n + ' [' + s.t + ']' + (bits.length ? ': ' + bits.join(' · ') : ''));
    if (withSql && s.q) L.push('  ```sql\n  ' + s.q.replace(/\s+/g, ' ').slice(0, 1500) + '\n  ```');
  });
  return L.join('\n');
}
function llmTable(k) {
  const t = M.tables.get(k); const L = ['# Tabla ' + k, 'Servidor: ' + [...t.srv].join(', ')];
  const desc = (pi) => { const p = M.P[pi]; const sc = schedText(p); return p.n + ' (' + p.path + ') estado=' + ESTADOS[p.estado] + (sc.length ? ' calendario=' + sc.slice(0, 2).map(({ root, s }) => (root !== pi ? 'vía ' + M.P[root].n + ' ' : '') + s.rep + ' [última ' + s.last + ']').join(' | ') : '') + (p.r ? ' fuentes=' + p.r.slice(0, 8).join(',') : ''); };
  L.push('## Escriben'); [...new Set(t.w.map(x => x[0]))].forEach(i => L.push('- ' + desc(i)));
  L.push('## Leen'); [...new Set(t.r.map(x => x[0]))].slice(0, 30).forEach(i => L.push('- ' + M.P[i].n + ' estado=' + ESTADOS[M.P[i].estado]));
  return L.join('\n');
}

function viewSoon(title, text) {
  return '<h1>' + esc(title) + ' <span class="b k">próximamente</span></h1><div class="panel" style="max-width:760px">' + text + '</div>';
}

/* ================= generador de índice ================= */
function viewGen() {
  return '<h1>Generar índice</h1><p class="muted">Se hace una sola vez por cada HOME nuevo. Todo se procesa en este navegador: no se envía nada a ningún servidor.</p>' + loadIndexPanel() +
    '<div class="panel"><div class="dl"><dt>1. HOME</dt><dd><input type="file" id="g-home" accept=".txt,.xml"> <span class="muted">exportación del repositorio (ej. home 20261001.txt)</span></dd>' +
    '<dt>2. Properties</dt><dd><input type="file" id="g-props" multiple webkitdirectory> <span class="muted">carpeta "properties sin contraseña"</span> · o archivos sueltos: <input type="file" id="g-props2" multiple accept=".txt,.properties"></dd>' +
    '<dt>3. Calendarización</dt><dd><input type="file" id="g-xlsx" accept=".xlsx"> <span class="muted">Etls scheduleds.xlsx</span></dd></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn pri" id="g-run">Generar índice</button><span id="g-msg" class="muted"></span></div><div class="bar" style="margin-top:8px"><i id="g-bar"></i></div></div><div id="g-done"></div>';
}
function bindGen() {
  bindLoadIndex();
  $('#g-run').onclick = async () => {
    const home = $('#g-home').files[0];
    if (!home) { $('#g-msg').textContent = 'Falta el archivo HOME.'; return; }
    const pf = [...$('#g-props').files, ...$('#g-props2').files].filter(f => /\.(txt|properties)$/i.test(f.name) && f !== home && f.size < 5e6);
    $('#g-run').disabled = true;
    try {
      const props = await Promise.all(pf.map(async f => ({ name: f.name, text: await f.text() })));
      let sched = [];
      const xf = $('#g-xlsx').files[0];
      if (xf) sched = schedFromRows(await readXlsx(xf));
      $('#g-msg').textContent = props.length + ' properties y ' + sched.length + ' calendarizaciones cargadas. Leyendo HOME…';
      const w = pixCreateWorker();
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d.type === 'progress') { $('#g-bar').style.width = d.pct + '%'; $('#g-msg').textContent = d.msg; }
        else if (d.type === 'error') { $('#g-msg').textContent = 'Error: ' + d.error; $('#g-run').disabled = false; w.terminate(); }
        else if (d.type === 'done') {
          w.terminate(); $('#g-bar').style.width = '100%';
          const idx = d.index; idx.sched = sched;
          const m = home.name.match(/(\d{8})/); const tag = m ? m[1] : new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const blob = new Blob(['window.INDICE = ', JSON.stringify(idx), ';\n'], { type: 'text/javascript' });
          const url = URL.createObjectURL(blob);
          $('#g-msg').textContent = 'Listo: ' + idx.resumen.jobs + ' jobs, ' + idx.resumen.trans + ' transformaciones.';
          $('#g-done').innerHTML = '<div class="alert ok"><b>Índice generado (' + (blob.size / 1048576).toFixed(1) + ' MB).</b> Descárgalo y guárdalo como <span class="mono">data/indice.js</span> dentro de la carpeta de la herramienta (reemplaza el anterior). Guarda también una copia como <span class="mono">data/indice_' + tag + '.js</span> para comparar versiones.' +
            '<div class="row" style="margin-top:8px"><a class="btn pri" href="' + url + '" download="indice.js">Descargar indice.js</a><a class="btn" href="' + url + '" download="indice_' + tag + '.js">Descargar indice_' + tag + '.js</a><a class="btn" href="#/">Usar ahora sin guardar</a></div></div>';
          load(idx); idbPutIndex(JSON.stringify(idx));
        }
      };
      w.postMessage({ home, props });
    } catch (e) { $('#g-msg').textContent = 'Error: ' + e.message; $('#g-run').disabled = false; }
  };
}

/* ================= router ================= */
function route() {
  const h = decodeURIComponent(location.hash.slice(1) || '/');
  const [, a, b] = h.split('/').concat(['']);
  const navKey = { p: 'procesos', t: 'procesos', buscar: 'procesos', linaje: 'procesos', app: 'procesos' }[a] || a;
  document.querySelectorAll('.side a.nv').forEach(x => x.classList.toggle('on', x.getAttribute('href') === '#/' + navKey));
  document.body.classList.remove('nav-open');
  const main = $('main');
  if (!M && !['generar', 'logs', 'config'].includes(a)) { main.innerHTML = viewNoIndex(); bindLoadIndex(); return; }
  const rest = h.split('/').slice(2).join('/');
  try {
    if (a === 'p') { main.innerHTML = viewProc(+b); bindProc(+b); }
    else if (a === 't') { main.innerHTML = viewTable(rest); $('#cp-llm') && ($('#cp-llm').onclick = () => copy(llmTable(rest))); }
    else if (a === 'buscar') { main.innerHTML = viewSearch(rest); sortable('sr-p'); }
    else if (a === 'procesos') { main.innerHTML = viewList(); bindList(); }
    else if (a === 'agenda') { main.innerHTML = viewAgenda(); bindAgenda(); }
    else if (a === 'bd' && b) { main.innerHTML = viewDb(rest); bindDb(); }
    else if (a === 'bd') { main.innerHTML = viewDbs(); bindDbs(); }
    else if (a === 'archivos') { main.innerHTML = viewFiles(); bindFiles(); }
    else if (a === 'app') { main.innerHTML = viewApp(rest); }
    else if (a === 'generar') { main.innerHTML = viewGen(); bindGen(); }
    else if (a === 'kpis') { main.innerHTML = viewKpis(b); bindKpis(b || 'carga'); }
    else if (a === 'linaje') { const id = h.split('/').slice(3).join('/'); main.innerHTML = viewLinaje(b, id); bindLinaje(b, id); }
    else if (a === 'comparar') { main.innerHTML = viewComparar(); bindComparar(); }
    else if (a === 'ejecuciones') { main.innerHTML = viewRuns(); bindRuns(); }
    else if (a === 'logs') { renderLogs(b || 'resumen').catch(e => { main.innerHTML = '<div class="alert bad">Error en Logs: ' + esc(e.message) + '</div>'; console.error(e); }); }
    else if (a === 'config') { main.innerHTML = viewConfig(); bindConfig(); }
    else if (a === 'auditoria') { main.innerHTML = viewSoon('Auditoría de secretos', 'El análisis de contraseñas, tokens y credenciales expuestas en los ETL (hoy en "analisis HOME vulnerabilidades etls") se incorporará como módulo de Atlas.'); }
    else main.innerHTML = viewHome();
  } catch (e) { main.innerHTML = '<div class="alert bad">Error al mostrar la vista: ' + esc(e.message) + '</div>'; console.error(e); }
  window.scrollTo(0, 0);
}
function load(ix) {
  IX = ix; M = buildModel(ix);
  $('#meta').textContent = (ix.fuente && ix.fuente.home || '') + ' · ' + ix.procs.length + ' procesos';
}

/* ================= índice guardado en este navegador =================
   El índice contiene datos internos (servidores, SQL, correos): no se publica con el sitio.
   Cada persona lo carga una vez desde el archivo que le comparte el equipo y queda guardado en su navegador. */
const _idxDb = () => new Promise((res, rej) => { const r = indexedDB.open('atlas-index', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function idbGetIndex() { try { const db = await _idxDb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get('indice'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
async function idbPutIndex(txt) { try { const db = await _idxDb(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ txt, at: Date.now() }, 'indice'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); return true; } catch (e) { return false; } }
async function idbDelIndex() { try { const db = await _idxDb(); await new Promise(res => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete('indice'); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {} }
function parseIndexText(t) {
  const ix = JSON.parse(String(t).replace(/^﻿/, '').replace(/^\s*window\.INDICE\s*=\s*/, '').replace(/;\s*$/, ''));
  if (!ix || !Array.isArray(ix.procs) || !ix.props) throw new Error('el archivo no es un índice de Atlas');
  return ix;
}
function loadIndexPanel() {
  return '<div class="panel"><h3 style="margin-top:0">Cargar un índice existente</h3><p class="muted">Selecciona el archivo <span class="mono">indice.js</span> que te compartió el equipo. Queda guardado en este navegador: no tendrás que volver a cargarlo.</p>' +
    '<div class="row"><input type="file" id="ix-file" accept=".js,.json"><span id="ix-msg" class="muted"></span></div></div>';
}
function viewNoIndex() {
  return '<div class="hero"><div><h1>Atlas Pentaho</h1><p>Falta el índice del catálogo. Cárgalo desde el archivo del equipo o genéralo a partir del HOME.</p></div></div>' +
    loadIndexPanel() + '<div class="panel"><h3 style="margin-top:0">¿No tienes el archivo?</h3><p class="muted">Genera el índice con el HOME, los properties y el Excel de calendarización.</p><a class="btn pri" href="#/generar">Generar índice</a></div>';
}
function bindLoadIndex() {
  const f = $('#ix-file'); if (!f) return;
  f.onchange = async () => {
    const file = f.files[0]; if (!file) return;
    $('#ix-msg').textContent = 'Leyendo ' + (file.size / 1048576).toFixed(1) + ' MB…';
    try {
      const txt = await file.text(); const ix = parseIndexText(txt);
      load(ix); const saved = await idbPutIndex(JSON.stringify(ix));
      if (typeof syncRunsFromLogs === 'function') syncRunsFromLogs().catch(() => {});
      toast(saved ? 'Índice cargado y guardado en este navegador' : 'Índice cargado (no se pudo guardar en el navegador)');
      location.hash = '#/'; route();
    } catch (e) { $('#ix-msg').textContent = 'No se pudo cargar: ' + e.message; }
  };
}
/* ================= filtro rápido en tablas largas =================
   Toda tabla con más de 10 filas que no tenga su propio filtro recibe un buscador encima. */
const OWN_FILTER = new Set(['dbt', 'lt', 'dbtab', 'ag', 'steps', 'hz-g', 'hz-db']);
function addQuickFilters(root) {
  root.querySelectorAll('.tw > table').forEach(tb => {
    if (tb.dataset.qf || OWN_FILTER.has(tb.id) || tb.classList.contains('heat') || tb.closest('.lx') || !tb.tBodies[0]) return;
    const rows = tb.tBodies[0].rows; if (rows.length <= 10) return;
    tb.dataset.qf = '1';
    const box = document.createElement('div'); box.className = 'qf';
    box.innerHTML = '<input type="search" placeholder="Filtrar esta tabla…"><span class="muted">' + rows.length + ' filas</span>';
    tb.parentNode.parentNode.insertBefore(box, tb.parentNode);
    const inp = box.firstChild, cnt = box.lastChild;
    inp.addEventListener('input', () => {
      const q = inp.value.toLowerCase().trim(); let n = 0;
      for (const r of rows) { const ok = !q || r.textContent.toLowerCase().includes(q); if (q) r.hidden = false; r.style.display = ok ? '' : 'none'; if (ok) n++; }
      cnt.textContent = q ? n + ' de ' + rows.length + ' filas' : rows.length + ' filas';
    });
  });
}
let _qfT = null;
new MutationObserver(() => { clearTimeout(_qfT); _qfT = setTimeout(() => { const m = $('main'); if (m) addQuickFilters(m); }, 60); })
  .observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', () => {
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = '#/buscar/' + enc($('#q').value.trim()); });
  $('#theme').onclick = () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'light' ? 'dark' : 'light'; try { localStorage.setItem('atlas-theme', r.dataset.theme); } catch (e) {} if (location.hash.startsWith('#/linaje')) route(); };
  $('#menu').onclick = () => document.body.classList.toggle('nav-open');
  renderEstFilter();
  if (window.INDICE) { try { load(window.INDICE); } catch (e) { console.error(e); $('main').innerHTML = '<div class="alert bad">Error cargando el índice: ' + esc(e.message) + '</div>'; return; } route(); return; }
  // sin data/indice.js (sitio público): se busca el índice guardado en este navegador
  // si el navegador no responde (almacenamiento bloqueado), se continúa sin índice guardado
  Promise.race([idbGetIndex(), new Promise(res => setTimeout(() => res(null), 4000))]).then(rec => {
    if (rec && rec.txt) { try { load(parseIndexText(rec.txt)); if (typeof syncRunsFromLogs === 'function') syncRunsFromLogs().catch(() => {}); } catch (e) { console.error(e); } }
    route();
  });
});
