// 중복 페이지 찾기·삭제 (파일 합친 뒤 같은 쪽이 여러 번 들어간 경우) (© 2026 GLORY KIM)
//  글자가 있는 쪽은 글자가 완전히 같을 때만, 스캔(그림) 쪽은 모양을 작게 줄여 비교한다. 먼저 나온 쪽을 남기고 나중 쪽을 지운다.
import { S, h, toast, busy, modal } from './state.js';
import * as core from './pdfcore.js';
import * as D from './doc.js';
import { needDoc, err, row, seg } from './tools.js';

const hashText = s => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = ((a << 5) + a) ^ c; b = ((b << 5) + b) ^ c; } return (a >>> 0).toString(36) + (b >>> 0).toString(36) + ':' + s.length; };

// 쪽 하나의 지문: 글자 해시(글자가 있을 때) + 잉크 위치 지도(스캔 비교용)
const MW = 200;
async function signature(pdf, num) {
  const page = await pdf.getPage(num);
  const vp = page.getViewport({ scale: 1 });
  let text = '';
  try { const tc = await page.getTextContent(); text = tc.items.map(x => x.str).join('').replace(/\s+/g, '').toLowerCase(); } catch { /* 글자 없음 */ }
  const cv = await core.renderCanvas(pdf, num, MW / vp.width);
  const w = cv.width, hh = cv.height;
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh).data;
  const g = new Uint8Array(w * hh), hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) { g[j] = (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8; hist[g[j]]++; }
  let bg = 255, best = -1; for (let v = 0; v < 256; v++) if (hist[v] > best) { best = hist[v]; bg = v; }
  const thr = bg - 45, m = new Uint8Array(w * hh);
  let count = 0;
  const grid = new Float32Array(64);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const j = y * w + x; if (g[j] < thr) { m[j] = 1; count++; grid[((y * 8 / hh) | 0) * 8 + ((x * 8 / w) | 0)]++; } }
  // 1칸 부풀린 지도 (스캔이 살짝 어긋나도 같은 쪽으로 보기 위함)
  const dil = new Uint8Array(w * hh);
  for (let y = 1; y < hh - 1; y++) for (let x = 1; x < w - 1; x++) { const j = y * w + x; if (m[j] || m[j - 1] || m[j + 1] || m[j - w] || m[j + w] || m[j - w - 1] || m[j - w + 1] || m[j + w - 1] || m[j + w + 1]) dil[j] = 1; }
  cv.width = 0; page.cleanup();
  return { text: text.length >= 30 ? hashText(text) : null, aspect: vp.width / vp.height, m, dil, count, grid, w, hh, flat: count < w * hh * 0.0006 };
}
// 두 쪽의 잉크 위치가 얼마나 겹치는지 (0~1)
function overlap(a, b) {
  if (a.w !== b.w || a.hh !== b.hh) return 0;
  const r = a.count / b.count;
  if (r < 0.75 || r > 1.34) return 0;
  let gd = 0; for (let i = 0; i < 64; i++) gd += Math.abs(a.grid[i] - b.grid[i]);
  if (gd > 0.5 * Math.max(a.count, b.count)) return 0;                       // 잉크 분포가 크게 다르면 비교 생략
  let c1 = 0, c2 = 0;
  for (let i = 0; i < a.m.length; i++) { if (a.m[i] && b.dil[i]) c1++; if (b.m[i] && a.dil[i]) c2++; }
  return Math.min(c1 / a.count, c2 / b.count);
}

