/* Catálogo Pentaho — Fase 2: KPIs, ventana horaria, linaje y comparación de índices.
   Usa los helpers globales de app.js (M, IX, esc, plink, tlink, badge, sortable…). */
'use strict';

/* ================= utilidades ================= */
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const uniqN = (arr) => new Set(arr).size;
/* Alcance de los indicadores: por defecto solo lo productivo (activos + manuales). */
const SCOPES = { prod: ['Productivo (activo + manual)', e => e === 'activo' || e === 'manual', 'productivos'], act: ['Solo activos', e => e === 'activo', 'activos'], all: ['Todos los procesos', () => true, '(todos)'] };
let KSCOPE = 'prod';
try { const s = localStorage.getItem('cp-scope'); if (SCOPES[s]) KSCOPE = s; } catch (e) {}
const isAct = (i) => SCOPES[KSCOPE][1](M.P[i].estado);
// Las etiquetas "activos" de las tablas pasan a decir el alcance elegido; las frases sobre calendarios se mantienen.
function scopeLabel(html) {
  if (KSCOPE === 'act') return html;
  const pl = KSCOPE === 'prod' ? 'productivos' : 'en alcance', sg = KSCOPE === 'prod' ? 'productivo' : 'en alcance';
  return html.replace(/(alendarios) activos/g, '$1 \u0001')
    .replace(/\b([Aa])ctivos\b/g, (m, a) => a === 'A' ? pl[0].toUpperCase() + pl.slice(1) : pl)
    .replace(/\b(escritor|proceso) activo\b/g, '$1 ' + sg)
    .replace(/\u0001/g, 'activos');
}
const barCell = (v, max, txt) => '<td data-v="' + v + '"><div class="hb"><i style="width:' + (max ? Math.max(2, v / max * 100) : 0) + '%"></i><span>' + (txt != null ? txt : v.toLocaleString('es')) + '</span></div></td>';
const heat = (v, max) => v ? 'background:color-mix(in srgb, var(--accent) ' + Math.round(12 + 78 * v / (max || 1)) + '%, var(--panel));' + (v / (max || 1) > .55 ? 'color:var(--accent-ink);' : '') : '';
const tbl = (id, heads, rows) => '<div class="tw"><table id="' + id + '"><thead><tr>' + heads.map(h => '<th class="s">' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
const plist = (ids, n) => { ids = [...ids]; return ids.slice(0, n || 6).map(plink).join(', ') + (ids.length > (n || 6) ? ' <span class="muted">+' + (ids.length - (n || 6)) + '</span>' : ''); };
function parseDate(s) { if (!s || s === '-') return null; const t = Date.parse(String(s).replace(/^(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3').replace(/\.\d+$/, '')); return isNaN(t) ? null : new Date(t); }

/* ================= calendarios → franjas ================= */
function cronField(f, lo, hi) {
  if (f == null || f === '*' || f === '?') return range(lo, hi);
  const out = new Set();
  for (const part of String(f).split(',')) {
    const [rg, step] = part.split('/');
    let a = lo, b = hi;
    if (rg !== '*' && rg !== '?') { const mm = rg.split('-'); a = +(DOW[String(mm[0]).toLowerCase()] ?? mm[0]); b = mm[1] != null ? +(DOW[String(mm[1]).toLowerCase()] ?? mm[1]) : (step ? hi : a); }
    for (let x = a; x <= b; x += +(step || 1)) out.add(x);
  }
  return [...out].filter(x => !isNaN(x));
}
function parseRep(rep) {
  const r = String(rep || '').trim();
  const out = { slots: [], mensual: null, ok: true };
  const tm = r.match(/at (\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?/i);
  let h = tm ? +tm[1] : 0;
  if (tm && tm[3]) h = (h % 12) + (/PM/i.test(tm[3]) ? 12 : 0);
  const all = range(0, 6);
  const add = (days, hours, per) => { for (const d of days) for (const x of hours) out.slots.push([d, x, per || 1]); };
  let m;
  if (/^Every weekday/i.test(r)) add([1, 2, 3, 4, 5], [h]);
  else if (/^Every day\b/i.test(r)) add(all, [h]);
  else if ((m = r.match(/^Every (\d+) minutes?/i))) add(all, range(0, 23), Math.max(1, Math.round(60 / +m[1])));
  else if ((m = r.match(/^Every (\d+) hours?/i))) { const hs = []; for (let x = h; x < 24; x += +m[1]) hs.push(x); add(all, hs); }
  else if (/^Every hour/i.test(r)) add(all, range(0, 23));
  else if ((m = r.match(/^Day (\d+) of every month/i))) out.mensual = { dia: +m[1], hora: h };
  else if ((m = r.match(/^CRON:\s*(.+)$/i))) {
    const f = m[1].trim().split(/\s+/);
    const mins = cronField(f[1], 0, 59).length, hours = cronField(f[2], 0, 23);
    const domAll = f[3] === '*' || f[3] === '?';
    if (!domAll && (f[5] === '?' || f[5] === '*')) out.mensual = { dia: f[3], hora: hours.join(',') };
    else { const days = (f[5] === '?' || f[5] === '*') ? all : cronField(f[5], 1, 7).map(x => (x - 1) % 7); add(days, hours, mins); }
  }
  else if ((m = r.match(/^Every ([A-Za-z, ]+?) at/i))) { const days = m[1].split(/,\s*|\s+and\s+/).map(x => DOW[x.trim().toLowerCase()]).filter(x => x != null); if (days.length) add(days, [h]); else out.ok = false; }
  else out.ok = false;
  out.freq = new Set(out.slots.map(x => x[1])).size > 6;
  return out;
}

/* ================= métricas derivadas (memo) ================= */
let K = null;
function kmodel() {
  if (K && K.M === M) return K;
  const P = M.P;
  // árbol de cada raíz calendarizada
  const tree = new Map();
  const treeOf = (id) => { if (tree.has(id)) return tree.get(id); const seen = new Set(), st = [id]; while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); for (const c of P[x].cs || []) st.push(c); } tree.set(id, seen); return seen; };
  const dbsOfTree = (id) => { const s = new Set(); for (const x of treeOf(id)) for (const c of P[x].cx || []) s.add((c.dbr || c.n).toUpperCase()); return s; };
  // flags de complejidad / riesgo
  const FLAGS = {
    rowsql: ['SQL por fila', 5, 'ExecSQL ejecutado una vez por cada fila del flujo'],
    lookup: ['Lookup fila a fila', 3, 'DB Lookup / Database Join consultan la BD por cada fila'],
    commit: ['Commit bajo', 2, 'Tamaño de commit menor a 100'],
    trunc: ['Truncate + carga', 2, 'Vacía la tabla antes de insertar: una falla deja la tabla vacía'],
    star: ['SELECT *', 1, 'Trae todas las columnas'],
    nowhere: ['UPDATE/DELETE sin WHERE', 4, 'Sentencia que afecta toda la tabla'],
    cursor: ['Cursor', 3, 'DECLARE … CURSOR: procesamiento fila a fila en SQL'],
    dyn: ['SQL dinámico', 2, 'SQL armado en tiempo de ejecución'],
    code: ['Código JS/Java', 2, 'Lógica embebida en JavaScript / Java'],
    path: ['Ruta fija', 1, 'Ruta de archivo hardcodeada (unidad o \\\\servidor)'],
    srv: ['Servidor fijo', 1, 'Conexión con servidor escrito sin variable'],
    noerr: ['Sin flujo de error', 2, 'Job sin ningún salto "si falla"'],
    off: ['Saltos deshabilitados', 1, 'Tiene saltos desactivados'],
    loop: ['Repetición interna', 2, 'Se re-ejecuta solo desde su START'],
    broken: ['Llamada rota', 4, 'Llama a un proceso que no existe en el HOME'],
  };
  const stmtNoWhere = (q) => cleanSqlUI(q).split(/;|\bGO\b/i).some(st => /^\s*(UPDATE|DELETE)\b/i.test(st) && !/\bWHERE\b/i.test(st) && !/\bJOIN\b/i.test(st));
  const flagsOf = (p) => {
    const f = {};
    const inc = (k, n) => { f[k] = (f[k] || 0) + (n || 1); };
    for (const s of p.st) {
      if (s.er) inc('rowsql');
      if (/^(DBLookup|DBJoin)$/.test(s.t)) inc('lookup');
      if (typeof s.cm === 'number' && s.cm > 0 && s.cm < 100) inc('commit');
      if (s.tr) inc('trunc');
      if (s.q) { const c = cleanSqlUI(s.q); if (/select\s+\*/i.test(c)) inc('star'); if (stmtNoWhere(s.q)) inc('nowhere'); if (/declare\s+\w+\s+cursor/i.test(c)) inc('cursor'); }
      if (s.dy) inc('dyn');
      if (s.code && s.t !== 'SHELL') inc('code');
      for (const [fp] of s.f || []) if (/^(?:[a-zA-Z]:[\\\/]|\\\\)/.test(fp)) inc('path');
      if (s.call && s.to < 0) inc('broken');
    }
    for (const c of p.cx || []) if (c.sv && c.sv.indexOf('${') < 0 && !c.nd) inc('srv');
    if (p.k === 'J' && p.st.length > 3 && !(p.hp || []).some(h => h[2] === 'E')) inc('noerr');
    if (p.hoff || (p.hp || []).some(h => h[3] === 0)) inc('off');
    if (p.loop) inc('loop');
    return f;
  };
  const score = (p, f) => {
    const sql = p.st.filter(s => s.q).length, code = p.st.reduce((a, s) => a + (s.cl || 0), 0);
    let v = p.st.length + sql * 2 + Math.round(code / 500) + (p.cs || []).length;
    for (const k in f) v += FLAGS[k][1] * Math.min(f[k], 5);
    return v;
  };
  for (const p of P) { p._f = flagsOf(p); p._sc = score(p, p._f); }
  // raíces activas
  const actRoots = M.sched.filter(s => s.id >= 0 && !s.pausado);
  K = { M, tree, treeOf, dbsOfTree, FLAGS, actRoots };
  return K;
}
function cleanSqlUI(q) { return q.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''"); }

/* ================= tablero ================= */
const KTABS = [['carga', 'Carga BD / servidor'], ['deps', 'Dependencias críticas'], ['riesgo', 'Complejidad / riesgo'], ['horario', 'Ventana horaria'],
  ['higiene', 'Higiene'], ['archivos', 'Movimiento de archivos'], ['externos', 'Externos / proveedores']];
function viewKpis(tab) {
  tab = tab || 'carga';
  const k = kmodel();
  const nav = '<div class="tabs">' + KTABS.map(([id, t]) => '<a class="' + (id === tab ? 'on' : '') + '" href="#/kpis/' + id + '">' + t + '</a>').join('') + '</div>';
  const fn = { carga: kCarga, deps: kDeps, riesgo: kRiesgo, horario: kHorario, higiene: kHigiene, archivos: kArchivos, externos: kExternos }[tab] || kCarga;
  const P = M.P, n = P.filter(p => isAct(p.i)).length;
  return '<h1>Indicadores</h1><div class="filters"><label>Alcance <select id="k-scope">' + Object.entries(SCOPES).map(([id, s]) => '<option value="' + id + '"' + (id === KSCOPE ? ' selected' : '') + '>' + s[0] + '</option>').join('') + '</select></label>' +
    '<span class="muted">' + n.toLocaleString('es') + ' de ' + P.length.toLocaleString('es') + ' procesos en el alcance. Activo = bajo un calendario no pausado · Manual = job MANUAL o lo que este llama.</span></div>' + nav + scopeLabel(fn(k));
}
function bindKpis(tab) {
  $('#k-scope').onchange = (e) => { KSCOPE = e.target.value; try { localStorage.setItem('cp-scope', KSCOPE); } catch (x) {} route(); };
  document.querySelectorAll('.tw table').forEach(t => t.id && sortable(t.id));
  if (tab === 'riesgo') {
    const run = () => { const e = $('#rk-e').value, kd = $('#rk-k').value, fl = $('#rk-f').value;
      const L = M.P.filter(p => (!e || (e === 'scope' ? isAct(p.i) : p.estado === e)) && (!kd || p.k === kd) && (!fl || p._f[fl])).sort((a, b) => b._sc - a._sc);
      $('#rk-n').textContent = L.length + ' procesos';
      $('#rk-out').innerHTML = riskTable(L.slice(0, 300)); sortable('rk-t'); };
    ['#rk-e', '#rk-k', '#rk-f'].forEach(s => $(s).addEventListener('change', run)); run();
  }
  if (tab === 'horario') {
    const upd = () => { $('#hz-out').innerHTML = heatmapHtml(kmodel(), $('#hz-solo').checked, $('#hz-freq').checked); bindHeat(); sortable('hz-f'); sortable('hz-m'); };
    $('#hz-solo').onchange = upd; $('#hz-freq').onchange = upd;
    bindHeat();
  }
  if (tab === 'higiene') document.querySelectorAll('[data-more]').forEach(b => b.onclick = () => { b.previousElementSibling.querySelectorAll('tr[hidden]').forEach(r => r.hidden = false); b.remove(); });
}

/* ---------- 1. carga BD / servidor ---------- */
function kCarga() {
  const P = M.P;
  const agg = new Map(); const sv = new Map();
  const get = (map, key, extra) => map.get(key) || map.set(key, Object.assign({ key, procs: new Set(), act: new Set(), roots: new Set(), sql: 0, rowsql: 0, lookup: 0, wr: 0, tabs: new Set(), dbs: new Set() }, extra)).get(key);
  for (const p of P) {
    const a = isAct(p.i);
    for (const c of p.cx || []) {
      const db = (c.dbr || c.n).toUpperCase(), srv = (c.svr || '?').toUpperCase();
      for (const o of [get(agg, db), get(sv, srv)]) {
        o.procs.add(p.i); if (a) { o.act.add(p.i); p._act.concat(p._man).forEach(r => o.roots.add(r)); }
        o.dbs.add(db); o.srvs = (o.srvs || new Set()).add(srv);
        if (a) for (const s of p.st) if (s.c === c.n) { if (s.q) o.sql++; if (s.er) o.rowsql++; if (/^(DBLookup|DBJoin)$/.test(s.t)) o.lookup++; if (s.w) o.wr += s.w.length; (s.w || []).concat(s.r || []).forEach(t => o.tabs.add(t)); }
      }
    }
  }
  const rowsOf = (map, isSrv) => { const L = [...map.values()].sort((a, b) => b.act.size - a.act.size); const mx = Math.max(...L.map(o => o.act.size), 1);
    return L.map(o => '<tr><td>' + (isSrv ? '<span class="mono">' + esc(o.key) + '</span>' : '<a href="#/bd/' + enc(o.key) + '">' + esc(o.key) + '</a>') + '</td><td class="mono">' + esc([...(isSrv ? o.dbs : o.srvs)].slice(0, 5).join(', ')) + ((isSrv ? o.dbs : o.srvs).size > 5 ? ' +' + ((isSrv ? o.dbs : o.srvs).size - 5) : '') + '</td>' +
      barCell(o.act.size, mx) + '<td data-v="' + o.procs.size + '">' + o.procs.size + '</td><td data-v="' + o.roots.size + '">' + o.roots.size + '</td><td data-v="' + o.tabs.size + '">' + o.tabs.size + '</td><td data-v="' + o.sql + '">' + o.sql + '</td><td data-v="' + o.wr + '">' + o.wr + '</td><td data-v="' + (o.rowsql + o.lookup) + '">' + (o.rowsql + o.lookup ? '<span class="b pausado">' + (o.rowsql + o.lookup) + '</span>' : 0) + '</td></tr>'); };
  const H = (first, second) => [first, second, 'Procesos activos', 'Procesos (todos)', 'Calendarios / jobs manuales', 'Tablas tocadas (activos)', 'Pasos SQL (activos)', 'Escrituras (activos)', 'Fila a fila (activos)'];
  return '<div class="panel muted">Mide cuánta carga de Pentaho recibe cada servidor y BD. "Fila a fila" cuenta pasos que consultan la BD una vez por fila (DB Lookup, Database Join, ExecSQL por fila): son los primeros candidatos a optimizar.</div>' +
    '<h2>Por servidor</h2>' + tbl('k-sv', H('Servidor', 'Bases de datos'), rowsOf(sv, true)) +
    '<h2>Por base de datos</h2>' + tbl('k-db', H('Base de datos', 'Servidor(es)'), rowsOf(agg, false));
}

/* ---------- 2. dependencias críticas ---------- */
function kDeps(k) {
  const P = M.P;
  const T = [...M.tables.values()];
  const actW = (t) => uniqN(t.w.map(x => x[0]).filter(isAct)), actR = (t) => uniqN(t.r.map(x => x[0]).filter(isAct));
  // impacto aguas abajo: procesos activos alcanzables leyendo la tabla (3 niveles)
  const downstream = (key) => { const procs = new Set(); let front = [key]; const seenT = new Set([key]);
    for (let d = 0; d < 3 && front.length; d++) { const nx = []; for (const tk of front) { const t = M.tables.get(tk); if (!t) continue; for (const [pi] of t.r) if (isAct(pi) && !procs.has(pi)) { procs.add(pi); for (const w of P[pi].w || []) if (!seenT.has(w)) { seenT.add(w); nx.push(w); } } } front = nx; }
    return procs; };
  const hubs = T.map(t => ({ t, r: actR(t), w: actW(t) })).filter(x => x.r > 0).sort((a, b) => b.r - a.r).slice(0, 40);
  hubs.forEach(h => { h.down = downstream(h.t.k).size; });
  const mxR = Math.max(...hubs.map(h => h.r), 1);
  const multi = T.map(t => ({ t, ids: [...new Set(t.w.map(x => x[0]).filter(isAct))] })).filter(x => x.ids.length >= 2).sort((a, b) => b.ids.length - a.ids.length);
  const starving = T.filter(t => actR(t) > 0 && actW(t) === 0).sort((a, b) => actR(b) - actR(a));
  const shared = P.filter(p => M.callers[p.i].length >= 2).map(p => ({ p, c: M.callers[p.i].length, roots: new Set(p._act.concat(p._man)).size })).sort((a, b) => b.roots - a.roots || b.c - a.c).slice(0, 40);
  const conns = new Map(); for (const p of P) if (isAct(p.i)) for (const c of p.cx || []) (conns.get(c.n) || conns.set(c.n, { c, ids: new Set() }).get(c.n)).ids.add(p.i);
  const CL = [...conns.values()].sort((a, b) => b.ids.size - a.ids.size).slice(0, 25); const mxC = Math.max(...CL.map(x => x.ids.size), 1);
  return '<div class="panel muted">Puntos donde una falla se propaga: tablas de las que dependen muchos procesos, tablas que varios procesos escriben a la vez y componentes reutilizados por muchos calendarios.</div>' +
    '<h2>Tablas leídas sin ningún escritor activo (' + starving.length + ')</h2><div class="muted">Procesos activos leen estas tablas, pero ningún proceso activo de Pentaho las actualiza. Si el dato se ve viejo, la causa suele estar aquí: lo carga otro sistema, un proceso manual o uno pausado.</div>' +
    tbl('k-st', ['Tabla', 'Lectores activos', 'Escritores (inactivos)', 'Estado de escritores'], starving.slice(0, 80).map(t => { const ws = [...new Set(t.w.map(x => x[0]))];
      return '<tr><td>' + tlink(t.k) + '</td><td data-v="' + actR(t) + '">' + actR(t) + '</td><td data-v="' + ws.length + '">' + (ws.length ? plist(ws, 4) : '<span class="b bad">ninguno en HOME</span>') + '</td><td>' + [...new Set(ws.map(i => M.P[i].estado))].map(e => '<span class="b ' + e + '">' + ESTADOS[e] + '</span>').join(' ') + '</td></tr>'; })) +
    '<h2>Tablas más consumidas (hubs)</h2><div class="muted">"Impacto" = procesos activos afectados aguas abajo, hasta 3 niveles, si la tabla queda desactualizada.</div>' +
    tbl('k-hub', ['Tabla', 'Lectores activos', 'Escritores activos', 'Impacto aguas abajo'], hubs.map(h => '<tr><td>' + tlink(h.t.k) + ' <a class="muted" href="#/linaje/t/' + enc(h.t.k) + '">linaje</a></td>' + barCell(h.r, mxR) + '<td data-v="' + h.w + '">' + (h.w ? h.w : '<span class="b bad">0</span>') + '</td><td data-v="' + h.down + '">' + h.down + '</td></tr>')) +
    '<h2>Tablas con varios escritores activos (' + multi.length + ')</h2><div class="muted">Riesgo de que un proceso pise la carga de otro (sobre todo si alguno hace truncate). Revisa sus horarios en la pestaña "Ventana horaria".</div>' +
    tbl('k-mw', ['Tabla', 'Escritores activos', 'Procesos', 'Con truncate'], multi.slice(0, 60).map(x => '<tr><td>' + tlink(x.t.k) + '</td><td data-v="' + x.ids.length + '">' + x.ids.length + '</td><td>' + plist(x.ids, 5) + '</td><td>' +
      (x.t.w.some(([pi, si]) => isAct(pi) && M.P[pi].st[si].tr) ? '<span class="b pausado">sí</span>' : '') + '</td></tr>')) +
    '<h2>Componentes reutilizados</h2><div class="muted">Sub-jobs y transformaciones llamados desde varios lugares: si fallan o se modifican, afectan a todos los calendarios que los usan.</div>' +
    tbl('k-sh', ['Proceso', 'Estado', 'Lo llaman', 'Calendarios / jobs manuales que dependen'], shared.map(x => '<tr><td>' + plink(x.p.i) + ' ' + kindTag(x.p) + '</td><td>' + badge(x.p) + '</td><td data-v="' + x.c + '">' + x.c + '</td><td data-v="' + x.roots + '">' + x.roots + '</td></tr>')) +
    '<h2>Conexiones más usadas por procesos activos</h2>' +
    tbl('k-cn', ['Conexión', 'Servidor / BD', 'Procesos activos'], CL.map(x => '<tr><td>' + esc(x.c.n) + '</td><td class="mono">' + esc(x.c.svr + ' / ' + x.c.dbr) + '</td>' + barCell(x.ids.size, mxC) + '</tr>'));
}

/* ---------- 3. complejidad / riesgo ---------- */
function riskTable(L) {
  const k = kmodel(); const mx = Math.max(...L.map(p => p._sc), 1);
  return tbl('rk-t', ['Proceso', 'Estado', 'Puntaje', 'Pasos', 'SQL', 'Código (car.)', 'Alertas'], L.map(p => '<tr><td>' + plink(p.i) + ' ' + kindTag(p) + '</td><td data-v="' + p.estado + '">' + badge(p) + '</td>' + barCell(p._sc, mx) +
    '<td data-v="' + p.st.length + '">' + p.st.length + '</td><td data-v="' + p.st.filter(s => s.q).length + '">' + p.st.filter(s => s.q).length + '</td><td data-v="' + p.st.reduce((a, s) => a + (s.cl || 0), 0) + '">' + p.st.reduce((a, s) => a + (s.cl || 0), 0).toLocaleString('es') + '</td><td>' +
    Object.entries(p._f).sort((a, b) => k.FLAGS[b[0]][1] - k.FLAGS[a[0]][1]).map(([f, n]) => '<span class="tag" title="' + esc(k.FLAGS[f][2]) + '">' + esc(k.FLAGS[f][0]) + (n > 1 ? ' ×' + n : '') + '</span>').join('') + '</td></tr>'));
}
function kRiesgo(k) {
  const act = M.P.filter(p => isAct(p.i));
  const cnt = Object.keys(k.FLAGS).map(f => [f, act.filter(p => p._f[f]).length, act.reduce((a, p) => a + (p._f[f] || 0), 0)]).sort((a, b) => b[1] - a[1]);
  const mx = Math.max(...cnt.map(c => c[1]), 1);
  return '<div class="panel muted"><b>Puntaje</b> = pasos + 2×pasos con SQL + caracteres de código/500 + llamadas + Σ(peso de cada alerta × ocurrencias, máx. 5). Sirve para priorizar qué revisar u optimizar primero, no para calificar la calidad.</div>' +
    '<h2>Alertas en procesos activos</h2>' + tbl('rk-c', ['Alerta', 'Qué significa', 'Peso', 'Procesos activos', 'Ocurrencias'],
      cnt.map(([f, n, o]) => '<tr><td>' + esc(k.FLAGS[f][0]) + '</td><td class="muted">' + esc(k.FLAGS[f][2]) + '</td><td>' + k.FLAGS[f][1] + '</td>' + barCell(n, mx) + '<td data-v="' + o + '">' + o + '</td></tr>')) +
    '<h2>Ranking</h2><div class="filters"><select id="rk-e"><option value="scope">Según el alcance</option><option value="">Todos</option>' + Object.entries(ESTADOS).map(([e, v]) => '<option value="' + e + '">' + v + '</option>').join('') + '</select>' +
    '<select id="rk-k"><option value="">Jobs y transformaciones</option><option value="J">Jobs</option><option value="T">Transformaciones</option></select>' +
    '<select id="rk-f"><option value="">Cualquier alerta</option>' + Object.entries(k.FLAGS).map(([f, d]) => '<option value="' + f + '">' + esc(d[0]) + '</option>').join('') + '</select><span id="rk-n" class="muted"></span></div><div id="rk-out"></div>';
}

/* ---------- 4. ventana horaria ---------- */
function heatData(k, includePaused, includeFreq) {
  const grid = range(0, 6).map(() => range(0, 23).map(() => ({ n: 0, jobs: [] })));
  const dbHour = new Map(); const monthly = []; const unknown = []; const freq = [];
  for (const s of M.sched) {
    if (s.id < 0 || (s.pausado && !includePaused)) continue;
    const r = parseRep(s.rep);
    if (!r.ok) { unknown.push(s); continue; }
    if (r.mensual) { monthly.push([s, r.mensual]); continue; }
    if (r.freq) { freq.push(s); if (!includeFreq) continue; }
    const dbs = k.dbsOfTree(s.id);
    for (const [d, h, per] of r.slots) {
      grid[d][h].n += per; grid[d][h].jobs.push(s);
      if (d === 3) for (const db of dbs) { const row = dbHour.get(db) || dbHour.set(db, range(0, 23).map(() => [])).get(db); row[h].push(s); }
    }
  }
  return { grid, dbHour, monthly, unknown, freq };
}
function heatmapHtml(k, includePaused, includeFreq) {
  const D = heatData(k, includePaused, includeFreq);
  const mx = Math.max(...D.grid.flat().map(c => c.n), 1);
  const order = [1, 2, 3, 4, 5, 6, 0];
  let h = '<h2>Ejecuciones por día y hora</h2><div class="muted">Cada celda = ejecuciones de calendarios' + (includePaused ? ' (incluye pausados)' : ' activos') + ' que inician en esa hora. Los "cada N minutos" suman sus ejecuciones por hora. Pasa el mouse o haz clic para ver los jobs.</div>' +
    '<div class="tw"><table class="heat" id="hz-g"><thead><tr><th></th>' + range(0, 23).map(x => '<th>' + String(x).padStart(2, '0') + '</th>').join('') + '</tr></thead><tbody>' +
    order.map(d => '<tr><th>' + DIAS[d] + '</th>' + D.grid[d].map((c, hh) => '<td data-d="' + d + '" data-h="' + hh + '" style="' + heat(c.n, mx) + '" title="' + DIAS[d] + ' ' + String(hh).padStart(2, '0') + ':00 — ' + c.n + ' ejecuciones">' + (c.n || '') + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div><div id="hz-det" class="panel" style="margin-top:8px"><span class="muted">Haz clic en una celda para ver qué jobs corren.</span></div>';
  const rows = [...D.dbHour.entries()].map(([db, hrs]) => ({ db, hrs, peak: Math.max(...hrs.map(x => x.length)), tot: hrs.reduce((a, x) => a + x.length, 0) })).sort((a, b) => b.peak - a.peak || b.tot - a.tot).slice(0, 20);
  const mx2 = Math.max(...rows.map(r => r.peak), 1);
  h += '<h2>Concurrencia sobre cada base de datos (miércoles típico)</h2><div class="muted">Calendarios que tocan la BD (en cualquier sub-proceso) e inician en esa hora. Los manuales no tienen horario y no aparecen aquí. Los picos muestran dónde se acumulan las cargas; las horas vacías muestran espacio libre para reprogramar.</div>' +
    '<div class="tw"><table class="heat" id="hz-db"><thead><tr><th>BD</th>' + range(0, 23).map(x => '<th>' + String(x).padStart(2, '0') + '</th>').join('') + '<th>Pico</th></tr></thead><tbody>' +
    rows.map(r => '<tr><th class="mono" style="text-align:left">' + esc(r.db) + '</th>' + r.hrs.map((x, hh) => '<td style="' + heat(x.length, mx2) + '" title="' + esc(r.db) + ' ' + String(hh).padStart(2, '0') + ':00 — ' + esc(x.map(s => s.name).join(', ')) + '">' + (x.length || '') + '</td>').join('') + '<td><b>' + r.peak + '</b></td></tr>').join('') + '</tbody></table></div>';
  if (D.freq.length) h += '<h2>Calendarios de alta frecuencia (' + D.freq.length + ')</h2><div class="muted">Corren a lo largo de todo el día (cada N minutos u horas). ' + (includeFreq ? 'Están incluidos en los mapas.' : 'No están en los mapas para que se vean los picos; actívalos arriba.') + '</div>' +
    tbl('hz-f', ['Calendario', 'Repetición', 'Job', 'BD que toca'], D.freq.map(s => '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.rep) + '</td><td>' + plink(s.id) + '</td><td class="mono">' + esc([...k.dbsOfTree(s.id)].join(', ')) + '</td></tr>'));
  if (D.monthly.length) h += '<h2>Calendarios mensuales (' + D.monthly.length + ')</h2>' + tbl('hz-m', ['Calendario', 'Día del mes', 'Hora', 'Job'], D.monthly.map(([s, m]) => '<tr><td>' + esc(s.name) + '</td><td>' + esc(m.dia) + '</td><td>' + esc(m.hora) + '</td><td>' + plink(s.id) + '</td></tr>'));
  if (D.unknown.length) h += '<div class="alert">No se pudo interpretar la repetición de: ' + D.unknown.map(s => esc(s.name + ' (' + s.rep + ')')).join('; ') + '</div>';
  h += '<script type="application/json" id="hz-data">' + JSON.stringify(D.grid.map(r => r.map(c => c.jobs.map(s => [s.id, s.name, s.rep])))).replace(/</g, '\\u003c') + '</script>';
  return h;
}
function bindHeat() {
  const el = $('#hz-data'); if (!el) return; const G = JSON.parse(el.textContent);
  document.querySelectorAll('#hz-g td[data-d]').forEach(td => td.onclick = () => {
    const d = +td.dataset.d, hh = +td.dataset.h, L = G[d][hh];
    $('#hz-det').innerHTML = '<b>' + DIAS[d] + ' ' + String(hh).padStart(2, '0') + ':00</b> — ' + L.length + ' calendarios<br>' + (L.map(([id, n, rep]) => plink(id) + ' <span class="muted">' + esc(rep) + '</span>').join('<br>') || '<span class="muted">ninguno</span>');
  });
}
function kHorario(k) {
  return '<div class="filters"><label><input type="checkbox" id="hz-solo"> incluir calendarios pausados</label><label><input type="checkbox" id="hz-freq"> incluir alta frecuencia (cada N minutos/horas)</label></div><div id="hz-out">' + heatmapHtml(k, false, false) + '</div>';
}

/* ---------- 5. higiene ---------- */
function kHigiene(k) {
  const P = M.P; const now = new Date();
  const lim = (rows, n) => rows.slice(0, 300).map((r, i) => i >= n ? r.replace('<tr', '<tr hidden') : r).join('') + (rows.length > 300 ? '<tr hidden><td colspan="9" class="muted">… y ' + (rows.length - 300) + ' más (refina en Procesos)</td></tr>' : '');
  const sec = (title, desc, id, heads, rows, n) => '<h2>' + title + ' <span class="muted">(' + rows.length + ')</span></h2>' + (desc ? '<div class="muted">' + desc + '</div>' : '') +
    (rows.length ? '<div class="tw"><table id="' + id + '"><thead><tr>' + heads.map(x => '<th class="s">' + x + '</th>').join('') + '</tr></thead><tbody>' + lim(rows, n || 25) + '</tbody></table></div>' + (rows.length > (n || 25) ? '<button class="btn" data-more>Ver todos</button>' : '') : '<p class="muted">Nada que reportar.</p>');
  const orphans = P.filter(p => p.estado === 'sin' && !M.callers[p.i].length);
  const byFolder = new Map(); for (const p of orphans) { const f = p.d.split('/').slice(0, 4).join('/'); byFolder.set(f, (byFolder.get(f) || 0) + 1); }
  const testy = P.filter(p => /(test|prueba|copia|copy|_old|old_|bkp|backup|respaldo|\(\d+\)|_tmp|tmp_|borrar|deprecated)/i.test(p.n));
  const names = new Map(); for (const p of P) (names.get(p.k + '|' + p.n.toLowerCase()) || names.set(p.k + '|' + p.n.toLowerCase(), []).get(p.k + '|' + p.n.toLowerCase())).push(p.i);
  const dups = [...names.values()].filter(v => v.length > 1).sort((a, b) => b.length - a.length);
  const age = (p) => { const d = parseDate(p.md); return d ? (now - d) / 31557600000 : null; };
  const oldAct = P.filter(p => isAct(p.i) && age(p) > 3).sort((a, b) => age(b) - age(a));
  const pausedOld = M.sched.filter(s => s.pausado).map(s => ({ s, d: parseDate(s.last) })).filter(x => !x.d || (now - x.d) > 31557600000).sort((a, b) => (a.d || 0) - (b.d || 0));
  const broken = P.filter(p => isAct(p.i)).flatMap(p => p.st.filter(s => s.call && s.to < 0).map(s => [p, s]));
  const unresolved = P.filter(p => isAct(p.i)).map(p => [p, (p.v || []).filter(v => { const r = resolveVar(p, v); return r.v == null && !r.amb; })]).filter(x => x[1].length).sort((a, b) => b[1].length - a[1].length);
  const nodef = P.filter(p => (p.cx || []).some(c => c.nd));
  const usedProps = new Set(P.flatMap(p => p.pe || []));
  const unusedProps = Object.keys(IX.props).filter(k2 => !usedProps.has(k2));
  const unlinked = M.sched.filter(s => s.id < 0);
  const yrs = new Map(); for (const p of P) { const d = parseDate(p.md); const y = d ? d.getFullYear() : '?'; const o = yrs.get(y) || yrs.set(y, [0, 0]).get(y); o[0]++; if (isAct(p.i)) o[1]++; }
  const YL = [...yrs.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))); const mxY = Math.max(...YL.map(y => y[1][0]), 1);
  return '<div class="panel muted">Candidatos a limpiar o corregir. Nada se borra automáticamente: confirma cada caso antes de actuar.<br>Llamadas rotas, variables sin resolver y antigüedad usan el <b>alcance elegido</b>. Huérfanos, duplicados, nombres de prueba, calendarios pausados y properties sin uso revisan <b>todo el HOME</b>, porque justamente buscan lo no productivo.</div>' +
    '<div class="grid">' + [[orphans.length, 'Huérfanos (nadie los llama, sin calendario)'], [dups.length, 'Nombres duplicados'], [testy.length, 'Nombres de prueba o copia'], [broken.length, 'Llamadas rotas en procesos activos'],
      [unresolved.length, 'Activos con variables sin resolver'], [pausedOld.length, 'Calendarios pausados hace más de 1 año'], [unusedProps.length, 'Properties sin uso'], [unlinked.length, 'Calendarios sin job en el HOME']]
      .map(([v, l]) => '<div class="kpi"><b>' + v + '</b><span>' + l + '</span></div>').join('') + '</div>' +
    sec('Llamadas rotas en procesos activos', 'El proceso llama a algo que no existe en el repositorio: esa rama falla o hace nada.', 'hg-br', ['Proceso', 'Paso', 'Busca'], broken.map(([p, s]) => '<tr><td>' + plink(p.i) + '</td><td>' + esc(s.n) + '</td><td class="mono">' + esc(s.tp) + '</td></tr>')) +
    sec('Procesos activos con variables sin resolver', 'Ningún .properties cargado define la variable (puede venir de kettle.properties del servidor o de un properties que falta en la carpeta).', 'hg-uv', ['Proceso', 'Variables'], unresolved.map(([p, vs]) => '<tr><td>' + plink(p.i) + '</td><td class="mono">' + esc(vs.join(', ')) + '</td></tr>')) +
    sec('Procesos activos sin modificar hace más de 3 años', 'Corren hoy pero nadie los toca hace años: revisa si siguen siendo necesarios o si arrastran lógica obsoleta.', 'hg-old', ['Proceso', 'Última modificación', 'Años'], oldAct.map(p => '<tr><td>' + plink(p.i) + '</td><td>' + esc(p.md) + ' ' + esc(p.mu || '') + '</td><td data-v="' + age(p).toFixed(1) + '">' + age(p).toFixed(1) + '</td></tr>')) +
    sec('Calendarios pausados hace más de 1 año (o que nunca corrieron)', 'Candidatos a eliminar del scheduler.', 'hg-ps', ['Calendario', 'Repetición', 'Última ejecución', 'Job'], pausedOld.map(({ s }) => '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.rep) + '</td><td>' + esc(s.last) + '</td><td>' + (s.id >= 0 ? plink(s.id) : esc(s.src)) + '</td></tr>')) +
    sec('Huérfanos por carpeta', 'Sin calendario, no son MANUAL y nadie los llama: suelen ser desarrollos, versiones viejas o pruebas.', 'hg-of', ['Carpeta', 'Huérfanos'], [...byFolder.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => '<tr><td class="mono"><a href="#/procesos">' + esc(f) + '</a></td><td data-v="' + n + '">' + n + '</td></tr>')) +
    sec('Nombres duplicados', 'Mismo nombre en distintas carpetas: confunde al dar soporte y facilita modificar la copia equivocada.', 'hg-dp', ['Nombre', 'Copias', 'Estados'], dups.map(ids => '<tr><td>' + esc(P[ids[0]].n) + '</td><td data-v="' + ids.length + '">' + ids.length + '</td><td>' + ids.slice(0, 6).map(i => plink(i) + ' ' + badge(P[i]) + ' <span class="mono muted">' + esc(P[i].d) + '</span>').join('<br>') + '</td></tr>')) +
    sec('Nombres de prueba, copia o respaldo', '', 'hg-ts', ['Proceso', 'Estado', 'Carpeta'], testy.sort((a, b) => (isAct(b.i) - isAct(a.i))).map(p => '<tr><td>' + plink(p.i) + '</td><td>' + badge(p) + '</td><td class="mono">' + esc(p.d) + '</td></tr>')) +
    sec('Conexiones usadas sin definición en el HOME', 'El paso referencia una conexión que no está definida en el objeto ni en otro proceso.', 'hg-nd', ['Proceso', 'Conexión'], nodef.map(p => '<tr><td>' + plink(p.i) + '</td><td>' + esc(p.cx.filter(c => c.nd).map(c => c.n).join(', ')) + '</td></tr>')) +
    sec('Properties sin uso', 'Ningún proceso los referencia (ni directa ni indirectamente).', 'hg-up', ['Archivo', 'Variables'], unusedProps.map(k2 => '<tr><td>' + esc(IX.props[k2].file) + '</td><td>' + Object.keys(IX.props[k2].kv).length + '</td></tr>')) +
    sec('Calendarios sin job en el HOME', 'El scheduler apunta a una ruta que no existe en el repositorio exportado.', 'hg-ul', ['Calendario', 'Ruta', 'Estado'], unlinked.map(s => '<tr><td>' + esc(s.name) + '</td><td class="mono">' + esc(s.src) + '</td><td>' + esc(s.st) + '</td></tr>')) +
    '<h2>Antigüedad: año de última modificación</h2>' + tbl('hg-y', ['Año', 'Procesos', 'Activos'], YL.map(([y, [a, b]]) => '<tr><td>' + y + '</td>' + barCell(a, mxY) + '<td data-v="' + b + '">' + b + '</td></tr>'));
}

/* ---------- 6. archivos ---------- */
function folderOf(p) {
  let s = String(p).replace(/\\/g, '/').replace(/^file:\/+/i, '/');
  const segs = s.split('/'); if (/\.[a-z0-9]{2,5}$/i.test(segs[segs.length - 1]) || /[*?]/.test(segs[segs.length - 1])) segs.pop();
  return segs.join('/') || '/';
}
function kArchivos() {
  const P = M.P;
  const all = [...M.files.entries()];
  const resolvedFor = (f, pi) => resolveStr(P[pi], f);
  const folders = new Map(), shares = new Map(), drives = new Map();
  let fixed = 0, vars = 0, personal = [];
  for (const [f, uses] of all) {
    const isFixed = /^(?:[a-zA-Z]:[\\\/]|\\\\)/.test(f); isFixed ? fixed++ : vars++;
    for (const [pi, si, op] of uses) {
      const r = resolvedFor(f, pi); const fo = folderOf(r).split('/').slice(0, 6).join('/');
      const o = folders.get(fo.toLowerCase()) || folders.set(fo.toLowerCase(), { fo, ids: new Set(), act: new Set(), ops: new Set() }).get(fo.toLowerCase());
      o.ids.add(pi); if (isAct(pi)) o.act.add(pi); o.ops.add(op);
      const sm = r.replace(/\//g, '\\').match(/^\\\\([^\\]+)/); if (sm) { const x = shares.get(sm[1].toUpperCase()) || shares.set(sm[1].toUpperCase(), new Set()).get(sm[1].toUpperCase()); x.add(pi); }
      const dm = r.match(/^([a-zA-Z]):/); if (dm) { const x = drives.get(dm[1].toUpperCase()) || drives.set(dm[1].toUpperCase(), new Set()).get(dm[1].toUpperCase()); x.add(pi); }
      if (/onedrive|\\users\\|\/users\/|desktop|escritorio|documents/i.test(r) && isAct(pi)) personal.push([pi, r]);
    }
  }
  const FL = [...folders.values()].sort((a, b) => b.act.size - a.act.size || b.ids.size - a.ids.size).slice(0, 60); const mx = Math.max(...FL.map(f => f.act.size), 1);
  const deleters = P.filter(p => isAct(p.i) && p.st.some(s => (s.f || []).some(f => /borra/.test(f[1]))));
  const pers = [...new Map(personal.map(x => [x[0] + '|' + folderOf(x[1]), x])).values()];
  return '<div class="panel muted">Dónde leen y escriben archivos los procesos. Las rutas se muestran resueltas con los .properties. Las carpetas personales o de OneDrive en procesos productivos son un riesgo: dependen de la sesión o la sincronización de un usuario.</div>' +
    '<div class="grid">' + [[all.length, 'Rutas distintas'], [fixed, 'Rutas fijas (hardcodeadas)'], [vars, 'Rutas con variables'], [shares.size, 'Servidores de red (\\\\…)'], [deleters.length, 'Activos que borran archivos'], [pers.length, 'Rutas personales/OneDrive en activos']]
      .map(([v, l]) => '<div class="kpi"><b>' + v + '</b><span>' + l + '</span></div>').join('') + '</div>' +
    '<h2>Carpetas más usadas</h2>' + tbl('ar-f', ['Carpeta (resuelta)', 'Procesos activos', 'Procesos (todos)', 'Operaciones'], FL.map(f => '<tr><td class="mono">' + esc(f.fo) + '</td>' + barCell(f.act.size, mx) + '<td data-v="' + f.ids.size + '">' + f.ids.size + '</td><td>' + [...f.ops].map(o => '<span class="tag">' + esc(o) + '</span>').join('') + '</td></tr>')) +
    '<div class="cols"><div><h2>Servidores de red</h2>' + tbl('ar-s', ['Servidor', 'Procesos', 'Activos'], [...shares.entries()].sort((a, b) => b[1].size - a[1].size).map(([s, ids]) => '<tr><td class="mono">\\\\' + esc(s) + '</td><td data-v="' + ids.size + '">' + ids.size + '</td><td>' + [...ids].filter(isAct).length + '</td></tr>')) + '</div>' +
    '<div><h2>Unidades locales</h2>' + tbl('ar-d', ['Unidad', 'Procesos', 'Activos'], [...drives.entries()].sort((a, b) => b[1].size - a[1].size).map(([d, ids]) => '<tr><td class="mono">' + esc(d) + ':</td><td data-v="' + ids.size + '">' + ids.size + '</td><td>' + [...ids].filter(isAct).length + '</td></tr>')) + '</div></div>' +
    '<h2>Rutas personales u OneDrive en procesos activos (' + pers.length + ')</h2>' + tbl('ar-p', ['Proceso', 'Ruta'], pers.slice(0, 100).map(([pi, r]) => '<tr><td>' + plink(pi) + '</td><td class="mono">' + esc(r) + '</td></tr>')) +
    '<h2>Procesos activos que borran archivos (' + deleters.length + ')</h2>' + tbl('ar-x', ['Proceso', 'Qué borra'], deleters.map(p => '<tr><td>' + plink(p.i) + '</td><td class="mono">' + p.st.flatMap(s => (s.f || []).filter(f => /borra/.test(f[1])).map(f => esc(resolveStr(p, f[0])))).slice(0, 5).join('<br>') + '</td></tr>'));
}

/* ---------- 7. externos / proveedores ---------- */
const PROVEEDORES_DEF = [['JPMorgan', 'jpm|jpmorgan|jp_morgan'], ['UBS', '\\bubs'], ['Bloomberg', 'bbg|bloomberg'], ['Pershing', 'pershing'], ['Mitsubishi', 'mitsubishi|mufg'],
  ['MCIT', 'mcit'], ['Cumplo', 'cumplo'], ['eFront', 'efront'], ['Artikos', 'artikos'], ['Geneva', 'geneva|gnv'], ['CMF', '\\bcmf'], ['TMF', '\\btmf'], ['BCP', '\\bbcp'],
  ['Gesintel', 'gesintel'], ['Power BI', 'powerbi|power_bi'], ['SharePoint', 'sharepoint'], ['Entra ID', 'entraid|graph\\.microsoft'], ['Office 365 mail', 'office365|outlook'], ['MSCI', 'msci'], ['Frodo', 'frodo']];
function kExternos() {
  const P = M.P;
  const provs = (window.PROVEEDORES || PROVEEDORES_DEF.map(([n, r]) => ({ nombre: n, patron: r }))).map(x => ({ n: x.nombre, re: new RegExp(x.patron, 'i') }));
  const hostOf = (kind, t) => { if (kind === 'http') { const m = String(t).match(/^[a-z]+:\/\/([^\/:?#]+)/i); return m ? m[1].toLowerCase() : t; } if (kind === 'sftp' || kind === 'ftp') return String(t).split(':')[0].toLowerCase(); if (kind === 'mongodb') return String(t).split('/')[0]; return t; };
  const groups = new Map();
  for (const [key, uses] of M.ext) {
    const [kind, target] = key.split('|');
    if (kind === 'mail') continue;
    for (const [pi] of uses) {
      const host = hostOf(kind, resolveStr(P[pi], target));
      const g = groups.get(kind + '|' + host) || groups.set(kind + '|' + host, { kind, host, ids: new Set() }).get(kind + '|' + host);
      g.ids.add(pi);
    }
  }
  const isPrivate = (h) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)/i.test(h);
  for (const p of P) for (const c of p.cx || []) if (/^\d+\.\d+\.\d+\.\d+$/.test(c.svr) && !isPrivate(c.svr)) {
    const g = groups.get('bd-externa|' + c.svr) || groups.set('bd-externa|' + c.svr, { kind: 'bd-externa', host: c.svr + ' (' + c.dbr + ')', ids: new Set() }).get('bd-externa|' + c.svr); g.ids.add(p.i); }
  const G = [...groups.values()].map(g => ({ ...g, act: [...g.ids].filter(isAct) })).sort((a, b) => b.act.length - a.act.length || b.ids.size - a.ids.size);
  const mx = Math.max(...G.map(g => g.act.length), 1);
  // proveedores: por nombre/ruta del proceso o destino
  const pv = provs.map(pr => {
    const ids = P.filter(p => pr.re.test(p.path) || p.st.some(s => (s.x || []).some(x => pr.re.test(x[1])) || (s.f || []).some(f => pr.re.test(f[0])))).map(p => p.i);
    const act = ids.filter(isAct); const roots = new Set(act.flatMap(i => M.P[i]._act.concat(M.P[i]._man))); const tabs = new Set(act.flatMap(i => M.P[i].w || []));
    return { n: pr.n, ids, act, roots, tabs };
  }).filter(x => x.ids.length).sort((a, b) => b.act.length - a.act.length);
  const mxP = Math.max(...pv.map(x => x.act.length), 1);
  const mails = [...M.ext.entries()].filter(([k]) => k.startsWith('mail|'));
  const doms = new Map(); for (const [k, uses] of mails) for (const [pi] of uses) for (const m of resolveStr(P[pi], k.slice(5)).matchAll(/@([\w.-]+)/g)) { const d = m[1].toLowerCase(); (doms.get(d) || doms.set(d, new Set()).get(d)).add(pi); }
  return '<div class="panel muted">Dependencias fuera de Pentaho: si uno de estos destinos falla, afecta a los procesos listados. Los proveedores se detectan por nombre en la ruta del proceso, archivos y destinos; puedes ajustar la lista con <span class="mono">window.PROVEEDORES</span> en data/aplicativos.js.</div>' +
    '<h2>Proveedores / sistemas</h2>' + tbl('ex-p', ['Proveedor', 'Procesos activos', 'Procesos (todos)', 'Calendarios / jobs manuales', 'Tablas que alimenta (activos)'], pv.map(x => '<tr><td><a href="#/buscar/' + enc(x.n) + '">' + esc(x.n) + '</a></td>' + barCell(x.act.length, mxP) +
      '<td data-v="' + x.ids.length + '">' + x.ids.length + '</td><td data-v="' + x.roots.size + '">' + x.roots.size + '</td><td data-v="' + x.tabs.size + '">' + x.tabs.size + '</td></tr>')) +
    '<h2>Destinos técnicos (SFTP, HTTP, Mongo, shell, BD externas)</h2><div class="muted">Destinos con variables resueltas. "bd-externa" = conexiones a IPs públicas.</div>' +
    tbl('ex-h', ['Tipo', 'Destino', 'Procesos activos', 'Procesos (todos)', 'Ejemplos'], G.slice(0, 120).map(g => '<tr><td><span class="tag">' + esc(g.kind) + '</span></td><td class="mono">' + esc(g.host) + '</td>' + barCell(g.act.length, mx) + '<td data-v="' + g.ids.size + '">' + g.ids.size + '</td><td>' + plist(g.act.length ? g.act : g.ids, 3) + '</td></tr>')) +
    '<h2>Notificaciones por correo: dominios destino</h2>' + tbl('ex-m', ['Dominio', 'Procesos', 'Activos'], [...doms.entries()].sort((a, b) => b[1].size - a[1].size).map(([d, ids]) => '<tr><td class="mono">' + esc(d) + '</td><td data-v="' + ids.size + '">' + ids.size + '</td><td>' + [...ids].filter(isAct).length + '</td></tr>'));
}

/* ================= linaje ================= */
function viewLinaje(kind, id, opts) {
  opts = opts || { depth: 2, act: true };
  const start = kind === 't' ? 't:' + id : 'p:' + id;
  if (kind === 't' && !M.tables.get(id)) return '<p>Tabla no encontrada.</p>';
  if (kind === 'p' && !M.P[+id]) return '<p>Proceso no encontrado.</p>';
  const cols = new Map([[0, [start]]]); const pos = new Map([[start, 0]]); const edges = [];
  const okP = (pi) => !opts.act || isAct(pi) || ('p:' + pi) === start;
  const up = (n) => n.startsWith('t:') ? [...new Set((M.tables.get(n.slice(2)) || { w: [] }).w.map(x => x[0]))].filter(okP).map(i => 'p:' + i) : (M.P[+n.slice(2)].r || []).map(k => 't:' + k);
  const down = (n) => n.startsWith('t:') ? [...new Set((M.tables.get(n.slice(2)) || { r: [] }).r.map(x => x[0]))].filter(okP).map(i => 'p:' + i) : (M.P[+n.slice(2)].w || []).map(k => 't:' + k);
  const steps = opts.depth * 2 - (kind === 'p' ? 1 : 0);
  const MAXC = 40; const trunc = {};
  for (const [dir, fn] of [[-1, up], [1, down]]) {
    let front = [start];
    for (let d = 1; d <= steps && front.length; d++) {
      const col = dir * d; const nx = [];
      for (const n of front) for (const m of fn(n)) {
        if (!pos.has(m)) { const arr = cols.get(col) || cols.set(col, []).get(col); if (arr.length >= MAXC) { trunc[col] = (trunc[col] || 0) + 1; continue; } arr.push(m); pos.set(m, col); nx.push(m); }
        if (pos.get(m) === col) edges.push(dir < 0 ? [m, n] : [n, m]);
      }
      front = nx;
    }
  }
  const node = (n) => {
    if (n.startsWith('t:')) { const k2 = n.slice(2); const t = M.tables.get(k2); const wa = t ? uniqN(t.w.map(x => x[0]).filter(isAct)) : 0;
      return '<a class="ln t' + (n === start ? ' c' : '') + '" id="n-' + enc(n) + '" href="#/linaje/t/' + enc(k2) + '" title="' + esc(k2) + '"><span class="mono">' + esc(k2.split('.').slice(1).join('.')) + '</span><small>' + esc(k2.split('.')[0]) + (t && !wa && t.r.length ? ' · <b class="bad-ink">sin escritor activo</b>' : '') + '</small></a>'; }
    const p = M.P[+n.slice(2)];
    return '<a class="ln p' + (n === start ? ' c' : '') + '" id="n-' + enc(n) + '" href="#/linaje/p/' + p.i + '" title="' + esc(p.path) + '">' + esc(p.n) + '<small>' + (p.k === 'J' ? 'Job' : 'Trans') + ' · ' + ESTADOS[p.estado] + '</small></a>';
  };
  const keys = [...cols.keys()].sort((a, b) => a - b);
  return '<div class="row"><h1>Linaje</h1>' + (kind === 't' ? tlink(id) : plink(+id)) + '</div>' +
    '<div class="filters"><label>Profundidad <select id="ln-d">' + [1, 2, 3, 4].map(x => '<option' + (x === opts.depth ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label>' +
    '<label><input type="checkbox" id="ln-a"' + (opts.act ? ' checked' : '') + '> solo procesos activos</label><span class="muted">Izquierda: de dónde viene el dato · derecha: a dónde va. Clic en un nodo para centrar el linaje en él.</span></div>' +
    '<div class="lineage" id="ln"><svg id="ln-svg"></svg>' + keys.map(c => '<div class="lcol"><div class="lh">' + (c === 0 ? 'Centro' : c < 0 ? 'Origen ' + (-c) : 'Destino ' + c) + '</div>' + cols.get(c).map(node).join('') + (trunc[c] ? '<div class="muted">+' + trunc[c] + ' más</div>' : '') + '</div>').join('') + '</div>' +
    '<script type="application/json" id="ln-e">' + JSON.stringify(edges).replace(/</g, '\\u003c') + '</script>';
}
function bindLinaje(kind, id) {
  const draw = () => {
    const box = $('#ln'), svg = $('#ln-svg'); if (!box) return;
    const E = JSON.parse($('#ln-e').textContent); const R = box.getBoundingClientRect();
    svg.setAttribute('width', box.scrollWidth); svg.setAttribute('height', box.scrollHeight);
    svg.innerHTML = E.map(([a, b]) => { const A = document.getElementById('n-' + enc(a)), B = document.getElementById('n-' + enc(b)); if (!A || !B) return '';
      const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
      const x1 = ra.right - R.left + box.scrollLeft, y1 = ra.top + ra.height / 2 - R.top, x2 = rb.left - R.left + box.scrollLeft, y2 = rb.top + rb.height / 2 - R.top; const mx = (x1 + x2) / 2;
      return '<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '"/>'; }).join('');
  };
  const rerender = () => { $('main').innerHTML = viewLinaje(kind, id, { depth: +$('#ln-d').value, act: $('#ln-a').checked }); bindLinaje(kind, id); };
  $('#ln-d').onchange = rerender; $('#ln-a').onchange = rerender;
  requestAnimationFrame(draw); window.onresize = draw;
}

/* ================= comparar índices ================= */
function viewComparar() {
  return '<h1>Comparar con un índice anterior</h1><p class="muted">Selecciona un <span class="mono">indice_AAAAMMDD.js</span> anterior. Se compara contra el índice cargado ahora (' + esc(IX.fuente && IX.fuente.home || '') + ').</p>' +
    '<div class="panel"><input type="file" id="cmp-f" accept=".js,.json"> <span id="cmp-msg" class="muted"></span></div><div id="cmp-out"></div>';
}
function bindComparar() {
  $('#cmp-f').onchange = async () => {
    const f = $('#cmp-f').files[0]; if (!f) return;
    $('#cmp-msg').textContent = 'Leyendo…';
    try {
      let t = await f.text(); t = t.replace(/^\s*window\.INDICE\s*=\s*/, '').replace(/;\s*$/, '');
      const old = JSON.parse(t); $('#cmp-msg').textContent = 'Comparando ' + (old.fuente && old.fuente.home || f.name) + ' → ' + (IX.fuente && IX.fuente.home || 'actual');
      $('#cmp-out').innerHTML = diffHtml(old, IX); document.querySelectorAll('#cmp-out table').forEach(x => sortable(x.id));
    } catch (e) { $('#cmp-msg').textContent = 'No se pudo leer: ' + e.message; }
  };
}
function diffHtml(A, B) {
  // el HOME puede traer la misma ruta repetida: se numera cada ocurrencia
  const keyer = () => { const seen = new Map(); return (p) => { const b = p.k + '|' + p.path.toLowerCase(); const n = (seen.get(b) || 0) + 1; seen.set(b, n); return b + '#' + n; }; };
  const kA = keyer(), kB = keyer(); A.procs.forEach(p => { p._dk = kA(p); }); B.procs.forEach(p => { p._dk = kB(p); });
  const key = (p) => p._dk;
  const mA = new Map(A.procs.map(p => [key(p), p])), mB = new Map(B.procs.map(p => [key(p), p]));
  const added = B.procs.filter(p => !mA.has(key(p))), removed = A.procs.filter(p => !mB.has(key(p)));
  const changed = [];
  for (const p of B.procs) { const o = mA.get(key(p)); if (!o) continue;
    if (o.md !== p.md || o.sz !== p.sz || o.st.length !== p.st.length) {
      const d = (x, y) => [(y || []).filter(k => !(x || []).includes(k)), (x || []).filter(k => !(y || []).includes(k))];
      const [wAdd, wDel] = d(o.w, p.w), [rAdd, rDel] = d(o.r, p.r);
      changed.push({ p, o, wAdd, wDel, rAdd, rDel, ds: p.st.length - o.st.length });
    } }
  const sk = (s) => s.name + '|' + s.rep;
  const sA = new Map((A.sched || []).map(s => [sk(s), s])), sB = new Map((B.sched || []).map(s => [sk(s), s]));
  const sAdd = (B.sched || []).filter(s => !sA.has(sk(s))), sDel = (A.sched || []).filter(s => !sB.has(sk(s)));
  const sChg = (B.sched || []).filter(s => sA.has(sk(s)) && sA.get(sk(s)).st !== s.st);
  const plB = (p) => plink(p.i);
  const list = (arr, n) => arr.slice(0, n || 6).join(', ') + (arr.length > (n || 6) ? ' +' + (arr.length - (n || 6)) : '');
  return '<div class="grid">' + [[added.length, 'Procesos nuevos'], [removed.length, 'Procesos eliminados'], [changed.length, 'Procesos modificados'], [sAdd.length, 'Calendarios nuevos'], [sDel.length, 'Calendarios eliminados'], [sChg.length, 'Calendarios con cambio de estado']]
    .map(([v, l]) => '<div class="kpi"><b>' + v + '</b><span>' + l + '</span></div>').join('') + '</div>' +
    '<h2>Calendarios con cambio de estado (' + sChg.length + ')</h2>' + tbl('cm-sc', ['Calendario', 'Repetición', 'Antes', 'Ahora'], sChg.map(s => '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.rep) + '</td><td>' + esc(sA.get(sk(s)).st) + '</td><td>' + esc(s.st) + '</td></tr>')) +
    '<h2>Calendarios nuevos / eliminados</h2>' + tbl('cm-sa', ['Cambio', 'Calendario', 'Repetición', 'Estado'], sAdd.map(s => '<tr><td><span class="b activo">nuevo</span></td><td>' + esc(s.name) + '</td><td>' + esc(s.rep) + '</td><td>' + esc(s.st) + '</td></tr>').concat(sDel.map(s => '<tr><td><span class="b bad">eliminado</span></td><td>' + esc(s.name) + '</td><td>' + esc(s.rep) + '</td><td>' + esc(s.st) + '</td></tr>'))) +
    '<h2>Procesos modificados (' + changed.length + ')</h2>' + tbl('cm-ch', ['Proceso', 'Estado', 'Modificado', 'Δ pasos', 'Tablas escritas (+/−)', 'Tablas leídas (+/−)'], changed.sort((a, b) => String(b.p.md).localeCompare(String(a.p.md))).map(c => '<tr><td>' + plB(c.p) + '</td><td>' + badge(M.P[c.p.i]) + '</td><td>' + esc(c.p.md) + ' ' + esc(c.p.mu || '') + '</td><td data-v="' + c.ds + '">' + (c.ds > 0 ? '+' : '') + c.ds + '</td><td class="mono">' +
      (c.wAdd.length ? '+ ' + esc(list(c.wAdd)) + '<br>' : '') + (c.wDel.length ? '− ' + esc(list(c.wDel)) : '') + '</td><td class="mono">' + (c.rAdd.length ? '+ ' + esc(list(c.rAdd)) + '<br>' : '') + (c.rDel.length ? '− ' + esc(list(c.rDel)) : '') + '</td></tr>')) +
    '<h2>Procesos nuevos (' + added.length + ')</h2>' + tbl('cm-ad', ['Proceso', 'Estado', 'Carpeta', 'Creado'], added.map(p => '<tr><td>' + plB(p) + '</td><td>' + badge(M.P[p.i]) + '</td><td class="mono">' + esc(p.d) + '</td><td>' + esc(p.cd) + '</td></tr>')) +
    '<h2>Procesos eliminados (' + removed.length + ')</h2>' + tbl('cm-rm', ['Proceso', 'Carpeta', 'Última modificación'], removed.map(p => '<tr><td>' + esc(p.n) + '</td><td class="mono">' + esc(p.d) + '</td><td>' + esc(p.md) + '</td></tr>'));
}
