import { PHOTO_MAX_EDGE, THUMB_EDGE } from '@dr/shared';
import { api } from './api';

export type ResizedPhoto = {
  photo: Blob;
  thumb: Blob;
  /** 画面で見せるためのプレビュー(端末の中だけの URL) */
  previewUrl: string;
};

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // 写真の向き(EXIF)を反映して読み込む
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('写真を変換できませんでした'))), 'image/jpeg', quality),
  );
}

/**
 * スマホの中で写真を縮小する(要件定義書 6.2)。
 * 長い辺を 800px にした写真(約150KB)と、一覧用の正方形の小さな写真を作る。
 */
export async function resizePhoto(file: Blob): Promise<ResizedPhoto> {
  const img = await loadBitmap(file);
  const w = img.width;
  const h = img.height;

  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, h));
  const main = document.createElement('canvas');
  main.width = Math.max(1, Math.round(w * scale));
  main.height = Math.max(1, Math.round(h * scale));
  main.getContext('2d')!.drawImage(img, 0, 0, main.width, main.height);

  // 一覧用: 真ん中を正方形に切り抜く
  const side = Math.min(w, h);
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = THUMB_EDGE;
  thumbCanvas.height = THUMB_EDGE;
  thumbCanvas
    .getContext('2d')!
    .drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, THUMB_EDGE, THUMB_EDGE);

  if ('close' in img) img.close();
  const photo = await toJpeg(main, 0.82);
  const thumb = await toJpeg(thumbCanvas, 0.8);
  return { photo, thumb, previewUrl: URL.createObjectURL(thumb) };
}

export async function uploadDogPhoto(dogId: number, p: ResizedPhoto, path = `/api/dogs/${dogId}/photo`) {
  const form = new FormData();
  form.append('photo', p.photo, 'photo.jpg');
  form.append('thumb', p.thumb, 'thumb.jpg');
  return api<{ dog: import('@dr/shared').DogSummary }>(path, { method: 'POST', body: form });
}
