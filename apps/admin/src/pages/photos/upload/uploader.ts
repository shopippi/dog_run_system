import {
  PHOTO_DERIVATIVES,
  PHOTO_UPLOAD_CONCURRENCY,
  type PhotoDerivative,
  type UploadStartResponse,
  type UploadTarget,
} from '@dr/shared';
import { ApiError, adminApi, adminPost } from '../../../lib/api';
import type { PickedFile } from './folders';
import { PrepareError, preparePhoto } from './process';

// 小さな自前の送り手(PF-2)。置き場所の決まり(PhotoStorage)に合わせて動く:
//   始める → (送っている途中なら)送り終えた部分を聞く → 足りない部分の送り先をもらって PUT → プレビューなどを PUT → 完了。
// 送り先は R2 の署名つき URL(ETag をヘッダーから読む)でも、Worker の URL(応答の etag)でも同じ形。
// 同時に4枚。つながらないときは少し待って送り直す。画面を読み込み直しても、同じ写真を落とし直せば、続きから送る
// (サーバーが同じアップロードを返し、送り終えた部分は送らない)。

export type FileOutcome = 'uploaded' | 'duplicate' | 'failed';
export type FileProgress = { done: boolean; outcome?: FileOutcome; message?: string; sentBytes: number };

type StatusResponse = { uploadId: string; status: string; parts: { partNumber: number; etag: string; size: number }[]; derivatives: PhotoDerivative[] };

const RETRIES = 4;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 送り直してよい失敗か(つながらない・サーバーが一時的に答えない) */
const transient = (e: unknown) => (e instanceof ApiError ? e.status === 0 || e.status === 429 || e.status >= 500 : e instanceof TypeError);

async function retrying<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let i = 0; ; i++) {
    if (signal.aborted) throw new DOMException('止めました', 'AbortError');
    try {
      return await fn();
    } catch (e) {
      if (i >= RETRIES || !transient(e)) throw e;
      await wait(800 * 2 ** i);
    }
  }
}

/**
 * 送り先へ PUT する。Worker の URL(同じサイトの /admin/api/…)は、パスだけで呼ぶ
 * (デモでは API が親の画面の中で動くため、URL のサイトが違って見えることがある)
 */
async function putTarget(target: UploadTarget, body: Blob, signal: AbortSignal): Promise<string> {
  const u = new URL(target.url, location.href);
  const sameSite = u.pathname.startsWith('/admin/api/');
  const url = sameSite ? u.pathname + u.search : target.url;
  let res: Response;
  try {
    res = await fetch(url, { method: 'PUT', headers: target.headers, body, signal, credentials: sameSite ? 'same-origin' : 'omit' });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ApiError(0, 'network', 'インターネットにつながっていないようです。つながると、続きから送ります。');
  }
  if (!res.ok) {
    let message = '写真の一部を送れませんでした。';
    try {
      const b = (await res.json()) as { error?: { message?: string } };
      if (b.error?.message) message = b.error.message;
    } catch {
      // 本文がなくてもよい
    }
    throw new ApiError(res.status, 'put_failed', message);
  }
  let etag = res.headers.get('etag');
  if (!etag && sameSite) {
    try {
      etag = ((await res.json()) as { etag?: string }).etag ?? null;
    } catch {
      etag = null;
    }
  }
  return etag ?? '';
}

export async function uploadFile(
  albumId: number,
  picked: PickedFile,
  watermark: string,
  onProgress: (sentBytes: number) => void,
  signal: AbortSignal,
): Promise<{ outcome: FileOutcome; message?: string }> {
  const { file } = picked;
  let prepared;
  try {
    prepared = await preparePhoto(file, watermark, picked.kind === 'heic');
  } catch (e) {
    return { outcome: 'failed', message: e instanceof PrepareError ? e.message : 'プレビューを作れませんでした。' };
  }
  const contentType = picked.kind === 'heic' ? (file.type === 'image/heif' ? 'image/heif' : 'image/heic') : 'image/jpeg';
  try {
    const start = await retrying(
      () =>
        adminPost<UploadStartResponse>(`/photos/albums/${albumId}/uploads`, {
          filename: file.name,
          bytes: file.size,
          contentType,
          sha256: prepared.sha256,
          width: prepared.width,
          height: prepared.height,
        }),
      signal,
    );
    if (start.duplicate) {
      onProgress(file.size);
      return { outcome: 'duplicate' };
    }
    const id = encodeURIComponent(start.uploadId);
    // 送り終えた部分(続きから送るため)
    const status = await retrying(() => adminApi<StatusResponse>(`/photos/uploads/${id}`), signal);
    const etags = new Map(status.parts.map((p) => [p.partNumber, p.etag]));
    let sent = status.parts.reduce((n, p) => n + p.size, 0);
    onProgress(sent);
    const missing = Array.from({ length: start.partCount }, (_, i) => i + 1).filter((n) => !etags.has(n));
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      const { parts } = await retrying(() => adminPost<{ parts: (UploadTarget & { partNumber: number })[] }>(`/photos/uploads/${id}/parts`, { partNumbers: batch }), signal);
      for (const t of parts) {
        const blob = file.slice((t.partNumber - 1) * start.partSize, t.partNumber * start.partSize);
        const etag = await retrying(() => putTarget(t, blob, signal), signal);
        etags.set(t.partNumber, etag);
        sent += blob.size;
        onProgress(sent);
      }
    }
    for (const kind of PHOTO_DERIVATIVES) {
      if (status.derivatives.includes(kind)) continue;
      const blob = prepared.blobs[kind];
      const target = await retrying(() => adminPost<UploadTarget>(`/photos/uploads/${id}/derivatives`, { kind, bytes: blob.size, contentType: 'image/jpeg' }), signal);
      await retrying(() => putTarget(target, blob, signal), signal);
    }
    const parts = [...etags.entries()].sort((a, b) => a[0] - b[0]).map(([partNumber, etag]) => ({ partNumber, etag }));
    const done = await retrying(() => adminPost<{ photoId: number; verified: boolean }>(`/photos/uploads/${id}/complete`, { parts }), signal);
    if (!done.verified) return { outcome: 'failed', message: '届いた写真が元の写真と一致しませんでした。もう一度落としてください。' };
    return { outcome: 'uploaded' };
  } catch (e) {
    if (signal.aborted) return { outcome: 'failed', message: '送るのを止めました。' };
    return { outcome: 'failed', message: e instanceof ApiError ? e.message : '写真を送れませんでした。もう一度落としてください。' };
  }
}

/** 同時に4枚ずつ送る。files はファイル名の順 */
export async function runQueue<T>(items: T[], worker: (item: T, index: number) => Promise<void>, concurrency = PHOTO_UPLOAD_CONCURRENCY) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!, i);
    }
  });
  await Promise.all(lanes);
}
