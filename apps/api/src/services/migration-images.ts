import { addDays, toJstDate, toJstIso, type Settings } from '@dr/shared';
import type { JobOutcome } from './jobs';

/** 移行期間の終わりから何日たったら、引き継ぎ申請の写真を消すか(B-06) */
export const MIGRATION_IMAGE_KEEP_DAYS = 30;

/**
 * 移行用の画像の削除(B-06。毎晩 3:10)。
 * 移行期間の終わり(settings.migration_period.end)から30日たったら、確認待ち・ほかの申請に添付された
 * 旧カードの写真(requests.attachment_key)を R2 から消し、requests.attachment_deleted_at に日時を入れる。
 * 申請の記録そのものは消さない。写真の削除は、物理削除をしない決まりの例外(個人の写った画像を長く残さないため。16.2)。
 * まだ確認待ちの申請の写真は消さずに残し、「一部だけ」として記録する(管理者が写真を見て判断できるように)。
 */
export async function deleteMigrationImages(
  db: D1Database,
  media: R2Bucket,
  now: Date,
  settings: Pick<Settings, 'migration_period'>,
): Promise<JobOutcome> {
  const end = settings.migration_period.end?.slice(0, 10) ?? null;
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { message: '移行期間の終わりが決まっていないため、写真は消していません。' };
  }
  const today = toJstDate(now);
  const deleteFrom = addDays(end, MIGRATION_IMAGE_KEEP_DAYS);
  if (today < deleteFrom) {
    return { message: `引き継ぎ申請の写真は ${deleteFrom} に消します(移行期間の終わり ${end} の${MIGRATION_IMAGE_KEEP_DAYS}日後)。` };
  }

  const { results } = await db
    .prepare(
      'SELECT id, attachment_key, status FROM requests WHERE attachment_key IS NOT NULL AND attachment_deleted_at IS NULL ORDER BY id',
    )
    .all<{ id: number; attachment_key: string; status: string }>();
  const targets = results.filter((r) => r.status !== 'pending');
  const pending = results.length - targets.length;

  const nowIso = toJstIso(now);
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    await media.delete(chunk.map((r) => r.attachment_key));
    await db.batch([
      db
        .prepare(
          `UPDATE requests SET attachment_deleted_at = ?
            WHERE attachment_deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
        )
        .bind(nowIso, JSON.stringify(chunk.map((r) => r.id))),
      db
        .prepare(
          `INSERT INTO audit_log (actor_type, action, target_type, target_id, after_value, reason, created_at)
           VALUES ('system', 'migration_images.delete', 'system', 'migration_images', ?, ?, ?)`,
        )
        .bind(JSON.stringify({ requestIds: chunk.map((r) => r.id) }), '移行期間の終了から30日たったため(毎晩の自動処理)', nowIso),
    ]);
  }

  const done = targets.length > 0 ? `引き継ぎ申請の写真を${targets.length}枚消しました。` : '消す写真はありませんでした。';
  if (pending > 0) {
    return {
      status: 'warning',
      message: `${done}確認待ちの申請が${pending}件あるため、その写真は残しています。確認待ちの画面で承認か却下をしてください。`,
    };
  }
  return { message: done };
}
