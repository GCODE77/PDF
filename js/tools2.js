// 추가 기능 대화상자: 머리글·쪽번호 · 자르기 · 나누기 · 속성 · 이미지 추출 · 만들기 · 양식 · 교정 · 서명/주석 요청 · 인쇄 · 소리내어 읽기 (© 2026 GLORY KIM)
import { S, h, icon, toast, busy, modal, download, pickFiles, readBytes, baseName, fmtSize } from './state.js';
import * as core from './pdfcore.js';
import * as c2 from './core2.js';
import * as D from './doc.js';
import * as V from './viewer.js';
import { needDoc, err, row, opt, pagesField, seg } from './tools.js';
import { analyzePage, editableLines } from './layout.js';
import { blankPagesDialog } from './blank.js';

const MM = 72 / 25.4;
const inp = (attrs = {}) => h('input', { class: 'inp', ...attrs });

// ---------- PDF ↔ 사진 (홈의 큰 버튼) ----------
export function photoPdfDialog() {
  let m;
  const card = (title, sub, ic, fn) => h('button', { class: 'choice', onclick: () => { m.close(); fn(); } },
    h('span', { class: 'cico', html: icon(ic) }), h('b', {}, title), h('small', {}, sub));
  m = modal({
    title: 'PDF ↔ 사진 변환',
    body: h('div', { class: 'choices' },
      card('사진 → PDF', '사진을 고르고 순서를 정해 PDF 한 개로 만듭니다 (폰은 카메라 촬영도 가능)', 'image', async () => {
        const { imagesDialog } = await import('./tools.js');
        const f = await pickFiles('image/*', true);
        imagesDialog(f.length ? f : undefined);
      }),
      card('PDF → 사진', 'PDF의 쪽마다 PNG·JPG 사진으로 저장합니다 (여러 쪽은 ZIP)', 'convert', async () => {
        const { convertDialog } = await import('./tools.js');
        convertDialog('png');
      })),
    actions: [{ label: '닫기' }],
  });
}

// ---------- 머리글 · 바닥글 · 쪽 번호 ----------
export async function headerFooterDialog() {
  if (!await needDoc()) return;
  const f = {};
  const mk = (k, a, ph) => (f[k + a] = inp({ placeholder: ph }));
  const pages = pagesField('적용할 페이지');
  const size = h('select', { class: 'inp' }, ...[9, 10, 11, 12, 14].map(v => opt(v, v + 'pt')));
  size.value = 10;
  const color = h('input', { type: 'color', value: '#444444' });
  const margin = inp({ type: 'number', value: 28, min: 8, max: 120 });
  const start = inp({ type: 'number', value: 1, min: 0 });
  const grid = (kind, title) => h('div', { class: 'row' }, h('label', { class: 'lab' }, title), h('div', { class: 'ctl tri' }, mk(kind, 'l', '왼쪽'), mk(kind, 'c', '가운데'), mk(kind, 'r', '오른쪽')));
  const preset = (t, fn) => h('button', { class: 'btn small', onclick: fn }, t);
  const body = [
    h('p', { class: 'muted' }, '쪽 번호·날짜·문서 이름을 모든 쪽의 위나 아래에 넣습니다. {n} 현재 쪽, {N} 전체 쪽, {date} 오늘 날짜, {name} 파일 이름을 쓸 수 있습니다.'),
    h('div', { class: 'btnrow' }, preset('쪽 번호 (아래 가운데)', () => { f.footerc.value = '{n}'; }), preset('쪽 번호 (n / N)', () => { f.footerc.value = '{n} / {N}'; }), preset('날짜 (위 오른쪽)', () => { f.headerr.value = '{date}'; }), preset('파일 이름 (위 왼쪽)', () => { f.headerl.value = '{name}'; })),
    grid('header', '머리글 (위)'), grid('footer', '바닥글 (아래)'), pages.el,
    row('글자 크기 · 색', size, color), row('여백 (pt) · 시작 번호', margin, start),
  ];
  modal({
    title: '머리글 · 바닥글 · 쪽 번호', wide: true, body,
    actions: [{ label: '취소' }, {
      label: '적용', kind: 'primary', icon: 'save', run: async () => {
        const idx = pages.get(); if (!idx) return false;
        const b = busy('넣는 중…');
        try {
          await D.flush();
          const o = { idx, size: +size.value, color: color.value, margin: +margin.value, start: +start.value, name: baseName(S.name), header: { l: f.headerl.value, c: f.headerc.value, r: f.headerr.value }, footer: { l: f.footerl.value, c: f.footerc.value, r: f.footerr.value } };
          await D.applyBytes(await c2.addHeaderFooter(S.bytes, o));
          toast('머리글·바닥글을 넣었습니다', 'ok');
        } catch (e) { err(e); return false; } finally { b.close(); }
      },
    }],
  });
}

