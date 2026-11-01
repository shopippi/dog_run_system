import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { notImplemented } from '../../lib/photos/availability';

// 段階1-A(管理)。PA-2 アップロード・PF-2 一斉アップロード
// 置き場所は lib/photos/storage.ts の PhotoStorage(R2 と代わりの置き場所を同じ形で使う)。requireStorage(c) で取る。
// 代わりの置き場所への部分の受け取り口(PUT /uploads/:id/parts/:n・/derivatives/:kind)は common.ts(統合の担当)にある。
// 原本はデコードしない。完了のときに storage.sha256() で確かめ、ブラウザの値と違えば photos.hash_mismatch_at を入れる。
export const adminUploadRoutes = new Hono<AppEnv>();

const todo = async (): Promise<never> => {
  throw notImplemented();
};

// 1枚を始める(uploadStartSchema → UploadStartResponse)。同じアルバムに同じ SHA-256 があれば duplicate
adminUploadRoutes.post('/albums/:id/uploads', todo);
// 送っている途中の状態(続きから送るため。→ uploadStatusResponseSchema)
adminUploadRoutes.get('/uploads/:uploadId', todo);
// 部分の送り先(uploadPartsSchema → uploadPartsResponseSchema)
adminUploadRoutes.post('/uploads/:uploadId/parts', todo);
// プレビュー・サムネイル・中サイズの送り先(uploadDerivativeSchema → UploadTarget)
adminUploadRoutes.post('/uploads/:uploadId/derivatives', todo);
// 完了(uploadCompleteSchema → uploadCompleteResponseSchema)。下書きとして album_photos に入る
adminUploadRoutes.post('/uploads/:uploadId/complete', todo);
// やめる(途中のファイルを消す。photos.status = 'failed'。行は消さない)
adminUploadRoutes.delete('/uploads/:uploadId', todo);
