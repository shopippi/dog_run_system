// デモの写真販売の初期データ(docs/photo-requirements.md 11章・docs/demo.md 手順10)。
// - 販売は「する」(設定 photo_sales_enabled = true)。写真は代わりの置き場所(env.MEDIA の photo-sales/ の下)、支払いはまねの Stripe
// - 公開中のアルバム4つ(日付3つ・イベント「ハロウィン仮装の日」)。見本の写真はブラウザの canvas で描く(著作物の写真は使わない)
// - プレビュー・サムネイルは、管理画面のアップロードと同じ透かし(施設の名前 SAMPLE)
// - 価格表: 通常 500円、イベント 800円(まるごと 4,000円)
// - こむぎママは写真3枚を、nico.mama はハロウィンのアルバムまるごとを、前に買ったことにする(購入した写真・注文の一覧が空にならない)

import { DEFAULT_SETTINGS, PHOTO_FALLBACK_PREFIX, addDays, defaultSaleEndsAt, formatAlbumDate, photoWatermarkText, sha256Hex, toJstDate, toJstIso } from '@dr/shared';
import type { Database, SqlValue } from 'sql.js';

export type SampleTheme = 'park' | 'halloween';

export type PhotoSeedOptions = {
  now: Date;
  /** 見本の写真(JPEG)を作る。longEdge は長辺の px。watermark を渡すと透かしを敷く */
  makeSamplePhoto: (variant: number, longEdge?: number, opts?: { theme?: SampleTheme; watermark?: string; quality?: number }) => Promise<Uint8Array>;
  /** 写真の置き場所に入れる(キーは photo-sales/ を含めたもの) */
  putMedia: (key: string, bytes: Uint8Array) => Promise<void>;
  /** アルバムごとの枚数を減らす(テスト用) */
  perAlbum?: number;
};

export type PhotoSeedSummary = { albums: number; photos: number; orders: number };

/** 前に写真を買ったことにするお客さん(LINE のアカウント) */
export const PHOTO_BUYERS = { photos: 'U-demo-mama', album: 'U-demo-nico' } as const;

const uuid = () => crypto.randomUUID();
const keyOf = (area: string) => `${area}/${uuid()}/${uuid()}.jpg`;

function run(sql: Database, query: string, params: SqlValue[] = []): number {
  sql.run(query, params);
  return Number(sql.exec('SELECT last_insert_rowid()')[0]!.values[0]![0]);
}

/** 日本時間の日付と時刻から日時の文字列 */
const at = (ymd: string, hhmm: string) => `${ymd}T${hhmm}:00+09:00`;

/** いちばん近い過去の 10月31日(60日より前なら、3週間前のイベントにする) */
export function halloweenDate(today: string): string {
  const y = Number(today.slice(0, 4));
  const d = today >= `${y}-10-31` ? `${y}-10-31` : `${y - 1}-10-31`;
  return addDays(today, -60) <= d ? d : addDays(today, -21);
}

type SeededPhoto = { photoId: number; filename: string; originalBytes: Uint8Array };

