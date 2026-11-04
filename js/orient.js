// 뒤집어지거나 옆으로 누운 쪽을 찾아 자동으로 똑바로 돌리기 (© 2026 GLORY KIM)
//  1) 글자 정보가 있는 쪽: 글자가 놓인 방향(PDF 안의 글자 행렬)으로 즉시 판별
//  2) 스캔(그림) 쪽: 줄의 방향을 가볍게 재서 후보를 줄이고, 후보 방향으로 돌려 OCR 해 보아 가장 잘 읽히는 방향을 고른다
import { S, h, toast, busy, modal } from './state.js';
import * as core from './pdfcore.js';
import * as D from './doc.js';
import { needDoc, err, row, opt, pagesField, ocrWorker } from './tools.js';

const norm = a => ((Math.round(a / 90) * 90) % 360 + 360) % 360;

// 글자 방향: 화면 기준으로 글자가 어느 쪽으로 흐르는지 → 똑바로 만들기 위해 시계 방향으로 돌려야 할 각도
async function textFix(pdf, lib, num) {
  const page = await pdf.getPage(num);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const bucket = { 0: 0, 90: 0, 180: 0, 270: 0 };
  let total = 0;
  for (const it of tc.items) {
    const len = (it.str || '').trim().length;
    if (!len) continue;
    const m = lib.Util.transform(vp.transform, it.transform);
    const ang = norm(Math.atan2(m[1], m[0]) * 180 / Math.PI);          // 글자가 흐르는 방향(시계 방향 각도)
    bucket[ang] += len; total += len;
  }
  page.cleanup();
  if (total < 8) return null;                                          // 글자 정보가 거의 없음 → 그림 쪽으로 처리
  const best = Object.entries(bucket).sort((a, b) => b[1] - a[1])[0];
  if (best[1] < total * 0.6) return null;
  const ang = +best[0];
  return { rot: (360 - ang) % 360, via: '글자 방향', conf: best[1] / total };
}

const rotateCanvas = (cv, rot) => {
  const sw = rot % 180 ? cv.height : cv.width, sh = rot % 180 ? cv.width : cv.height;
  const o = document.createElement('canvas'); o.width = sw; o.height = sh;
  const c = o.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, sw, sh);
  c.translate(sw / 2, sh / 2); c.rotate(rot * Math.PI / 180); c.drawImage(cv, -cv.width / 2, -cv.height / 2);
  return o;
};

// 줄 방향 비율: 가로 줄이 많으면 >1, 세로 줄이 많으면 <1
function lineRatio(cv) {
  const w = 480, k = w / cv.width, hh = Math.max(1, Math.round(cv.height * k));
  const s = document.createElement('canvas'); s.width = w; s.height = hh;
  s.getContext('2d').drawImage(cv, 0, 0, w, hh);
  const d = s.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh).data;
  const rows = new Float32Array(hh), cols = new Float32Array(w);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (((d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8) < 130) { rows[y]++; cols[x]++; } }
  const vr = a => { let m = 0; for (const v of a) m += v; m /= a.length; let s2 = 0; for (const v of a) s2 += (v - m) ** 2; return s2 / a.length; };
  const rv = vr(rows), cv2 = vr(cols);
  return cv2 ? rv / cv2 : 1;
}

async function scoreOcr(worker, cv) {
  const { data } = await worker.recognize(cv, {}, { text: true, blocks: true });
  let sc = 0, n = 0;
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) words.push(wd);
  if (!words.length && data.words) words.push(...data.words);
  for (const wd of words) {
    const t = (wd.text || '').replace(/[^0-9A-Za-z가-힣]/g, '');
    if (t.length >= 1 && wd.confidence >= 60) { sc += t.length * (wd.confidence / 100); n++; }
  }
  return { sc, n };
}

