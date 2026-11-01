import { derivativeKindSchema, uploadCompleteSchema, uploadDerivativeSchema, uploadPartsSchema, uploadStartSchema } from '@dr/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { originOf, requireStorage } from '../../lib/photos/availability';
import { parseInput, parseJson } from '../../lib/validate';
import { toId } from '../../services/photos/admin-common';
import { abortUpload, completeUpload, derivativeTarget, partTargets, startUpload, uploadStatus } from '../../services/photos/admin-upload';

// 段階1-A(管理)。PA-2 アップロード・PF-2 一斉アップロード
// 置き場所は lib/photos/storage.ts の PhotoStorage(R2 と代わりの置き場所を同じ形で使う)。requireStorage(c) で取る。
// 代わりの置き場所への部分の受け取り口(PUT /uploads/:id/parts/:n・/derivatives/:kind)は common.ts(統合の担当)にある。
// 原本はデコードしない。完了のときに storage.sha256() で確かめ、ブラウザの値と違えば photos.hash_mismatch_at を入れる。
export const adminUploadRoutes = new Hono<AppEnv>();

const ctxOf = (c: Context<AppEnv>) => ({ staffId: c.get('staff').id, now: c.get('now'), origin: originOf(c) });

// 1枚を始める(uploadStartSchema → UploadStartResponse)。同じアルバムに同じ SHA-256 があれば duplicate
adminUploadRoutes.post('/albums/:id/uploads', async (c) => {
  const input = await parseJson(c, uploadStartSchema);
  const storage = requireStorage(c);
  return c.json(await startUpload(c.env.DB, storage, toId(c.req.param('id')), input, ctxOf(c)));
});
// 送っている途中の状態(続きから送るため。→ uploadStatusResponseSchema)
adminUploadRoutes.get('/uploads/:uploadId', async (c) => c.json(await uploadStatus(c.env.DB, requireStorage(c), c.req.param('uploadId'), c.get('now'))));
// 部分の送り先(uploadPartsSchema → uploadPartsResponseSchema)
adminUploadRoutes.post('/uploads/:uploadId/parts', async (c) => {
  const input = await parseJson(c, uploadPartsSchema);
  return c.json(await partTargets(c.env.DB, requireStorage(c), c.req.param('uploadId'), input.partNumbers, ctxOf(c)));
});
// プレビュー・サムネイル・中サイズの送り先(uploadDerivativeSchema → UploadTarget)
adminUploadRoutes.post('/uploads/:uploadId/derivatives', async (c) => {
  const input = await parseJson(c, uploadDerivativeSchema);
  const kind = parseInput(derivativeKindSchema, input.kind);
  return c.json(await derivativeTarget(c.env.DB, requireStorage(c), c.req.param('uploadId'), kind, ctxOf(c)));
});
// 完了(uploadCompleteSchema → uploadCompleteResponseSchema)。下書きとして album_photos に入る
adminUploadRoutes.post('/uploads/:uploadId/complete', async (c) => {
  const input = await parseJson(c, uploadCompleteSchema);
  return c.json(await completeUpload(c.env.DB, requireStorage(c), c.req.param('uploadId'), input.parts, ctxOf(c)));
});
// やめる(途中のファイルを消す。photos.status = 'failed'。行は消さない)
adminUploadRoutes.delete('/uploads/:uploadId', async (c) => {
  await abortUpload(c.env.DB, requireStorage(c), c.req.param('uploadId'), c.get('now'));
  return c.body(null, 204);
});
