// 犬を飼っている人の気持ちに寄り添う、小さな記念(docs/design.md 13章)。
// 画面と API で同じ決まりを使う。

/** チェックイン完了の画面で一言を出す、来場の回数の節目 */
export const VISIT_MILESTONES = [10, 30, 50, 100] as const;

/** 来場の回数が節目なら、その回数を返す(節目でなければ null) */
export function visitMilestone(count: number): number | null {
  return (VISIT_MILESTONES as readonly number[]).includes(count) ? count : null;
}

/** 「こむぎちゃん・だいずちゃんと 30回目の来場です」 */
export function milestoneText(dogNames: string[], count: number): string {
  const who = dogNames.length > 0 ? `${dogNames.map((n) => `${n}ちゃん`).join('・')}と ` : '';
  return `${who}${count}回目の来場です`;
}

/**
 * 今月が誕生月のワンちゃんの名前(生まれた年月 "YYYY-MM" がある子だけ)。
 * jstDate は日本時間の今日("YYYY-MM-DD")。
 */
export function birthMonthNames(dogs: { name: string; birthYm: string | null }[], jstDate: string): string[] {
  const month = jstDate.slice(5, 7);
  return dogs.filter((d) => d.birthYm !== null && d.birthYm.slice(5, 7) === month).map((d) => d.name);
}

/** 「11月はこむぎの誕生月です」(該当がなければ null) */
export function birthMonthText(dogs: { name: string; birthYm: string | null }[], jstDate: string): string | null {
  const names = birthMonthNames(dogs, jstDate);
  if (names.length === 0) return null;
  return `${Number(jstDate.slice(5, 7))}月は${names.join('・')}の誕生月です`;
}

/**
 * 今日のスタンプの位置(左上から数えて)。たまっている数 points のうち、最後の todayPoints 個。
 * 並べられる数(limit)を超える分は数えない。
 */
export function todayStampIndices(points: number, todayPoints: number, limit: number): number[] {
  const end = Math.min(points, limit);
  const start = Math.max(0, Math.min(end, points - Math.max(0, todayPoints)));
  return Array.from({ length: Math.max(0, end - start) }, (_, k) => start + k);
}
