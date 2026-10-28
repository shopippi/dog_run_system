import { addDays, toJstDate, toJstIso } from '@dr/shared';
import type { JobOutcome } from './jobs';

/** バックアップを残す日数(B-04。要件定義書 15.2) */
export const BACKUP_KEEP_DAYS = 30;
const PREFIX = 'backups/';
/** 1回に読む行数(大きな表も少しずつ読む) */
const PAGE = 2000;

export const backupKey = (date: string) => `${PREFIX}${date}.json`;

/**
 * データベースの全テーブルを JSON にして、R2 の backups/<日付>.json に保存する(B-04)。
 * 形式: { format, version, createdAt, tables: { 表の名前: { columns: [...], rows: [[...], ...] } } }
 * 復元は製作者が行う(docs/deploy.md)。保存したあと、30日より前のバックアップを消す
 * (バックアップのファイルの削除は、物理削除をしない決まりの例外。古いものを残すと無料枠を使い切るため)。
 */
export async function backupDatabase(db: D1Database, media: R2Bucket, now: Date): Promise<JobOutcome> {
  const { results: tables } = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
    .all<{ name: string }>();

  const out: Record<string, { columns: string[]; rows: unknown[][] }> = {};
  let totalRows = 0;
  for (const { name } of tables) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    let columns: string[] = [];
    const rows: unknown[][] = [];
    let after = Number.MIN_SAFE_INTEGER;
    for (;;) {
      const page = await db
        .prepare(`SELECT rowid AS __rowid__, * FROM ${quoted} WHERE rowid > ? ORDER BY rowid LIMIT ?`)
        .bind(after, PAGE)
        .raw<unknown[]>({ columnNames: true });
      const [head, ...body] = page;
      if (head && columns.length === 0) columns = (head as string[]).slice(1);
      for (const r of body) rows.push(r.slice(1));
      if (body.length < PAGE) break;
      after = body[body.length - 1]![0] as number;
    }
    if (columns.length === 0) {
      // 空の表でも列の名前を残す
      const { results } = await db.prepare(`SELECT name FROM pragma_table_info(?)`).bind(name).all<{ name: string }>();
      columns = results.map((r) => r.name);
    }
    out[name] = { columns, rows };
    totalRows += rows.length;
  }

  const today = toJstDate(now);
  const body = JSON.stringify({ format: 'dog-run-backup', version: 1, createdAt: toJstIso(now), tables: out });
  await media.put(backupKey(today), body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { tables: String(tables.length), rows: String(totalRows) },
  });

  const removed = await removeOldBackups(media, today);
  const size = body.length >= 1024 * 1024 ? `${(body.length / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(body.length / 1024)}KB`;
  return {
    message:
      `${tables.length}個の表(合計${totalRows}行、${size})を保存しました。` +
      (removed > 0 ? `${BACKUP_KEEP_DAYS}日より前のバックアップを${removed}件消しました。` : ''),
  };
}

/** 今日を含めて BACKUP_KEEP_DAYS 日分だけを残し、それより前のバックアップを消す */
export async function removeOldBackups(media: R2Bucket, today: string): Promise<number> {
  const oldest = addDays(today, -(BACKUP_KEEP_DAYS - 1));
  const old: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await media.list({ prefix: PREFIX, cursor });
    for (const o of list.objects) {
      const m = o.key.match(/^backups\/(\d{4}-\d{2}-\d{2})\.json$/);
      if (m && m[1]! < oldest) old.push(o.key);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < old.length; i += 1000) await media.delete(old.slice(i, i + 1000));
  return old.length;
}