// ---------- 쪽 자르기 ----------
export async function cropDialog() {
  if (!await needDoc()) return;
  const mm = k => inp({ type: 'number', value: 0, min: 0, max: 200, step: 1, 'aria-label': k });
  const t = mm('위'), r = mm('오른쪽'), b2 = mm('아래'), l = mm('왼쪽');
  const pages = pagesField('자를 페이지');
  modal({
    title: '쪽 자르기', body: [h('p', { class: 'muted' }, '여백을 잘라 낼 길이(mm)를 입력하세요. 원본 내용은 지워지지 않고 보이는 영역만 줄어듭니다.'), row('위 · 아래 (mm)', t, b2), row('왼쪽 · 오른쪽 (mm)', l, r), pages.el],
    actions: [{ label: '취소' }, {
      label: '자르기', kind: 'primary', run: async () => {
        const idx = pages.get(); if (!idx) return false;
        const busy1 = busy('자르는 중…');
        try {
          await D.flush();
          await D.applyBytes(await c2.cropPages(S.bytes, idx, { t: +t.value * MM, r: +r.value * MM, b: +b2.value * MM, l: +l.value * MM }));
          toast('잘랐습니다', 'ok');
        } catch (e) { err(e); return false; } finally { busy1.close(); }
      },
    }],
  });
}

// ---------- 문서 나누기 ----------
export async function splitDialog() {
  if (!await needDoc()) return;
  const mode = seg('splitm', [['n', 'N쪽마다', '예: 5쪽씩 나누기'], ['r', '범위로', '예: 1-3, 4-6, 7-'], ['one', '한 쪽씩', '쪽마다 파일 1개']], 'n', v => { nIn.hidden = v !== 'n'; rIn.hidden = v !== 'r'; });
  const nIn = inp({ type: 'number', value: Math.max(1, Math.ceil(S.n / 2)), min: 1 });
  const rIn = inp({ placeholder: '1-3, 4-6, 7-', hidden: true });
  modal({
    title: 'PDF 나누기', body: [h('p', { class: 'muted' }, `전체 ${S.n}쪽을 여러 파일로 나눠 ZIP 하나로 저장합니다.`), mode.el, row('쪽 수', nIn), row('범위', rIn)],
    actions: [{ label: '취소' }, {
      label: '나누어 저장', kind: 'primary', icon: 'save', run: async () => {
        let groups = [];
        const m = mode.get();
        if (m === 'one') groups = Array.from({ length: S.n }, (_, i) => [i]);
        else if (m === 'n') { const k = Math.max(1, +nIn.value | 0); for (let i = 0; i < S.n; i += k) groups.push(Array.from({ length: Math.min(k, S.n - i) }, (_, j) => i + j)); }
        else {
          const { parseRange } = await import('./state.js');
          for (const part of rIn.value.split(',').map(s => s.trim()).filter(Boolean)) { const g = parseRange(part, S.n); if (!g) { toast(`범위를 확인해 주세요: ${part}`, 'err'); return false; } groups.push(g); }
          if (!groups.length) { toast('나눌 범위를 입력해 주세요', 'err'); return false; }
        }
        const bz = busy('나누는 중…');
        try {
          const bytes = await D.currentBytes();
          const parts = await c2.splitPdf(bytes, groups);
          const base = baseName(S.name);
          const z = new window.JSZip();
          parts.forEach((p, i) => z.file(`${base}_${String(i + 1).padStart(2, '0')}(${p.pages[0] + 1}-${p.pages[p.pages.length - 1] + 1}쪽).pdf`, p.bytes));
          download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), base + '_나눔.zip');
          toast(`${parts.length}개 파일로 나눴습니다`, 'ok');
        } catch (e) { err(e); return false; } finally { bz.close(); }
      },
    }],
  });
}

