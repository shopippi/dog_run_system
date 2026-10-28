// 検索用の文字の正規化。ひらがなとカタカナ、全角と半角、大文字と小文字を区別しない(要件定義書 6.3)。

/** 検索のために文字をそろえる。カタカナはひらがなにし、英数字は半角の小文字にする。 */
export function normalizeForSearch(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 犬の名前から、おうちの呼び名を自動で作る(例: アル・ニコのおうち)。 */
export function autoHouseholdName(dogNames: string[]): string {
  const names = dogNames.map((n) => n.trim()).filter((n) => n.length > 0);
  if (names.length === 0) return 'おうち';
  return `${names.join('・')}のおうち`;
}