async function imageFix(worker, pdf, num) {
  const page = await pdf.getPage(num);
  const vw = page.getViewport({ scale: 1 }).width;
  const cv = await core.renderCanvas(pdf, num, 760 / vw);
  const ratio = lineRatio(cv);
  const cand = ratio > 1.3 ? [0, 180] : ratio < 0.77 ? [90, 270] : [0, 90, 180, 270];
  const res = [];
  for (const r of cand) {
    const rc = r ? rotateCanvas(cv, r) : cv;
    res.push({ r, ...(await scoreOcr(worker, rc)) });
    if (rc !== cv) rc.width = 0;
    // 이미 아주 잘 읽히면(똑바로) 나머지는 시험하지 않는다
    if (r === 0 && res[0].n >= 25 && res[0].sc >= 60 && ratio > 1.3) break;
  }
  cv.width = 0;
  res.sort((a, b) => b.sc - a.sc);
  const best = res[0], second = res[1] || { sc: 0 };
  if (best.sc < 8) return { rot: 0, via: '글자를 읽지 못해 그대로', conf: 0, uncertain: true };
  const certain = best.sc >= second.sc * 1.6;
  return { rot: certain ? best.r : 0, via: 'OCR 비교', conf: certain ? Math.min(1, best.sc / (best.sc + second.sc)) : 0, uncertain: !certain };
}

export async function orientDialog() {
  if (!await needDoc()) return;
  const pages = pagesField('검사할 페이지');
  const lang = h('select', { class: 'inp' }, opt('kor+eng', '한국어 + 영어 (한글 문서)'), opt('eng', '영어 (영문 문서·더 빠름)'));
  const review = h('input', { type: 'checkbox', checked: true });
  modal({
    title: '뒤집힌 페이지 자동 바로잡기', wide: true,
    body: [h('p', { class: 'muted' }, '거꾸로 뒤집히거나 옆으로 누운 쪽을 찾아 똑바로 돌립니다. 글자가 들어 있는 PDF는 글자 방향으로 바로 알아내고, 스캔본은 글자를 읽어 보며 방향을 판단합니다(쪽당 몇 초 걸릴 수 있습니다).'),
      pages.el, row('스캔본 언어', lang), row('옵션', h('label', { class: 'chk' }, review, '적용 전에 찾은 쪽을 보고 확인하기'))],
    actions: [{ label: '취소' }, {
      label: '검사 시작', kind: 'primary', run: async () => {
        const idx = pages.get(); if (!idx) return false;
        const b = busy('방향을 검사하는 중…', { stoppable: true });
        let closed = false;
        try {
          await D.flush();
          const lib = await D.getPdfjs();
          const found = [], unsure = [], need = [];
          // 1단계: 글자 정보가 있는 쪽은 글자 방향으로 즉시 판단 (빠름)
          for (let n = 0; n < idx.length; n++) {
            if (b.cancelled) throw new Error('취소되었습니다');
            if (b.stopped) break;
            const i = idx[n];
            b.set(`${n + 1} / ${idx.length}장 글자 방향 확인 중`, 0.25 * n / idx.length);
            const r = await textFix(S.pdf, lib, i + 1);
            if (!r) need.push(i); else if (r.rot) found.push({ i, ...r });
            if (n % 6 === 5) await new Promise(res => setTimeout(res, 0));
          }
          // 2단계: 스캔(그림) 쪽은 글자를 읽어 방향 판단 — 여러 개를 동시에
          if (need.length && !b.stopped && !b.cancelled) {
            b.set('글자 인식 엔진을 준비하는 중… (처음 한 번은 시간이 걸립니다)');
            const O = await import('./ocrjob.js');
            const pool = await O.makePool(lang.value, Math.min(O.workerCount(), need.length));
            let next = 0, done = 0;
            try {
              await Promise.all(pool.workers.map(async w => {
                while (!b.cancelled && !b.stopped) {
                  const k = next++; if (k >= need.length) return;
                  const i = need[k];
                  const r = await imageFix(w, S.pdf, i + 1);
                  if (r.rot) found.push({ i, ...r }); else if (r.uncertain) unsure.push(i);
                  done++;
                  b.set(`${done} / ${need.length}장 스캔 쪽 방향 판단 중 (글자를 읽어 확인)`, 0.25 + 0.75 * done / need.length);
                }
              }));
            } finally { await pool.close(); }
          }
          if (b.cancelled) throw new Error('취소되었습니다');
          found.sort((p, q) => p.i - q.i);
          b.close(); closed = true;
          if (!found.length) { toast(unsure.length ? `돌릴 쪽을 찾지 못했습니다 (확신이 없어 그대로 둔 쪽 ${unsure.length}개: ${unsure.slice(0, 8).map(x => x + 1).join(', ')}…)` : '모든 쪽이 이미 똑바로 되어 있습니다', 'ok'); return; }
          if (review.checked) await showFound(found, unsure);
          else await applyRot(found);
        } catch (e) { err(e); } finally { if (!closed) b.close(); }
      },
    }],
  });
}

