// 문서 글자(텍스트 개체·본문 수정)용 글꼴: 화면 표시용 로딩, 저장용 바이트, 글꼴별 기준선 측정 (© 2026 GLORY KIM)
const T = 'vendor/fonts/text/', G = 'vendor/fonts/sig/';
const L = (id, label, group, r, b) => ({ id, label, group, r: T + r, b: b ? T + b : undefined });
export const TEXT_FONTS = [
  { id: 'noto', label: 'Noto Sans KR (기본 고딕)', group: '고딕', r: 'vendor/fonts/NotoSansKR-Regular.ttf', b: 'vendor/fonts/NotoSansKR-Bold.ttf' },
  L('gothic', '나눔고딕', '고딕', 'NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'),
  L('myeongjo', '나눔명조 (바탕체)', '명조·바탕', 'NanumMyeongjo-Regular.ttf', 'NanumMyeongjo-Bold.ttf'),
  { id: 'pen', label: '나눔 펜 손글씨', group: '손글씨', r: G + 'NanumPenScript-Regular.ttf' },
  { id: 'brush', label: '나눔 붓글씨', group: '손글씨', r: G + 'NanumBrushScript-Regular.ttf' },
  { id: 'gaegu', label: '개구 손글씨', group: '손글씨', r: G + 'Gaegu-Regular.ttf' },
  L('gothica1', 'Gothic A1', '고딕', 'GothicA1-Regular.ttf', 'GothicA1-Bold.ttf'),
  L('plexkr', 'IBM Plex Sans KR', '고딕', 'IBMPlexSansKR-Regular.ttf', 'IBMPlexSansKR-Bold.ttf'),
  L('sunflower', '해바라기 (Sunflower)', '고딕', 'Sunflower-Medium.ttf', 'Sunflower-Bold.ttf'),
  L('dohyeon', '도현체 (제목용)', '제목·디자인', 'DoHyeon-Regular.ttf'),
  L('blackhan', '검은고딕 (제목용)', '제목·디자인', 'BlackHanSans-Regular.ttf'),
  L('jua', '주아체', '제목·디자인', 'Jua-Regular.ttf'),
  L('cutefont', '귀여운체', '제목·디자인', 'CuteFont-Regular.ttf'),
  L('gugi', '구기체', '제목·디자인', 'Gugi-Regular.ttf'),
  L('orbit', '오르빗', '제목·디자인', 'Orbit-Regular.ttf'),
  L('songmyung', '송명체 (명조)', '명조·바탕', 'SongMyung-Regular.ttf'),
  L('hahmlet', '함렛 (명조)', '명조·바탕', 'Hahmlet.ttf'),
  L('poorstory', '푸어스토리 (손글씨)', '손글씨', 'PoorStory-Regular.ttf'),
  L('singleday', '싱글데이 (손글씨)', '손글씨', 'SingleDay-Regular.ttf'),
  L('yeonsung', '연성체 (손글씨)', '손글씨', 'YeonSung-Regular.ttf'),
  L('eastsea', '동해독도 (붓글씨)', '손글씨', 'EastSeaDokdo-Regular.ttf'),
  L('dokdo', '독도체 (붓글씨)', '손글씨', 'Dokdo-Regular.ttf'),
  L('ncoding', '나눔고딕코딩', '고정폭', 'NanumGothicCoding-Regular.ttf', 'NanumGothicCoding-Bold.ttf'),
  L('courier', 'Courier Prime', '고정폭', 'CourierPrime-Regular.ttf', 'CourierPrime-Bold.ttf'),
  L('sourcecode', 'Source Code Pro', '고정폭', 'SourceCodePro.ttf'),
  L('roboto', 'Roboto', '영문', 'Roboto.ttf'),
  L('lato', 'Lato', '영문', 'Lato-Regular.ttf', 'Lato-Bold.ttf'),
  L('opensans', 'Open Sans', '영문', 'OpenSans.ttf'),
  L('montserrat', 'Montserrat', '영문', 'Montserrat.ttf'),
  L('oswald', 'Oswald', '영문', 'Oswald.ttf'),
  L('playfair', 'Playfair Display (세리프)', '영문', 'PlayfairDisplay.ttf'),
  L('lora', 'Lora (세리프)', '영문', 'Lora.ttf'),
  L('bebas', 'Bebas Neue (제목)', '영문', 'BebasNeue-Regular.ttf'),
  L('abril', 'Abril Fatface (제목)', '영문', 'AbrilFatface-Regular.ttf'),
  L('pacifico', 'Pacifico (필기체)', '영문', 'Pacifico-Regular.ttf'),
  L('lobster', 'Lobster (필기체)', '영문', 'Lobster-Regular.ttf'),
  L('indie', 'Indie Flower (손글씨)', '영문', 'IndieFlower-Regular.ttf'),
  L('shadows', 'Shadows Into Light (손글씨)', '영문', 'ShadowsIntoLight.ttf'),
];
export const userFonts = {};                       // 불러온 글꼴 { id: {id,label,buf} } (이번 실행 동안만 유지)
export const GROUP_ORDER = ['고딕', '명조·바탕', '제목·디자인', '손글씨', '고정폭', '영문', '불러온 글꼴'];
export const allFonts = () => [...TEXT_FONTS, ...Object.values(userFonts)];
export const fontDef = id => allFonts().find(f => f.id === id) || TEXT_FONTS[0];
export const hasBold = id => { const f = fontDef(id); return !!(f.b || f.buf2); };

