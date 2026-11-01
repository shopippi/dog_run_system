import { normalizePostal, parseZipcloud, toJstIso } from '@dr/shared';
import { errorText, JobError, type JobOutcome } from './jobs';

// 郵便番号から地域(都道府県・市区町村・町域)を調べる(docs/design.md 12.3「どこから来ているか」)。
// - 調べるのは、おうちの郵便番号のうち、まだ postal_areas にないものだけ
// - 調べ先は zipcloud(無料・登録不要の郵便番号検索。https://zipcloud.ibsnet.co.jp/doc/api)
// - 1回の実行で調べる数に上限を付け、1件ごとに間を空ける(相手のサービスに負担をかけないため。
//   Workers の無料プランは1回の実行で外へのリクエストが50件までなので、ほかの処理の分を残す)
// - 見つからなかった郵便番号は status = 'not_found' で残す(毎晩、同じ番号を調べ直さない)
// - つながらなかった・失敗した番号は残さない(次の実行で調べ直す)

export const POSTAL_LOOKUP_URL = 'https://zipcloud.ibsnet.co.jp/api/search?zipcode=';
export const POSTAL_SOURCE = 'zipcloud';
/** 1回の実行で調べる郵便番号の数 */
export const POSTAL_MAX_PER_RUN = 30;
/** 1件ごとに空ける間(ms) */
export const POSTAL_DELAY_MS = 300;

/** まだ調べていない郵便番号(7桁にそろえたもの)。古いおうちの順 */
export async function pendingPostalCodes(db: D1Database): Promise<string[]> {
  const [{ results: codes }, { results: known }] = await Promise.all([
    db
      .prepare(
        `SELECT postal_code, MIN(id) AS first_id FROM households
          WHERE postal_code IS NOT NULL AND postal_code <> '' AND status <> 'withdrawn'
          GROUP BY postal_code ORDER BY first_id`,
      )
      .all<{ postal_code: string }>(),
    db.prepare('SELECT postal_code FROM postal_areas').all<{ postal_code: string }>(),
  ]);
  const done = new Set(known.map((r) => r.postal_code));
  const out: string[] = [];
  for (const r of codes) {
    const code = normalizePostal(r.postal_code);
    if (code && !done.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export type PostalLookupOptions = {
  fetcher?: typeof fetch;
  limit?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 郵便番号を調べて postal_areas に入れる(ジョブと、管理画面の「今すぐ調べる」から呼ぶ) */
export async function lookupPostalAreas(db: D1Database, now: Date, opts: PostalLookupOptions = {}): Promise<JobOutcome> {
  const fetcher = opts.fetcher ?? fetch;
  const limit = opts.limit ?? POSTAL_MAX_PER_RUN;
  const delayMs = opts.delayMs ?? POSTAL_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;

  const pending = await pendingPostalCodes(db);
  if (pending.length === 0) return { message: '調べる郵便番号はありませんでした(すべて調べてあります)。' };
  const batch = pending.slice(0, limit);
  let found = 0;
  let notFound = 0;
  const failures: string[] = [];
  const nowIso = toJstIso(now);

  for (let i = 0; i < batch.length; i++) {
    const code = batch[i]!;
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    try {
      const res = await fetcher(`${POSTAL_LOOKUP_URL}${code}`, { headers: { 'user-agent': 'dog-run-system (postal lookup)' } });
      if (!res.ok) throw new Error(`応答 ${res.status}`);
      const area = parseZipcloud(await res.json());
      await db
        .prepare(
          `INSERT OR REPLACE INTO postal_areas (postal_code, prefecture, city, town, status, source, looked_up_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(code, area?.prefecture ?? null, area?.city ?? null, area?.town ?? null, area ? 'found' : 'not_found', POSTAL_SOURCE, nowIso)
        .run();
      if (area) found += 1;
      else notFound += 1;
    } catch (e) {
      failures.push(`${code}: ${errorText(e)}`);
    }
  }

  if (failures.length === batch.length) {
    throw new JobError(
      '郵便番号の調べ先(zipcloud)につながりませんでした。少し待ってから、もう一度お試しください。',
      failures.slice(0, 3).join(' / '),
    );
  }
  const rest = pending.length - (found + notFound);
  const parts = [`郵便番号を${found + notFound}件調べました${notFound ? `(見つからなかった番号 ${notFound}件)` : ''}。`];
  if (failures.length) parts.push(`${failures.length}件は調べられませんでした。`);
  if (rest > 0) parts.push(`残りの${rest}件は次の実行で調べます。`);
  const message = parts.join('');
  return failures.length
    ? { status: 'warning', message, detail: failures.slice(0, 5).join(' / ') }
    : { message };
}
