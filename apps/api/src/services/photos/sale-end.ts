import { isDeletionNoticeDue, toJstIso } from '@dr/shared';
import type { Bindings } from '../../env';
import { loadSettings } from '../../lib/settings';
import { photoStorage } from '../../lib/photos/storage';
import { auditStatement } from '../audit';
import { errorText, type JobOutcome } from '../jobs';
import { photoAlerts } from './dashboard';

// 段階1-D(配信)。PF-8 販売期間と自動削除(毎晩 3:10 の自動処理から呼ぶ。cron.ts)。docs/photo-requirements.md 3.2・3.8
// 1) 販売終了の photo_deletion_notice_days 日前になったアルバムに deletion_notice_at を入れる(PA-1 のダッシュボードとシステムの状態に出す)。
//    延長されて、まだお知らせの時期でなくなったアルバムは、お知らせを戻す(次の時期にまた出す)。
// 2) sale_ends_at を過ぎた公開中のアルバムを ended にする(ended_at)。
// 3) ended のアルバムの、売れなかった写真のファイル(原本・プレビュー・サムネイル・中サイズ)を消す(photos.files_deleted_at、albums.files_deleted_at)。
//    - 売れた写真(有効な購入の権利がある写真)は消さない。購入済み領域(purchased_key)のファイルは、どの写真でも決して消さない。
//    - ほかの下書き・公開中のアルバムにも載っている写真は消さない(そのアルバムが終わったときに消す)。
//    - お支払い待ちの注文に入っている写真は、今夜は消さない(次の晩にやり直す)。
//    これは「物理削除しない」の唯一の例外(ファイルだけ。行は消さない。3.8)。
// 4) 途中でやめたアップロード(3日より古い)の部分のファイルを片付ける(業務の記録ではない)。
// 何度動かしても同じ結果になる(消し終えた写真・アルバムは飛ばす)。1枚が失敗しても、ほかは続け、次の晩にやり直す。
// system_jobs への記録(photo_sale_end)は photoSaleEndJob の結果を runJob に渡す(統合の担当が cron.ts に足す)。

export type PhotoSaleEndResult = {
  message: string;
  status: 'ok' | 'warning' | 'failed';
  detail?: string;
  /** 今回、販売終了にしたアルバム */
  ended: number;
  /** 今回、ファイルを消した写真 */
  filesDeleted: number;
  /** 今回、削除の前のお知らせを出したアルバム */
  notices: number;
  /** 販売終了まで photo_deletion_notice_days 日以内のアルバム(お知らせ中) */
  endingSoon: { albumId: number; name: string; saleEndsAt: string }[];
  /** お支払い待ちの注文などで、今夜は消さなかった写真 */
  deferred: number;
  /** 消せなかった写真(次の晩にやり直す) */
  failed: number;
  uploadsAborted: number;
};

const DAY_MS = 24 * 3600_000;
/** これより古い「送っている途中」のアップロードは、やめたものとして片付ける */
const ABANDONED_UPLOAD_MS = 3 * DAY_MS;
/** お支払い待ちの注文を「まだ払われるかもしれない」とみなす長さ(Stripe の Checkout の期限は最長 24 時間) */
const PENDING_ORDER_MS = 2 * DAY_MS;

type AlbumRow = { id: number; name: string; sale_ends_at: string; deletion_notice_at: string | null };
type PhotoRow = {
  id: number;
  status: string;
  original_key: string;
  preview_key: string | null;
  thumb_key: string | null;
  view_key: string | null;
  sold: number;
  elsewhere: number;
  pending: number;
};
type UploadRow = {
  id: string;
  photo_id: number;
  multipart_upload_id: string | null;
  updated_at: string;
  original_key: string;
  preview_key: string | null;
  thumb_key: string | null;
  view_key: string | null;
};

