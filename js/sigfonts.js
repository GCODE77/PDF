// 서명용 글꼴: 내장 손글씨·필기체(필요할 때만 불러옴) + 내 컴퓨터 글꼴 + 글꼴 파일 불러오기 (© 2026 GLORY KIM)
const SIG = 'vendor/fonts/sig/';
export const SIG_FONTS = [
  { id: 'pen', label: '나눔 펜 손글씨 (한글·영문)', family: 'PDFG Nanum Pen', url: SIG + 'NanumPenScript-Regular.ttf', group: '손글씨' },
  { id: 'brush', label: '나눔 붓글씨 (한글·영문)', family: 'PDFG Nanum Brush', url: SIG + 'NanumBrushScript-Regular.ttf', group: '손글씨' },
  { id: 'gaegu', label: '개구 손글씨 (한글·영문)', family: 'PDFG Gaegu', url: SIG + 'Gaegu-Regular.ttf', group: '손글씨' },
  { id: 'vibes', label: 'Great Vibes (영문 필기체)', family: 'PDFG Great Vibes', url: SIG + 'GreatVibes-Regular.ttf', group: '영문 필기체' },
  { id: 'dancing', label: 'Dancing Script (영문 필기체)', family: 'PDFG Dancing', url: SIG + 'DancingScript.ttf', group: '영문 필기체' },
  { id: 'caveat', label: 'Caveat (영문 손글씨)', family: 'PDFG Caveat', url: SIG + 'Caveat.ttf', group: '영문 필기체' },
  { id: 'noto', label: '고딕 (Noto Sans KR)', family: 'PDFG Noto', url: 'vendor/fonts/NotoSansKR-Regular.ttf', group: '기본 글꼴' },
  { id: 'sys-script', label: '기본 필기체 (기기에 있는 글꼴)', family: "'Segoe Script','Brush Script MT','Apple Chancery',cursive", system: true, group: '기본 글꼴' },
  { id: 'sys-serif', label: '명조·바탕 (기기에 있는 글꼴)', family: "'Batang','Times New Roman',serif", system: true, group: '기본 글꼴' },
];
const loaded = new Map();
export function ensureFont(f) {
  if (f.system) return Promise.resolve();
  if (!loaded.has(f.id)) {
    loaded.set(f.id, (async () => {
      const ff = new FontFace(f.family, f.buf ? f.buf : `url(${f.url})`);
      await ff.load();
      document.fonts.add(ff);
    })().catch(e => { loaded.delete(f.id); throw e; }));
  }
  return loaded.get(f.id);
}
export const cssFamily = f => (f.system ? f.family : `"${f.family}"`);

// 글꼴 파일(.ttf .otf .woff .woff2)을 불러온다
export async function fontFromFile(file) {
  const buf = await file.arrayBuffer();
  const base = file.name.replace(/\.[^.]+$/, '');
  const f = { id: 'user-' + Date.now(), label: base + ' (불러온 글꼴)', family: 'PDFG User ' + base.replace(/[^\w가-힣]/g, ''), buf, group: '불러온 글꼴' };
  await ensureFont(f);
  return f;
}
// 이 컴퓨터에 설치된 글꼴 (브라우저가 허용할 때만)
export const canListLocal = () => typeof window.queryLocalFonts === 'function';
export async function listLocalFonts() {
  const all = await window.queryLocalFonts();
  const seen = new Set(), out = [];
  for (const d of all) if (!seen.has(d.family)) { seen.add(d.family); out.push({ id: 'local-' + d.family, label: d.family, family: `'${d.family.replace(/'/g, '')}'`, system: true, group: '내 컴퓨터 글꼴' }); }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}