export async function seedPhotoSales(sql: Database, opts: PhotoSeedOptions): Promise<PhotoSeedSummary> {
  const nowIso = toJstIso(opts.now);
  const today = toJstDate(opts.now);
  const watermark = photoWatermarkText({ photo_watermark_text: '', facility_name: DEFAULT_SETTINGS.facility_name });
  const cap = (n: number) => Math.min(n, opts.perAlbum ?? n);

  // ---- 設定と価格表
  sql.run(
    `INSERT INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [nowIso],
  );
  sql.run('UPDATE price_lists SET album_price = 4000, updated_at = ? WHERE id = 2', [nowIso]);

  // ---- アルバム
  const halloween = halloweenDate(today);
  const albums = [
    { name: formatAlbumDate(addDays(today, -1)), kind: 'date', date: addDays(today, -1), list: 1, count: cap(16), theme: 'park' as const },
    { name: formatAlbumDate(addDays(today, -7)), kind: 'date', date: addDays(today, -7), list: 1, count: cap(14), theme: 'park' as const },
    { name: 'ハロウィン仮装の日', kind: 'event', date: halloween, list: 2, count: cap(16), theme: 'halloween' as const },
    { name: formatAlbumDate(addDays(today, -14)), kind: 'date', date: addDays(today, -14), list: 1, count: cap(12), theme: 'park' as const },
  ];

  const albumPhotos: SeededPhoto[][] = [];
  const albumIds: number[] = [];
  let variant = 0;
  let photoCount = 0;
  for (const a of albums) {
    // 撮った日の夜に公開した(今より後にはしない)
    const publishedAt = at(a.date, '19:30') <= nowIso ? at(a.date, '19:30') : nowIso;
    const albumId = run(
      sql,
      `INSERT INTO albums (name, kind, event_date, price_list_id, status, published_at, sale_ends_at, source_folder, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`,
      [a.name, a.kind, a.date, a.list, publishedAt, defaultSaleEndsAt(publishedAt, 6), a.kind === 'date' ? a.date : a.name, publishedAt, publishedAt],
    );
    albumIds.push(albumId);
    const list: SeededPhoto[] = [];
    for (let i = 0; i < a.count; i++, variant++) {
      const original = await opts.makeSamplePhoto(variant, 1600, { theme: a.theme, quality: 0.86 });
      const preview = await opts.makeSamplePhoto(variant, 1200, { theme: a.theme, watermark, quality: 0.7 });
      const thumb = await opts.makeSamplePhoto(variant, 400, { theme: a.theme, watermark, quality: 0.7 });
      const keys = { original: keyOf('originals'), preview: keyOf('preview'), thumb: keyOf('thumb'), view: keyOf('view') };
      await opts.putMedia(PHOTO_FALLBACK_PREFIX + keys.original, original);
      await opts.putMedia(PHOTO_FALLBACK_PREFIX + keys.preview, preview);
      await opts.putMedia(PHOTO_FALLBACK_PREFIX + keys.thumb, thumb);
      // 中サイズ(透かしなし)は、デモでは原本と同じ写真を使う
      await opts.putMedia(PHOTO_FALLBACK_PREFIX + keys.view, original);
      const filename = `IMG_${String(2101 + variant).padStart(4, '0')}.JPG`;
      const photoId = run(
        sql,
        `INSERT INTO photos (original_key, preview_key, thumb_key, view_key, sha256, bytes, content_type, width, height,
                             original_filename, status, sha256_verified_at, created_at, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, 'image/jpeg', 1600, 1067, ?, 'ready', ?, ?, ?)`,
        [keys.original, keys.preview, keys.thumb, keys.view, await sha256Hex(original), original.byteLength, filename, publishedAt, publishedAt, publishedAt],
      );
      sql.run(
        `INSERT INTO album_photos (album_id, photo_id, sort_order, status, published_at, created_at, updated_at)
         VALUES (?, ?, ?, 'published', ?, ?, ?)`,
        [albumId, photoId, i + 1, publishedAt, publishedAt, publishedAt],
      );
      if (i === 0) sql.run('UPDATE albums SET cover_photo_id = ? WHERE id = ?', [photoId, albumId]);
      list.push({ photoId, filename, originalBytes: original });
      photoCount++;
    }
    albumPhotos.push(list);
  }

  // ---- 前の購入(購入者・注文・明細・権利・購入済み領域のコピー)
  const customerOf = (lineUserId: string): number | null => {
    const m = sql.exec(`SELECT id, household_id, line_display_name FROM family_members WHERE line_user_id = ? AND status = 'active'`, [lineUserId])[0]?.values[0];
    if (!m) return null;
    return run(
      sql,
      `INSERT INTO photo_customers (line_user_id, display_name, family_member_id, household_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [lineUserId, m[2] as string, m[0] as number, m[1] as number, nowIso, nowIso],
    );
  };
  const copied = new Set<number>();
  const copyToPurchased = async (p: SeededPhoto, when: string) => {
    if (copied.has(p.photoId)) return;
    const key = keyOf('purchased');
    await opts.putMedia(PHOTO_FALLBACK_PREFIX + key, p.originalBytes);
    sql.run('UPDATE photos SET purchased_key = ?, purchased_verified_at = ? WHERE id = ?', [key, when, p.photoId]);
    copied.add(p.photoId);
  };
  const newOrder = (customerId: number, amount: number, paidAt: string) => {
    const orderId = run(
      sql,
      `INSERT INTO orders (customer_id, household_id, status, amount, currency, payment_mode, paid_at, created_at, updated_at)
       SELECT id, household_id, 'paid', ?, 'jpy', 'mock', ?, ?, ? FROM photo_customers WHERE id = ?`,
      [amount, paidAt, paidAt, paidAt, customerId],
    );
    const hex = Array.from({ length: 16 }, (_, i) => ((orderId * 7 + i * 3) % 16).toString(16)).join('');
    sql.run('UPDATE orders SET stripe_session_id = ?, stripe_payment_intent = ? WHERE id = ?', [`cs_mock_${orderId}_${hex}`, `pi_mock_${orderId}`, orderId]);
    return orderId;
  };
  let orders = 0;

  // こむぎママ: 1週間前のアルバムから3枚(500円 × 3)。1枚はもうダウンロードした
  const mama = customerOf(PHOTO_BUYERS.photos);
  if (mama) {
    const paidAt = at(addDays(today, -6), '20:12');
    const orderId = newOrder(mama, 1500, paidAt);
    const bought = albumPhotos[1]!.slice(2, 5);
    for (const p of bought) {
      const itemId = run(sql, `INSERT INTO order_items (order_id, kind, album_id, photo_id, unit_price, label) VALUES (?, 'photo', ?, ?, 500, ?)`, [
        orderId,
        albumIds[1]!,
        p.photoId,
        `${albums[1]!.name} ${p.filename}`,
      ]);
      sql.run('INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at) VALUES (?, ?, ?, ?)', [mama, p.photoId, itemId, paidAt]);
      await copyToPurchased(p, paidAt);
    }
    sql.run(
      `INSERT INTO download_logs (customer_id, photo_id, entitlement_id, kind, ip_hash, user_agent, created_at)
       SELECT ?, ?, id, 'original', 'demo', 'デモのスマホ', ? FROM entitlements WHERE customer_id = ? AND photo_id = ?`,
      [mama, bought[0]!.photoId, at(addDays(today, -6), '20:20'), mama, bought[0]!.photoId],
    );
    orders++;
  }

  // nico.mama: ハロウィンのアルバムまるごと(4,000円)
  const nico = customerOf(PHOTO_BUYERS.album);
  if (nico) {
    const day = addDays(halloween, 2) <= addDays(today, -1) ? addDays(halloween, 2) : addDays(today, -1);
    const paidAt = at(day, '21:05');
    const photos = albumPhotos[2]!;
    const orderId = newOrder(nico, 4000, paidAt);
    const itemId = run(sql, `INSERT INTO order_items (order_id, kind, album_id, photo_id, unit_price, label) VALUES (?, 'album', ?, NULL, 4000, ?)`, [
      orderId,
      albumIds[2]!,
      `アルバムまるごと(${photos.length}枚)`,
    ]);
    for (const p of photos) {
      sql.run('INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at) VALUES (?, ?, ?, ?)', [nico, p.photoId, itemId, paidAt]);
      await copyToPurchased(p, paidAt);
    }
    orders++;
  }

  return { albums: albums.length, photos: photoCount, orders };
}
