import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApiLogin } from './booking-helpers';
import { sql } from './merge-helpers';

// 段階1-D(配信)の e2e の準備: 公開したアルバム・写真と、購入した状態(注文・明細・権利・購入済み領域のファイル)を作る。
// 公開(1-A)とお支払い(1-C)の画面ができる前でも、購入した写真の画面とダウンロードを通しで確かめられるように。
// - 行は wrangler d1 execute で直接入れる(テストの DB)
// - ファイルは、代わりの置き場所の受け取り口(PUT /admin/api/photos/uploads/:id/derivatives/:kind。段階0の共通の部品)で入れる。
//   受け取り口は写真の行のキーに書くので、入れるあいだだけ preview = 原本・thumb = 購入済み領域のキーにしておき、あとで戻す

export const SHOT_DIR_1D = process.env.SHOTS_1D ?? '/home/user/shots-photos/1d';
export function shot(name: string): string {
  mkdirSync(SHOT_DIR_1D, { recursive: true });
  return `${SHOT_DIR_1D}/${name}.png`;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 日本時間の日時("2026-11-03T09:00:00+09:00") */
export function jstIso(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600_000);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}T${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}:${pad(j.getUTCSeconds())}+09:00`;
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const sha256 = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');

/** ブラウザで見本の写真(JPEG)を作る。variant ごとに空・芝生・犬の色を変える(著作物の写真は使わない) */
export async function makeSampleJpeg(page: Page, variant: number, width: number, height: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([v, w, h]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      const skies = ['#9cc3e6', '#c9d8e8', '#f0d9b5', '#b7d3c4', '#d8c7e0', '#a9c4d9'];
      const dogs = ['#8a5a2b', '#3b3b3b', '#d9b382', '#f2f2f2', '#6b4a32', '#b8860b'];
      g.fillStyle = skies[v % skies.length]!;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#6f9a4b';
      g.fillRect(0, h * 0.62, w, h * 0.38);
      g.fillStyle = dogs[v % dogs.length]!;
      g.beginPath();
      g.ellipse(w * (0.35 + (v % 3) * 0.12), h * 0.6, w * 0.16, h * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(w * (0.48 + (v % 3) * 0.12), h * 0.48, h * 0.09, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = `${Math.round(h / 14)}px sans-serif`;
      g.fillText(`No.${v + 1}`, w * 0.05, h * 0.12);
      return c.toDataURL('image/jpeg', 0.9);
    },
    [variant, width, height] as const,
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

export type SeedAlbum = { name: string; eventDate: string; photos: number; status?: 'published' | 'ended'; saleEndsAt?: Date };
export type SeededPhoto = { id: number; albumId: number; filename: string; sha256: string; original: Buffer };

let seq = 0;

/**
 * 購入した状態を作る。user は 'Uxxx:名前'。返すのは写真(原本のバイトと SHA-256)。
 * page は見本の写真を作るのに使う(どの画面でもよい)
 */
export async function seedPurchases(
  page: Page,
  request: APIRequestContext,
  user: string,
  albums: SeedAlbum[],
  opts: { paidAt?: Date; viewSize?: [number, number] } = {},
): Promise<SeededPhoto[]> {
  const [lineId, displayName = ''] = user.split(':');
  const now = new Date();
  const nowIso = jstIso(now);
  const paidAt = jstIso(opts.paidAt ?? new Date(now.getTime() - 3600_000));
  seq += 1;
  const base = (Math.floor(Math.random() * 80_000) + 10_000) * 100 + seq;
  const customer = `(SELECT id FROM photo_customers WHERE line_user_id = ${q(lineId!)})`;
  const statements: string[] = [
    "INSERT INTO settings (key, value, updated_at) VALUES ('photo_sales_enabled', 'true', '2026-11-01T00:00:00+09:00') ON CONFLICT (key) DO UPDATE SET value = 'true'",
    `INSERT INTO photo_customers (line_user_id, display_name, created_at, updated_at) VALUES (${q(lineId!)}, ${q(displayName)}, ${q(nowIso)}, ${q(nowIso)})
       ON CONFLICT (line_user_id) WHERE line_user_id IS NOT NULL DO NOTHING`,
  ];
  const orderId = base;
  const uploads: { uploadId: string; original: Buffer; view: Buffer }[] = [];
  const photos: SeededPhoto[] = [];
  let photoNo = 0;
  let amount = 0;
  const itemStatements: string[] = [];
  for (const [ai, a] of albums.entries()) {
    const albumId = base + ai * 10_000_000 + 1_000_000;
    const status = a.status ?? 'published';
    const saleEnds = jstIso(a.saleEndsAt ?? new Date(now.getTime() + 180 * 86400_000));
    statements.push(
      `INSERT INTO albums (id, name, kind, event_date, price_list_id, status, published_at, sale_ends_at, ended_at, created_at, updated_at)
       VALUES (${albumId}, ${q(a.name)}, 'date', ${q(a.eventDate)}, 1, ${q(status)}, ${q(paidAt)}, ${q(saleEnds)}, ${status === 'ended' ? q(nowIso) : 'NULL'}, ${q(nowIso)}, ${q(nowIso)})`,
    );
    for (let i = 0; i < a.photos; i++) {
      const variant = photoNo++;
      const photoId = albumId + i + 1;
      const original = await makeSampleJpeg(page, variant, 1600, 1200);
      const [vw, vh] = opts.viewSize ?? [1024, 768];
      const view = await makeSampleJpeg(page, variant, vw, vh);
      const k = (area: string) => `${area}/${randomUUID()}/${randomUUID()}.jpg`;
      const keys = { original: k('originals'), purchased: k('purchased'), view: k('view') };
      const filename = `IMG_${String(2001 + variant).padStart(4, '0')}.JPG`;
      const uploadId = randomUUID();
      statements.push(
        `INSERT INTO photos (id, original_key, preview_key, thumb_key, view_key, purchased_key, sha256, bytes, content_type, width, height, original_filename, status, sha256_verified_at, purchased_verified_at, created_at, uploaded_at)
         VALUES (${photoId}, ${q(keys.original)}, ${q(keys.original)}, ${q(keys.purchased)}, ${q(keys.view)}, ${q(keys.purchased)}, ${q(sha256(original))}, ${original.length}, 'image/jpeg', 1600, 1200, ${q(filename)}, 'ready', ${q(nowIso)}, ${q(nowIso)}, ${q(nowIso)}, ${q(nowIso)})`,
        `INSERT INTO album_photos (album_id, photo_id, sort_order, status, published_at, created_at, updated_at) VALUES (${albumId}, ${photoId}, ${i + 1}, 'published', ${q(paidAt)}, ${q(nowIso)}, ${q(nowIso)})`,
        `INSERT INTO photo_uploads (id, photo_id, album_id, storage, part_size, part_count, status, created_at, updated_at) VALUES (${q(uploadId)}, ${photoId}, ${albumId}, 'fallback', 1572864, 1, 'uploading', ${q(nowIso)}, ${q(nowIso)})`,
      );
      itemStatements.push(
        `INSERT INTO order_items (id, order_id, kind, album_id, photo_id, unit_price, label) VALUES (${photoId}, ${orderId}, 'photo', ${albumId}, ${photoId}, 500, ${q(`${a.name} ${filename}`)})`,
        `INSERT INTO entitlements (customer_id, photo_id, order_item_id, granted_at) VALUES (${customer}, ${photoId}, ${photoId}, ${q(paidAt)})`,
      );
      amount += 500;
      uploads.push({ uploadId, original, view });
      photos.push({ id: photoId, albumId, filename, sha256: sha256(original), original });
    }
  }
  statements.push(
    `INSERT INTO orders (id, customer_id, status, amount, payment_mode, paid_at, created_at, updated_at) VALUES (${orderId}, ${customer}, 'paid', ${amount}, 'mock', ${q(paidAt)}, ${q(paidAt)}, ${q(paidAt)})`,
    ...itemStatements,
  );
  sql(statements.join(';\n'));

  // ファイル(原本 → 原本のキー・購入済み領域、中サイズ)
  await adminApiLogin(request, 'admin');
  for (const u of uploads) {
    for (const [kind, body] of [
      ['preview', u.original],
      ['thumb', u.original],
      ['view', u.view],
    ] as const) {
      const r = await request.put(`/admin/api/photos/uploads/${u.uploadId}/derivatives/${kind}`, {
        headers: { 'x-dr-admin': '1', 'content-type': 'image/jpeg' },
        data: body,
      });
      expect(r.status(), await r.text()).toBe(200);
    }
  }
  const ids = photos.map((p) => p.id).join(',');
  sql(
    `UPDATE photos SET preview_key = NULL, thumb_key = NULL WHERE id IN (${ids});
     UPDATE photo_uploads SET status = 'completed', completed_at = ${q(nowIso)} WHERE id IN (${uploads.map((u) => q(u.uploadId)).join(',')})`,
  );
  return photos;
}

/** 無圧縮の ZIP を読む(中央ディレクトリから)。名前・中身・圧縮の方式 */
export function parseStoreZip(buf: Buffer): { name: string; data: Buffer; method: number }[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP の終わりがない');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer; method: number }[] = [];
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    out.push({ name, data: buf.subarray(start, start + size), method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