export async function duplicatePagesDialog(opt = {}) {
  if (!await needDoc()) return;
  if (S.n < 2) { toast('쪽이 2개 이상일 때 쓸 수 있습니다'); return; }
  const mode = seg('dmode', [['exact', '완전히 같은 쪽만 (권장)', '글자·모양이 똑같은 쪽'], ['near', '거의 같은 쪽까지', '스캔 오차를 더 넉넉히 봅니다 (양식 서식이 같고 숫자만 다른 쪽은 같은 쪽으로 볼 수 있음)']], 'exact');
  const rv = h('input', { type: 'checkbox', checked: true });
  modal({
    title: '중복 페이지 찾기 · 삭제', wide: true,
    body: [h('p', { class: 'muted' }, opt.fromMerge ? '합친 문서에 같은 쪽이 여러 번 들어갔는지 확인합니다. 먼저 나온 쪽은 남기고, 나중에 나온 같은 쪽을 지울 수 있습니다.' : '같은 내용의 쪽이 여러 번 들어 있으면 먼저 나온 쪽만 남기고 나머지를 지웁니다. 글자가 있는 쪽은 글자가 완전히 같을 때만, 스캔한 쪽은 모양이 같을 때 중복으로 봅니다. 빈 쪽은 비교하지 않습니다.'),
      mode.el, row('옵션', h('label', { class: 'chk' }, rv, '지우기 전에 찾은 쪽을 보고 확인하기'))],
    actions: [{ label: opt.fromMerge ? '그냥 두기' : '취소' }, {
      label: '중복 찾기', kind: 'primary', run: async () => {
        const NEED = mode.get() === 'near' ? 0.88 : 0.965;
        const b = busy('중복 페이지를 찾는 중…', { stoppable: true });
        let closed = false;
        try {
          await D.flush();
          const sigs = [];
          for (let i = 0; i < S.n; i++) {
            if (b.cancelled) throw new Error('취소되었습니다');
            if (b.stopped) break;
            b.set(`${i + 1} / ${S.n}장 분석 중`, i / S.n);
            sigs.push(await signature(S.pdf, i + 1));
            if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
          }
          b.set(`${S.n} / ${S.n}장 비교하는 중…`, 0.97);
          const kept = [], dups = [];
          sigs.forEach((s, i) => {
            if (!s.flat) {
              for (const j of kept) {
                const o = sigs[j];
                if (Math.abs(o.aspect - s.aspect) > 0.03) continue;
                let same;
                if (s.text && o.text) same = s.text === o.text;                         // 둘 다 글자가 있으면 글자가 같아야 함
                else same = overlap(s, o) >= NEED;
                if (same) { dups.push({ i, of: j }); return; }
              }
            }
            kept.push(i);
          });
          b.close(); closed = true;
          if (!dups.length) { toast('중복된 쪽이 없습니다' + (mode.get() === 'exact' ? '. 「거의 같은 쪽까지」로 바꿔 보세요' : ''), 'ok'); return; }
          if (rv.checked) await show(dups); else await applyDup(dups, new Set(dups.map(d => d.i)));
        } catch (e) { err(e); } finally { if (!closed) b.close(); }
      },
    }],
  });
}

async function applyDup(dups, del) {
  if (!del.size) { toast('지울 쪽을 선택해 주세요'); return false; }
  const bz = busy('중복 쪽을 지우는 중…');
  try {
    await D.applyBytes(await core.applyPlan(S.bytes, Array.from({ length: S.n }, (_, i) => i).filter(i => !del.has(i)).map(i => ({ src: i, rot: 0 }))));
    toast(`중복 ${del.size}쪽을 지웠습니다 (Ctrl+Z로 되돌리기)`, 'ok');
    return true;
  } catch (e) { err(e); return false; } finally { bz.close(); }
}

async function show(dups) {
  const bz = busy('찾은 쪽 미리보기를 만드는 중…');
  const cells = [];
  try {
    for (let k = 0; k < dups.length; k++) {
      bz.set(`${k + 1} / ${dups.length}장`, k / dups.length);
      const pg = await S.pdf.getPage(dups[k].i + 1);
      const cv = await core.renderCanvas(S.pdf, dups[k].i + 1, 110 / pg.getViewport({ scale: 1 }).width);
      cells.push(cv);
    }
  } finally { bz.close(); }
  const checks = dups.map(() => h('input', { type: 'checkbox', checked: true }));
  const label = h('b', {}, '');
  const upd = () => { label.textContent = `${checks.filter(c => c.checked).length} / ${checks.length}쪽 삭제 선택`; };
  checks.forEach(c => c.addEventListener('change', upd)); upd();
  const grid = h('div', { class: 'blankgrid' }, dups.map((d, k) => h('label', { class: 'bcell', title: `${d.i + 1}쪽은 ${d.of + 1}쪽과 같습니다` }, checks[k], cells[k], h('span', {}, `${d.i + 1}쪽 = ${d.of + 1}쪽`))));
  modal({
    title: '찾은 결과', wide: true,
    body: [h('p', {}, `중복된 쪽 ${dups.length}개를 찾았습니다. 「N쪽 = M쪽」은 N쪽이 앞의 M쪽과 같다는 뜻이며, N쪽을 지웁니다. 지우지 않을 쪽은 체크를 풀어 주세요.`),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn small', onclick: () => { checks.forEach(c => { c.checked = true; }); upd(); } }, '모두 선택'), h('button', { class: 'btn small', onclick: () => { checks.forEach(c => { c.checked = false; }); upd(); } }, '모두 해제'), label), grid],
    actions: [{ label: '닫기' }, { label: '삭제', kind: 'primary', run: async () => ((await applyDup(dups, new Set(dups.filter((_, k) => checks[k].checked).map(d => d.i)))) === false ? false : undefined) }],
  });
}
