// AI가 잘 읽도록 PDF → 마크다운 변환 (제목·목록·표 구조 · 머리글/쪽번호 제거 · 스캔은 OCR · 쪽 표시 · 나누기 · 여러 파일) (© 2026 GLORY KIM)
import { S, h, icon, toast, busy, modal, download, pickFiles, readBytes, baseName, fmtSize, parseRange } from './state.js';
import * as D from './doc.js';
import { analyzeAll } from './exporters.js';
import { needDoc, err, row, opt, seg } from './tools.js';

// ---------- 글 구조 인식 규칙 ----------
const BULLET = /^([•·‣●○◦■□▪▫◆◇▶▷※★☆➢➤\-–—*])\s+(.*)$/;
const NUMBERED = [/^(\d{1,3}[.)])\s+(.*)$/, /^(\(\d{1,3}\))\s*(.*)$/, /^([가-하][.)])\s+(.*)$/, /^([①-⑳])\s*(.*)$/, /^([ⅰ-ⅹⅠ-Ⅹ][.)])\s+(.*)$/];
const ARTICLE = /^제\s*\d+\s*(조|장|절|편|항)(\s|\(|$|\[)/;
const PAGENUM = /^[\s\-–—·•]*(?:page|p\.|쪽)?\s*\d{1,4}\s*(?:\/|of)?\s*\d{0,4}\s*(?:page|쪽|p\.)?[\s\-–—·•]*$/i;
const normKey = t => t.replace(/\s+/g, ' ').replace(/\d+/g, '#').trim();
const oneLine = t => t.replace(/\t/g, '   ').replace(/[  ]+/g, ' ').trim();

function bodySize(pages) {
  const m = new Map();
  for (const pg of pages) for (const b of pg.blocks) if (b.type === 'p') { const k = Math.round(b.size * 2) / 2; m.set(k, (m.get(k) || 0) + b.text.length); }
  let best = 11, bn = -1;
  for (const [k, v] of m) if (v > bn) { bn = v; best = k; }
  return best;
}
// 쪽마다 같은 자리에 반복되는 머리글·바닥글
function findRepeats(pages) {
  const cnt = new Map();
  for (const pg of pages) {
    const seen = new Set();
    for (const b of pg.blocks) if (b.type === 'p' && (b.top < pg.h * 0.09 || b.bottom > pg.h * 0.91)) {
      const k = normKey(b.text); if (k && !seen.has(k)) { seen.add(k); cnt.set(k, (cnt.get(k) || 0) + 1); }
    }
  }
  const need = Math.max(3, Math.ceil(pages.length * 0.4));
  return new Set([...cnt].filter(([, v]) => v >= need).map(([k]) => k));
}
const headingLevel = (b, body, text) => {
  if (text.length > 90) return 0;
  const allBold = (b.runs || b.segs?.flatMap(s => s.runs) || []).every(r => r.bold || !r.text.trim());
  if (b.size >= body * 1.55) return 1;
  if (b.size >= body * 1.3) return 2;
  if (ARTICLE.test(text) && text.length < 70) return /^제\s*\d+\s*[장절편]/.test(text) ? 2 : 3;
  if (b.size >= body * 1.12 && allBold && text.length <= 70) return 3;
  if (allBold && text.length <= 40 && b.lines.length === 1 && !/[.。다]$/.test(text) && !BULLET.test(text) && b.align === 'center') return 3;
  return 0;
};
const mdInline = b => {
  const runs = b.segs ? b.segs.flatMap((s, i) => (i ? [{ text: '   ', bold: false }, ...s.runs] : s.runs)) : b.runs;
  const total = runs.reduce((a, r) => a + r.text.trim().length, 0) || 1;
  const bold = runs.filter(r => r.bold).reduce((a, r) => a + r.text.trim().length, 0);
  if (bold / total > 0.6) return oneLine(runs.map(r => r.text).join(''));        // 거의 전부 굵으면 강조 표시 생략
  return oneLine(runs.map(r => {
    const t = r.text;
    if (!r.bold || t.trim().length < 2) return t;
    const m = /^(\s*)(.*?)(\s*)$/s.exec(t);
    return m[1] + '**' + m[2] + '**' + m[3];
  }).join(''));
};
const escLead = t => (/^(#{1,6}\s|>\s|\+\s|=+$|-{3,}$)/.test(t) ? '\\' + t : t);

function tableMd(t) {
  const nr = t.ys.length - 1, nc = t.xs.length - 1;
  const g = Array.from({ length: nr }, () => Array(nc).fill(''));
  for (const c of t.cells) {
    const txt = c.paras.map(p => oneLine(p.text)).filter(Boolean).join('<br>');
    for (let a = 0; a < c.rs; a++) for (let d = 0; d < c.cs; d++) if (c.r + a < nr && c.c + d < nc) g[c.r + a][c.c + d] = d === 0 ? txt : '';   // 세로로 합친 칸은 아래 줄에도 반복
  }
  let rows = g.filter(r => r.some(v => v));
  const keep = Array.from({ length: nc }, (_, j) => rows.some(r => r[j]));
  rows = rows.map(r => r.filter((_, j) => keep[j]));
  if (!rows.length) return '';
  if (rows[0].length === 1) return rows.map(r => r[0]).join('\n\n');             // 한 칸짜리 상자는 일반 글로
  const e = v => v.replace(/\|/g, '\\|');
  const head = '| ' + rows[0].map(e).join(' | ') + ' |', sep = '| ' + rows[0].map(() => '---').join(' | ') + ' |';
  return [head, sep, ...rows.slice(1).map(r => '| ' + r.map(e).join(' | ') + ' |')].join('\n');
}

// 쪽 하나 → 마크다운 (표시용 쪽 표지는 넣지 않음)
function pageMd(pg, o, ctx) {
  const out = [];
  let inList = false;
  const push = (line, list = false) => { if (!list || !inList) out.push(''); out.push(line); inList = list; };
  for (const b of pg.blocks) {
    if (b.type === 'p') {
      const text0 = oneLine(b.text);
      if (!text0) continue;
      if (o.stripHF) {
        const edge = b.top < pg.h * 0.09 || b.bottom > pg.h * 0.91;
        if (edge && (ctx.repeats.has(normKey(b.text)) || (text0.length <= 14 && PAGENUM.test(text0)))) continue;
      }
      const lvl = headingLevel(b, ctx.body, text0);
      if (lvl) { push('#'.repeat(lvl) + ' ' + text0.replace(/^[#\s]+/, ''), false); out.push(''); inList = false; ctx.heads.push({ lvl, text: text0, page: pg.num }); continue; }
      const mb = BULLET.exec(text0);
      if (mb) { push('- ' + oneLine(mb[2]), true); continue; }
      let nm = null;
      for (const re of NUMBERED) { const m = re.exec(text0); if (m) { nm = m; break; } }
      if (nm && text0.length < 400) { push('- ' + text0, true); continue; }
      push(escLead(mdInline(b)), false);
    } else if (b.type === 'table') {
      const t = tableMd(b);
      if (t) { push(t, false); out.push(''); inList = false; }
    } else if (b.type === 'img') {
      if (o.images === 'none' || b.bg || b.w < pg.w * 0.06 || b.h < pg.h * 0.03) continue;
      if (o.images === 'files' && b.data) {
        const name = `images/p${String(pg.num).padStart(3, '0')}_${ctx.imgFiles.length + 1}.${b.data.ext === 'jpeg' ? 'jpg' : 'png'}`;
        ctx.imgFiles.push([name, b.data.data]);
        push(`![그림 (${pg.num}쪽)](${name})`, false);
      } else push(`*[그림: ${pg.num}쪽]*`, false);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// OCR 글(문단은 빈 줄 기준)
const ocrMd = text => String(text || '').split(/\n{2,}/).map(p => {
  const lines = p.split('\n').map(l => l.replace(/ {2,}/g, ' ').trim()).filter(Boolean);
  if (!lines.length) return '';
  const avg = lines.reduce((x, l) => x + l.length, 0) / lines.length;
  return lines.length >= 3 && avg >= 35 ? lines.join(' ') : lines.join('\n');           // 줄글은 이어 붙이고, 양식처럼 짧은 줄은 줄바꿈 유지
}).filter(Boolean).join('\n\n');

// 파일 하나를 쪽별 마크다운으로 바꾼다. 반환 {pages:[{n,md}], imgFiles}
export async function convertPdfToMd(pdf, lib, idx, o, prog) {
  const pages = await analyzeAll(pdf, lib, idx, {
    images: o.images === 'files', imageMeta: o.images === 'place', color: false,
    cancelled: prog.cancelled, stopped: prog.stopped,
    onProgress: (t, p) => prog.set(t, p * (o.ocr ? 0.55 : 0.9)),
  });
  pages.forEach((pg, k) => { pg.num = idx[k] + 1; });
  const ctx = { body: bodySize(pages), repeats: o.stripHF ? findRepeats(pages) : new Set(), heads: [], imgFiles: [] };
  const mds = new Map();
  const need = [];
  pages.forEach((pg, k) => { if (!pg.textLen && !pg.blocks.some(b => b.type === 'p' || b.type === 'table')) need.push(k); });
  if (need.length && o.ocr && !prog.stopped?.()) {
    const O = await import('./ocrjob.js');
    prog.set('글자 인식 엔진을 준비하는 중… (처음 한 번은 시간이 걸립니다)');
    const pool = await O.makePool(o.lang || 'kor+eng', Math.min(O.workerCount(), need.length));
    let next = 0, done = 0;
    try {
      await Promise.all(pool.workers.map(async w => {
        while (!prog.cancelled?.() && !prog.stopped?.()) {
          const q = next++; if (q >= need.length) return;
          const k = need[q];
          const r = await O.ocrOnePage(pdf, idx[k], O.OCR_WIDTH.normal, w);
          mds.set(k, ocrMd(r.text));
          done++;
          prog.set(`${done} / ${need.length}장 스캔 쪽 글자 읽는 중 (OCR)`, 0.55 + 0.4 * done / need.length);
        }
      }));
    } finally { await pool.close(); }
  }
  const out = pages.map((pg, k) => {
    let md = mds.has(k) ? mds.get(k) : pageMd(pg, o, ctx);
    if (!md && need.includes(k) && !o.ocr) md = '*[스캔 이미지 쪽 — 글자 정보가 없어 읽지 못했습니다. 문자 인식(OCR)이 필요합니다]*';
    return { n: pg.num, md };
  });
  return { pages: out, heads: ctx.heads, imgFiles: ctx.imgFiles };
}

// ---------- 조립: 머리말 · 목차 · 쪽 표시 · 나누기 ----------
const today = () => new Date().toISOString().slice(0, 10);
const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
function marker(n, style) { return style === 'comment' ? `<!-- page: ${n} -->` : style === 'visible' ? `**[${n}쪽]**` : ''; }
export function assemble(name, res, o, total) {
  const base = baseName(name);
  let groups = [res.pages];
  if (o.split === 'pages') { const k = Math.max(1, o.splitN | 0); groups = []; for (let i = 0; i < res.pages.length; i += k) groups.push(res.pages.slice(i, i + k)); }
  else if (o.split === 'chars') {
    const lim = Math.max(5000, (o.splitN | 0) * 1000); groups = []; let cur = [], len = 0;
    for (const p of res.pages) { if (cur.length && len + p.md.length > lim) { groups.push(cur); cur = []; len = 0; } cur.push(p); len += p.md.length; }
    if (cur.length) groups.push(cur);
  }
  return groups.map((g, i) => {
    const first = g[0]?.n, last = g.at(-1)?.n;
    const parts = [];
    if (o.frontMatter) {
      parts.push(['---', `title: ${q(base)}`, `source: ${q(name)}`, `pages: ${q(first === last ? String(first) : `${first}-${last} / 전체 ${total}`)}`, groups.length > 1 ? `part: ${q(`${i + 1}/${groups.length}`)}` : null, `converted: ${today()}`, 'tool: PDF 공작소', '---'].filter(Boolean).join('\n'));
    }
    if (o.toc) {
      const heads = res.heads.filter(x => x.page >= first && x.page <= last && x.lvl <= 3);
      if (heads.length) parts.push('## 목차\n\n' + heads.map(x => `${'  '.repeat(x.lvl - 1)}- ${x.text.replace(/^제\s*/, '제')} (${x.page}쪽)`).join('\n'));
    }
    for (const p of g) { const m = marker(p.n, o.marks); parts.push((m ? m + '\n\n' : '') + (p.md || '*(내용 없음)*')); }
    const text = parts.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
    return { name: groups.length > 1 ? `${base}_part${String(i + 1).padStart(2, '0')}_${first}-${last}쪽.md` : base + '.md', text, from: first, to: last };
  });
}
const estTokens = t => { let ko = 0, other = 0; for (const ch of t) { if (/[ᄀ-ᇿ㄰-㆏가-힯㐀-鿿]/.test(ch)) ko++; else if (!/\s/.test(ch)) other++; } return Math.round(ko * 0.95 + other * 0.28); };

// ---------- 대화상자 ----------
export async function aiMarkdownDialog() {
  const files = [];                                   // {name, bytes?, current}
  if (S.pdf) { files.push({ name: S.name, current: true }); }
  const list = h('div', { class: 'flist' });
  const draw = () => {
    list.replaceChildren(...files.map((f, i) => h('div', { class: 'fitem' },
      h('span', { class: 'fico', html: icon('file') }), h('span', { class: 'fn' }, `${i + 1}. ${f.name}`, h('small', {}, f.current ? ' · 열려 있는 문서' : f.pages ? ` · ${f.pages}쪽` : '')),
      h('button', { class: 'icon-btn danger', 'aria-label': '제거', onclick: () => { files.splice(i, 1); draw(); }, html: icon('x') }))));
    if (!files.length) list.append(h('p', { class: 'empty' }, 'PDF 파일을 추가해 주세요 (여러 개 가능)'));
    single.hidden = files.length !== 1;
  };
  const add = async fl => {
    for (const f of fl) {
      try { const bytes = await readBytes(f); const n = (await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false })).getPageCount(); files.push({ name: f.name, bytes, pages: n }); }
      catch { toast(`'${f.name}' 파일을 열 수 없습니다 (암호 문서이거나 손상됨)`, 'err'); }
    }
    draw();
  };
  const chk = (label, on) => { const i = h('input', { type: 'checkbox', checked: on }); return { i, el: h('label', { class: 'chk' }, i, label) }; };
  const stripHF = chk('머리글·바닥글·쪽 번호 자동 제거 (AI가 헷갈리지 않게)', true);
  const ocr = chk('글자가 없는 스캔 쪽은 OCR로 읽기', true);
  const front = chk('문서 정보(제목·출처·쪽수) 머리말 넣기', true);
  const toc = chk('목차 만들기', false);
  const marks = h('select', { class: 'inp' }, opt('comment', '숨은 표시 <!-- page: 3 --> (읽기 방해 없음, 권장)'), opt('visible', '눈에 보이는 표시 **[3쪽]**'), opt('none', '표시 안 함'));
  const images = h('select', { class: 'inp' }, opt('place', '자리 표시만 *[그림: 3쪽]*'), opt('none', '그림은 모두 생략'), opt('files', '그림을 파일로 함께 저장 (ZIP)'));
  const split = h('select', { class: 'inp' }, opt('none', '나누지 않음 (한 파일)'), opt('pages', 'N쪽씩 나누기'), opt('chars', '글자 수로 나누기 (쪽 경계에서)'));
  const splitN = h('input', { class: 'inp', type: 'number', min: 1, value: 20, hidden: true });
  split.onchange = () => { splitN.hidden = split.value === 'none'; splitN.value = split.value === 'pages' ? 20 : 80; splitN.title = split.value === 'pages' ? '쪽 수' : '천 글자'; unit.textContent = split.value === 'pages' ? '쪽' : '천 자'; unit.hidden = split.value === 'none'; };
  const unit = h('span', { class: 'muted small', hidden: true }, '쪽');
  const merge = seg('mdmerge', [['each', '파일마다 따로', 'ZIP 안에 파일별 .md'], ['one', '하나로 합치기', '파일 이름을 제목으로 구분']], 'each');
  const rangeIn = h('input', { class: 'inp', placeholder: '예: 1-30, 45 (비우면 전체)' });
  const single = row('쪽 범위', rangeIn); single.hidden = true;
  const lang = h('select', { class: 'inp' }, opt('kor+eng', 'OCR 언어: 한국어 + 영어'), opt('eng', 'OCR 언어: 영어'));
  modal({
    title: 'AI용 마크다운 변환', wide: true,
    body: [h('p', { class: 'muted' }, 'PDF를 ChatGPT·Claude 같은 AI가 읽기 좋은 마크다운(.md)으로 바꿉니다. 제목·목록·표 구조를 살리고, 반복되는 머리글·쪽 번호는 빼며, 스캔본은 글자를 읽어 넣습니다. 여러 파일도 한 번에 변환할 수 있습니다.'),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: async () => add(await pickFiles('application/pdf,.pdf', true)), textContent: '+ PDF 추가' })), list, single,
      row('옵션', h('div', { class: 'chkcol' }, stripHF.el, ocr.el, front.el, toc.el)), row('쪽 표시', marks), row('그림', images), row('나누기', split, splitN, unit), row('OCR', lang),
      h('div', { class: 'muted small' }, '여러 파일을 변환할 때'), merge.el],
    actions: [{ label: '닫기' }, {
      label: '변환하기', kind: 'primary', icon: 'convert', run: async () => {
        if (!files.length) { toast('변환할 PDF를 추가하거나 열어 주세요', 'err'); return false; }
        const o = { stripHF: stripHF.i.checked, ocr: ocr.i.checked, frontMatter: front.i.checked, toc: toc.i.checked, marks: marks.value, images: images.value, split: split.value, splitN: +splitN.value, lang: lang.value };
        const b = busy('마크다운으로 변환하는 중…', { stoppable: true });
        const lib = await D.getPdfjs();
        const results = [], failed = [];
        try {
          for (let fi = 0; fi < files.length; fi++) {
            if (b.cancelled) throw new Error('취소되었습니다');
            if (b.stopped && results.length) break;
            const f = files[fi];
            let pdf, own = false;
            try {
              if (f.current) { await D.flush(); pdf = S.pdf; } else { pdf = await D.openPdfjs(f.bytes); own = true; }
              let idx = Array.from({ length: pdf.numPages }, (_, i) => i);
              if (files.length === 1 && rangeIn.value.trim()) { const r = parseRange(rangeIn.value, pdf.numPages); if (!r) throw new Error(`쪽 범위를 확인해 주세요 (1~${pdf.numPages})`); idx = r; }
              const prog = { cancelled: () => b.cancelled, stopped: () => b.stopped, set: (t, p) => b.set(`${files.length > 1 ? `[${fi + 1}/${files.length}] ` : ''}${t || ''}`.trim(), p == null ? null : (fi + p) / files.length) };
              const res = await convertPdfToMd(pdf, lib, idx, o, prog);
              results.push({ name: f.name, total: pdf.numPages, res });
            } catch (e) { if (b.cancelled) throw e; failed.push(`${f.name}: ${e.message || e}`); }
            finally { if (own) { try { pdf?.destroy?.(); } catch { /* 무시 */ } } }
          }
          b.close();
          if (!results.length) throw new Error('변환된 파일이 없습니다. ' + failed.join(' / '));
          showResult(results, o, failed, merge.get());
        } catch (e) { b.close(); err(e); return false; }
      },
    }],
  });
  draw();
}

function showResult(results, o, failed, mergeMode) {
  let outs = [];                                                // [{name, text}]
  const imgs = [];
  for (const r of results) {
    const parts = assemble(r.name, r.res, o, r.total);
    outs.push(...parts); imgs.push(...r.res.imgFiles.map(([n, d]) => [`${baseName(r.name)}/${n}`, d]));
  }
  if (results.length > 1 && mergeMode === 'one') {
    const body = results.map(r => {
      const ps = assemble(r.name, r.res, { ...o, split: 'none', frontMatter: false, toc: false }, r.total)[0].text.replace(/^(#{1,5}) /gm, '#$1 ');
      return `# [문서] ${baseName(r.name)}\n\n` + ps;
    }).join('\n\n---\n\n');
    outs = [{ name: '합친_문서.md', text: body }];
  }
  const all = outs.map(x => x.text).join('\n');
  const chars = all.length, tok = estTokens(all);
  const prev = h('textarea', { class: 'inp txt mono', readonly: true, style: { minHeight: '260px' } }, outs[0].text.slice(0, 4000) + (outs[0].text.length > 4000 ? '\n\n… (미리보기는 앞부분만 보입니다)' : ''));
  const needZip = outs.length > 1 || imgs.length > 0;
  const stats = h('p', {}, `파일 ${outs.length}개 · 글자 ${chars.toLocaleString()}자 · 대략 ${tok.toLocaleString()} 토큰 (AI 입력 길이 참고용) · ${fmtSize(new Blob([all]).size)}`);
  const notes = [failed.length ? h('p', { class: 'warnbox' }, '변환하지 못한 파일: ' + failed.join(' / ')) : null,
    tok > 150000 ? h('p', { class: 'warnbox' }, '내용이 매우 깁니다. 한 번에 넣기 어려우면 「나누기」 옵션으로 쪽 수나 글자 수 기준으로 나눠 보세요.') : null];
  modal({
    title: '변환 결과', wide: true, body: [stats, ...notes, prev],
    actions: [{ label: '닫기' },
      { label: '클립보드에 복사', keep: true, run: async () => { if (outs.length > 1) { toast('여러 파일은 「저장」으로 받아 주세요'); return false; } try { await navigator.clipboard.writeText(outs[0].text); toast('복사했습니다. AI 입력창에 붙여넣으세요', 'ok'); } catch { toast('복사하지 못했습니다. 「저장」을 이용해 주세요', 'err'); } } },
      { label: needZip ? 'ZIP으로 저장' : '.md 저장', kind: 'primary', icon: 'save', run: async () => {
        if (!needZip) { download(new Blob([outs[0].text], { type: 'text/markdown;charset=utf-8' }), outs[0].name); return; }
        const z = new window.JSZip();
        outs.forEach(x => z.file(x.name, x.text));
        imgs.forEach(([n, d]) => z.file(n, d));
        download(await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }), (results.length === 1 ? baseName(results[0].name) : '마크다운_변환') + '.zip');
      } }],
  });
}
