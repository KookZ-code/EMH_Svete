/*
 * parse_wb_layout.cjs — dev tool, run manually:  node scripts/parse_wb_layout.cjs
 *
 * แกะ "Lay out wire bond 1.xlsx" (= ZIP archive) แล้ว generate
 * src/lib/config/wb_layout.ts ซึ่งเก็บผังพื้นโรงงาน WB (WB_FLOOR) แบบ static.
 *
 * ทำไมถึง parse Excel แทนการ query DB: ไฟล์ Excel ระบุตำแหน่งทุกเครื่องครบถ้วน
 * (แต่ละ cell = เลขเครื่องจริง เรียงตามตำแหน่งในไลน์) พร้อม support blocks ทุกตัว
 * จึงเป็น layout source of truth ที่แม่นยำกว่าการเดาจาก group_machine
 *
 * วิธีจำแนก cell: ค่าตัวเลขล้วน = machine, ขึ้นต้น "LINE" = line label, อื่น ๆ = support block
 * (เก็บสี fill จาก Excel ไว้ให้ support block เพื่อความเหมือนต้นฉบับ)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const XLSX = path.join(ROOT, 'Lay out wire bond 1.xlsx');
const OUT = path.join(ROOT, 'src', 'lib', 'config', 'wb_layout.ts');

// ── extract the xlsx (zip) into a temp dir via PowerShell (Windows dev env) ──
function extractXlsx() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbxlsx-'));
  const zipCopy = path.join(tmp, 'book.zip');
  fs.copyFileSync(XLSX, zipCopy);
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zipCopy}' -DestinationPath '${tmp}' -Force`]);
  return tmp;
}

// ── XML helpers ──
function readXml(dir, rel) { return fs.readFileSync(path.join(dir, rel), 'utf8'); }

function parseSharedStrings(xml) {
  const sst = [];
  const re = /<si>([\s\S]*?)<\/si>/g; let m;
  while ((m = re.exec(xml))) {
    const tparts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]);
    sst.push(tparts.join('').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
  }
  return sst;
}

// fillId per cellXf, and rgb per fillId
function parseStyles(xml) {
  const fills = [];
  const fb = xml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/);
  if (fb) {
    const re = /<fill>([\s\S]*?)<\/fill>/g; let m;
    while ((m = re.exec(fb[1]))) {
      const fg = m[1].match(/<fgColor[^>]*rgb="([0-9A-Fa-f]{6,8})"/);
      const pat = m[1].match(/patternType="([^"]+)"/);
      fills.push({ rgb: fg ? fg[1].slice(-6) : null, pattern: pat ? pat[1] : null });
    }
  }
  const xfFill = [];
  const cb = xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (cb) {
    const re = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g; let m;
    while ((m = re.exec(cb[1]))) {
      const fid = m[1].match(/fillId="(\d+)"/);
      xfFill.push(fid ? parseInt(fid[1]) : 0);
    }
  }
  return { fills, xfFill };
}

function colNum(ref) {
  const c = ref.match(/^([A-Z]+)/)[1];
  let n = 0; for (const ch of c) n = n*26 + (ch.charCodeAt(0)-64);
  return n;
}

// cells keyed "r,c" -> {v, rgb}
function parseSheet(xml, sst, styles) {
  const cells = {};
  const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let rm;
  while ((rm = rowRe.exec(xml))) {
    const r = parseInt(rm[1]);
    const cellRe = /<c r="([A-Z]+\d+)"(?:\s+s="(\d+)")?(?:\s+t="(\w+)")?\s*(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
    while ((cm = cellRe.exec(rm[2]))) {
      const ref = cm[1], s = cm[2] ? parseInt(cm[2]) : 0, t = cm[3], inner = cm[4] || '';
      const c = colNum(ref);
      let val = '';
      const vmatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (t === 's' && vmatch) val = sst[parseInt(vmatch[1])] ?? '';
      else if (vmatch) val = vmatch[1];
      else { const im = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/); if (im) val = im[1]; }
      const fill = styles.fills[styles.xfFill[s] ?? 0] || {};
      cells[r + ',' + c] = { v: (val || '').trim(), rgb: fill.rgb };
    }
  }
  return cells;
}

// ── floor structure: which Excel rows belong to which zone ──
const ZONES = [
  { id:'Z1', label:'ZONE 1',                supervisor:'หยก , ย๊ะห์', rows:[4,6,8,10,12,14,17,19] },
  { id:'Z2', label:'ZONE 2 (TQFP)',          supervisor:'โบว์ , รุ้ง', rows:[21,23,25,27,29,31] },
  { id:'Z3', label:'ZONE 3 (QFN Old Room)',  supervisor:'สุ , น้อย',   rows:[38,40,42,44,46,48,50,52,54] },
];

const isNum = v => /^\d+$/.test(v);
const isLine = v => /^LINE/.test(v);

// support fill: ใช้สีจาก Excel ถ้ามี ไม่งั้น fallback ตาม keyword
function supColor(v, rgb) {
  if (rgb) return '#' + rgb;
  if (/ISP|IS\d/.test(v)) return '#9FE0B0';
  if (/QC|3\/O/.test(v)) return '#FFCCFF';
  if (/PLASMA/.test(v)) return '#C8E6A0';
  if (/SUP/.test(v)) return '#00FF99';
  if (/MOLD/.test(v)) return '#A8C0E0';
  return '#E0E4E8';
}

function buildRow(cells, r) {
  const rowCells = [];
  for (let c = 1; c <= 90; c++) {
    const k = r + ',' + c;
    const cell = cells[k];
    if (!cell || !cell.v) continue;
    if (isLine(cell.v))      rowCells.push({ kind:'line', v: cell.v, col: c });
    else if (isNum(cell.v))  rowCells.push({ kind:'machine', v: cell.v, num: parseInt(cell.v), col: c });
    else                     rowCells.push({ kind:'support', v: cell.v, color: supColor(cell.v, cell.rgb), col: c });
  }
  rowCells.sort((a, b) => a.col - b.col);
  return { cells: rowCells.map(({ col, ...rest }) => rest) };
}

// ── main ──
const dir = extractXlsx();
const sst = parseSharedStrings(readXml(dir, 'xl/sharedStrings.xml'));
const styles = parseStyles(readXml(dir, 'xl/styles.xml'));
const cells = parseSheet(readXml(dir, 'xl/worksheets/sheet1.xml'), sst, styles);

const WB_FLOOR = ZONES.map(z => ({
  id: z.id, label: z.label, supervisor: z.supervisor,
  rows: z.rows.map(r => buildRow(cells, r)),
}));

const machineCount = WB_FLOOR.flatMap(z => z.rows).flatMap(r => r.cells).filter(c => c.kind === 'machine').length;

const header = `// AUTO-GENERATED by scripts/parse_wb_layout.cjs — DO NOT EDIT BY HAND.
// Source: "Lay out wire bond 1.xlsx". Re-run the script to regenerate.

export type WbCellKind = 'machine' | 'line' | 'support';

export interface WbCell {
  kind: WbCellKind;
  v: string;        // displayed text (machine base number, "LINExx", or support label)
  num?: number;     // machine base number (kind === 'machine')
  color?: string;   // support block fill color (kind === 'support')
}

export interface WbRow { cells: WbCell[]; }

export interface WbZone {
  id: string;
  label: string;
  supervisor: string;
  rows: WbRow[];
}

`;

const body = `export const WB_FLOOR: WbZone[] = ${JSON.stringify(WB_FLOOR, null, 2)};\n`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + body, 'utf8');

console.log(`wrote ${path.relative(ROOT, OUT)}`);
console.log(`zones: ${WB_FLOOR.length}, base machine cells: ${machineCount}`);
