// 犬の写真の代わりに使う、簡単な犬の絵(SVG)。色と耳の形を変えて数種類にする。
// ブラウザの canvas で JPEG にして、写真の保存先(R2 の代わり)に入れる。

const FURS = ['#E8C9A0', '#B5763A', '#3A3330', '#F4F1EC', '#D99A5B', '#8D8F94', '#C46A2B', '#6B4A33'];
const BACKS = ['#DCE8E0', '#E6E1D6', '#DDE3EC', '#EADBD5', '#E3E8D3', '#E4DDE8'];

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** 犬の絵の SVG。viewBox で写真(横長)と一覧用(正方形の顔)を切り替える。 */
export function dogSvg(variant: number, kind: 'photo' | 'thumb'): string {
  const fur = FURS[variant % FURS.length]!;
  const back = BACKS[(variant * 5 + 1) % BACKS.length]!;
  const floppy = variant % 3 !== 1;
  const ear = shade(fur, 0.78);
  const dark = fur === '#3A3330' || fur === '#6B4A33';
  const muzzle = dark ? '#D9CBB8' : shade(fur, 1.12);
  const eye = '#1B1714';
  const view = kind === 'photo' ? '0 0 400 300' : '110 30 180 180';
  const ears = floppy
    ? `<ellipse cx="150" cy="118" rx="26" ry="50" transform="rotate(18 150 118)" fill="${ear}"/>
       <ellipse cx="250" cy="118" rx="26" ry="50" transform="rotate(-18 250 118)" fill="${ear}"/>`
    : `<path d="M150 70 L168 128 L128 118 Z" fill="${ear}"/><path d="M250 70 L232 128 L272 118 Z" fill="${ear}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">
  <rect x="0" y="0" width="400" height="300" fill="${back}"/>
  <rect x="0" y="232" width="400" height="68" fill="${shade(back, 0.93)}"/>
  <ellipse cx="200" cy="250" rx="92" ry="58" fill="${fur}"/>
  ${ears}
  <circle cx="200" cy="128" r="62" fill="${fur}"/>
  <ellipse cx="200" cy="158" rx="34" ry="26" fill="${muzzle}"/>
  <circle cx="178" cy="120" r="7" fill="${eye}"/><circle cx="222" cy="120" r="7" fill="${eye}"/>
  <circle cx="180" cy="118" r="2" fill="#fff"/><circle cx="224" cy="118" r="2" fill="#fff"/>
  <ellipse cx="200" cy="146" rx="11" ry="8" fill="${eye}"/>
  <path d="M200 154 Q200 166 190 168 M200 154 Q200 166 210 168" stroke="${eye}" stroke-width="3" fill="none" stroke-linecap="round"/>
  ${variant % 2 === 0 ? `<path d="M196 168 Q200 182 204 168 Z" fill="#D9707A"/>` : ''}
</svg>`;
}

/** 紙のスタンプカード(旧カード)の写真の代わり */
export function paperCardSvg(stamped: number): string {
  const cells = Array.from({ length: 10 }, (_, i) => {
    const x = 70 + (i % 5) * 65;
    const y = 150 + Math.floor(i / 5) * 70;
    const on = i < stamped;
    return `<circle cx="${x}" cy="${y}" r="24" fill="none" stroke="#9AA3AD" stroke-width="2"/>${
      on ? `<circle cx="${x}" cy="${y}" r="20" fill="#C2341F" opacity=".82"/><text x="${x}" y="${y + 6}" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">済</text>` : ''
    }`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280">
  <rect width="400" height="280" fill="#8C7B66"/>
  <g transform="rotate(-3 200 140)">
    <rect x="22" y="40" width="356" height="220" rx="6" fill="#FBF8F1"/>
    <text x="40" y="78" font-size="20" fill="#2B2B2B" font-family="sans-serif">ドッグラン スタンプカード</text>
    <text x="40" y="106" font-size="15" fill="#5B6470" font-family="sans-serif">お名前: もも ちゃん</text>
    ${cells}
  </g>
</svg>`;
}

async function svgToJpeg(svg: string, width: number, height: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  // toBlob は、画面の中の画面(iframe)を読み込み直している間に返ってこないことがあるため、同期の toDataURL を使う
  const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function makeDogPhoto(variant: number, kind: 'photo' | 'thumb'): Promise<Uint8Array> {
  return kind === 'photo' ? svgToJpeg(dogSvg(variant, kind), 640, 480) : svgToJpeg(dogSvg(variant, kind), 240, 240);
}

export function makeCardPhoto(): Promise<Uint8Array> {
  return svgToJpeg(paperCardSvg(7), 800, 560);
}