/** 夜間の処理の本体。結果を返す(runJob に渡す形は photoSaleEndJob) */
export async function runPhotoSaleEnd(env: Bindings, now: Date): Promise<PhotoSaleEndResult> {
  const db = env.DB;
  const settings = await loadSettings(db);
  const nowIso = toJstIso(now);
  const noticeDays = settings.photo_deletion_notice_days;
  const errors: string[] = [];
  const result: PhotoSaleEndResult = {
    message: '',
    status: 'ok',
    ended: 0,
    filesDeleted: 0,
    notices: 0,
    endingSoon: [],
    deferred: 0,
    failed: 0,
    uploadsAborted: 0,
  };

  // ---- 1) 2) お知らせと販売終了
  const { results: live } = await db
    .prepare("SELECT id, name, sale_ends_at, deletion_notice_at FROM albums WHERE status = 'published' AND sale_ends_at IS NOT NULL ORDER BY sale_ends_at, id")
    .all<AlbumRow>();
  const statements: D1PreparedStatement[] = [];
  for (const a of live) {
    const end = new Date(a.sale_ends_at);
    if (Number.isNaN(end.getTime())) continue;
    if (now.getTime() >= end.getTime()) {
      statements.push(
        db.prepare("UPDATE albums SET status = 'ended', ended_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'published'").bind(nowIso, a.id),
        auditStatement(db, {
          staffId: null,
          actor: { type: 'system', id: null },
          action: 'photo_album.sale_end',
          targetType: 'photo_album',
          targetId: a.id,
          before: { status: 'published', saleEndsAt: a.sale_ends_at },
          after: { status: 'ended' },
          now,
        }),
      );
      result.ended++;
    } else if (isDeletionNoticeDue(a.sale_ends_at, now, noticeDays)) {
      result.endingSoon.push({ albumId: a.id, name: a.name, saleEndsAt: a.sale_ends_at });
      if (!a.deletion_notice_at) {
        statements.push(db.prepare('UPDATE albums SET deletion_notice_at = ?1, updated_at = ?1 WHERE id = ?2 AND deletion_notice_at IS NULL').bind(nowIso, a.id));
        result.notices++;
      }
    } else if (a.deletion_notice_at) {
      // 販売期間が延長された。お知らせを戻し、次にその時期になったら、また知らせる
      statements.push(db.prepare('UPDATE albums SET deletion_notice_at = NULL, updated_at = ?1 WHERE id = ?2').bind(nowIso, a.id));
    }
  }
  if (statements.length) await db.batch(statements);

  // ---- 3) 売れなかった写真のファイルを消す
  const storage = photoStorage(env);
  const { results: ended } = await db
    .prepare("SELECT id, name FROM albums WHERE status = 'ended' AND files_deleted_at IS NULL ORDER BY id")
    .all<{ id: number; name: string }>();
  if (ended.length && !storage) {
    errors.push('写真の置き場所がないため、ファイルを消せませんでした');
  } else if (storage) {
    const pendingSince = toJstIso(new Date(now.getTime() - PENDING_ORDER_MS));
    for (const album of ended) {
      const { results: photos } = await db
        .prepare(
          `SELECT p.id, p.status, p.original_key, p.preview_key, p.thumb_key, p.view_key,
                  EXISTS (SELECT 1 FROM entitlements e WHERE e.photo_id = p.id AND e.revoked_at IS NULL) AS sold,
                  EXISTS (SELECT 1 FROM album_photos ap2 JOIN albums a2 ON a2.id = ap2.album_id
                           WHERE ap2.photo_id = p.id AND a2.id <> ?1 AND a2.status IN ('draft', 'published') AND ap2.status <> 'removed') AS elsewhere,
                  EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                           WHERE o.status = 'pending' AND o.created_at > ?2
                             AND (oi.photo_id = p.id
                                  OR (oi.kind = 'album' AND oi.album_id IN (SELECT ap3.album_id FROM album_photos ap3 WHERE ap3.photo_id = p.id)))) AS pending
             FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
            WHERE ap.album_id = ?1 AND p.files_deleted_at IS NULL
            ORDER BY p.id`,
        )
        .bind(album.id, pendingSince)
        .all<PhotoRow>();
      let complete = true;
      let deletedHere = 0;
      for (const p of photos) {
        if (p.sold || p.elsewhere) continue; // 売れた写真は残す。ほかのアルバムに載っている写真は、そちらが終わったときに
        if (p.pending || p.status === 'uploading') {
          result.deferred++;
          complete = false;
          continue;
        }
        const keys = [p.original_key, p.preview_key, p.thumb_key, p.view_key].filter((k): k is string => !!k);
        try {
          await storage.delete(keys, now);
          // 消している間に売れていないことを、もう一度確かめてから印を付ける
          await db
            .prepare(
              `UPDATE photos SET files_deleted_at = ? WHERE id = ? AND files_deleted_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.photo_id = photos.id AND e.revoked_at IS NULL)`,
            )
            .bind(nowIso, p.id)
            .run();
          result.filesDeleted++;
          deletedHere++;
        } catch (e) {
          result.failed++;
          complete = false;
          errors.push(`写真 ${p.id}: ${errorText(e)}`);
        }
      }
      if (complete) {
        await db.batch([
          db.prepare('UPDATE albums SET files_deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND files_deleted_at IS NULL').bind(nowIso, album.id),
          auditStatement(db, {
            staffId: null,
            actor: { type: 'system', id: null },
            action: 'photo_album.files_delete',
            targetType: 'photo_album',
            targetId: album.id,
            after: { deletedPhotos: deletedHere, keptSoldPhotos: photos.filter((p) => p.sold).length },
            now,
          }),
        ]);
      }
    }

    // ---- 4) 途中でやめたアップロードの片付け
    const { results: uploads } = await db
      .prepare(
        `SELECT u.id, u.photo_id, u.multipart_upload_id, u.updated_at, p.original_key, p.preview_key, p.thumb_key, p.view_key
           FROM photo_uploads u JOIN photos p ON p.id = u.photo_id WHERE u.status = 'uploading'`,
      )
      .all<UploadRow>();
    for (const u of uploads) {
      if (now.getTime() - new Date(u.updated_at).getTime() < ABANDONED_UPLOAD_MS) continue;
      try {
        await storage.abortMultipart(u.original_key, u.multipart_upload_id, now);
        await storage.delete([u.preview_key, u.thumb_key, u.view_key].filter((k): k is string => !!k), now);
        await db.batch([
          db.prepare("UPDATE photo_uploads SET status = 'aborted', updated_at = ?1 WHERE id = ?2 AND status = 'uploading'").bind(nowIso, u.id),
          db.prepare("UPDATE photos SET status = 'failed' WHERE id = ? AND status = 'uploading'").bind(u.photo_id),
        ]);
        result.uploadsAborted++;
      } catch (e) {
        errors.push(`アップロード ${u.id}: ${errorText(e)}`);
      }
    }
  }

  // ---- 結果(システムの状態に出す文)
  const alerts = await photoAlerts(db, now, settings.photo_download_limit);
  const parts: string[] = [];
  parts.push(result.ended ? `${result.ended}つのアルバムを販売終了にしました。` : '販売終了にするアルバムはありませんでした。');
  if (result.filesDeleted) parts.push(`売れなかった写真${result.filesDeleted}枚のファイルを消しました(売れた写真は残しています)。`);
  if (result.endingSoon.length) {
    const names = result.endingSoon.slice(0, 3).map((a) => `「${a.name}」`).join('');
    parts.push(
      `販売終了まで${noticeDays}日以内のアルバムが${result.endingSoon.length}つあります(${names}${result.endingSoon.length > 3 ? 'ほか' : ''})。売れなかった写真は、終了の翌晩に消えます。続けるときは、写真販売のアルバムで販売期間を延ばしてください。`,
    );
  }
  if (result.deferred) parts.push(`お支払い待ちの注文に入っている写真${result.deferred}枚は、次の晩に確かめます。`);
  if (result.uploadsAborted) parts.push(`途中でやめたアップロード${result.uploadsAborted}件を片付けました。`);
  if (alerts.hashMismatchPhotos) parts.push(`確認用の値が合わなかった写真が${alerts.hashMismatchPhotos}枚あります。製作者に連絡してください。`);
  if (alerts.downloadLimitHits) parts.push(`この24時間で、ダウンロードの上限に達した写真が${alerts.downloadLimitHits}件あります(写真販売の注文で記録を見られます)。`);
  if (errors.length) {
    parts.push(`${result.failed || errors.length}件はうまくできませんでした。次の晩に自動でやり直します。`);
    result.detail = errors.slice(0, 10).join(' / ');
  }
  result.status = errors.length || alerts.hashMismatchPhotos ? 'warning' : 'ok';
  result.message = parts.join('');
  return result;
}

/** system_jobs に残す形(runJob(env.DB, 'photo_sale_end', now, () => photoSaleEndJob(env, now))) */
export async function photoSaleEndJob(env: Bindings, now: Date): Promise<JobOutcome> {
  const r = await runPhotoSaleEnd(env, now);
  return r.detail ? { status: r.status, message: r.message, detail: r.detail } : { status: r.status, message: r.message };
}
