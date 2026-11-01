// デモの写真販売の初期データ(段階0のつなぎ口。docs/photo-requirements.md 11章)。
// 見本の写真(canvas で描いた JPEG)で、日付のアルバム1つとイベントのアルバム1つを作る。販売は止めたまま(設定 photo_sales_enabled = false)。
// 段階1の担当は、ここを使ってデモの手順(公開 → 購入 → ダウンロード)を作る。写真の置き場所は「代わりの置き場所」(env.MEDIA の photo-sales/ の下)。

import { PHOTO_FALLBACK_PREFIX, addDays, formatAlbumDate, sha256Hex, toJstDate, toJstIso } from '@dr/shared';
import type { Database } from 'sql.js';

export type PhotoSeedOptions = {
  now: Date;
  /** 見本の写真(JPEG)を作る。longEdge は長辺の px */
  makeSamplePhoto: (variant: number, longEdge?: number) => Promise<Uint8Array>;
  /** 写真の置き場所に入れる(キーは photo-sales/ を含めたもの) */
  putMedia: (key: string, bytes: Uint8Array) => Promise<void>;
  /** アルバムごとの枚数 */
  perAlbum?: number;
};

export type PhotoSeedSummary = { albums: number; photos: number };

const uuid = () => crypto.randomUUID();

/** 写真販売の見本のデータを入れる。アルバムは下書き(公開は段階1のデモの手順で) */
export async function seedPhotoSales(sql: Database, opts: PhotoSeedOptions): Promise<PhotoSeedSummary> {
  const nowIso = toJstIso(opts.now);
  const today = toJstDate(opts.now);
  const per = opts.perAlbum ?? 6;
  const albums = [
    { name: formatAlbumDate(addDays(today, -1)), kind: 'date', date: addDays(today, -1), priceListId: 1 },
    { name: '秋のわんわん運動会', kind: 'event', date: addDays(today, -3), priceListId: 2 },
  ];
  let photoCount = 0;
  for (const [ai, a] of albums.entries()) {
    sql.run(
      `INSERT INTO albums (name, kind, event_date, price_list_id, status, source_folder, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [a.name, a.kind, a.date, a.priceListId, a.kind === 'date' ? a.date : a.name, nowIso, nowIso],
    );
    const albumId = Number(sql.exec('SELECT last_insert_rowid()')[0]!.values[0]![0]);
    for (let i = 0; i < per; i++) {
      const variant = ai * per + i;
      const original = await opts.makeSamplePhoto(variant, 1800);
      const preview = await opts.makeSamplePhoto(variant, 1200);
      const thumb = await opts.makeSamplePhoto(variant, 400);
      const keys = {
        original: `originals/${uuid()}/${uuid()}.jpg`,
        preview: `preview/${uuid()}/${uuid()}.jpg`,
        thumb: `thumb/${uuid()}/${uuid()}.jpg`,
        view: `view/${uuid()}/${uuid()}.jpg`,
      };
      await opts.putMedia(PHOTO_FALLBACK_PREFIX + keys.original, original);
      await opts.putMedia(PHOTO_FALLBACK_PREFIX + keys.preview, preview);
      await opts.putMedia(PHOTO_FALLBACK_PREFIX + keys.thumb, thumb);
      await opts.putMedia(PHOTO_FALLBACK_PREFIX + keys.view, preview);
      const filename = `IMG_${String(1001 + variant).padStart(4, '0')}.JPG`;
      sql.run(
        `INSERT INTO photos (original_key, preview_key, thumb_key, view_key, sha256, bytes, content_type, width, height,
                             original_filename, status, sha256_verified_at, created_at, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, 'image/jpeg', 1800, 1200, ?, 'ready', ?, ?, ?)`,
        [keys.original, keys.preview, keys.thumb, keys.view, await sha256Hex(original), original.byteLength, filename, nowIso, nowIso, nowIso],
      );
      const photoId = Number(sql.exec('SELECT last_insert_rowid()')[0]!.values[0]![0]);
      sql.run(
        `INSERT INTO album_photos (album_id, photo_id, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)`,
        [albumId, photoId, i + 1, nowIso, nowIso],
      );
      if (i === 0) sql.run('UPDATE albums SET cover_photo_id = ? WHERE id = ?', [photoId, albumId]);
      photoCount++;
    }
  }
  return { albums: albums.length, photos: photoCount };
}