// ---------- 문서 속성 ----------
export async function propsDialog() {
  if (!await needDoc()) return;
  await D.flush();
  const m = await c2.getMeta(S.bytes);
  const pg = await S.pdf.getPage(1), vp = pg.getViewport({ scale: 1 });
  const f = {};
  const field = (k, label) => row(label, (f[k] = inp({ value: m[k] || '' })));
  const info = h('div', { class: 'muted small' }, `쪽 수 ${m.pages}쪽 · 용량 ${fmtSize(S.bytes.length)} · 첫 쪽 크기 ${(vp.width / MM).toFixed(0)}×${(vp.height / MM).toFixed(0)}mm`);
  modal({
    title: '문서 속성', body: [info, field('title', '제목'), field('author', '작성자'), field('subject', '주제'), field('keywords', '키워드 (쉼표로 구분)'), field('creator', '만든 프로그램')],
    actions: [{ label: '닫기' }, {
      label: '속성 저장', kind: 'primary', run: async () => {
        const bz = busy('저장하는 중…');
        try { await D.applyBytes(await c2.setMeta(S.bytes, Object.fromEntries(Object.keys(f).map(k => [k, f[k].value])))); toast('문서 속성을 저장했습니다', 'ok'); }
        catch (e) { err(e); return false; } finally { bz.close(); }
      },
    }],
  });
}

// ---------- 이미지 추출 ----------
export async function extractImagesDialog() {
  if (!await needDoc()) return;
  const pages = pagesField('대상 페이지');
  modal({
    title: '이미지 추출', body: [h('p', { class: 'muted' }, 'PDF에 들어 있는 그림을 원본 그대로 꺼내 ZIP으로 저장합니다.'), pages.el],
    actions: [{ label: '취소' }, {
      label: '추출', kind: 'primary', icon: 'save', run: async () => {
        const idx = pages.get(); if (!idx) return false;
        const bz = busy('그림을 찾는 중…');
        try {
          await D.flush();
          const lib = await D.getPdfjs();
          const cache = new Map(), seen = new Set(), files = [];
          for (let n = 0; n < idx.length; n++) {
            if (bz.cancelled) throw new Error('취소되었습니다');
            bz.set(`${n + 1} / ${idx.length} 페이지`, n / idx.length);
            const a = await analyzePage(S.pdf, lib, idx[n] + 1, { color: false, images: true, imgCache: cache });
            for (const b of a.blocks) if (b.type === 'img' && !seen.has(b.data)) { seen.add(b.data); files.push([`${baseName(S.name)}_${String(idx[n] + 1).padStart(3, '0')}_${files.length + 1}.${b.data.ext === 'jpeg' ? 'jpg' : 'png'}`, b.data.data]); }
          }
          if (!files.length) throw new Error('꺼낼 그림을 찾지 못했습니다');
          if (files.length === 1) download(files[0][1], files[0][0], files[0][0].endsWith('jpg') ? 'image/jpeg' : 'image/png');
          else { const z = new window.JSZip(); files.forEach(([n, d]) => z.file(n, d)); download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), baseName(S.name) + '_그림.zip'); }
          toast(`그림 ${files.length}개를 저장했습니다`, 'ok');
        } catch (e) { err(e); return false; } finally { bz.close(); }
      },
    }],
  });
}

