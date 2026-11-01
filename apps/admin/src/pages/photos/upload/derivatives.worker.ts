/// <reference lib="ES2022" />
import { PHOTO_DERIVATIVE_SPECS, PHOTO_DERIVATIVES, sha256Hex, type PhotoDerivative } from '@dr/shared';
import { drawWatermark, fitLongEdge } from './watermark';

// 写真のプレビュー・サムネイル・中サイズを作る Web Worker(docs/photo-requirements.md 3.3)。画面を止めないよう、別のスレッドで動く。
// - 原本の SHA-256 は、原本のバイトそのものから計算する(デコードしない)
// - プレビュー(長辺1200px・品質0.7・透かし)、サムネイル(長辺400px・透かし)、中サイズ(長辺2048px・透かしなし)。
//   canvas で描き直すので、元の写真の EXIF(撮影場所など)は入らない。向きは EXIF の向きに合わせる(from-image)
// - HEIC をこの端末で読めないときは decode を返す(画面が heic2any で JPEG にしてから、もう一度頼む。原本は HEIC のまま)

export type DeriveRequest = {
  id: number;
  /** 原本(ハッシュを計算する) */
  original: Blob;
  /** 画像として読むもの(HEIC を JPEG にしたもの。省くと原本を読む) */
  decodable?: Blob;
  watermark: string;
  /** ハッシュは計算済み(HEIC を変換して頼み直すとき) */
  sha256?: string;
};

export type DeriveResult =
  | { id: number; ok: true; sha256: string; width: number; height: number; blobs: Record<PhotoDerivative, Blob> }
  | { id: number; ok: false; reason: 'decode' | 'other'; sha256: string | null; message: string };

type Scope = { onmessage: ((e: MessageEvent<DeriveRequest>) => void) | null; postMessage(m: DeriveResult): void };
const scope = self as unknown as Scope;

async function render(bitmap: ImageBitmap, kind: PhotoDerivative, watermark: string): Promise<Blob> {
  const spec = PHOTO_DERIVATIVE_SPECS[kind];
  const size = fitLongEdge(bitmap.width, bitmap.height, spec.longEdge);
  // 大きく縮めるときは、ブラウザのきれいな縮小を使う
  const scaled = await createImageBitmap(bitmap, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(size.width, size.height);
  const g = canvas.getContext('2d')!;
  g.drawImage(scaled, 0, 0);
  scaled.close();
  if (spec.watermark) drawWatermark(g, size.width, size.height, watermark);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: spec.quality });
}

scope.onmessage = async (e) => {
  const req = e.data;
  let sha256: string | null = req.sha256 ?? null;
  try {
    sha256 ??= await sha256Hex(req.original);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(req.decodable ?? req.original, { imageOrientation: 'from-image' });
    } catch {
      scope.postMessage({ id: req.id, ok: false, reason: 'decode', sha256, message: 'この写真を読み込めませんでした。' });
      return;
    }
    const blobs = {} as Record<PhotoDerivative, Blob>;
    for (const kind of PHOTO_DERIVATIVES) blobs[kind] = await render(bitmap, kind, req.watermark);
    const out: DeriveResult = { id: req.id, ok: true, sha256, width: bitmap.width, height: bitmap.height, blobs };
    bitmap.close();
    scope.postMessage(out);
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, reason: 'other', sha256, message: err instanceof Error ? err.message : String(err) });
  }
};
