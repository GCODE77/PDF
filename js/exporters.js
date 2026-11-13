// 변환기: 페이지 분석 결과(layout.js) → Word · PPT · 엑셀 · HTML · 마크다운 · 텍스트 · CSV (© 2026 GLORY KIM)
import { analyzePage } from './layout.js';

const esc = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tw = pt => Math.round(pt * 20);
const emu = pt => Math.round(pt * 12700);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex6 = c => (c || '#000000').replace('#', '').toUpperCase().padStart(6, '0').slice(0, 6);
const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const FORMATS = {
  docx: { ext: 'docx', mime: DOCX_MIME, label: 'Word (DOCX)' },
  pptx: { ext: 'pptx', mime: PPTX_MIME, label: 'PowerPoint (PPTX)' },
  xlsx: { ext: 'xlsx', mime: XLSX_MIME, label: '엑셀 (XLSX)' },
  html: { ext: 'html', mime: 'text/html;charset=utf-8', label: '웹 페이지 (HTML)' },
  md: { ext: 'md', mime: 'text/markdown;charset=utf-8', label: '마크다운 (AI용)' },
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8', label: '표만 CSV' },
  txt: { ext: 'txt', mime: 'text/plain;charset=utf-8', label: '텍스트 (TXT)' },
};

const paraRuns = p => (p.segs ? p.segs.flatMap(s => s.runs) : p.runs);
const paraText = p => p.text.replace(/\t/g, ' ');
const textBlocks = (text, W, H) => {
  const blocks = [];
  let y = 54;
  for (const line of String(text || '').split(/\n/)) {
    if (!line.trim()) { y += 10; continue; }
    const run = { key: 'ocr', text: line, size: 11, font: { family: null, ko: true }, bold: false, italic: false, color: '#000000' };
    blocks.push({ type: 'p', lines: [{ by: y + 11, size: 11, segs: [] }], runs: [run], align: 'left', x: 54, x1: Math.min(W - 54, 54 + line.length * 7), first: 0, size: 11, pitch: 16, by0: y + 11, byN: y + 11, top: y, bottom: y + 14, text: line });
    y += 16;
  }
  return blocks;
};

// 모든 페이지를 분석한다. 글이 없는 쪽은 ocr(index) 로 글자를 얻어 문단으로 만든다
export async function analyzeAll(pdf, lib, idx, { onProgress, cancelled, stopped, ocr, images = true, imageMeta = false, color = true, wholePage = false } = {}) {
  const out = [], imgCache = new Map();
  for (let n = 0; n < idx.length; n++) {
    if (cancelled?.()) throw new Error('취소되었습니다');
    if (stopped?.()) break;
    onProgress?.(`${n + 1} / ${idx.length} 페이지 분석 중`, n / idx.length);
    let m = await analyzePage(pdf, lib, idx[n] + 1, { images, imageMeta, imgCache, color, wholePage });
    if (!m.textLen && ocr && !m.pageImage) {
      onProgress?.(`${n + 1} / ${idx.length} 페이지 글자 인식(OCR) 중…`, n / idx.length);
      const t = await ocr(idx[n]);
      if (t) { m = { ...m, blocks: textBlocks(t, m.w, m.h), ocr: true }; }
    }
    out.push(m);
  }
  return out;
}

// ======================== TXT / MD / CSV ========================
const tableRows = t => {
  const nr = t.ys.length - 1, nc = t.xs.length - 1;
  const g = Array.from({ length: nr }, () => Array(nc).fill(''));
  for (const c of t.cells) g[c.r][c.c] = c.paras.map(paraText).join(' ');
  return g;
};
export function toTxt(pages) {
  return pages.map(pg => {
    const out = [];
    for (const b of pg.blocks) {
      if (b.type === 'p') out.push(b.text);
      else if (b.type === 'table') out.push(tableRows(b).map(r => r.join('\t')).join('\n'));
    }
    return out.join('\n\n');
  }).join('\n\n\f\n\n').replace(/\f/g, '────────').replace(/\r/g, '');
}
export function toMd(pages) {
  const sizes = pages.flatMap(pg => pg.blocks.filter(b => b.type === 'p').map(b => b.size));
  const body = sizes.length ? sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : 11;
  return pages.map(pg => pg.blocks.map(b => {
    if (b.type === 'p') {
      const t = paraText(b);
      const bold = paraRuns(b).every(r => r.bold);
      if (b.size >= body * 1.6) return '# ' + t;
      if (b.size >= body * 1.3) return '## ' + t;
      if (b.size >= body * 1.12 && bold) return '### ' + t;
      return bold && t.length < 80 ? `**${t}**` : t;
    }
    if (b.type === 'table') {
      const r = tableRows(b).map(x => x.map(v => v.replace(/\|/g, '\\|')));
      const head = '| ' + r[0].join(' | ') + ' |', sep = '| ' + r[0].map(() => '---').join(' | ') + ' |';
      return [head, sep, ...r.slice(1).map(x => '| ' + x.join(' | ') + ' |')].join('\n');
    }
    return '';
  }).filter(Boolean).join('\n\n')).join('\n\n---\n\n');
}
export function toCsv(pages) {
  const q = v => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const parts = [];
  pages.forEach((pg, i) => pg.blocks.filter(b => b.type === 'table').forEach((t, k) => { parts.push(`# ${i + 1}쪽 표 ${k + 1}\n` + tableRows(t).map(r => r.map(q).join(',')).join('\n')); }));
  if (!parts.length) throw new Error('표를 찾지 못했습니다. 표가 없는 문서는 TXT·Word로 변환해 보세요.');
  return parts.join('\n\n');
}