async function applyRot(list) {
  const rot = new Map(list.map(f => [f.i, f.rot]));
  const bz = busy('돌리는 중…');
  try {
    await D.applyBytes(await core.applyPlan(S.bytes, Array.from({ length: S.n }, (_, i) => ({ src: i, rot: rot.get(i) || 0 }))));
    toast(`${list.length}쪽을 똑바로 돌렸습니다 (Ctrl+Z로 되돌리기)`, 'ok');
  } catch (e) { err(e); return false; } finally { bz.close(); }
}

async function showFound(found, unsure) {
  const checks = found.map(() => h('input', { type: 'checkbox', checked: true }));
  const cells = [];
  for (const f of found) {
    const pg = await S.pdf.getPage(f.i + 1);
    const cv = await core.renderCanvas(S.pdf, f.i + 1, 110 / pg.getViewport({ scale: 1 }).width);
    const fixed = rotateCanvas(cv, f.rot);
    cv.width = 0;
    cells.push(fixed);
  }
  const desc = { 90: '오른쪽으로 90°', 180: '180° (뒤집힘)', 270: '왼쪽으로 90°' };
  const grid = h('div', { class: 'blankgrid' }, found.map((f, k) => h('label', { class: 'bcell', title: `${f.i + 1}쪽 · ${f.via}` }, checks[k], cells[k], h('span', {}, `${f.i + 1}쪽 · ${desc[f.rot]}`))));
  const label = h('b', {}, '');
  const upd = () => { label.textContent = `${checks.filter(c => c.checked).length} / ${checks.length}쪽 돌리기`; };
  checks.forEach(c => c.addEventListener('change', upd)); upd();
  modal({
    title: '찾은 결과', wide: true,
    body: [h('p', {}, `똑바로 돌릴 쪽 ${found.length}개를 찾았습니다. 그림은 돌린 뒤의 모습입니다. 돌리지 않을 쪽은 체크를 풀어 주세요.`),
      unsure.length ? h('p', { class: 'muted small' }, `글자가 적거나 확신이 없어 그대로 둔 쪽: ${unsure.slice(0, 20).map(x => x + 1).join(', ')}${unsure.length > 20 ? ' …' : ''}`) : null,
      h('div', { class: 'btnrow' }, h('button', { class: 'btn small', onclick: () => { checks.forEach(c => { c.checked = true; }); upd(); } }, '모두 선택'), h('button', { class: 'btn small', onclick: () => { checks.forEach(c => { c.checked = false; }); upd(); } }, '모두 해제'), label), grid],
    actions: [{ label: '닫기' }, { label: '적용', kind: 'primary', run: async () => {
      const list = found.filter((_, k) => checks[k].checked);
      if (!list.length) { toast('돌릴 쪽을 선택해 주세요'); return false; }
      return (await applyRot(list)) === false ? false : undefined;
    } }],
  });
}