// ---------- PDF 만들기: 빈 문서 · 글 · 붙여넣기 ----------
export function createBlankDialog() {
  const size = h('select', { class: 'inp' }, opt('a4', 'A4'), opt('a3', 'A3'), opt('a5', 'A5'), opt('letter', 'Letter'), opt('legal', 'Legal'));
  const dir = h('select', { class: 'inp' }, opt('p', '세로'), opt('l', '가로'));
  const cnt = inp({ type: 'number', value: 1, min: 1, max: 200 });
  modal({
    title: '빈 문서 만들기', body: [row('용지', size, dir), row('쪽 수', cnt)],
    actions: [{ label: '취소' }, { label: '만들기', kind: 'primary', run: async () => { try { const b = await c2.blankPdf(size.value, dir.value === 'l', Math.max(1, Math.min(200, +cnt.value | 0))); await S.openBytes(b, '새 문서.pdf'); } catch (e) { err(e); return false; } } }],
  });
}
export function createTextDialog() {
  const ta = h('textarea', { class: 'inp txt', placeholder: '여기에 글을 붙여넣거나 입력하세요. 줄 앞에 # 를 붙이면 제목이 됩니다.' });
  const size = h('select', { class: 'inp' }, opt(10, '작게 (10pt)'), opt(11, '보통 (11pt)'), opt(13, '크게 (13pt)'), opt(16, '아주 크게 (16pt)'));
  size.value = 11;
  const file = h('button', { class: 'btn small', onclick: async () => { const [f] = await pickFiles('.txt,.md,text/plain,text/markdown'); if (f) ta.value = new TextDecoder('utf-8').decode(await readBytes(f)).replace(/^﻿/, ''); } }, '텍스트 파일 불러오기');
  modal({
    title: '글로 PDF 만들기', wide: true, body: [h('div', { class: 'btnrow' }, file), ta, row('글자 크기', size)],
    actions: [{ label: '취소' }, { label: 'PDF 만들기', kind: 'primary', run: async () => { if (!ta.value.trim()) { toast('글을 입력해 주세요', 'err'); return false; } const bz = busy('만드는 중…'); try { await S.openBytes(await c2.textToPdf(ta.value, { size: +size.value }), '새 문서.pdf'); } catch (e) { err(e); return false; } finally { bz.close(); } } }],
  });
}
export async function pasteImageDialog() {
  const open = async blob => { const { imagesDialog } = await import('./tools.js'); imagesDialog([new File([blob], '붙여넣은 이미지.' + (blob.type.split('/')[1] || 'png'), { type: blob.type })]); };
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) { await open(await it.getType(t)); return; } }
    toast('클립보드에 이미지가 없습니다. 이미지를 복사한 뒤 다시 눌러 주세요', 'err');
  } catch {
    const box = h('div', { class: 'pastebox', tabindex: '0' }, '여기를 누르고 Ctrl+V 로 이미지를 붙여넣으세요');
    const m = modal({ title: '클립보드에서 PDF 만들기', body: box, actions: [{ label: '닫기' }] });
    box.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); m.close(); open(f); } });
    box.focus();
  }
}

// ---------- 페이지 회전 · 삭제 ----------
export async function rotateDialog() {
  if (!await needDoc()) return;
  const pages = pagesField('회전할 페이지');
  const dir = seg('rotd', [['90', '오른쪽 90°', '시계 방향'], ['-90', '왼쪽 90°', '반시계 방향'], ['180', '180°', '뒤집기']], '90');
  modal({
    title: '페이지 회전', body: [pages.el, dir.el],
    actions: [{ label: '취소' }, { label: '회전', kind: 'primary', run: async () => {
      const idx = pages.get(); if (!idx) return false;
      const bz = busy('회전하는 중…');
      try { await D.flush(); const set = new Set(idx); await D.applyBytes(await core.applyPlan(S.bytes, Array.from({ length: S.n }, (_, i) => ({ src: i, rot: set.has(i) ? +dir.get() : 0 })))); toast('회전했습니다', 'ok'); }
      catch (e) { err(e); return false; } finally { bz.close(); }
    } }],
  });
}
export async function deleteDialog() {
  if (!await needDoc()) return;
  const pages = pagesField('삭제할 페이지');
  modal({
    title: '페이지 삭제', body: [h('p', { class: 'muted' }, '실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.'), pages.el],
    actions: [{ label: '취소' }, { label: '삭제', kind: 'primary', run: async () => {
      const idx = pages.get(); if (!idx) return false;
      if (idx.length >= S.n) { toast('모든 페이지를 지울 수는 없습니다', 'err'); return false; }
      const bz = busy('삭제하는 중…');
      try { await D.flush(); const del = new Set(idx); await D.applyBytes(await core.applyPlan(S.bytes, Array.from({ length: S.n }, (_, i) => i).filter(i => !del.has(i)).map(i => ({ src: i, rot: 0 })))); toast(`${idx.length}쪽을 삭제했습니다`, 'ok'); }
      catch (e) { err(e); return false; } finally { bz.close(); }
    } }],
  });
}

