// 写真がない犬の代わりに出す絵(犬種の色と名前の頭文字。要件定義書 6.2)。画面ごとに同じ絵になるよう共通にする。

const PALETTE = ['#2e7a4e', '#b9741b', '#3d6a9e', '#8a4f9e', '#bf3f35', '#4f7f8a', '#7a6a2e'];

export function placeholderColor(breedName: string, name = ''): string {
  let h = 0;
  for (const ch of breedName || name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function nameInitial(name: string): string {
  return [...(name.trim() || '?')][0]!;
}
