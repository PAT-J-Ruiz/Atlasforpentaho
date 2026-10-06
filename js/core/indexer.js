/* Catálogo Pentaho — indexador del volcado HOME (exportación del repositorio PDI).
   - Lee el HOME en streaming (no lo carga entero en memoria) y procesa cada
     <transformation>/<job> por separado.
   - Corre dentro de un Web Worker creado desde un Blob, así funciona abriendo
     index.html directamente desde disco (file://).
   - Nunca guarda contraseñas: descarta <password> y enmascara literales en SQL. */
function pixCore() {
  'use strict';

  /* ---------- XML mínimo (sin dependencias) ---------- */
  function decode(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (m, e) {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }
  function parseXML(src) {
    const root = { tag: '#root', text: '', children: [] };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s\/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.text += m[1];
      else if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); }
      else if (m[3] !== undefined) {
        const el = { tag: m[3], text: '', children: [] };
        top.children.push(el);
        if (!m[5]) stack.push(el);
      } else if (m[6] !== undefined && stack.length > 1) top.text += decode(m[6]);
    }
    if (!root.children.length) throw new Error('XML sin elementos');
    return root.children[0];
  }
  const ch = (el, n) => { if (!el) return null; for (const c of el.children) if (c.tag === n) return c; return null; };
  const chs = (el, n) => el ? el.children.filter(c => c.tag === n) : [];
  const ct = (el, n) => { const c = ch(el, n); return c ? c.text.trim() : ''; };
  function leaves(el, out, parent) {
    for (const c of el.children) {
      if (c.children.length) leaves(c, out, c.tag);
      else { const t = c.text.trim(); if (t) out.push([c.tag, t, parent]); }
    }
    return out;
  }

  /* ---------- .properties ---------- */
  const SENS = /(pass(word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|clave|contrase|credential)/i;
  function parseProps(text) {
    const out = {};
    const lines = text.replace(/\r/g, '').split('\n');
    let buf = '';
    for (let l of lines) {
      if (!buf) { const t = l.replace(/^\s+/, ''); if (!t || t[0] === '#' || t[0] === '!') continue; l = t; }
      const tail = l.match(/(\\+)$/);
      if (tail && tail[1].length % 2 === 1) { buf += l.slice(0, -1); continue; }
      l = buf + l; buf = '';
      const m = l.match(/^((?:\\.|[^=:\s\\])+)\s*[=:\s]\s*([\s\S]*)$/);
      const k = (m ? m[1] : l).trim().replace(/\\(.)/g, '$1');
      let v = m ? m[2].trim() : '';
      v = v.replace(/\\u([0-9a-fA-F]{4})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
      if (SENS.test(k) && v) v = '(oculto)';
      out[k] = v;
    }
    return out;
  }

  /* ---------- SQL (dialecto SQL Server, tolerante a ${VAR}) ---------- */
  const ID = '(?:\\[[^\\]]+\\]|"[^"]+"|`[^`]+`|\\$\\{[^}]+\\}|%%[^%]+%%|[#@]{0,2}[A-Za-z_\\u00C0-\\u017F][\\w$#@\\u00C0-\\u017F]*)';
  const IDENT = ID + '(?:\\s*\\.\\s*(?:' + ID + ')?)*';
  const KW = new Set(('SELECT WHERE SET VALUES AS ON LEFT RIGHT INNER OUTER CROSS FULL WITH OPENQUERY OPENROWSET OPENJSON OPENXML ' +
    'UNNEST LATERAL GROUP ORDER HAVING UNION EXCEPT INTERSECT AND OR NOT NULL CASE WHEN THEN ELSE END INTO FROM JOIN ' +
    'TOP DISTINCT ALL TABLE INSERTED DELETED OUTPUT EXISTS IN IS LIKE BETWEEN BY NOLOCK STRING_SPLIT STATISTICS').split(' '));
  const reFromJoin = new RegExp('\\b(DELETE\\s+(?:TOP\\s*\\(\\s*\\d+\\s*\\)\\s*)?FROM|FROM|JOIN|APPLY)\\s+(' + IDENT + ')(\\s*\\()?', 'gi');
  const reWrite = new RegExp('\\b(INSERT\\s+INTO|INSERT|INTO|UPDATE(?:\\s+TOP\\s*\\(\\s*\\d+\\s*\\))?|DELETE(?:\\s+TOP\\s*\\(\\s*\\d+\\s*\\))?(?!\\s+FROM)|MERGE(?:\\s+INTO)?|TRUNCATE\\s+TABLE|BULK\\s+INSERT|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|CREATE\\s+TABLE|ALTER\\s+TABLE)\\s+(' + IDENT + ')', 'gi');
  const reExec = new RegExp('\\bEXEC(?:UTE)?\\s+(?:@\\w+\\s*=\\s*)?(' + IDENT + ')', 'gi');
  const reAlias = new RegExp('\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(' + IDENT + ')\\s+(?:AS\\s+)?([A-Za-z_]\\w*)', 'gi');
  const reCte = /(?:\bWITH|,)\s*([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s+AS\s*\(/gi;

  function splitIdent(s) {
    const parts = []; let cur = ''; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '[') { const j = s.indexOf(']', i); cur += s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; }
      else if (c === '"' || c === '`') { const j = s.indexOf(c, i + 1); cur += s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; }
      else if (c === '$' && s[i + 1] === '{') { const j = s.indexOf('}', i); cur += s.slice(i, j + 1); i = j + 1; }
      else if (c === '.') { parts.push(cur.trim()); cur = ''; i++; }
      else if (/\s/.test(c)) i++;
      else { cur += c; i++; }
    }
    parts.push(cur.trim());
    return parts;
  }
  function cleanSql(sql) {
    return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  }
  function sqlRefs(sql) {
    const s = cleanSql(sql);
    const r = [], w = [], sp = [];
    let dyn = /sp_executesql|EXEC(?:UTE)?\s*\(/i.test(s);
    const ctes = new Set(); let m;
    reCte.lastIndex = 0; while ((m = reCte.exec(s))) ctes.add(m[1].toUpperCase());
    const alias = {};
    reAlias.lastIndex = 0;
    while ((m = reAlias.exec(s))) { const a = m[2].toUpperCase(); if (!KW.has(a)) alias[a] = m[1]; }
    const ok = (id) => {
      const p = splitIdent(id); const last = (p[p.length - 1] || '').toUpperCase();
      if (!last || KW.has(last) || ctes.has(last) && p.length === 1) return null;
      if (/^[#@]/.test(p[p.length - 1])) return null;
      return p;
    };
    reFromJoin.lastIndex = 0;
    while ((m = reFromJoin.exec(s))) {
      const isDel = /^DELETE/i.test(m[1]);
      if (m[3] && !isDel) continue; // función / table-valued
      const p = ok(m[2]); if (p) (isDel ? w : r).push(p);
      if (!isDel && /^FROM$/i.test(m[1])) { // FROM a x, b y
        let rest = s.slice(reFromJoin.lastIndex);
        const reNext = new RegExp('^\\s*(?:(?:AS\\s+)?[A-Za-z_]\\w*\\s*)?(?:WITH\\s*\\([^)]*\\)\\s*)?,\\s*(' + IDENT + ')');
        let k = 0, mm;
        while (k++ < 20 && (mm = rest.match(reNext))) { const q = ok(mm[1]); if (q) r.push(q); rest = rest.slice(mm[0].length); }
      }
    }
    reWrite.lastIndex = 0;
    while ((m = reWrite.exec(s))) {
      let id = m[2];
      if (/^INTO$/i.test(m[1]) && /\bINSERT\s+$/i.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
      if (/^INSERT$/i.test(m[1]) && /^INTO$/i.test(id)) continue;
      if (/^(UPDATE|DELETE)/i.test(m[1]) && alias[id.toUpperCase()]) id = alias[id.toUpperCase()];
      if (/^(DROP|CREATE|ALTER)/i.test(m[1])) dyn = dyn || false;
      const p = ok(id); if (p) w.push(p);
    }
    reExec.lastIndex = 0;
    while ((m = reExec.exec(s))) { const p = splitIdent(m[1]); const l = (p[p.length - 1] || '').toLowerCase(); if (l && !/^@/.test(p[0]) && l !== 'sp_executesql') sp.push(p); }
    return { r, w, sp, dyn };
  }
  function maskSecrets(t) {
    return t.replace(/Encrypted\s+[0-9a-f]{6,}/gi, 'Encrypted ****')
      .replace(/((?:pass(?:word|wd)?|pwd|secret|token|api_?key)\s*[=:]\s*['"]?)([^\s'";&]{3,})/gi, '$1****');
  }

  /* ---------- clasificación de pasos / entradas ---------- */
  const IN_T = /^(TextFileInput|ExcelInput|CsvInput|GetFileNames|JsonInput|getXMLData|PropertyInput|LoadFileInput|AccessInput|XMLInputStream|XBaseInput|ParallelGzipCsvInput|FixedInput|YamlInput|GetFilesRowsCount|FileExists|ExcelInputStep|SASInput|CubeInput)$/;
  const OUT_T = /^(TextFileOutput|ExcelOutput|TypeExitExcelWriterStep|XMLOutput|JsonOutput|AccessOutput|PropertyOutput|SQLFileOutput|CubeOutput|PGPEncryptStream)$/;
  const FILE_TAGS = new Set(['name', 'filename', 'file', 'file_name', 'foldername', 'folder', 'directory', 'source_filefolder', 'destination_filefolder',
    'localdirectory', 'sftpdirectory', 'targetdirectory', 'remotedirectory', 'ftpdirectory', 'targetfilename', 'sourcefilename', 'zipfilename',
    'sourcedirectory', 'movetodirectory', 'destinationfolder', 'filefolder', 'scriptfile', 'sqlfilename', 'wildcardSource', 'source_directory',
    'target_directory', 'destination_directory', 'filenameField', 'fileName', 'attachfiles', 'zip_filename', 'movetofolder', 'destfolder', 'temp_folder']);
  const PATHLIKE = /^(?:[a-zA-Z]:[\\\/]|\\\\|file:|sftp:|ftp:|smb:|vfs:|hdfs:|s3:)/;
  const LOOSEPATH = /^(?:\/[^\s<>]*|\$\{[^}]+\}[^\s]*|%%[^%]+%%[^\s]*|[^\s<>]*[\\\/][^\s<>]+)$/;
  const JOB_FILE_OP = {
    COPY_FILES: 'copia', MOVE_FILES: 'mueve', DELETE_FILES: 'borra', DELETE_FILE: 'borra', DELETE_FOLDERS: 'borra', CREATE_FOLDER: 'crea',
    CREATE_FILE: 'crea', FOLDER_IS_EMPTY: 'verifica', FILE_EXISTS: 'verifica', FILES_EXIST: 'verifica', EVAL_FILES_METRICS: 'verifica',
    ZIP_FILE: 'comprime', UNZIP: 'descomprime', ADD_RESULT_FILENAMES: 'agrega-resultado', DELETE_RESULT_FILENAMES: 'borra',
    COPY_MOVE_RESULT_FILENAMES: 'mueve', SFTP: 'sftp-descarga', SFTPPUT: 'sftp-sube', FTP: 'ftp-descarga', FTP_PUT: 'ftp-sube',
    FTP_DELETE: 'ftp-borra', SHELL: 'ejecuta', SQL: 'lee', WAIT_FOR_FILE: 'verifica', PGP_ENCRYPT_FILES: 'cifra', PGP_DECRYPT_FILES: 'descifra',
    WRITE_TO_FILE: 'escribe', FILE_COMPARE: 'verifica', XSLT: 'transforma'
  };
  const SKIP_LEAF = new Set(['type', 'description', 'xloc', 'yloc', 'nr', 'draw', 'parallel', 'copies', 'distribute', 'custom_distribution',
    'method', 'schema_name', 'trim_type', 'format', 'currency', 'decimal', 'group', 'length', 'precision', 'repeat']);

  function fileRole(kind, t, tag) {
    if (kind === 'J') {
      const op = JOB_FILE_OP[t] || 'usa';
      if (t === 'COPY_FILES' || t === 'MOVE_FILES' || t === 'COPY_MOVE_RESULT_FILENAMES')
        return tag === 'destination_filefolder' || /dest|target|movetofolder/i.test(tag) ? op + '-a' : op + '-desde';
      if (t === 'SFTP' || t === 'FTP') return /targetdirectory/i.test(tag) ? 'descarga-a' : 'descarga-desde';
      if (t === 'SFTPPUT' || t === 'FTP_PUT') return /localdirectory/i.test(tag) ? 'sube-desde' : 'sube-a';
      return op;
    }
    if (IN_T.test(t)) return 'lee';
    if (OUT_T.test(t)) return 'escribe';
    if (/Mail/.test(t)) return 'adjunta';
    return 'usa';
  }

  function extractStep(el, kind) {
    const t = ct(el, 'type');
    const s = { n: ct(el, 'name'), t };
    const c = ct(el, 'connection'); if (c) s.c = c;
    const L = leaves(el, [], el.tag);
    const get = (tag) => { for (const x of L) if (x[0] === tag) return x[1]; return ''; };
    const rd = [], wr = [], sp = [], files = [], ext = [], vd = [];
    const addSql = (q) => {
      if (!q) return;
      s.q = maskSecrets(q.length > 60000 ? q.slice(0, 60000) + '\n-- (truncado)' : q);
      const x = sqlRefs(q); rd.push(...x.r); wr.push(...x.w); sp.push(...x.sp); if (x.dyn) s.dy = 1;
    };
    const lk = ch(el, 'lookup');
    // --- base de datos
    if (t === 'TableOutput') { const tb = ct(el, 'table'); if (tb) wr.push([ct(el, 'schema'), tb]); if (ct(el, 'truncate') === 'Y') s.tr = 1; const cm = ct(el, 'commit'); if (cm) s.cm = +cm || cm; if (ct(el, 'tablename_in_field') === 'Y') s.dy = 1; }
    else if (/^(InsertUpdate|Update|Delete|SynchronizeAfterMerge)$/.test(t) && lk) { const tb = ct(lk, 'table'); if (tb) wr.push([ct(lk, 'schema'), tb]); const cm = ct(el, 'commit'); if (cm) s.cm = +cm || cm; }
    else if (t === 'DBLookup' && lk) { const tb = ct(lk, 'table'); if (tb) rd.push([ct(lk, 'schema'), tb]); }
    else if (t === 'DBProc') { const p = ct(el, 'procedure'); if (p) sp.push(splitIdent(p)); }
    else if (/^(TableInput|DBJoin|ExecSQL|ExecSQLRow|DynamicSQLRow|SQL|WAIT_FOR_SQL|EVAL_TABLE_CONTENT)$/.test(t)) {
      addSql(get('sql') || get('custom_sql'));
      if (/^(WAIT_FOR_SQL|EVAL_TABLE_CONTENT)$/.test(t) && !s.q) { const tb = get('tablename'); if (tb) rd.push([get('schemaname'), tb]); }
      if (t === 'SQL' && get('sqlfromfile') === 'Y') { const f = get('sqlfilename'); if (f) files.push([f, 'lee-sql']); }
      if (/^(ExecSQL|ExecSQLRow)$/.test(t) && ct(el, 'execute_each_row') === 'Y') s.er = 1;
    }
    else if (/^(TABLE_EXISTS|COLUMNS_EXIST)$/.test(t)) { const tb = get('tablename'); if (tb) rd.push([get('schemaname'), tb]); }
    else if (t === 'TRUNCATE_TABLES') { for (const f of chs(ch(el, 'fields'), 'field')) { const tb = ct(f, 'name'); if (tb) wr.push([ct(f, 'schemaname'), tb]); } }
    else if (c && get('table')) { (/Output|Insert|Update|Delete|Merge|Bulk|Load/i.test(t) ? wr : rd).push([get('schema'), get('table')]); }
    if (/MongoDb/.test(t)) ext.push(['mongodb', (get('hostname') || '?') + '/' + get('db_name') + '/' + get('collection'), /Output/.test(t) ? 'escribe' : 'lee']);
    // --- llamadas a otros procesos
    if (kind === 'J' && (t === 'TRANS' || t === 'JOB')) {
      s.call = [t === 'TRANS' ? 'T' : 'J', get('directory'), t === 'TRANS' ? get('transname') : get('jobname'), get('filename'), get('specification_method')];
    } else if (/^(JobExecutor|TransExecutor|SimpleMapping|Mapping|MetaInject|SingleThreader)$/.test(t)) {
      const isJob = t === 'JobExecutor';
      s.call = [isJob ? 'J' : 'T', ct(el, 'directory') || get('directory'), isJob ? ct(el, 'job_name') : (ct(el, 'trans_name') || get('trans_name')), ct(el, 'filename'), ct(el, 'specification_method')];
    }
    // --- código embebido
    const code = [];
    for (const x of L) if (/^(jsScript_script|class_source|script)$/.test(x[0]) && x[1].length > 1) code.push(x[1]);
    if (code.length) { let cd = code.join('\n/* ---- */\n'); s.cl = cd.length; s.code = maskSecrets(cd.length > 30000 ? cd.slice(0, 30000) + '\n/* (truncado) */' : cd); }
    // --- externos
    const srv = get('servername') || get('serverName') || get('server') || get('hostname');
    if (/^(SFTP|SFTPPUT|FTP|FTP_PUT|FTP_DELETE|FTPS_GET|FTPS_PUT)$/.test(t) || /^(SFTPPut|FTPPut)$/.test(t)) ext.push([/FTPS?_|^FTP/.test(t) && !/SFTP/.test(t) ? 'ftp' : 'sftp', srv + (get('serverport') || get('port') ? ':' + (get('serverport') || get('port')) : ''), get('username') || get('userName')]);
    if (t === 'MAIL') ext.push(['mail', [get('destination'), get('destinationCc')].filter(Boolean).join(' | ') || '?', get('subject')]);
    if (t === 'Mail') ext.push(['mail', '(campo ' + (get('destination') || '?') + ')', '(campo ' + (get('subject') || '?') + ')']);
    if (/^(HTTP|HTTPPOST|Rest|HTTP_POST|WebServiceLookup|WEBSERVICE_AVAILABLE)$/i.test(t)) ext.push(['http', get('url') || get('urlField') || get('wsURL') || '?', get('method') || '']);
    if (t === 'SHELL') { const f = get('filename'); ext.push(['shell', f || '(script embebido)', get('work_directory')]); }
    // --- archivos / carpetas
    if (!s.call) {
      const seen = new Set();
      for (const [tag, v, parent] of L) {
        if (SKIP_LEAF.has(tag) || v.length > 400 || v.indexOf('\n') >= 0 || tag === 'url' || /^https?:/i.test(v)) continue;
        const ftag = FILE_TAGS.has(tag);
        if (!(PATHLIKE.test(v) || (ftag && LOOSEPATH.test(v)))) continue;
        if (tag === 'name' && parent !== 'file' && parent !== 'field' && !PATHLIKE.test(v)) continue;
        if (tag === 'name' && parent === 'field' && kind === 'T') continue;
        if (/^\$\{Internal\./.test(v) && v.length < 40) continue;
        if (/^%%java\.io\.tmpdir%%$/i.test(v)) continue;
        if (seen.has(v)) continue; seen.add(v);
        files.push([v, fileRole(kind, t, tag)]);
      }
    }
    // --- variables definidas
    if (t === 'SET_VARIABLES') { for (const f of chs(ch(el, 'fields'), 'field')) { const n = ct(f, 'variable_name'); if (n) vd.push([n, ct(f, 'variable_value')]); } const f = get('filename'); if (f) files.push([f, 'carga-variables']); }
    if (t === 'SetVariable') { for (const f of chs(ch(el, 'fields'), 'field')) { const n = ct(f, 'variable_name'); if (n) vd.push([n, '(campo ' + ct(f, 'field_name') + ')']); } }
    if (t === 'SPECIAL' && ct(el, 'start') === 'Y' && ct(el, 'repeat') === 'Y') s.loop = [ct(el, 'schedulerType'), ct(el, 'intervalSeconds'), ct(el, 'intervalMinutes'), ct(el, 'hour'), ct(el, 'minutes')];
    if (rd.length) s.rd = rd; if (wr.length) s.wr = wr; if (sp.length) s.sp = sp;
    if (files.length) s.f = files; if (ext.length) s.x = ext; if (vd.length) s.vd = vd;
    return s;
  }

  /* ---------- estado del indexado ---------- */
  function newState(props) {
    const P = {};
    for (const name in props) P[name.replace(/\.(txt|properties)$/i, '').trim().toUpperCase()] = { file: name, kv: props[name] };
    return { procs: [], conns: {}, props: P, errors: [] };
  }
  const VAR_RE = /\$\{([^}\s]+)\}|%%([A-Za-z_][\w.]*)%%/g;
  const PROPREF = /([A-Za-z0-9_ ][A-Za-z0-9_ .\-]*?)\.properties\b/gi;

  function handleObject(st, kind, xml) {
    const root = parseXML(xml);
    const info = kind === 'T' ? ch(root, 'info') : root;
    const p = { i: st.procs.length, k: kind, n: ct(info, 'name'), d: ct(info, 'directory') || '/' };
    const desc = ct(info, 'description'); if (desc) p.ds = desc.slice(0, 1000);
    p.cu = ct(info, 'created_user'); p.cd = ct(info, 'created_date'); p.mu = ct(info, 'modified_user'); p.md = ct(info, 'modified_date');
    const par = chs(ch(info, 'parameters'), 'parameter').map(x => [ct(x, 'name'), ct(x, 'default_value'), ct(x, 'description')]).filter(x => x[0]);
    if (par.length) p.par = par;
    // conexiones definidas en el objeto (sin contraseña)
    const cn = {};
    for (const c of chs(root, 'connection')) {
      const d = { n: ct(c, 'name'), ty: ct(c, 'type'), ac: ct(c, 'access'), sv: ct(c, 'server'), db: ct(c, 'database'), po: ct(c, 'port'), us: ct(c, 'username') };
      if (!d.n) continue;
      cn[d.n] = d;
      const key = [d.ty, d.sv, d.db, d.po, d.us, d.ac].join('|');
      const g = st.conns[d.n] || (st.conns[d.n] = {});
      if (!g[key]) g[key] = Object.assign({ cnt: 0 }, d);
      g[key].cnt++;
    }
    p._cn = cn;
    // pasos / entradas
    const els = kind === 'T' ? chs(root, 'step') : chs(ch(root, 'entries'), 'entry');
    p.st = els.map(e => extractStep(e, kind));
    if (kind === 'T') {
      const hops = chs(ch(root, 'order'), 'hop');
      p.nh = hops.length;
      const off = hops.filter(h => ct(h, 'enabled') === 'N').length; if (off) p.hoff = off;
      const eh = chs(ch(root, 'step_error_handling'), 'error').length; if (eh) p.eh = eh;
      const lt = ch(ch(ch(info, 'log'), 'trans-log-table'), 'table'); if (lt && lt.text.trim()) p.lg = lt.text.trim();
    } else {
      const idx = {}; p.st.forEach((s, i) => { idx[s.n] = i; });
      p.hp = chs(ch(root, 'hops'), 'hop').map(h => {
        const cond = ct(h, 'unconditional') === 'Y' ? 'S' : (ct(h, 'evaluation') === 'N' ? 'E' : 'O');
        const a = [idx[ct(h, 'from')], idx[ct(h, 'to')], cond]; if (ct(h, 'enabled') === 'N') a.push(0); return a;
      }).filter(h => h[0] !== undefined && h[1] !== undefined);
      const lt = ch(ch(root, 'job-log-table'), 'table'); if (lt && lt.text.trim()) p.lg = lt.text.trim();
    }
    // .properties referenciados
    const pf = new Set(); let m;
    PROPREF.lastIndex = 0;
    while ((m = PROPREF.exec(xml))) {
      const base = m[1].split(/[\\\/]/).pop().trim().toUpperCase();
      const last = base.split(/\s+/).pop();
      if (st.props[base]) pf.add(base); else if (st.props[last]) pf.add(last);
    }
    if (pf.size) p.pf = [...pf];
    // variables usadas
    const vs = new Set(); VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(xml))) { const v = m[1] || m[2]; if (!/^Internal\./i.test(v)) vs.add(v); if (vs.size > 400) break; }
    if (vs.size) p.v = [...vs].sort();
    p.sz = xml.length;
    st.procs.push(p);
  }

  /* ---------- post-proceso: llamadas, properties efectivos, BD/tablas ---------- */
  const INTERNAL_DIR = /\$\{Internal\.(Entry\.Current\.Directory|Job\.Filename\.Directory|Transformation\.Filename\.Directory|Job\.Repository\.Directory|Transformation\.Repository\.Directory|Entry\.Current\.Folder)\}/gi;
  function normPath(s) {
    s = s.replace(/\\/g, '/').replace(/\/+/g, '/');
    const out = [];
    for (const seg of s.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
    return '/' + out.join('/');
  }
  function makeResolver(st, p) {
    const local = {};
    (p.par || []).forEach(x => { if (x[1]) local[x[0]] = x[1]; });
    for (const s of p.st) if (s.vd) for (const [n, v] of s.vd) if (v && v[0] !== '(' && !(n in local)) local[n] = v;
    const files = (p.pe || []).map(k => st.props[k]).filter(Boolean);
    return function resolve(str, depth) {
      if (!str || str.indexOf('${') < 0 && str.indexOf('%%') < 0) return str;
      depth = depth || 0; if (depth > 4) return str;
      const out = str.replace(VAR_RE, (all, a, b) => {
        const v = a || b;
        if (v in local) return local[v];
        for (const f of files) if (v in f.kv && f.kv[v] !== '') return f.kv[v];
        const g = st.varGlobal[v];
        if (g && g.size === 1) return [...g][0];
        return all;
      });
      return out !== str ? resolve(out, depth + 1) : out;
    };
  }

  function finalize(st, onProgress) {
    const procs = st.procs;
    // valores globales de variables (para inferir si una variable tiene un único valor en todos los properties)
    st.varGlobal = {};
    for (const k in st.props) for (const [n, v] of Object.entries(st.props[k].kv)) if (v !== '') (st.varGlobal[n] || (st.varGlobal[n] = new Set())).add(v);
    const byPath = new Map(), byName = new Map();
    for (const p of procs) {
      p.path = normPath(p.d + '/' + p.n);
      byPath.set(p.k + '|' + p.path.toLowerCase(), p.i);
      const nk = p.k + '|' + p.n.toLowerCase();
      (byName.get(nk) || byName.set(nk, []).get(nk)).push(p.i);
    }
    const resolveCall = (p, call, R) => {
      const [k, dir, name, file, method] = call;
      let path = '';
      const fix = (x) => (R ? R(x) : x).replace(INTERNAL_DIR, p.d);
      if (file && (method === 'filename' || !name)) path = fix(file).replace(/\.(ktr|kjb)$/i, '');
      else if (name) path = (dir ? fix(dir) : p.d) + '/' + fix(name);
      if (!path) return { to: -1, tp: '' };
      const np = normPath(path);
      let id = byPath.get(k + '|' + np.toLowerCase());
      if (id === undefined) id = byPath.get((k === 'T' ? 'J' : 'T') + '|' + np.toLowerCase());
      if (id === undefined) {
        const base = np.split('/').pop().toLowerCase();
        const c = byName.get(k + '|' + base);
        if (c && c.length === 1) id = c[0];
        else if (c && c.length > 1) { // misma carpeta que el llamador primero
          const same = c.find(i => procs[i].d.toLowerCase() === p.d.toLowerCase()); if (same !== undefined) id = same;
        }
      }
      return { to: id === undefined ? -1 : id, tp: np };
    };
    // 1ª pasada de llamadas (sin variables)
    for (const p of procs) for (const s of p.st) if (s.call) { const r = resolveCall(p, s.call, null); s.to = r.to; s.tp = r.tp; }
    const edges = () => { for (const p of procs) p.cs = [...new Set(p.st.filter(s => s.to >= 0).map(s => s.to))]; };
    edges();
    // properties efectivos = propios + heredados de quienes lo llaman
    const propagate = () => {
      for (const p of procs) p._pe = new Set(p.pf || []);
      for (let it = 0, changed = true; changed && it < 25; it++) {
        changed = false;
        for (const p of procs) for (const c of p.cs) { const q = procs[c]; for (const f of p._pe) if (!q._pe.has(f)) { q._pe.add(f); changed = true; } }
      }
      for (const p of procs) { p.pe = [...p._pe]; delete p._pe; }
    };
    propagate();
    // 2ª pasada: llamadas no resueltas con variables
    let fixed = 0;
    for (const p of procs) { const R = makeResolver(st, p); for (const s of p.st) if (s.call && s.to < 0) { const r = resolveCall(p, s.call, R); if (r.to >= 0) { s.to = r.to; s.tp = r.tp; fixed++; } } }
    if (fixed) { edges(); propagate(); }
    onProgress && onProgress(97, 'Resolviendo conexiones y tablas…');
    // conexiones y tablas
    for (const p of procs) {
      const R = makeResolver(st, p);
      const cx = {};
      const conn = (name) => {
        if (!name) return null;
        if (cx[name]) return cx[name];
        let d = p._cn[name];
        if (!d && st.conns[name]) d = Object.values(st.conns[name]).sort((a, b) => b.cnt - a.cnt)[0];
        const rn = R(name);
        if (!d && rn !== name && st.conns[rn]) d = Object.values(st.conns[rn]).sort((a, b) => b.cnt - a.cnt)[0];
        const o = d ? { n: name, ty: d.ty, ac: d.ac, sv: d.sv, db: d.db, svr: R(d.sv), dbr: R(d.db) } : { n: name, ty: '?', sv: '', db: '', svr: '', dbr: '' };
        if (!d) o.nd = 1;
        return (cx[name] = o);
      };
      const tkey = (parts, c) => {
        let a = parts.map(x => R(x || '').trim());
        let srv = '';
        if (a.length >= 4) { srv = a[a.length - 4]; a = a.slice(-3); }
        let db, sc, tb;
        if (a.length === 3) [db, sc, tb] = a; else if (a.length === 2) [sc, tb] = a; else tb = a[0];
        if (!db) db = c ? (c.dbr || c.n) : '?';
        if (!sc) sc = 'dbo';
        return [db, sc, tb].join('.').toUpperCase() + (srv ? '@' + srv.toUpperCase() : '');
      };
      const r = new Set(), w = new Set(), sp = new Set();
      for (const s of p.st) {
        const c = conn(s.c);
        if (s.rd) { s.r = [...new Set(s.rd.map(x => tkey(x, c)))]; s.r.forEach(k => r.add(k)); delete s.rd; }
        if (s.wr) { s.w = [...new Set(s.wr.map(x => tkey(x, c)))]; s.w.forEach(k => w.add(k)); delete s.wr; }
        if (s.sp) { s.p = [...new Set(s.sp.map(x => tkey(x, c)))]; s.p.forEach(k => sp.add(k)); delete s.sp; }
      }
      p.cx = Object.values(cx);
      if (r.size) p.r = [...r]; if (w.size) p.w = [...w]; if (sp.size) p.sp = [...sp];
      delete p._cn;
      if (!p.cs.length) delete p.cs;
      if (!p.pe.length) delete p.pe;
    }
    const conns = {};
    for (const n in st.conns) conns[n] = Object.values(st.conns[n]);
    const props = {};
    for (const k in st.props) props[k] = st.props[k];
    return {
      v: 1, generado: new Date().toISOString(), procs, conns, props, errores: st.errors,
      resumen: { jobs: procs.filter(p => p.k === 'J').length, trans: procs.filter(p => p.k === 'T').length, pasos: procs.reduce((a, p) => a + p.st.length, 0) }
    };
  }

  async function indexHome(stream, total, props, onProgress) {
    const st = newState(props || {});
    const reader = stream.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '', read = 0, scanFrom = 0, lastPct = -1;
    const MARKS = [['\n</transformation>', 'T', '\n<transformation>'], ['\n</job>', 'J', '\n<job>']];
    for (;;) {
      const { done, value } = await reader.read();
      if (value) { read += value.length; buf += dec.decode(value, { stream: true }); }
      if (done) buf += dec.decode();
      for (;;) {
        let best = -1, mk = null;
        for (const M of MARKS) { const e = buf.indexOf(M[0], scanFrom); if (e >= 0 && (best < 0 || e < best)) { best = e; mk = M; } }
        if (best < 0) { scanFrom = Math.max(0, buf.length - 20); break; }
        const end = best + mk[0].length;
        const s = buf.lastIndexOf(mk[2], best);
        if (s >= 0) {
          const xml = buf.slice(s + 1, end);
          try { handleObject(st, mk[1], xml); }
          catch (err) { st.errors.push({ tipo: mk[1], pos: read, error: String(err && err.message || err), muestra: xml.slice(0, 200) }); }
        }
        buf = buf.slice(end); scanFrom = 0;
      }
      const pct = total ? Math.floor(read / total * 95) : 0;
      if (pct !== lastPct) { lastPct = pct; onProgress && onProgress(pct, 'Leyendo HOME… ' + st.procs.length + ' procesos'); }
      if (done) break;
    }
    onProgress && onProgress(96, 'Resolviendo llamadas y properties…');
    return finalize(st, onProgress);
  }

  return { parseProps, sqlRefs, indexHome, normPath };
}

/* Arranque dentro del Web Worker */
function pixWorkerBoot() {
  const api = pixCore();
  self.onmessage = async (ev) => {
    const { home, props } = ev.data;
    try {
      const pr = {};
      for (const f of props || []) pr[f.name] = api.parseProps(f.text);
      const idx = await api.indexHome(home.stream(), home.size, pr, (pct, msg) => self.postMessage({ type: 'progress', pct, msg }));
      idx.fuente = { home: home.name, bytes: home.size, properties: (props || []).map(f => f.name) };
      self.postMessage({ type: 'done', index: idx });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err && err.stack || err) });
    }
  };
}

function pixCreateWorker() {
  const src = pixCore.toString() + '\n' + pixWorkerBoot.toString() + '\npixWorkerBoot();';
  return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
}
