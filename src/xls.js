// Minimal reader for legacy Excel files (.xls, BIFF8 inside a Compound File), enough to
// read the cell text and numbers of exported tables. Formatting, formulas and dates
// stored as serial numbers are not interpreted: callers get raw values.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;

export function isXls(buf) {
  const b = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  return SIGNATURE.every((v, i) => b[i] === v);
}

// ---- Compound File Binary (the container) --------------------------------

function readCfb(buf) {
  const dv = new DataView(buf);
  if (!isXls(buf)) throw new Error("Not an Excel 97–2003 (.xls) file.");
  const sectorSize = 1 << dv.getUint16(0x1e, true);
  const miniSize = 1 << dv.getUint16(0x20, true);
  const nFat = dv.getUint32(0x2c, true);
  const dirStart = dv.getUint32(0x30, true);
  const miniCutoff = dv.getUint32(0x38, true);
  const miniFatStart = dv.getUint32(0x3c, true);
  let difatSector = dv.getUint32(0x44, true);
  const offset = (s) => (s + 1) * sectorSize;

  // Sector numbers of the FAT itself: 109 in the header, the rest in DIFAT sectors.
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(0x4c + i * 4, true));
  const perSector = sectorSize / 4 - 1;
  let guard = 0;
  while (fatSectors.length < nFat && difatSector !== END_OF_CHAIN && difatSector !== FREE && guard++ < 1e5) {
    const o = offset(difatSector);
    for (let i = 0; i < perSector && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(o + i * 4, true));
    difatSector = dv.getUint32(o + perSector * 4, true);
  }
  const fat = [];
  for (const s of fatSectors) {
    const o = offset(s);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(dv.getUint32(o + i * 4, true));
  }

  const chain = (start, table) => {
    const out = [];
    for (let s = start, n = 0; s !== END_OF_CHAIN && s !== FREE && s < table.length && n < table.length; s = table[s], n++) out.push(s);
    return out;
  };
  const readChain = (start, size = Infinity) => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(Math.min(size, sectors.length * sectorSize));
    sectors.forEach((s, i) => {
      const len = Math.min(sectorSize, out.length - i * sectorSize);
      if (len > 0) out.set(new Uint8Array(buf, offset(s), len), i * sectorSize);
    });
    return out;
  };

  // Directory entries (128 bytes each).
  const dir = readChain(dirStart);
  const ddv = new DataView(dir.buffer);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = ddv.getUint16(o + 0x40, true);
    let name = "";
    for (let i = 0; i < nameLen / 2 - 1; i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type: dir[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
  }
  const root = entries[0];

  let mini = null;
  let miniFat = null;
  const stream = (entry) => {
    if (entry.size >= miniCutoff) return readChain(entry.start, entry.size);
    // Small streams live in the mini stream, addressed by the mini FAT.
    if (!mini) {
      mini = readChain(root.start, root.size);
      const mf = readChain(miniFatStart);
      const mdv = new DataView(mf.buffer);
      miniFat = [];
      for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mdv.getUint32(i, true));
    }
    const out = new Uint8Array(entry.size);
    chain(entry.start, miniFat).forEach((s, i) => {
      const len = Math.min(miniSize, out.length - i * miniSize);
      if (len > 0) out.set(mini.subarray(s * miniSize, s * miniSize + len), i * miniSize);
    });
    return out;
  };
  return { entries, stream };
}

// ---- BIFF8 workbook --------------------------------------------------------

const decoderLatin1 = new TextDecoder("latin1");
const decoderUtf16 = new TextDecoder("utf-16le");