// ======================== HTML ========================
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const runHtml = r => {
  const st = [`font-size:${r.size.toFixed(1)}pt`, `color:${r.color}`];
  if (r.font?.family) st.push(`font-family:'${r.font.family}','맑은 고딕',sans-serif`);
  let h = `<span style="${st.join(';')}">${esc(r.text).replace(/\t/g, '&emsp;')}</span>`;
  if (r.bold) h = `<b>${h}</b>`;
  if (r.italic) h = `<i>${h}</i>`;
  return h;
};
const paraHtml = p => {
  const runs = paraRuns(p);
  const body = p.segs ? p.segs.map(s => s.runs.map(runHtml).join('')).join('<span style="display:inline-block;width:2em"></span>') : runs.map(runHtml).join('');
  return `<p style="text-align:${p.align};margin:0 0 ${Math.max(2, p.size * 0.5).toFixed(0)}pt ${p.align === 'left' ? Math.max(0, p.x - 40).toFixed(0) : 0}pt;line-height:${(p.pitch / p.size).toFixed(2)}">${body}</p>`;
};
export function toHtml(pages, title) {
  const out = pages.map((pg, i) => {
    const parts = pg.blocks.map(b => {
      if (b.type === 'p') return paraHtml(b);
      if (b.type === 'img') return `<p><img alt="" src="data:${b.data.mime};base64,${b64(b.data.data)}" style="max-width:100%;width:${b.w.toFixed(0)}pt"></p>`;
      const grid = [];
      const skip = new Set();
      const rows = [];
      for (let r = 0; r < b.ys.length - 1; r++) {
        const tds = [];
        for (let c = 0; c < b.xs.length - 1; c++) {
          if (skip.has(r + ',' + c)) continue;
          const cell = b.cells.find(x => x.r === r && x.c === c);
          if (!cell) continue;
          for (let a = 0; a < cell.rs; a++) for (let d = 0; d < cell.cs; d++) if (a || d) skip.add((r + a) + ',' + (c + d));
          const st = (cell.fill ? `background:${cell.fill};` : '') + 'padding:3px 6px;vertical-align:top;' + (b.ruled ? 'border:1px solid #333;' : '');
          tds.push(`<td${cell.rs > 1 ? ` rowspan="${cell.rs}"` : ''}${cell.cs > 1 ? ` colspan="${cell.cs}"` : ''} style="${st}width:${(cell.x1 - cell.x).toFixed(0)}pt">${cell.paras.map(paraHtml).join('')}</td>`);
        }
        rows.push(`<tr>${tds.join('')}</tr>`);
      }
      void grid;
      return `<table style="border-collapse:collapse;margin:0 0 12pt">${rows.join('')}</table>`;
    });
    return `<section class="pg"><div class="no">${i + 1}쪽</div>${parts.join('\n')}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:'맑은 고딕',sans-serif;background:#eef0f3;margin:0;padding:16px}.pg{background:#fff;max-width:820px;margin:0 auto 16px;padding:40px 48px;box-shadow:0 1px 6px #0002;border-radius:4px}.no{font:12px sans-serif;color:#889;text-align:right;margin-bottom:8px}</style></head><body>${out}</body></html>`;
}

// ======================== DOCX ========================
const rFonts = r => {
  const f = r.font?.family, asc = f || '맑은 고딕', ea = r.font?.ko ? f : '맑은 고딕';
  return `<w:rFonts w:ascii="${esc(asc)}" w:hAnsi="${esc(asc)}" w:eastAsia="${esc(ea)}" w:cs="${esc(asc)}"/>`;
};
const wRun = r => {
  const pr = `<w:rPr>${rFonts(r)}${r.bold ? '<w:b/><w:bCs/>' : ''}${r.italic ? '<w:i/><w:iCs/>' : ''}<w:color w:val="${hex6(r.color)}"/><w:sz w:val="${Math.max(2, Math.round(r.size * 2))}"/><w:szCs w:val="${Math.max(2, Math.round(r.size * 2))}"/></w:rPr>`;
  return r.text.split('\t').map((t, i) => `${i ? `<w:r>${pr}<w:tab/></w:r>` : ''}${t ? `<w:r>${pr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : ''}`).join('');
};
function wPara(p, o) {
  // o: {ml, mr, W, prevBottom, cellLeft}
  const pitch = Math.max(p.pitch, p.size * 1.15);
  const top = p.by0 - (pitch - 0.22 * p.size);
  const before = Math.max(0, top - o.prevBottom);
  const baseX = o.cellLeft ?? o.ml;
  let left = Math.max(0, p.x - baseX), right = 0, first = '';
  const multi = p.lines.length > 1;
  if (p.align !== 'left' || multi) right = Math.max(0, (o.W - o.mr) - p.x1 - (multi ? 6 : 0));
  if (o.cellRight != null && (p.align !== 'left' || multi)) right = Math.max(0, o.cellRight - p.x1 - (multi ? 6 : 0));
  if (p.first > 0.5) first = ` w:firstLine="${tw(p.first)}"`;
  else if (p.first < -0.5) { first = ` w:hanging="${tw(-p.first)}"`; left += -p.first; }
  let tabs = '';
  let runs;
  if (p.segs) {
    tabs = '<w:tabs>' + p.segs.slice(1).map(s => `<w:tab w:val="left" w:pos="${tw(s.x - baseX)}"/>`).join('') + '</w:tabs>';
    runs = p.segs.map((s, i) => (i ? `<w:r><w:tab/></w:r>` : '') + s.runs.map(wRun).join('')).join('');
  } else runs = p.runs.map(wRun).join('');
  const jc = p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : '';
  const xml = `<w:p><w:pPr>${tabs}<w:spacing w:before="${tw(before)}" w:after="0" w:line="${tw(pitch)}" w:lineRule="exact"/><w:ind w:left="${tw(left)}" w:right="${tw(right)}"${first}/>${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${runs}</w:p>`;
  return { xml, bottom: p.byN + 0.22 * p.size };
}
const emptyP = (h, extra = '') => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, tw(h))}" w:lineRule="exact"/>${extra}</w:pPr></w:p>`;

export async function buildDocx(pages, title, opts = {}) {
  const z = new window.JSZip();
  const rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
  const media = new Map();
  let imgN = 0, rid = 1, docId = 1;
  const imgRel = d => {
    if (!media.has(d)) {
      const name = `image${++imgN}.${d.ext}`, id = 'rId' + (++rid);
      media.set(d, { name, id });
      z.file('word/media/' + name, d.data);
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    }
    return media.get(d);
  };
  const body = [];
  pages.forEach((pg, pi) => {
    const bl = pg.blocks.filter(b => !(b.type === 'img' && b.bg && pg.textLen && !pg.ocr));
    const W = pg.w, H = pg.h;
    if (opts.layout !== 'flow') {
      // ── 원본 위치 그대로: 글 문단은 쪽 기준 고정 위치 틀, 표는 떠 있는 표, 그림은 쪽 기준 고정 그림으로 놓는다 ──
      const M = 18;
      const pics = bl.filter(b => b.type === 'img').map(b => {
        const rel = imgRel(b.data), id = docId++;
        return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(b.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(b.top)}</wp:posOffset></wp:positionV><wp:extent cx="${emu(b.w)}" cy="${emu(b.h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="그림 ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${rel.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(b.w)}" cy="${emu(b.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
      }).join('');
      body.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${pics}</w:p>`);
      const frame = (x, y, w, h, inner, jc, extraPPr = '') => `<w:p><w:pPr><w:framePr w:w="${tw(w)}" w:h="${tw(h)}" w:hRule="atLeast" w:hSpace="0" w:vSpace="0" w:wrap="around" w:vAnchor="page" w:hAnchor="page" w:x="${tw(x)}" w:y="${tw(y)}"/>${extraPPr}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${inner}</w:p>`;
      for (const b of bl) {
        if (b.type === 'p') {
          const pitch = Math.max(b.pitch, b.size * 1.15);
          const top = b.by0 - (pitch - 0.22 * b.size);
          const parts = b.segs ? b.segs.map(sg => ({ x: sg.x, x1: sg.x1, runs: sg.runs, lines: 1, align: 'left' })) : [{ x: b.x, x1: b.x1, runs: b.runs, lines: b.lines.length, align: b.align, first: b.first }];
          for (const q of parts) {
            const multi = q.lines > 1;
            const wText = q.x1 - q.x;
            let wF = multi ? wText + 6 : wText * 1.25 + b.size * 2, xF = q.x - 1;
            if (q.align === 'center') xF = (q.x + q.x1) / 2 - wF / 2; else if (q.align === 'right') xF = q.x1 - wF + 2;
            xF = Math.max(0, xF); wF = Math.min(wF, W - xF);
            const runs = q.runs.map(wRun).join('');
            if (!runs) continue;
            const ind = !multi || !(q.first > 0.5) ? '' : `<w:ind w:firstLine="${tw(q.first)}"/>`;
            body.push(frame(xF, top, Math.max(10, wF), q.lines * pitch + 2, runs, q.align === 'center' ? 'center' : q.align === 'right' ? 'right' : '', `<w:spacing w:before="0" w:after="0" w:line="${tw(pitch)}" w:lineRule="exact"/>${ind}`));
          }
        } else if (b.type === 'table') {
          body.push(wTable(b, { ml: 0, mr: 0, W, floatPos: true }));
        }
      }
      const sectF = `<w:sectPr><w:pgSz w:w="${tw(W)}" w:h="${tw(H)}"${W > H ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(M)}" w:right="${tw(M)}" w:bottom="${tw(M)}" w:left="${tw(M)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
      if (pi < pages.length - 1) body.push(emptyP(1, sectF)); else body.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`, sectF);
      return;
    }
    const xs0 = bl.map(b => b.x), xs1 = bl.map(b => b.type === 'p' ? b.x1 : b.type === 'table' ? b.x1 : b.x1);
    const ml = bl.length ? clamp(Math.floor(Math.min(...xs0)), 0, W * 0.4) : 54;
    const mr = bl.length ? clamp(Math.floor(W - Math.max(...xs1)), 0, W * 0.4) : 54;
    const mt = bl.length ? clamp(Math.floor(Math.min(...bl.map(b => b.top)) - 1), 0, H * 0.5) : 54;
    const mb = 12;
    let prev = mt;
    const o = { ml, mr, W, prevBottom: prev };
    for (const b of bl) {
      o.prevBottom = prev;
      if (b.type === 'p') {
        const r = wPara(b, o);
        body.push(r.xml); prev = r.bottom;
      } else if (b.type === 'img') {
        let wPt = Math.min(b.w, W - ml - mr), hPt = b.h * (wPt / b.w);
        const maxH = H - mt - mb - 10;                 // 쪽을 넘지 않게
        if (hPt > maxH) { wPt *= maxH / hPt; hPt = maxH; }
        const rel = imgRel(b.data);
        const id = docId++;
        const before = Math.max(0, b.top - prev);
        body.push(`<w:p><w:pPr><w:spacing w:before="${tw(before)}" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="${tw(Math.max(0, b.x - ml))}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(wPt)}" cy="${emu(hPt)}"/><wp:docPr id="${id}" name="그림 ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${rel.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(wPt)}" cy="${emu(hPt)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
        prev = b.top + hPt;
      } else if (b.type === 'table') {
        const gap = b.top - prev;
        if (gap > 1.5) body.push(emptyP(gap));
        body.push(wTable(b, o));
        prev = b.bottom;
      }
    }
    const sect = `<w:sectPr><w:pgSz w:w="${tw(W)}" w:h="${tw(H)}"${W > H ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(mt)}" w:right="${tw(mr)}" w:bottom="${tw(mb)}" w:left="${tw(ml)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
    if (pi < pages.length - 1) body.push(emptyP(1, sect));
    else body.push(sect);
  });
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  z.file('[Content_Types].xml', `${XMLH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  z.file('_rels/.rels', `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/_rels/document.xml.rels', `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  z.file('word/styles.xml', `${XMLH}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`);
  z.file('word/document.xml', `${XMLH}<w:document ${NS}><w:body>${body.join('')}</w:body></w:document>`);
  void title;
  return z.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
}

function wTable(t, o) {
  const nr = t.ys.length - 1, nc = t.xs.length - 1;
  const grid = t.xs.slice(0, -1).map((x, i) => `<w:gridCol w:w="${tw(t.xs[i + 1] - x)}"/>`).join('');
  const bd = t.ruled ? ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('') : ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="nil"/>`).join('');
  const at = (r, c) => t.cells.find(x => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);
  const rows = [];
  for (let r = 0; r < nr; r++) {
    const tcs = [];
    for (let c = 0; c < nc; c++) {
      const cell = at(r, c);
      if (!cell) { tcs.push(`<w:tc><w:tcPr><w:tcW w:w="${tw(t.xs[c + 1] - t.xs[c])}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`); continue; }
      if (cell.c !== c) continue;                    // 가로로 합쳐진 칸은 시작 칸에서 한 번만 쓴다
      const w = tw(cell.x1 - cell.x);
      const pr = `<w:tcW w:w="${w}" w:type="dxa"/>${cell.cs > 1 ? `<w:gridSpan w:val="${cell.cs}"/>` : ''}${cell.rs > 1 ? `<w:vMerge${cell.r === r ? ' w:val="restart"' : ''}/>` : ''}${cell.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex6(cell.fill)}"/>` : ''}`;
      let inner = '';
      if (cell.r === r) {
        let prev = cell.y;
        const oo = { ...o, cellLeft: cell.x + 2, cellRight: cell.x1 - 2, prevBottom: cell.y };
        for (const p of cell.paras) {
          oo.prevBottom = prev;
          const res = wPara({ ...p, x: Math.max(p.x, cell.x + 2) }, oo);
          inner += res.xml; prev = res.bottom;
        }
      }
      tcs.push(`<w:tc><w:tcPr>${pr}</w:tcPr>${inner || '<w:p/>'}</w:tc>`);
    }
    rows.push(`<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${tw(t.ys[r + 1] - t.ys[r])}" w:hRule="atLeast"/></w:trPr>${tcs.join('')}</w:tr>`);
  }
  const flo = o.floatPos ? `<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="${tw(t.x0 + 2)}" w:tblpY="${tw(t.y0)}"/><w:tblOverlap w:val="overlap"/>` : '';
  return `<w:tbl><w:tblPr>${flo}<w:tblW w:w="${tw(t.x1 - t.x0)}" w:type="dxa"/>${o.floatPos ? '' : `<w:tblInd w:w="${tw(Math.max(0, t.x0 - o.ml))}" w:type="dxa"/>`}<w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

// ======================== PPTX ========================
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const aRun = (r, scale = 1) => `<a:r><a:rPr lang="ko-KR" altLang="en-US" sz="${Math.max(100, Math.round(r.size * scale * 100))}"${r.bold ? ' b="1"' : ''}${r.italic ? ' i="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${hex6(r.color)}"/></a:solidFill><a:latin typeface="${esc(r.font?.family || '맑은 고딕')}"/><a:ea typeface="${esc(r.font?.ko && r.font.family ? r.font.family : '맑은 고딕')}"/></a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
const algn = a => (a === 'center' ? 'ctr' : a === 'right' ? 'r' : 'l');
const themeXml = `${XMLH}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

export async function buildPptx(pages) {
  const z = new window.JSZip();
  const W0 = pages[0]?.w || 595, H0 = pages[0]?.h || 842;
  const sw = emu(W0), sh = emu(H0);
  const ct = [];
  let imgN = 0;
  const imgFiles = new Map();
  pages.forEach((pg, i) => {
    const f = Math.min(W0 / pg.w, H0 / pg.h), ox = (W0 - pg.w * f) / 2, oy = (H0 - pg.h * f) / 2;
    const X = v => emu(v * f + ox), Y = v => emu(v * f + oy), L = v => emu(v * f);
    let id = 2;
    const slideRels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'];
    let rid = 1;
    const shapes = [];
    const txBox = (x, top, w, h, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="텍스트 ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${X(x)}" y="${Y(top)}"/><a:ext cx="${L(w)}" cy="${L(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
    const aPara = (p, runs, scale) => `<a:p><a:pPr algn="${algn(p.align)}"${p.first > 0.5 ? ` indent="${L(p.first)}"` : ''}><a:lnSpc><a:spcPts val="${Math.round(Math.max(p.pitch, p.size * 1.15) * f * 100)}"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef></a:pPr>${runs.map(r => aRun(r, scale)).join('')}</a:p>`;
    for (const b of pg.blocks) {
      if (b.type === 'p') {
        const pitch = Math.max(b.pitch, b.size * 1.15);
        const top = b.by0 - (pitch - 0.22 * b.size);
        if (b.segs) b.segs.forEach(s => shapes.push(txBox(s.x, top, s.x1 - s.x + b.size * 2, pitch + 2, aPara({ ...b, first: 0, align: 'left' }, s.runs, f))));
        else {
          const w = (b.x1 - b.x) * 1.05 + b.size * 0.5;
          shapes.push(txBox(b.x, top, w, (b.byN - b.by0) + pitch + 2, aPara({ ...b, first: 0 }, b.runs, f)));
        }
      } else if (b.type === 'img') {
        if (b.bg && pg.textLen && !pg.ocr) continue;
        let name = imgFiles.get(b.data);
        if (!name) { name = `image${++imgN}.${b.data.ext}`; imgFiles.set(b.data, name); z.file('ppt/media/' + name, b.data.data); }
        const rid2 = 'rId' + (++rid);
        slideRels.push(`<Relationship Id="${rid2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
        shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="그림 ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid2}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${X(b.x)}" y="${Y(b.top)}"/><a:ext cx="${L(b.w)}" cy="${L(b.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
      } else if (b.type === 'table') {
        const nr = b.ys.length - 1, nc = b.xs.length - 1;
        const at = (r, c) => b.cells.find(x => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);
        const ln = (k) => b.ruled ? `<a:${k} w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:${k}>` : `<a:${k} w="0"><a:noFill/></a:${k}>`;
        const rows = [];
        for (let r = 0; r < nr; r++) {
          const tcs = [];
          for (let c = 0; c < nc; c++) {
            const cell = at(r, c);
            if (!cell) { tcs.push('<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></a:txBody><a:tcPr/></a:tc>'); continue; }
            const attrs = (cell.cs > 1 && cell.c === c ? ` gridSpan="${cell.cs}"` : '') + (cell.rs > 1 && cell.r === r ? ` rowSpan="${cell.rs}"` : '') + (cell.c !== c ? ' hMerge="1"' : '') + (cell.r !== r ? ' vMerge="1"' : '');
            const paras = cell.r === r && cell.c === c && cell.paras.length ? cell.paras.map(p => `<a:p><a:pPr algn="${algn(p.align)}"/>${paraRuns(p).map(x => aRun(x, f)).join('')}</a:p>`).join('') : '<a:p><a:endParaRPr lang="ko-KR"/></a:p>';
            tcs.push(`<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${paras}</a:txBody><a:tcPr marL="${L(2)}" marR="${L(2)}" marT="${L(1)}" marB="${L(1)}" anchor="t">${ln('lnL')}${ln('lnR')}${ln('lnT')}${ln('lnB')}${cell.fill ? `<a:solidFill><a:srgbClr val="${hex6(cell.fill)}"/></a:solidFill>` : '<a:noFill/>'}</a:tcPr></a:tc>`);
          }
          rows.push(`<a:tr h="${L(b.ys[r + 1] - b.ys[r])}">${tcs.join('')}</a:tr>`);
        }
        shapes.push(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id++}" name="표 ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${X(b.x0)}" y="${Y(b.y0)}"/><a:ext cx="${L(b.x1 - b.x0)}" cy="${L(b.y1 - b.y0)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${b.xs.slice(0, -1).map((x, k) => `<a:gridCol w="${L(b.xs[k + 1] - x)}"/>`).join('')}</a:tblGrid>${rows.join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
      }
    }
    z.file(`ppt/slides/slide${i + 1}.xml`, `${XMLH}<p:sld ${A_NS}><p:cSld>${emptyTree}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    z.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRels.join('')}</Relationships>`);
    ct.push(`<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
  });
  const n = pages.length;
  z.file('[Content_Types].xml', `${XMLH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${ct.join('')}</Types>`);
  z.file('_rels/.rels', `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  z.file('ppt/presentation.xml', `${XMLH}<p:presentation ${A_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${sw}" cy="${sh}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  z.file('ppt/_rels/presentation.xml.rels', `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${pages.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);
  z.file('ppt/slideMasters/slideMaster1.xml', `${XMLH}<p:sldMaster ${A_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`);
  z.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  z.file('ppt/slideLayouts/slideLayout1.xml', `${XMLH}<p:sldLayout ${A_NS} type="blank" preserve="1"><p:cSld name="빈 화면">${emptyTree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  z.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  z.file('ppt/theme/theme1.xml', themeXml);
  return z.generateAsync({ type: 'blob', mimeType: PPTX_MIME, compression: 'DEFLATE' });
}

// ======================== XLSX ========================
// 원본 쪽의 위치를 그대로 살리기 위해, 쪽 안의 모든 칸 경계(표의 줄·글 시작·그림 모서리)를 모아 하나의 격자를 만들고
// 열 너비 · 행 높이를 pt 에 맞춘 뒤, 표 칸·문단을 그 격자 위에 (병합 셀로) 놓고 그림은 셀에 붙여 둔다.
const colName = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const isNum = s => /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s) && !/^0\d/.test(s.replace(/,/g, '')) && (!/,/.test(s) || /^[-+]?\d{1,3}(,\d{3})+$/.test(s));

class Axis {
  constructor() { this.b = []; }
  add(v, tol) {
    if (!(v >= 0)) v = 0;
    for (const x of this.b) if (Math.abs(x - v) <= tol) return;
    this.b.push(v);
  }
  done() { this.b.sort((p, q) => p - q); return this; }
  idx(v) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < this.b.length; i++) { const d = Math.abs(this.b[i] - v); if (d < bd) { bd = d; bi = i; } else if (this.b[i] > v) break; }
    return bi;
  }
}

export async function buildXlsx(pages) {
  const z = new window.JSZip();
  const fonts = [], fills = [], xfs = [];
  const fontIdx = f => {
    const k = [f.size, f.bold ? 1 : 0, f.italic ? 1 : 0, f.color, f.name].join('|');
    let i = fonts.findIndex(x => x.k === k);
    if (i < 0) { fonts.push({ ...f, k }); i = fonts.length - 1; }
    return i;
  };
  fontIdx({ size: 11, bold: false, italic: false, color: '000000', name: '맑은 고딕' });
  const xfIdx = o => {
    const k = JSON.stringify(o);
    let i = xfs.findIndex(x => x.k === k);
    if (i < 0) { if (o.fill && !fills.includes(o.fill)) fills.push(o.fill); xfs.push({ ...o, k }); i = xfs.length - 1; }
    return i;
  };
  xfIdx({ font: 0, fill: null, border: false, h: null, v: 'top', wrap: false, fmt: 0 });
  const fontOf = r => ({ size: Math.max(6, Math.min(72, Math.round((r.size || 11) * 2) / 2)), bold: !!r.bold, italic: !!r.italic, color: hex6(r.color), name: (r.font?.family) || '맑은 고딕' });
  const mediaFiles = [];                 // {name, data}
  const mediaOf = new Map();
  const sheets = [];

  pages.forEach((pg, pi) => {
    const tables = pg.blocks.filter(b => b.type === 'table');
    const paras = pg.blocks.filter(b => b.type === 'p');
    const imgs = pg.blocks.filter(b => b.type === 'img' && b.data && !(b.bg && pg.textLen && !pg.ocr));
    // ---- 격자 경계 모으기 ----
    let xtol = 8, ytol = 3, ax, ay;
    for (let tries = 0; tries < 5; tries++) {
      ax = new Axis(); ay = new Axis();
      for (const t of tables) { t.xs.forEach(x => ax.add(x, 1.5)); t.ys.forEach(y => ay.add(y, 1.5)); }
      for (const m of imgs) { ax.add(m.x, 2); ax.add(m.x1, 2); ay.add(m.top, 2); ay.add(m.bottom, 2); }
      for (const p of paras) {
        if (p.segs) p.segs.forEach(s => { ax.add(s.x, xtol); ax.add(s.x1 + 1, xtol); }); else { ax.add(p.x, xtol); ax.add(p.x1 + 1, xtol); }
        ay.add(p.top, ytol); ay.add(p.bottom, ytol);
      }
      if (ax.b.length <= 160 && ay.b.length <= 900) break;
      xtol *= 1.6; ytol *= 1.6;
    }
    ax.done(); ay.done();
    if (ax.b.length < 2) ax.b.push((ax.b[0] || 0) + 20);
    if (ay.b.length < 2) ay.b.push((ay.b[0] || 0) + 20);
    const NC = ax.b.length - 1, NR = ay.b.length - 1;
    const cells = new Map();             // "r,c" -> {v, rich, s, num}
    const busy = new Set();
    const merges = [];
    const style = o => xfIdx({ font: 0, fill: null, border: false, h: null, v: 'top', wrap: false, fmt: 0, ...o });
    // 범위 [r0,r1) x [c0,c1) 에 내용 놓기 (겹치면 병합하지 않고 왼쪽 위 칸만)
    const place = (r0, r1, c0, c1, content, st) => {
      r0 = Math.max(0, Math.min(NR - 1, r0)); c0 = Math.max(0, Math.min(NC - 1, c0));
      r1 = Math.max(r0 + 1, Math.min(NR, r1)); c1 = Math.max(c0 + 1, Math.min(NC, c1));
      let free = true;
      for (let r = r0; r < r1 && free; r++) for (let c = c0; c < c1; c++) if (busy.has(r + ',' + c)) { free = false; break; }
      if (!free) { r1 = r0 + 1; c1 = c0 + 1; if (busy.has(r0 + ',' + c0)) return; }
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { busy.add(r + ',' + c); cells.set(r + ',' + c, { s: st.s, v: '' }); }
      if (content && (content.v || content.rich)) cells.set(r0 + ',' + c0, { ...content, s: st.s });
      if (r1 - r0 > 1 || c1 - c0 > 1) merges.push(`${colName(c0)}${r0 + 1}:${colName(c1 - 1)}${r1}`);
    };
    const contentOf = (ps) => {
      // ps: 문단 목록 → {v, rich, num, fmt}
      const rs = [];
      ps.forEach((p, i) => { if (i) rs.push({ text: '\n', size: p.size, bold: false, italic: false, color: '#000000', font: null }); (p.segs ? p.segs.flatMap(s => s.runs) : p.runs).forEach(r => rs.push(r)); });
      const text = rs.map(r => r.text).join('').replace(/\t/g, ' ');
      if (!text.trim()) return null;
      const styles = new Set(rs.filter(r => r.text !== '\n').map(r => [r.size, r.bold, r.italic, r.color, r.font?.family].join('|')));
      if (styles.size > 1) {
        const rich = rs.map(r => { const f = fontOf(r); return `<r><rPr><rFont val="${esc(f.name)}"/>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}<color rgb="FF${f.color}"/><sz val="${f.size}"/></rPr><t xml:space="preserve">${esc(r.text.replace(/\t/g, ' '))}</t></r>`; }).join('');
        const dom = rs.reduce((a, r) => (r.text.length > (a?.text.length || 0) ? r : a), null);
        return { v: text, rich, dom };
      }
      const dom = rs.find(r => r.text !== '\n') || rs[0];
      const t = text.trim();
      if (ps.length === 1 && isNum(t)) { const dec = (t.split('.')[1] || '').length; const comma = /,/.test(t); return { v: t.replace(/,/g, ''), num: true, fmt: comma ? (dec === 2 ? 4 : dec === 0 ? 3 : 0) : 0, dom, v0: t }; }
      return { v: text, dom };
    };
    const hOf = a => (a === 'center' ? 'center' : a === 'right' ? 'right' : null);

    // ---- 표 ----
    for (const t of tables) {
      for (const c of t.cells) {
        const r0 = ay.idx(t.ys[c.r]), r1 = ay.idx(t.ys[c.r + c.rs]), c0 = ax.idx(t.xs[c.c]), c1 = ax.idx(t.xs[c.c + c.cs]);
        const ct = contentOf(c.paras || []);
        let v = 'top';
        if (c.paras?.length) {
          const top = c.paras[0].top, bot = c.paras[c.paras.length - 1].bottom, h = c.y1 - c.y;
          if (h > 0 && Math.abs((top + bot) / 2 - (c.y + c.y1) / 2) < 0.2 * h) v = 'center';
        }
        const f = ct?.dom ? fontIdx(fontOf(ct.dom)) : 0;
        const multi = (c.paras?.length || 0) > 1 || (c.paras?.[0]?.lines?.length || 0) > 1;
        const s = style({ font: f, fill: c.fill ? hex6(c.fill) : null, border: !!t.ruled, h: hOf(c.paras?.[0]?.align), v, wrap: multi || (ct && ct.rich && /\n/.test(ct.v)), fmt: ct?.fmt || 0 });
        place(r0, r1, c0, c1, ct, { s });
      }
    }
    // ---- 문단 ----
    for (const p of paras) {
      const r0 = ay.idx(p.top), r1 = Math.max(r0 + 1, ay.idx(p.bottom));
      const parts = p.segs ? p.segs.map(s => ({ x: s.x, x1: s.x1 + 1, p: { ...p, segs: null, runs: s.runs, lines: [1] } })) : [{ x: p.x, x1: p.x1 + 1, p }];
      for (const q of parts) {
        const ct = contentOf([q.p]);
        if (!ct) continue;
        const c0 = ax.idx(q.x), c1 = Math.max(c0 + 1, ax.idx(q.x1));
        const f = ct.dom ? fontIdx(fontOf(ct.dom)) : 0;
        const s = style({ font: f, h: hOf(p.align), v: 'top', wrap: (p.lines?.length || 1) > 1, fmt: ct.fmt || 0 });
        place(r0, r1, c0, c1, ct, { s });
      }
    }
    // ---- 그림 ----
    const pics = imgs.map(m => {
      let name = mediaOf.get(m.data);
      if (!name) { name = `image${mediaFiles.length + 1}.${m.data.ext}`; mediaOf.set(m.data, name); mediaFiles.push({ name, data: m.data.data }); }
      return { name, c0: ax.idx(m.x), c1: Math.max(ax.idx(m.x) + 1, ax.idx(m.x1)), r0: ay.idx(m.top), r1: Math.max(ay.idx(m.top) + 1, ay.idx(m.bottom)), w: m.w, h: m.h };
    });
    const colW = Array.from({ length: NC }, (_, i) => Math.max(0.2, Math.round((((ax.b[i + 1] - ax.b[i]) * 96 / 72 - 5) / 7) * 100) / 100));
    const rowH = Array.from({ length: NR }, (_, i) => Math.max(1, Math.round((ay.b[i + 1] - ay.b[i]) * 4) / 4));
    sheets.push({ cells, merges, colW, rowH, NR, NC, pics, landscape: pg.w > pg.h, name: `${pi + 1}쪽` });
  });

  const sheetXml = (sh, hasDrawing) => {
    const cols = `<cols>${sh.colW.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
    const byRow = new Map();
    for (const [k, c] of sh.cells) { const [r, cc] = k.split(',').map(Number); (byRow.get(r) || byRow.set(r, []).get(r)).push([cc, c]); }
    let rowXml = '';
    for (let r = 0; r < sh.NR; r++) {
      const list = (byRow.get(r) || []).sort((a, b) => a[0] - b[0]);
      const cx = list.map(([cc, c]) => {
        const ref = colName(cc) + (r + 1);
        if (c.rich) return `<c r="${ref}" s="${c.s}" t="inlineStr"><is>${c.rich}</is></c>`;
        if (!c.v) return `<c r="${ref}" s="${c.s}"/>`;
        if (c.num) return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
        return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
      }).join('');
      rowXml += `<row r="${r + 1}" ht="${sh.rowH[r]}" customHeight="1">${cx}</row>`;
    }
    return `${XMLH}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowXml}</sheetData>${sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}<pageMargins left="0.4" right="0.4" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="1"/>${hasDrawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
  };
  const drawingXml = sh => {
    const body = sh.pics.map((p, i) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${p.c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${p.c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="그림 ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(p.w)}" cy="${emu(p.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`).join('');
    return `${XMLH}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${body}</xdr:wsDr>`;
  };
  const ctDraw = [];
  sheets.forEach((sh, i) => {
    z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, sh.pics.length > 0));
    if (sh.pics.length) {
      z.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`);
      z.file(`xl/drawings/drawing${i + 1}.xml`, drawingXml(sh));
      z.file(`xl/drawings/_rels/drawing${i + 1}.xml.rels`, `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sh.pics.map((p, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${p.name}"/>`).join('')}</Relationships>`);
      ctDraw.push(`<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    }
  });
  mediaFiles.forEach(m => z.file('xl/media/' + m.name, m.data));
  const fontXml = fonts.map(f => `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}<sz val="${f.size}"/><color rgb="FF${f.color}"/><name val="${esc(f.name)}"/><family val="2"/></font>`).join('');
  const fillXml = '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' + fills.map(f => `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
  const xfXml = xfs.map(x => `<xf numFmtId="${x.fmt || 0}" fontId="${x.font}" fillId="${x.fill ? 2 + fills.indexOf(x.fill) : 0}" borderId="${x.border ? 1 : 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="${x.v || 'top'}"${x.h ? ` horizontal="${x.h}"` : ''}${x.wrap ? ' wrapText="1"' : ''}/></xf>`).join('');
  z.file('xl/styles.xml', `${XMLH}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fontXml}</fonts><fills count="${2 + fills.length}">${fillXml}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfXml}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  z.file('xl/workbook.xml', `${XMLH}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('[Content_Types].xml', `${XMLH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${ctDraw.join('')}</Types>`);
  z.file('_rels/.rels', `${XMLH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  return z.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
}

// ======================== 한 번에 변환 ========================
// kind: docx | pptx | xlsx | html | md | csv | txt   → { blob, ext }
export async function exportPages(kind, pdf, lib, idx, opts = {}) {
  const pages = await analyzeAll(pdf, lib, idx, { ...opts, images: opts.images !== false && (kind === 'docx' || kind === 'pptx' || kind === 'html' || kind === 'xlsx') });
  opts.onProgress?.('파일을 만드는 중…', 1);
  const title = opts.title || '문서';
  const T = s => new Blob(['﻿' + s], { type: FORMATS[kind].mime });
  if (!pages.some(p => p.blocks.length)) throw new Error('변환할 내용을 찾지 못했습니다. 스캔 문서라면 OCR 옵션을 켜 주세요.');
  if (kind === 'docx') return { blob: await buildDocx(pages, title, { layout: opts.layout }), ext: 'docx' };
  if (kind === 'pptx') return { blob: await buildPptx(pages), ext: 'pptx' };
  if (kind === 'xlsx') return { blob: await buildXlsx(pages), ext: 'xlsx' };
  if (kind === 'html') return { blob: T(toHtml(pages, title)), ext: 'html' };
  if (kind === 'md') return { blob: T(toMd(pages)), ext: 'md' };
  if (kind === 'csv') return { blob: T(toCsv(pages)), ext: 'csv' };
  return { blob: T(toTxt(pages)), ext: 'txt' };
}
