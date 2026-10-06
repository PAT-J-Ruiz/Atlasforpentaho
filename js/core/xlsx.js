/* Lector mínimo de .xlsx (primera hoja) sin librerías externas.
   Usa DecompressionStream('deflate-raw'), disponible en Edge/Chrome actuales. */
async function readXlsx(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('No es un .xlsx válido');
  const n = dv.getUint16(e + 10, true);
  let off = dv.getUint32(e + 16, true);
  const td = new TextDecoder();
  const entries = {};
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    entries[td.decode(buf.subarray(off + 46, off + 46 + nl))] = { method, csize, lho };
    off += 46 + nl + xl + cl;
  }
  async function read(name) {
    const en = entries[name]; if (!en) return null;
    const start = en.lho + 30 + dv.getUint16(en.lho + 26, true) + dv.getUint16(en.lho + 28, true);
    const data = buf.subarray(start, start + en.csize);
    if (en.method === 0) return td.decode(data);
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(ds).text();
  }
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const shared = [];
  const ssTxt = await read('xl/sharedStrings.xml');
  if (ssTxt) for (const si of xml(ssTxt).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const sheetName = Object.keys(entries).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  const doc = xml(await read(sheetName));
  const colIdx = (ref) => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  const rows = [];
  for (const r of doc.getElementsByTagName('row')) {
    const row = [];
    for (const c of r.getElementsByTagName('c')) {
      const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0];
      let val = '';
      if (t === 's' && v) val = shared[+v.textContent] || '';
      else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
      else if (v) val = v.textContent;
      row[colIdx(c.getAttribute('r'))] = val;
    }
    rows.push(Array.from(row, x => x === undefined ? '' : x));
  }
  return rows;
}

/* Convierte la hoja de calendarización de Pentaho (Schedule Name, Repeats, Source File…) a objetos. */
function schedFromRows(rows) {
  if (!rows.length) return [];
  const h = rows[0].map(x => String(x).trim().toLowerCase());
  const col = (re) => h.findIndex(x => re.test(x));
  const C = { name: col(/schedule name|nombre/), rep: col(/repeat|repite/), src: col(/source|origen|archivo/), out: col(/output|salida/),
    last: col(/last run|última|ultima/), next: col(/next run|próxima|proxima/), by: col(/created by|creado/), st: col(/status|estado/) };
  return rows.slice(1).filter(r => r.some(x => x)).map(r => {
    const g = (k) => C[k] >= 0 ? String(r[C[k]] || '').trim() : '';
    return { name: g('name'), rep: g('rep'), src: g('src'), out: g('out'), last: g('last'), next: g('next'), by: g('by'), st: g('st') };
  });
}