/** Reads an .xls file. Returns [{ name, rows: [[value, ...], ...] }] with strings and numbers. */
export function readXls(buf) {
  const { entries, stream } = readCfb(buf);
  const entry = entries.find((e) => e.type === 2 && /^(workbook|book)$/i.test(e.name));
  if (!entry) throw new Error("This .xls file has no workbook.");
  const data = stream(entry);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Split into records: [type, payload] (CONTINUE records stay separate for the SST).
  const records = [];
  for (let o = 0; o + 4 <= data.length; ) {
    const type = dv.getUint16(o, true);
    const len = dv.getUint16(o + 2, true);
    records.push({ type, pos: o, data: data.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }

  const sheets = [];
  let sst = [];
  records.forEach((r, i) => {
    if (r.type === 0x0085) {
      // BOUNDSHEET: position of the sheet's BOF, visibility, type, name.
      const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const kind = r.data[5];
      const { text } = readString(r.data, 6, true);
      if (kind === 0) sheets.push({ name: text, pos: v.getUint32(0, true), rows: [] });
    } else if (r.type === 0x00fc) {
      const parts = [r.data];
      for (let j = i + 1; j < records.length && records[j].type === 0x003c; j++) parts.push(records[j].data);
      sst = readSst(parts);
    }
  });
  if (!sheets.length) throw new Error("This .xls file has no worksheets.");

  for (const sheet of sheets) {
    let k = records.findIndex((r) => r.pos === sheet.pos);
    if (k < 0) continue;
    const set = (row, col, value) => {
      while (sheet.rows.length <= row) sheet.rows.push([]);
      const line = sheet.rows[row];
      while (line.length < col) line.push("");
      line[col] = value;
    };
    let pendingFormula = null;
    for (k++; k < records.length && records[k].type !== 0x000a; k++) {
      const { type, data: d } = records[k];
      const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const row = d.length >= 4 ? v.getUint16(0, true) : 0;
      const col = d.length >= 4 ? v.getUint16(2, true) : 0;
      if (type === 0x00fd) set(row, col, sst[v.getUint32(6, true)] ?? "");
      else if (type === 0x0203) set(row, col, v.getFloat64(6, true));
      else if (type === 0x027e) set(row, col, rk(v.getUint32(6, true)));
      else if (type === 0x0204) set(row, col, readString(d, 6, false).text);
      else if (type === 0x00bd) {
        // MULRK: several RK numbers in one row.
        const last = v.getUint16(d.length - 2, true);
        for (let c = col, o = 4; c <= last; c++, o += 6) set(row, c, rk(v.getUint32(o + 2, true)));
      } else if (type === 0x0006) {
        // FORMULA: the cached result is a number unless the top bytes say otherwise.
        if (v.getUint16(12, true) === 0xffff) {
          if (d[6] === 0) pendingFormula = { row, col };
          else if (d[6] === 1) set(row, col, d[8] ? "TRUE" : "FALSE");
        } else set(row, col, v.getFloat64(6, true));
      } else if (type === 0x0207 && pendingFormula) {
        set(pendingFormula.row, pendingFormula.col, readString(d, 0, false).text);
        pendingFormula = null;
      }
    }
  }
  return sheets.map(({ name, rows }) => ({ name, rows }));
}

function rk(x) {
  let n;
  if (x & 2) n = x >> 2;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, x & 0xfffffffc, true);
    n = b.getFloat64(0, true);
  }
  return x & 1 ? n / 100 : n;
}

// XLUnicodeString: character count (1 or 2 bytes), option flags, then the characters.
function readString(d, o, shortLen) {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const cch = shortLen ? d[o] : v.getUint16(o, true);
  o += shortLen ? 1 : 2;
  const flags = d[o++];
  const wide = flags & 1;
  let rich = 0;
  let ext = 0;
  if (flags & 8) (rich = v.getUint16(o, true)), (o += 2);
  if (flags & 4) (ext = v.getUint32(o, true)), (o += 4);
  const bytes = cch * (wide ? 2 : 1);
  const text = (wide ? decoderUtf16 : decoderLatin1).decode(d.subarray(o, o + bytes));
  return { text, end: o + bytes + rich * 4 + ext };
}

// Shared string table. Strings may continue across CONTINUE records; each continuation
// of a string's characters starts with a fresh flags byte.
function readSst(parts) {
  let pi = 0;
  let d = parts[0];
  let v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let o = 8;
  const total = v.getUint32(4, true);
  const next = () => {
    pi++;
    d = parts[pi];
    v = d && new DataView(d.buffer, d.byteOffset, d.byteLength);
    o = 0;
  };
  const skip = (n) => {
    while (n > 0 && d) {
      const take = Math.min(n, d.length - o);
      o += take;
      n -= take;
      if (n > 0) next();
    }
  };
  const out = [];
  for (let s = 0; s < total && d; s++) {
    if (o >= d.length) next();
    if (!d) break;
    const cch = v.getUint16(o, true);
    o += 2;
    let flags = d[o++];
    let rich = 0;
    let ext = 0;
    if (flags & 8) (rich = v.getUint16(o, true)), (o += 2);
    if (flags & 4) (ext = v.getUint32(o, true)), (o += 4);
    let text = "";
    let left = cch;
    while (left > 0 && d) {
      const wide = flags & 1;
      const avail = Math.floor((d.length - o) / (wide ? 2 : 1));
      const n = Math.min(left, avail);
      text += (wide ? decoderUtf16 : decoderLatin1).decode(d.subarray(o, o + n * (wide ? 2 : 1)));
      o += n * (wide ? 2 : 1);
      left -= n;
      if (left > 0) {
        next();
        if (!d) break;
        flags = d[o++];
      }
    }
    skip(rich * 4 + ext);
    out.push(text);
  }
  return out;
}