const shown = new Map();                           // 화면 표시용 FontFace 로딩 상태
export const faceName = (id, bold) => `PDFG-${id}${bold && hasBold(id) ? '-b' : ''}`;
export const cssFamily = (id, bold) => (id && id !== 'noto' ? `"${faceName(id, bold)}","Noto Sans KR","Malgun Gothic",sans-serif` : '"Noto Sans KR","Malgun Gothic","맑은 고딕",sans-serif');
export function loadDisplay(id, bold) {
  id = id || 'noto';
  const key = faceName(id, bold);
  if (!shown.has(key)) {
    const f = fontDef(id);
    const src = bold && f.b ? f.b : f.r;
    shown.set(key, (async () => {
      const ff = new FontFace(key, f.buf && !src ? f.buf : `url(${src})`);
      await ff.load();
      document.fonts.add(ff);
      compute(id, bold);
    })().catch(e => { shown.delete(key); throw e; }));
  }
  return shown.get(key);
}
export const isLoaded = (id, bold) => shown.has(faceName(id || 'noto', bold));

// 글꼴별 기준선: 줄 높이 1.3 안에서 첫 줄 기준선이 내려오는 위치(글자 크기의 배수)
const metrics = {};
function compute(id, bold) {
  const key = faceName(id, bold);
  if (metrics[key]) return metrics[key];
  const c = document.createElement('canvas').getContext('2d');
  c.font = `100px "${key}"`;
  const m = c.measureText('가Hg');
  const a = (m.fontBoundingBoxAscent || 88) / 100, d = (m.fontBoundingBoxDescent || 28) / 100;
  return (metrics[key] = (1.3 - (a + d)) / 2 + a);
}
export async function measure(id, bold) {
  id = id || 'noto';
  if (id === 'noto') return 1.086;
  await loadDisplay(id, bold);
  return metrics[faceName(id, bold)] || compute(id, bold);
}
export const baseOf = (id, bold) => (!id || id === 'noto' ? 1.086 : metrics[faceName(id, bold)] || 1.086);

// 저장용 글꼴 파일 바이트
const bytesCache = new Map();
export async function fontBytes(id, bold) {
  const f = fontDef(id);
  const url = bold && f.b ? f.b : f.r;
  if (!url && f.buf) return new Uint8Array(f.buf);
  if (!bytesCache.has(url)) {
    bytesCache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error('글꼴을 불러오지 못했습니다'); return r.arrayBuffer(); }).then(b => new Uint8Array(b)));
  }
  return bytesCache.get(url);
}

// 사용자가 고른 글꼴 파일(.ttf .otf)을 추가
export async function addUserFont(file) {
  const buf = await file.arrayBuffer();
  const base = file.name.replace(/\.[^.]+$/, '');
  const id = 'user' + Date.now().toString(36);
  const def = { id, label: base + ' (불러온 글꼴)', buf };
  userFonts[id] = def;
  const ff = new FontFace(faceName(id, false), buf.slice(0));
  await ff.load();
  document.fonts.add(ff);
  shown.set(faceName(id, false), Promise.resolve());
  compute(id, false);
  return def;
}