// ---------- 교정 (영구 삭제) ----------
const PRESETS = [
  ['rrn', '주민등록번호', '\\d{6}\\s*-\\s*[1-4]\\d{6}'],
  ['tel', '전화번호', '0\\d{1,2}\\s*-\\s*\\d{3,4}\\s*-\\s*\\d{4}'],
  ['mail', '이메일', '[\\w.+-]+@[\\w-]+\\.[\\w.-]+'],
  ['card', '카드번호', '\\d{4}[- ]\\d{4}[- ]\\d{4}[- ]\\d{4}'],
];
const charW = ch => (/[ᄀ-ᇿ㄰-㆏가-힯㐀-鿿]/.test(ch) ? 1 : /\s/.test(ch) ? 0.3 : /[.,:;'"!|il1()-]/.test(ch) ? 0.35 : 0.58);
export async function redactSearchDialog() {
  if (!await needDoc()) return;
  const words = h('textarea', { class: 'inp txt', placeholder: '지울 단어를 한 줄에 하나씩 입력 (예: 홍길동)', style: { minHeight: '90px' } });
  const checks = PRESETS.map(([id, t]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-id': id }), t));
  modal({
    title: '검색해서 교정 표시', body: [h('p', { class: 'muted' }, '찾은 글자 위에 검은 상자(교정 표시)를 만듭니다. 아직 지워지지 않으며, 확인한 뒤 「교정 적용」을 눌러야 영구 삭제됩니다.'), words, h('div', { class: 'chkgrid' }, checks)],
    actions: [{ label: '취소' }, {
      label: '찾아서 표시', kind: 'primary', run: async () => {
        const res = [];
        words.value.split('\n').map(s => s.trim()).filter(Boolean).forEach(w => res.push(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')));
        checks.forEach((c, i) => { if (c.querySelector('input').checked) res.push(new RegExp(PRESETS[i][2], 'g')); });
        if (!res.length) { toast('지울 단어를 입력하거나 항목을 골라 주세요', 'err'); return false; }
        const bz = busy('글자를 찾는 중…');
        try {
          await D.flush();
          const lib = await D.getPdfjs();
          let n = 0;
          D.snap();
          for (let i = 0; i < S.n; i++) {
            const lines = await editableLines(await S.pdf.getPage(i + 1), lib);
            for (const ln of lines) {
              const cum = [0];
              for (const ch of ln.text) cum.push(cum[cum.length - 1] + charW(ch));
              const tot = cum[cum.length - 1] || 1;
              for (const re of res) {
                re.lastIndex = 0;
                let m;
                while ((m = re.exec(ln.text))) {
                  if (!m[0]) { re.lastIndex++; continue; }
                  const a = ln.x + ln.w * cum[m.index] / tot, b = ln.x + ln.w * cum[m.index + m[0].length] / tot;
                  (S.overlays[i] ||= []).push({ id: 'o' + (S.uid++), type: 'redact', x: a - 1, y: ln.top, w: b - a + 2, h: ln.h, color: '#000000', size: ln.size });
                  n++;
                }
              }
            }
          }
          const { emit } = await import('./state.js');
          emit('overlays-changed');
          toast(n ? `${n}곳에 교정 표시를 했습니다. 확인 후 「교정 적용」을 눌러 주세요` : '찾은 글자가 없습니다', n ? 'ok' : 'err');
        } catch (e) { err(e); return false; } finally { bz.close(); }
      },
    }],
  });
}
export async function redactApplyDialog() {
  if (!await needDoc()) return;
  const pagesWith = Object.entries(S.overlays).filter(([, l]) => l.some(o => o.type === 'redact')).map(([i]) => +i);
  if (!pagesWith.length) { toast('교정 표시가 없습니다. 「교정」 도구로 지울 영역을 드래그해 주세요'); V.setTool('redact'); return; }
  const mode = seg('redm', [['img', '그림으로 바꿔 완전 삭제 (권장)', `해당 ${pagesWith.length}쪽의 글자·그림이 모두 이미지로 바뀌어 복구할 수 없습니다 (이 쪽은 글자 선택 불가)`], ['txt', '글자만 제거', '교정 상자가 글자 줄 전체를 덮을 때만 확실합니다 · 나머지 쪽은 그대로 유지']], 'img');
  modal({
    title: '교정 적용 (영구 삭제)', body: [h('p', {}, `${pagesWith.length}쪽의 교정 표시를 적용합니다. 적용하면 되돌릴 수 없는 삭제가 됩니다 (실행 취소는 가능).`), mode.el],
    actions: [{ label: '취소' }, {
      label: '교정 적용', kind: 'primary', run: async () => {
        const bz = busy('교정하는 중…');
        try {
          await D.flush();
          let bytes = S.bytes;
          if (mode.get() === 'img') bytes = await c2.rasterizePages(bytes, S.pdf, pagesWith, 2.2, (i, n) => bz.set(`${i + 1} / ${n} 쪽`, i / n));
          await D.applyBytes(bytes);
          toast('교정을 적용했습니다. 지운 내용은 복구할 수 없습니다', 'ok');
        } catch (e) { err(e); return false; } finally { bz.close(); }
      },
    }],
  });
}

// ---------- 양식 ----------
const FIELD_KINDS = [['text', '텍스트 필드', '글자를 입력하는 칸'], ['check', '체크박스', '선택 표시'], ['radio', '라디오 단추', '같은 이름 중 하나 선택'], ['drop', '드롭다운', '목록에서 고르기'], ['sign', '서명란', '서명할 자리']];
export function formsDialog() {
  const kind = seg('fk', FIELD_KINDS, S.style.fieldKind || 'text');
  kind.el.classList.add('seg-grid');
  needDoc().then(ok => { if (!ok) return; });
  modal({
    title: '양식 만들기', body: [h('p', { class: 'muted' }, '넣을 입력칸 종류를 고르고, 문서에서 칸이 들어갈 자리를 드래그하세요. 저장하면 다른 PDF 프로그램에서도 입력할 수 있는 진짜 양식이 됩니다.'), kind.el],
    actions: [{ label: '닫기' }, { label: '칸 그리기 시작', kind: 'primary', run: async () => { if (!await needDoc()) return false; S.style.fieldKind = kind.get(); V.setTool('field'); } }],
  });
}
export async function fillFormDialog() {
  if (!await needDoc()) return;
  await D.flush();
  let fields;
  try { fields = (await c2.listFormFields(S.bytes)).filter(f => f.kind !== 'other'); } catch { fields = []; }
  if (!fields.length) { toast('이 문서에는 입력 양식이 없습니다. 「텍스트」 도구로 직접 글자를 넣거나 「양식 만들기」로 칸을 만드세요'); return; }
  const flat = h('input', { type: 'checkbox' });
  const ctrls = fields.map(f => {
    let el;
    if (f.kind === 'check') el = h('input', { type: 'checkbox', checked: !!f.value });
    else if (f.kind === 'text') el = inp({ value: f.value });
    else { el = h('select', { class: 'inp' }, opt('', '(선택 안 함)'), ...f.options.map(o => opt(o, o))); el.value = f.value || ''; }
    return { f, el, row: row(`${f.name} · ${f.page + 1}쪽`, el) };
  });
  modal({
    title: '양식 채우기', wide: true, body: [h('p', { class: 'muted' }, `입력 칸 ${fields.length}개를 찾았습니다.`), ...ctrls.map(c => c.row), h('label', { class: 'chk' }, flat, '입력 후 고정하기 (수정 불가)')],
    actions: [{ label: '취소' }, { label: '채우기 적용', kind: 'primary', run: async () => {
      const bz = busy('채우는 중…');
      try {
        const vals = {};
        ctrls.forEach(c => { vals[c.f.name] = c.f.kind === 'check' ? c.el.checked : c.el.value; });
        await D.applyBytes(await c2.fillFormFields(S.bytes, vals, flat.checked));
        toast('양식을 채웠습니다', 'ok');
      } catch (e) { err(e); return false; } finally { bz.close(); }
    } }],
  });
}
export async function flattenFormTool() {
  if (!await needDoc()) return;
  await D.flush();
  const bz = busy('고정하는 중…');
  try { await D.applyBytes(await c2.flattenForm(S.bytes)); toast('입력칸을 일반 내용으로 고정했습니다', 'ok'); } catch (e) { err(e); } finally { bz.close(); }
}

// ---------- 서명 요청 · 주석 요청 (파일 전달 방식) ----------
function sendDialog(kind) {
  const sign = kind === 'sign';
  const title = sign ? '전자 서명 요청' : '주석 요청하기';
  const subject = sign ? `[서명 요청] ${baseName(S.name)}` : `[검토 요청] ${baseName(S.name)}`;
  const msg = sign
    ? `첨부한 PDF에 서명해 주세요.\n\n1) PDF 공작소(https://gcode77.github.io/PDF)에서 파일을 열고\n2) 「채우기 및 서명」으로 서명을 넣은 뒤\n3) 저장해서 다시 보내 주세요.`
    : `첨부한 PDF를 검토하고 의견을 남겨 주세요.\n\n1) PDF 공작소(https://gcode77.github.io/PDF)에서 파일을 열고\n2) 메모·형광펜·텍스트로 의견을 적은 뒤\n3) 저장해서 다시 보내 주세요.`;
  const to = inp({ type: 'email', placeholder: '받는 사람 이메일 (선택)' });
  const note = h('textarea', { class: 'inp txt', style: { minHeight: '110px' } }, msg);
  const steps = h('ol', { class: 'steps' },
    h('li', {}, h('b', {}, sign ? '서명할 자리 표시' : '검토할 문서 준비'), h('div', { class: 'btnrow' }, sign ? h('button', { class: 'btn small', onclick: async () => { if (!await needDoc()) return; document.querySelector('.m-wrap')?.remove(); S.style.fieldKind = 'sign'; V.setTool('field'); } }, '서명란 그리기') : h('button', { class: 'btn small', onclick: async () => { if (!await needDoc()) return; document.querySelector('.m-wrap')?.remove(); V.setTool('note'); } }, '메모로 요청 사항 적기'))),
    h('li', {}, h('b', {}, '안내 문구 확인 후 보내기'), to, note));
  modal({
    title, wide: true,
    body: [h('p', { class: 'muted' }, '이 앱은 서버가 없어 파일을 직접 주고받는 방식입니다. 받는 사람은 PDF 공작소(또는 아무 PDF 프로그램)로 열어 서명·의견을 넣어 다시 보내면 됩니다. (서명 진행 현황 추적은 지원하지 않습니다)'), steps],
    actions: [{ label: '닫기' }, {
      label: '파일 보내기 (공유)', kind: 'primary', icon: 'share', run: async () => {
        const bz = busy('보낼 파일을 만드는 중…');
        let bytes;
        try { bytes = await D.currentBytes(); if (sign) bytes = await c2.addFormFields(bytes, S.overlays); } catch (e) { err(e); bz.close(); return false; }
        bz.close();
        const file = new File([bytes], D.safeName('', '.pdf'), { type: 'application/pdf' });
        try {
          if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: subject, text: note.value }); return; }
        } catch (e) { if (e.name === 'AbortError') return; }
        download(bytes, file.name, 'application/pdf');
        location.href = `mailto:${encodeURIComponent(to.value)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(note.value + '\n\n(방금 내려받은 PDF 파일을 첨부해 주세요)')}`;
        toast('PDF를 저장하고 메일 작성 창을 열었습니다. 저장된 파일을 첨부해 보내세요', 'ok');
      },
    }],
  });
}
export const signRequestDialog = () => needDoc().then(ok => ok && sendDialog('sign'));
export const reviewRequestDialog = () => needDoc().then(ok => ok && sendDialog('review'));

// ---------- 인쇄 · 소리내어 읽기 ----------
export async function printDoc() {
  if (!await needDoc()) return;
  const bz = busy('인쇄 준비 중…');
  try {
    const bytes = await D.currentBytes();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const fr = h('iframe', { src: url, style: { position: 'fixed', right: 0, bottom: 0, width: '1px', height: '1px', border: 0, opacity: 0 } });
    document.body.append(fr);
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { window.open(url, '_blank'); } setTimeout(() => { fr.remove(); URL.revokeObjectURL(url); }, 60000); };
  } catch (e) { err(e); } finally { bz.close(); }
}
let reading = false;
export function stopReading() { reading = false; speechSynthesis?.cancel(); toast('읽기를 멈췄습니다'); }
export async function readAloud(fromPage) {
  if (!('speechSynthesis' in window)) { toast('이 기기는 소리내어 읽기를 지원하지 않습니다', 'err'); return; }
  if (!await needDoc()) return;
  speechSynthesis.cancel();
  reading = true;
  toast('현재 쪽부터 읽습니다. 멈추려면 보기 → 소리내어 읽기 → 읽기 멈춤');
  for (let p = fromPage || S.curPage; p <= S.n && reading; p++) {
    const text = await core.pageText(S.pdf, p);
    V.scrollToPage(p);
    if (!text) continue;
    await new Promise(res => { const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.onend = res; u.onerror = res; speechSynthesis.speak(u); });
  }
  reading = false;
}

// ======================== 도구 등록 ========================
const T = (id, group, label, ic, color, desc, run, extra = {}) => ({ id, group, label, icon: ic, color, desc, run, doc: true, ...extra });
export const TOOLS2 = [
  T('underline', 'edit', '밑줄', 'underline', '#e1251b', '글자를 드래그해 밑줄을 긋습니다.', () => V.setTool('underline')),
  T('strike', 'edit', '취소선', 'strike', '#6b7280', '글자를 드래그해 취소선을 긋습니다.', () => V.setTool('strike')),
  T('shape', 'edit', '도형 · 선 · 화살표', 'shape', '#0f9d8a', '사각형·원·선·화살표를 그립니다.', () => V.setTool('shape')),
  T('redact', 'edit', '교정 (영구 삭제)', 'redact', '#b91c1c', '개인정보 등을 영구히 지웁니다 (검은 상자).', () => V.setTool('redact')),
  T('redact-find', 'edit', '검색해서 교정 표시', 'search', '#b91c1c', '주민번호·전화번호·단어를 찾아 한꺼번에 표시합니다.', redactSearchDialog),
  T('redact-apply', 'edit', '교정 적용', 'redact', '#b91c1c', '표시한 부분을 되돌릴 수 없게 삭제합니다.', redactApplyDialog),
  T('forms', 'edit', '양식 만들기', 'form', '#c026d3', '입력칸(텍스트·체크박스·목록·서명란)을 만듭니다.', formsDialog),
  T('fillform', 'edit', '양식 채우기', 'form', '#5258e4', '문서의 입력칸을 한 번에 채웁니다.', fillFormDialog),
  T('flatform', 'opt', '양식 고정', 'lock', '#6b7280', '입력칸을 일반 내용으로 굳혀 수정할 수 없게 합니다.', flattenFormTool),
  T('signreq', 'edit', '전자 서명 요청', 'sign', '#c026d3', '서명란을 넣고 파일을 보내 서명을 받습니다.', signRequestDialog),
  T('reviewreq', 'edit', '주석 요청하기', 'note', '#d4a017', '파일을 보내 검토 의견을 받습니다.', reviewRequestDialog),
  T('rotate', 'page', '페이지 회전', 'rotr', '#16a34a', '원하는 쪽을 돌립니다.', rotateDialog),
  T('blankpages', 'page', '빈 페이지 찾아 삭제', 'trash', '#dc2626', '스캔 문서의 빈 쪽·파일철 구멍 자국을 자동으로 찾아 지웁니다.', blankPagesDialog),
  T('delpages', 'page', '페이지 삭제', 'trash', '#dc2626', '필요 없는 쪽을 지웁니다.', deleteDialog),
  T('split', 'page', 'PDF 나누기', 'split', '#0e7490', '여러 파일로 쪼갭니다.', splitDialog),
  T('crop', 'page', '쪽 자르기', 'crop', '#16a34a', '여백을 잘라 냅니다.', cropDialog),
  T('header', 'opt', '머리글 · 바닥글 · 쪽 번호', 'header', '#0369a1', '쪽 번호·날짜를 모든 쪽에 넣습니다.', headerFooterDialog),
  T('props', 'opt', '문서 속성', 'info', '#6b7280', '제목·작성자 등 정보를 보고 고칩니다.', propsDialog),
  T('getimages', 'convert', '이미지 추출', 'image', '#0f9d8a', 'PDF 안의 그림을 꺼냅니다.', extractImagesDialog),
  T('print', 'opt', '인쇄', 'print', '#374151', '프린터로 출력합니다.', printDoc),
  T('create-blank', 'convert', '빈 문서 만들기', 'newdoc', '#e1251b', '빈 페이지 PDF를 새로 만듭니다.', createBlankDialog, { doc: false }),
  T('create-text', 'convert', '글로 PDF 만들기', 'file', '#e1251b', '입력하거나 붙여넣은 글을 PDF로.', createTextDialog, { doc: false }),
  T('create-paste', 'convert', '클립보드에서 만들기', 'image', '#e1251b', '복사한 이미지를 PDF로.', pasteImageDialog, { doc: false }),
];
export { FIELD_KINDS, blankPagesDialog };
