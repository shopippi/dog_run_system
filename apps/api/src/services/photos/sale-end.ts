import type { Bindings } from '../../env';

// 段階1-D(配信)。PF-8 販売期間と自動削除(毎晩 3:10 の自動処理から呼ぶ。cron.ts)
// 作ること:
// 1) 販売終了の photo_deletion_notice_days 日前のアルバムに deletion_notice_at を入れ、管理者に知らせる(PA-1 のダッシュボードに出す。メールは将来)
// 2) sale_ends_at を過ぎた公開中のアルバムを ended にする(ended_at)
// 3) ended のアルバムの、売れなかった写真のファイル(原本・プレビュー・サムネイル・中サイズ)を消す(photos.files_deleted_at、albums.files_deleted_at)。
//    ほかの販売中のアルバムにも載っている写真は消さない。売れた写真の purchased_key のファイルは決して消さない。
//    これは「物理削除しない」の唯一の例外(ファイルだけ。行は消さない。docs/photo-requirements.md 3.8)
// 4) 結果を system_jobs に残す(SYSTEM_JOB_NAMES に 'photo_sale_end' を足す。システムの状態に出る)
// いまは何もしない(写真の行がない・販売が始まっていないため、消すものはない)。

export type PhotoSaleEndResult = { message: string; ended: number; filesDeleted: number; notices: number };

export async function runPhotoSaleEnd(_env: Bindings, _now: Date): Promise<PhotoSaleEndResult> {
  return { message: '写真の販売終了の処理は、まだ作っていません(段階1-D)。', ended: 0, filesDeleted: 0, notices: 0 };
}
