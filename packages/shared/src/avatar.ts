// 写真がない犬の代わりに出す絵(犬種の色と名前の頭文字。要件定義書 6.2)。画面ごとに同じ絵になるよう共通にする。

// 落ち着いた濃い色だけ(白い頭文字が読める濃さ)。緑は使わない(docs/design.md 3章)
const PALETTE = ['#5A6472', '#8A6346', '#3D5A80', '#6B5B7A', '#8A4B45', '#4F5F6E', '#6E6450'];

export function placeholderColor(breedName: string, name = ''): string {
  let h = 0;
  for (const ch of breedName || name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function nameInitial(name: string): string {
  return [...(name.trim() || '?')][0]!;
}
