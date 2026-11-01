// 犬の写真の代わりに使う、簡単な犬の絵(SVG)。色と耳の形を変えて数種類にする。
// ブラウザの canvas で JPEG にして、写真の保存先(R2 の代わり)に入れる。

import { drawWatermark } from '../../../admin/src/pages/photos/upload/watermark';

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

/** 会員証の背景の写真の代わり(白っぽい犬の明るい写真。文字が読めるかを見比べるため) */
export function makeCardBackground(): Promise<Uint8Array> {
  return svgToJpeg(dogSvg(3, 'photo'), 1200, 900);
}

// ---------------------------------------------------------------- 写真販売の見本の写真(docs/photo-requirements.md 11章)
// 著作物の写真は使わない。ブラウザの canvas で、ドッグランの景色と犬のシルエットを描いた JPEG を作る(原本の代わり)。
// 色はくすんだ落ち着いた色だけ(docs/design.md)。やわらかいグラデーションの空と芝生に、1〜2頭の犬。
// 透かし付きのプレビュー・サムネイルは、管理画面のアップロードと同じ透かしの部品(drawWatermark)で描く。

export type SampleTheme = 'park' | 'halloween';
export type SampleOptions = { theme?: SampleTheme; watermark?: string; quality?: number };

/** 決まった種から作る乱数(同じ番号なら同じ写真) */
function seeded(n: number) {
  let a = (n * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARK_SKIES: [string, string][] = [
  ['#C9D8E4', '#EEF1EC'],
  ['#D9D3C7', '#F2EEE6'],
  ['#C4D2D9', '#E9EDE8'],
  ['#E2D2C4', '#F4ECE2'],
  ['#CBD5CF', '#EEF0EA'],
];
const PARK_GRASS: [string, string][] = [
  ['#8FA67E', '#6F8A64'],
  ['#9AAA7F', '#7A8D63'],
  ['#86A08A', '#67816C'],
  ['#A3A883', '#838A66'],
];
const HALLOWEEN_SKIES: [string, string][] = [
  ['#B9A9B8', '#E7D8CF'],
  ['#A9A3B6', '#DCCFC6'],
  ['#C2AFA4', '#ECDCCF'],
];
const DOG_FURS = ['#E6D3B8', '#B98A5E', '#4A403A', '#F2EEE8', '#C9965F', '#8E8C88', '#A86F43', '#6E5443', '#D8C4A6'];

/** 1頭の犬のシルエット(横向き)。x・y は足元の中心、s は大きさ */
function drawDog(g: CanvasRenderingContext2D, x: number, y: number, s: number, fur: string, facing: 1 | -1, r: () => number, hat: boolean) {
  const dark = shadeHex(fur, 0.8);
  g.save();
  g.translate(x, y);
  g.scale(facing * s, s);
  // 影
  g.fillStyle = 'rgba(40, 45, 35, 0.18)';
  g.beginPath();
  g.ellipse(0, 4, 78, 12, 0, 0, Math.PI * 2);
  g.fill();
  // 足
  g.fillStyle = dark;
  for (const lx of [-48, -30, 28, 46]) {
    g.beginPath();
    g.roundRect(lx - 7, -48, 14, 50, 6);
    g.fill();
  }
  // しっぽ
  g.strokeStyle = fur;
  g.lineWidth = 12;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-60, -78);
  const up = r() > 0.4;
  g.quadraticCurveTo(-95, up ? -120 : -70, -88, up ? -140 : -60);
  g.stroke();
  // 体
  g.fillStyle = fur;
  g.beginPath();
  g.ellipse(0, -72, 70, 34, 0, 0, Math.PI * 2);
  g.fill();
  // 首と頭
  g.beginPath();
  g.ellipse(52, -100, 22, 30, -0.5, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(70, -128, 30, 26, 0, 0, Math.PI * 2);
  g.fill();
  // 鼻先
  g.beginPath();
  g.ellipse(96, -120, 18, 13, 0.1, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2B2622';
  g.beginPath();
  g.ellipse(112, -123, 5, 4, 0, 0, Math.PI * 2);
  g.fill();
  // 目
  g.beginPath();
  g.arc(80, -134, 3.5, 0, Math.PI * 2);
  g.fill();
  // 耳(垂れ耳か立ち耳)
  g.fillStyle = dark;
  g.beginPath();
  if (r() > 0.5) {
    g.ellipse(56, -122, 11, 22, 0.35, 0, Math.PI * 2);
  } else {
    g.moveTo(52, -146);
    g.lineTo(62, -176);
    g.lineTo(74, -148);
    g.closePath();
  }
  g.fill();
  // ハロウィン: 小さなとんがり帽子(くすんだ紫)
  if (hat) {
    g.fillStyle = '#5E5368';
    g.beginPath();
    g.moveTo(52, -150);
    g.lineTo(78, -196);
    g.lineTo(96, -146);
    g.closePath();
    g.fill();
    g.fillStyle = '#C49A5A';
    g.fillRect(52, -154, 44, 6);
  }
  g.restore();
}

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawPumpkin(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = '#C8865A';
  for (const dx of [-18, 18, 0]) {
    g.beginPath();
    g.ellipse(dx, -28, 26, 28, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#6E7A55';
  g.fillRect(-3, -62, 6, 12);
  g.restore();
}

/** 見本の景色を描く(設計の大きさ 1200×800。g は width×height) */
export function drawSampleScene(g: CanvasRenderingContext2D, width: number, height: number, variant: number, theme: SampleTheme = 'park') {
  const r = seeded(variant + (theme === 'halloween' ? 1000 : 0));
  g.save();
  g.scale(width / 1200, height / 800);
  const skies = theme === 'halloween' ? HALLOWEEN_SKIES : PARK_SKIES;
  const [skyTop, skyBottom] = skies[variant % skies.length]!;
  const sky = g.createLinearGradient(0, 0, 0, 520);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(1, skyBottom);
  g.fillStyle = sky;
  g.fillRect(0, 0, 1200, 800);
  // やわらかい光
  const sx = 150 + r() * 900;
  const sun = g.createRadialGradient(sx, 140, 10, sx, 140, 420);
  sun.addColorStop(0, 'rgba(255, 250, 240, 0.55)');
  sun.addColorStop(1, 'rgba(255, 250, 240, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 1200, 800);
  // 遠くの木立(ぼかした丸)
  g.fillStyle = theme === 'halloween' ? 'rgba(90, 80, 95, 0.28)' : 'rgba(92, 112, 92, 0.30)';
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.ellipse(i * 150 + r() * 80 - 40, 470, 90 + r() * 50, 60 + r() * 40, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 芝生
  const [gTop, gBottom] = PARK_GRASS[(variant * 3 + 1) % PARK_GRASS.length]!;
  const grass = g.createLinearGradient(0, 470, 0, 800);
  grass.addColorStop(0, gTop);
  grass.addColorStop(1, gBottom);
  g.fillStyle = grass;
  g.beginPath();
  g.moveTo(0, 500);
  g.bezierCurveTo(300, 470 + r() * 30, 800, 520 - r() * 30, 1200, 490);
  g.lineTo(1200, 800);
  g.lineTo(0, 800);
  g.closePath();
  g.fill();
  // 柵
  g.strokeStyle = 'rgba(245, 240, 230, 0.55)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(0, 470);
  g.lineTo(1200, 462);
  g.moveTo(0, 440);
  g.lineTo(1200, 432);
  for (let x = 30; x < 1200; x += 120) {
    g.moveTo(x, 420);
    g.lineTo(x, 486);
  }
  g.stroke();
  if (theme === 'halloween') {
    drawPumpkin(g, 120 + r() * 200, 700, 1.4);
    drawPumpkin(g, 900 + r() * 200, 650, 1);
  }
  // 犬(1〜2頭)。正方形のサムネイル(真ん中を切り取る)でも切れないよう、真ん中の寄りに置く
  const dogs = r() > 0.55 ? 2 : 1;
  for (let i = 0; i < dogs; i++) {
    const fur = DOG_FURS[Math.floor(r() * DOG_FURS.length)]!;
    // 2頭は向かい合わせ
    const facing: 1 | -1 = dogs === 2 ? (i === 0 ? 1 : -1) : r() > 0.5 ? 1 : -1;
    const scale = (dogs === 1 ? 2.0 : 1.45) + r() * 0.3;
    const x = dogs === 1 ? 600 - facing * 10 * scale + (r() - 0.5) * 80 : (i === 0 ? 380 : 820) + (r() - 0.5) * 30;
    const y = 650 + r() * 70;
    drawDog(g, x, y, scale, fur, facing, r, theme === 'halloween' && r() > 0.3);
  }
  g.restore();
}

/**
 * 見本の写真(JPEG)。longEdge は長辺の px(3:2 の横長)。watermark を渡すと、管理画面のアップロードと同じ透かしを全面に敷く
 */
export async function makeSamplePhoto(variant: number, longEdge = 1800, opts: SampleOptions = {}): Promise<Uint8Array> {
  const width = longEdge;
  const height = Math.round((longEdge * 2) / 3);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  drawSampleScene(g, width, height, variant, opts.theme);
  if (opts.watermark) drawWatermark(g, width, height, opts.watermark);
  // toBlob は iframe の読み込み直しの途中で返ってこないことがあるため、同期の toDataURL を使う
  const b64 = canvas.toDataURL('image/jpeg', opts.quality ?? 0.82).split(',')[1] ?? '';
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
