// 고양이 색 팔레트와 2D 얼굴 그림 (대화 초상화, 앨범, 지도에 사용)
export const COLORS = [
  { body: '#FFB661', stripe: '#EE8F3C', tabby: true },            // 0 보리 (치즈 태비)
  { body: '#FFE39E', stripe: '#F2C46B', tabby: false },           // 1 우유 (크림)
  { body: '#CDB9F6', stripe: '#AE97E6', tabby: false },           // 2 라일락 (라벤더)
  { body: '#A1E3CD', stripe: '#78CDB1', tabby: false },           // 3 박하 (민트)
  { body: '#FFB1C5', stripe: '#F48FAA', tabby: false },           // 4 앵두 (딸기)
  { body: '#AEBEDB', stripe: '#8398BD', tabby: true },            // 5 구름 (회색 고등어)
  { body: '#A4D3FF', stripe: '#7CB6EC', tabby: false },           // 6 소나기 (하늘)
  { body: '#554A5F', stripe: '#403649', tabby: false, dark: true }, // 7 밤이 (까망)
];

// mood: 'open' | 'happy' | 'sleep'
export function catFaceSVG(i, { mood = 'open', size = 64, locked = false } = {}) {
  const c = COLORS[i];
  const body = locked ? '#E6D9DC' : c.body;
  const ink = c.dark && !locked ? '#FFC7D4' : '#5B3A44';
  const inner = locked ? '#D8C8CC' : '#FF9DB2';
  const h = Math.round(size * 100 / 120);
  let s = `<svg viewBox="0 0 120 100" width="${size}" height="${h}" aria-hidden="true">`;
  s += `<path d="M20 44 L26 7 L54 28 Z" fill="${body}" stroke="${body}" stroke-width="6" stroke-linejoin="round"/>`;
  s += `<path d="M100 44 L94 7 L66 28 Z" fill="${body}" stroke="${body}" stroke-width="6" stroke-linejoin="round"/>`;
  s += `<path d="M28 34 L30 17 L43 27Z" fill="${inner}" stroke="${inner}" stroke-width="3" stroke-linejoin="round"/>`;
  s += `<path d="M92 34 L90 17 L77 27Z" fill="${inner}" stroke="${inner}" stroke-width="3" stroke-linejoin="round"/>`;
  s += `<ellipse cx="60" cy="60" rx="47" ry="37" fill="${body}"/>`;
  if (locked) {
    s += `<text x="60" y="74" text-anchor="middle" font-family="Jua, sans-serif" font-size="40" fill="#C7B3B8">?</text></svg>`;
    return s;
  }
  if (c.tabby) s += `<path d="M50 27 q1 8 0 12 M60 25 q1 9 0 14 M70 27 q1 8 0 12" stroke="${c.stripe}" stroke-width="4.5" stroke-linecap="round" fill="none"/>`;
  if (mood === 'open') {
    const eye = c.dark ? '#E2EE78' : '#3A2A32';
    s += `<ellipse cx="41" cy="57" rx="6.5" ry="8" fill="${eye}"/><ellipse cx="79" cy="57" rx="6.5" ry="8" fill="${eye}"/>`;
    if (c.dark) s += `<ellipse cx="41" cy="57" rx="2.2" ry="6" fill="#2B2233"/><ellipse cx="79" cy="57" rx="2.2" ry="6" fill="#2B2233"/>`;
    s += `<circle cx="39" cy="54" r="2.4" fill="#fff"/><circle cx="77" cy="54" r="2.4" fill="#fff"/>`;
  } else if (mood === 'happy') {
    s += `<path d="M34 60 q7 -9 14 0 M72 60 q7 -9 14 0" stroke="${ink}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`;
  } else {
    s += `<path d="M34 57 q7 6 14 0 M72 57 q7 6 14 0" stroke="${ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
  }
  s += `<ellipse cx="27" cy="70" rx="8" ry="5" fill="#FF7F9E" opacity="${c.dark ? 0.35 : 0.5}"/><ellipse cx="93" cy="70" rx="8" ry="5" fill="#FF7F9E" opacity="${c.dark ? 0.35 : 0.5}"/>`;
  s += `<ellipse cx="60" cy="65" rx="4.5" ry="3.2" fill="#FF8FA8"/>`;
  s += `<path d="M52 70 q4 5.5 8 0 q4 5.5 8 0" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  s += `</svg>`;
  return s;
}
