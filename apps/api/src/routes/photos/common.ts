import { PHOTO_DERIVATIVES, type PhotoConfigResponse, type PhotoDerivative, type PhotoLegalResponse } from '@dr/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../../env';
import { AppError, errors } from '../../lib/errors';
import { photoAvailability, requireStorage } from '../../lib/photos/availability';
import { verifyFileToken } from '../../lib/photos/file-token';
import { fileTokenSecret } from '../../lib/photos/storage';
import { contentDisposition } from '../../lib/photos/s3';
import { loadSettings } from '../../lib/settings';

// 写真販売の共通の部品(段階0・統合の担当のファイル。段階1の各担当は変えない。docs/photo-stage1-brief.md)
// - photoConfigRoutes: お客さん向け。準備中かどうか(GET /api/photos/config)
// - photoLegalRoutes: 認証なし。特定商取引法に基づく表記・利用規約・プライバシーポリシー(Stripe の審査に要る)
// - photoFileRoutes: 認証なし。代わりの置き場所の、短い期限の受け取り口(R2 の署名つき URL の代わり)
// - photoAvailabilityRoutes: 管理画面。置き場所・決済・設定の状態
// - photoFallbackUploadRoutes: 管理画面。代わりの置き場所への、原本の部分とプレビューなどの受け取り口

// ---------------------------------------------------------------- お客さん: 準備中かどうか(PU-1)

export const photoConfigRoutes = new Hono<AppEnv>();
photoConfigRoutes.get('/config', async (c) => {
  const settings = await loadSettings(c.env.DB);
  const a = photoAvailability(c.env, settings);
  const body: PhotoConfigResponse = {
    available: a.available,
    // お客さんには理由の内訳を出さない(「準備中」だけ)
    message: a.available ? null : '写真の販売は準備中です。始まるまで、もうしばらくお待ちください。',
    facilityName: settings.facility_name,
    refundDays: settings.photo_refund_days,
    downloadLimit: settings.photo_download_limit,
  };
  return c.json(body);
});

// ---------------------------------------------------------------- 認証なし: 法定表示

export const photoLegalRoutes = new Hono<AppEnv>();
photoLegalRoutes.get('/legal', async (c) => {
  const s = await loadSettings(c.env.DB);
  const body: PhotoLegalResponse = { facilityName: s.facility_name, tokushoho: s.photo_tokushoho_text, terms: s.photo_terms_text, privacy: s.privacy_text };
  return c.json(body);
});

// ---------------------------------------------------------------- 認証なし: 代わりの置き場所の受け取り口(1枚)

type SingleFileToken = { e: number; k: string; f: string; t: string };

export const photoFileRoutes = new Hono<AppEnv>();
photoFileRoutes.get('/files/:token', async (c) => {
  const secret = fileTokenSecret(c.env);
  const storage = requireStorage(c);
  if (!secret || storage.kind !== 'fallback') throw errors.notFound();
  const p = await verifyFileToken<SingleFileToken>(secret, c.req.param('token'), c.get('now'));
  if (!p || typeof p.k !== 'string') {
    throw new AppError(410, 'link_expired', 'ダウンロードの期限(5分)が切れました。購入した写真の画面から、もう一度ダウンロードしてください。');
  }
  const file = await storage.get(p.k);
  if (!file) throw errors.notFound('写真が見つかりませんでした。お店に知らせてください。');
  return new Response(file.body, {
    headers: {
      'content-type': p.t || file.contentType || 'application/octet-stream',
      'content-length': String(file.size),
      'content-disposition': contentDisposition(p.f || 'photo.jpg'),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});

// ---------------------------------------------------------------- 管理画面: 状態

export const photoAvailabilityRoutes = new Hono<AppEnv>();
photoAvailabilityRoutes.get('/availability', async (c) => c.json(photoAvailability(c.env, await loadSettings(c.env.DB))));

// ---------------------------------------------------------------- 管理画面: 代わりの置き場所への受け取り口

/** 部分の上限(D1 の1行に入る大きさ) */
const FALLBACK_BODY_LIMIT = 1_900_000;
const tooLarge = () => new AppError(413, 'too_large', '送った写真の部分が大きすぎます。画面を読み込み直して、もう一度送ってください。');
const fallbackLimit = bodyLimit({ maxSize: FALLBACK_BODY_LIMIT, onError: () => { throw tooLarge(); } });

type UploadRow = {
  id: string;
  status: string;
  storage: string;
  part_count: number;
  part_size: number;
  original_key: string;
  preview_key: string | null;
  thumb_key: string | null;
  view_key: string | null;
};

async function findUpload(db: D1Database, id: string): Promise<UploadRow> {
  const row = await db
    .prepare(
      `SELECT u.id, u.status, u.storage, u.part_count, u.part_size, p.original_key, p.preview_key, p.thumb_key, p.view_key
         FROM photo_uploads u JOIN photos p ON p.id = u.photo_id WHERE u.id = ?`,
    )
    .bind(id)
    .first<UploadRow>();
  if (!row) throw errors.notFound('送っている途中の写真が見つかりませんでした。もう一度、写真を落としてください。');
  if (row.status !== 'uploading') {
    throw errors.conflict('upload_closed', 'この写真は、もう送り終えたか、送るのをやめています。画面を読み込み直してください。');
  }
  return row;
}

export const photoFallbackUploadRoutes = new Hono<AppEnv>();

photoFallbackUploadRoutes.put('/uploads/:uploadId/parts/:n', fallbackLimit, async (c) => {
  const storage = requireStorage(c);
  if (storage.kind !== 'fallback' || !storage.putPart) throw errors.notFound();
  const up = await findUpload(c.env.DB, c.req.param('uploadId'));
  if (up.storage !== 'fallback') throw errors.notFound();
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1 || n > up.part_count) throw errors.badRequest('送る部分の番号が正しくありません。もう一度、写真を落としてください。');
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > up.part_size) throw tooLarge();
  const { etag } = await storage.putPart(up.original_key, n, body);
  c.header('etag', etag);
  return c.json({ partNumber: n, etag });
});

photoFallbackUploadRoutes.put('/uploads/:uploadId/derivatives/:kind', fallbackLimit, async (c) => {
  const storage = requireStorage(c);
  if (storage.kind !== 'fallback') throw errors.notFound();
  const kind = c.req.param('kind') as PhotoDerivative;
  if (!(PHOTO_DERIVATIVES as readonly string[]).includes(kind)) throw errors.notFound();
  const up = await findUpload(c.env.DB, c.req.param('uploadId'));
  const key = up[`${kind}_key`];
  if (!key) throw errors.notFound();
  if ((c.req.header('content-type') ?? '') !== 'image/jpeg') throw errors.badRequest('プレビューは JPEG で送ってください。画面を読み込み直してください。');
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) throw errors.badRequest('写真が空です。もう一度、写真を落としてください。');
  await storage.put(key, body, 'image/jpeg');
  c.header('etag', `"${kind}"`);
  return c.json({ kind, bytes: body.byteLength });
});
