import { PHOTO_MAX_EDGE, THUMB_EDGE, type DogPhotoKind, type DogSummary } from '@dr/shared';
import { adminApi } from './api';

/**
 * 管理画面での犬の写真の縮小と回転(A-04)。
 * お客さん向け(apps/liff/src/lib/photo.ts)と同じく、長い辺 800px の写真と一覧用の正方形の小さな写真を作る。
 * サーバーでは回転できないので、回転もここで行い、回した JPEG を送る。
 */

export type Rotation = 0 | 90 | 180 | 270;

export type RenderedPhoto = { photo: Blob; thumb: Blob; previewUrl: string };

/** 写真を読み込む。写真の向き(EXIF)を反映する */
export async function loadImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
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

/** 今の写真(ログインのクッキーで読む)を読み込む */
export async function loadCurrentPhoto(url: string): Promise<ImageBitmap | HTMLImageElement> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('写真を読み込めませんでした');
  return loadImage(await res.blob());
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('写真を変換できませんでした'))), 'image/jpeg', quality),
  );
}

/** 回して縮小した写真と、一覧用の正方形の写真を作る(90度ずつ、時計回り) */
export async function renderPhoto(img: ImageBitmap | HTMLImageElement, rotation: Rotation): Promise<RenderedPhoto> {
  const w = img.width;
  const h = img.height;
  const turned = rotation === 90 || rotation === 270;
  const outW0 = turned ? h : w;
  const outH0 = turned ? w : h;
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(outW0, outH0));
  const main = document.createElement('canvas');
  main.width = Math.max(1, Math.round(outW0 * scale));
  main.height = Math.max(1, Math.round(outH0 * scale));
  const g = main.getContext('2d')!;
  g.translate(main.width / 2, main.height / 2);
  g.rotate((rotation * Math.PI) / 180);
  const dw = (turned ? main.height : main.width);
  const dh = (turned ? main.width : main.height);
  g.drawImage(img, -dw / 2, -dh / 2, dw, dh);

  // 一覧用: 回した写真の真ん中を正方形に切り抜く
  const side = Math.min(main.width, main.height);
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = THUMB_EDGE;
  thumbCanvas.height = THUMB_EDGE;
  thumbCanvas
    .getContext('2d')!
    .drawImage(main, (main.width - side) / 2, (main.height - side) / 2, side, side, 0, 0, THUMB_EDGE, THUMB_EDGE);

  const photo = await toJpeg(main, 0.82);
  const thumb = await toJpeg(thumbCanvas, 0.8);
  return { photo, thumb, previewUrl: URL.createObjectURL(photo) };
}

export async function uploadAdminDogPhoto(dogId: number, p: RenderedPhoto, kind: DogPhotoKind) {
  const form = new FormData();
  form.append('photo', p.photo, 'photo.jpg');
  form.append('thumb', p.thumb, 'thumb.jpg');
  form.append('kind', kind);
  return adminApi<{ dog: DogSummary }>(`/dogs/${dogId}/photo`, { method: 'POST', body: form });
}
