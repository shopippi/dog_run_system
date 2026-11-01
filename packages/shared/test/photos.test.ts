import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  addMonthsJst,
  albumEntitlementPhotoIds,
  albumPhotosBulkSchema,
  cartAddSchema,
  cartLineStates,
  checkoutEntries,
  dedupeCartItems,
  cartTotal,
  checkoutSchema,
  classifyUploadFile,
  compareFileNames,
  defaultSaleEndsAt,
  downloadAllowance,
  formatAlbumDate,
  formatPhotoPrice,
  isDeletionNoticeDue,
  isOnSale,
  isSha256Hex,
  parseFolderName,
  photoWatermarkText,
  priceListCreateSchema,
  refundEligibility,
  refundSchema,
  resolveAlbumPrice,
  resolvePhotoPrice,
  sameSha256,
  settingsSchema,
  sha256Hex,
  uploadStartSchema,
} from '../src';

// 写真販売の決まり(docs/photo-requirements.md 3章・PF-1〜PF-8)

const NOW = new Date('2026-11-03T10:00:00+09:00');

describe('価格(PF-3)', () => {
  it('写真ごとの例外価格が、価格表より優先する', () => {
    expect(resolvePhotoPrice({ priceOverride: 1200, unitPrice: 500 })).toBe(1200);
    expect(resolvePhotoPrice({ priceOverride: null, unitPrice: 500 })).toBe(500);
    expect(resolvePhotoPrice({ priceOverride: undefined, unitPrice: 800 })).toBe(800);
  });
  it('アルバムまるごとの価格は、価格表に無ければ買えない(null)', () => {
    expect(resolveAlbumPrice({ albumPrice: null })).toBeNull();
    expect(resolveAlbumPrice({ albumPrice: 3000 })).toBe(3000);
  });
  it('価格は50円以上の整数円', () => {
    expect(priceListCreateSchema.safeParse({ name: '通常', unitPrice: 500, albumPrice: null }).success).toBe(true);
    expect(priceListCreateSchema.safeParse({ name: '通常', unitPrice: 49, albumPrice: null }).success).toBe(false);
    expect(priceListCreateSchema.safeParse({ name: '通常', unitPrice: 500.5, albumPrice: null }).success).toBe(false);
  });
  it('初期案: 通常 500円・イベント 800円 は migration に、販売は止めておく(設定)', () => {
    expect(DEFAULT_SETTINGS.photo_sales_enabled).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, checkin_passphrase: 'abcdefgh' }).success).toBe(true);
  });
});

describe('販売期間(PF-1・PF-8)', () => {
  it('販売終了の既定は、公開 + 6か月(時刻はそのまま)', () => {
    expect(defaultSaleEndsAt('2026-11-03T10:00:00+09:00')).toBe('2027-05-03T10:00:00+09:00');
  });
  it('月末は、その月の最後の日に切る', () => {
    expect(addMonthsJst('2026-08-31T09:00:00+09:00', 6)).toBe('2027-02-28T09:00:00+09:00');
    expect(addMonthsJst('2027-08-31T09:00:00+09:00', 6)).toBe('2028-02-29T09:00:00+09:00');
  });
  it('日本時間で数える(UTC では前の日でも)', () => {
    // UTC 2026-10-31T16:00Z = 日本時間 11/1 1:00
    expect(addMonthsJst('2026-10-31T16:00:00Z', 6)).toBe('2027-05-01T01:00:00+09:00');
  });
  it('販売中は、公開中で終了の日時より前', () => {
    expect(isOnSale({ status: 'published', saleEndsAt: '2026-11-03T10:00:01+09:00' }, NOW)).toBe(true);
    expect(isOnSale({ status: 'published', saleEndsAt: '2026-11-03T10:00:00+09:00' }, NOW)).toBe(false);
    expect(isOnSale({ status: 'draft', saleEndsAt: null }, NOW)).toBe(false);
    expect(isOnSale({ status: 'ended', saleEndsAt: null }, NOW)).toBe(false);
  });
  it('削除の7日前から、お知らせを出す', () => {
    expect(isDeletionNoticeDue('2026-11-10T10:00:00+09:00', NOW)).toBe(true);
    expect(isDeletionNoticeDue('2026-11-10T10:00:01+09:00', NOW)).toBe(false);
    expect(isDeletionNoticeDue('2026-11-03T09:00:00+09:00', NOW)).toBe(false);
  });
});

describe('まるごと購入の権利(PF-6)', () => {
  const photos = [
    { photoId: 1, status: 'published' as const, publishedAt: '2026-11-01T09:00:00+09:00' },
    { photoId: 2, status: 'published' as const, publishedAt: '2026-11-03T10:00:00+09:00' },
    // お支払いのあとに公開した
    { photoId: 3, status: 'published' as const, publishedAt: '2026-11-03T10:00:01+09:00' },
    { photoId: 4, status: 'draft' as const, publishedAt: null },
    { photoId: 5, status: 'hidden' as const, publishedAt: '2026-11-01T09:00:00+09:00' },
    { photoId: 6, status: 'removed' as const, publishedAt: '2026-11-01T09:00:00+09:00' },
    { photoId: 7, status: 'published' as const, publishedAt: '2026-11-01T09:00:00+09:00', filesDeleted: true },
  ];
  it('お支払いの確定の時点で公開中の写真だけ', () => {
    expect(albumEntitlementPhotoIds(photos, '2026-11-03T10:00:00+09:00')).toEqual([1, 2]);
  });
  it('すでに持っている写真は足さない', () => {
    expect(albumEntitlementPhotoIds(photos, '2026-11-03T10:00:00+09:00', [1])).toEqual([2]);
  });
});

describe('返金(PF-6・PA-6)', () => {
  const paidAt = '2026-11-01T10:00:00+09:00';
  it('7日以内で、ダウンロードしていなければ返金できる', () => {
    const r = refundEligibility({ paidAt, refundedAt: null, downloaded: false, now: new Date('2026-11-08T10:00:00+09:00') });
    expect(r).toEqual({ eligible: true, deadline: '2026-11-08T10:00:00+09:00' });
  });
  it('7日を過ぎたら返金できない', () => {
    const r = refundEligibility({ paidAt, refundedAt: null, downloaded: false, now: new Date('2026-11-08T10:00:01+09:00') });
    expect(r).toMatchObject({ eligible: false, reason: 'too_late' });
  });
  it('一度でもダウンロードしたら返金できない', () => {
    expect(refundEligibility({ paidAt, refundedAt: null, downloaded: true, now: NOW })).toMatchObject({ eligible: false, reason: 'downloaded' });
  });
  it('返金済み・未確定は返金できない', () => {
    expect(refundEligibility({ paidAt, refundedAt: NOW.toISOString(), downloaded: false, now: NOW })).toMatchObject({ reason: 'already_refunded' });
    expect(refundEligibility({ paidAt: null, refundedAt: null, downloaded: false, now: NOW })).toMatchObject({ reason: 'not_paid' });
  });
  it('期間は設定で変えられる', () => {
    expect(refundEligibility({ paidAt, refundedAt: null, downloaded: false, now: NOW, refundDays: 1 })).toMatchObject({ reason: 'too_late' });
  });
  it('条件の外の返金(override)にも、理由が要る', () => {
    expect(refundSchema.safeParse({ itemIds: [1], reason: '', override: true }).success).toBe(false);
    expect(refundSchema.parse({ itemIds: [1, 1], reason: '誤購入' })).toEqual({ itemIds: [1], reason: '誤購入', override: false });
  });
});

describe('ダウンロードの回数(PF-7)', () => {
  const at = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
  it('24時間で10回まで', () => {
    const nine = Array.from({ length: 9 }, (_, i) => at(i + 1));
    expect(downloadAllowance(nine, NOW)).toEqual({ allowed: true, remaining: 1, resetsAt: null });
    const ten = [...nine, at(0.5)];
    const r = downloadAllowance(ten, NOW);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    // いちばん古い記録(9時間前)が24時間を過ぎると、1回分が空く
    expect(r.resetsAt).toBe('2026-11-04T01:00:00+09:00');
  });
  it('24時間より前の記録は数えない', () => {
    const old = Array.from({ length: 10 }, () => at(24.01));
    expect(downloadAllowance(old, NOW).allowed).toBe(true);
  });
  it('上限は設定で変えられる', () => {
    expect(downloadAllowance([at(1)], NOW, { count: 1, hours: 2 }).allowed).toBe(false);
    expect(downloadAllowance([at(3)], NOW, { count: 1, hours: 2 }).allowed).toBe(true);
  });
});

describe('フォルダ名(PF-2)', () => {
  it('YYYY-MM-DD / YYYYMMDD / YYYY.MM.DD は日付のアルバム', () => {
    for (const f of ['2026-11-03', '20261103', '2026.11.03', ' 2026-11-03 ']) {
      expect(parseFolderName(f, NOW)).toEqual({ kind: 'date', eventDate: '2026-11-03', name: '2026/11/03' });
    }
  });
  it('それ以外はイベントのアルバム(開催日は今日)', () => {
    expect(parseFolderName('第3回運動会', NOW)).toEqual({ kind: 'event', eventDate: '2026-11-03', name: '第3回運動会' });
    expect(parseFolderName('2026-11-03 運動会', NOW).kind).toBe('event');
    expect(parseFolderName('2026/11/03', NOW).kind).toBe('event');
  });
  it('ありえない日付はイベントのアルバム', () => {
    expect(parseFolderName('2026-02-30', NOW).kind).toBe('event');
    expect(parseFolderName('20261301', NOW).kind).toBe('event');
    expect(parseFolderName('2028.02.29', NOW).kind).toBe('date');
  });
  it('今日は日本時間で決める', () => {
    expect(parseFolderName('運動会', new Date('2026-11-02T15:30:00Z')).eventDate).toBe('2026-11-03');
  });
  it('JPEG と HEIC だけを送り、隠しファイル・RAW・動画は飛ばす', () => {
    expect(classifyUploadFile('IMG_0001.JPG')).toBe('jpeg');
    expect(classifyUploadFile('a/b/IMG_0001.jpeg')).toBe('jpeg');
    expect(classifyUploadFile('IMG_0002.HEIC')).toBe('heic');
    expect(classifyUploadFile('noext', 'image/jpeg')).toBe('jpeg');
    expect(classifyUploadFile('.DS_Store')).toBe('skip_hidden');
    expect(classifyUploadFile('._IMG_0001.JPG')).toBe('skip_hidden');
    expect(classifyUploadFile('IMG_0003.CR3')).toBe('skip_type');
    expect(classifyUploadFile('MOV_0001.MOV')).toBe('skip_type');
  });
  it('並び順はファイル名の順(数字は数として)', () => {
    expect(['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg'].sort(compareFileNames)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });
});

describe('カート(PF-6。サーバー側・複数)', () => {
  const entries = [
    { id: 1, kind: 'photo' as const, albumId: 1, photoId: 10, unavailable: null },
    { id: 2, kind: 'photo' as const, albumId: 1, photoId: 11, unavailable: null },
    { id: 3, kind: 'album' as const, albumId: 1, photoId: null, unavailable: null },
    { id: 4, kind: 'photo' as const, albumId: 2, photoId: 20, unavailable: null },
    // 日付のアルバム 3 から入れたが、まるごと買うイベントのアルバム 1 にも載っている写真
    { id: 5, kind: 'photo' as const, albumId: 3, photoId: 12, unavailable: null },
    { id: 6, kind: 'photo' as const, albumId: 2, photoId: 21, unavailable: 'ended' as const },
    { id: 7, kind: 'photo' as const, albumId: 4, photoId: 40, unavailable: 'already_owned' as const },
  ];
  const albumPhotos = new Map([[1, new Set([10, 11, 12])]]);
  it('まるごとに含まれる1枚は redundant、買えないものは unavailable、ほかは ok', () => {
    const st = cartLineStates(entries, albumPhotos);
    expect([...st]).toEqual([
      [1, 'redundant'],
      [2, 'redundant'],
      [3, 'ok'],
      [4, 'ok'],
      [5, 'redundant'],
      [6, 'unavailable'],
      [7, 'unavailable'],
    ]);
    expect(checkoutEntries(entries, st).map((e) => e.id)).toEqual([3, 4]);
  });
  it('まるごとが買えなくなったら、1枚ずつの写真は ok に戻る', () => {
    const st = cartLineStates(entries.map((e) => (e.id === 3 ? { ...e, unavailable: 'no_album_price' as const } : e)), albumPhotos);
    expect(st.get(1)).toBe('ok');
    expect(st.get(3)).toBe('unavailable');
  });
  it('入れる前に、同じ写真(ほかのアルバムからでも)・同じアルバムのまるごとを1つにする', () => {
    const items = [
      { kind: 'photo' as const, albumId: 1, photoId: 10 },
      { kind: 'photo' as const, albumId: 3, photoId: 10 },
      { kind: 'album' as const, albumId: 1 },
      { kind: 'album' as const, albumId: 1 },
      { kind: 'photo' as const, albumId: 2, photoId: 20 },
    ];
    expect(dedupeCartItems(items)).toEqual([items[0], items[2], items[4]]);
  });
  it('合計はサーバーが決めた価格だけ。購入手続きは品物も金額も受け取らない(サーバーのカートを使う)', () => {
    expect(cartTotal([{ kind: 'photo', albumId: 1, photoId: 1, unitPrice: 500 }, { kind: 'album', albumId: 2, unitPrice: 3000 }])).toBe(3500);
    expect(checkoutSchema.parse({ items: [{ kind: 'photo', albumId: 1, photoId: 2 }], total: 1 })).toEqual({});
    expect(cartAddSchema.safeParse({ items: [] }).success).toBe(false);
    expect(cartAddSchema.safeParse({ items: [{ kind: 'photo', albumId: 1, photoId: 2 }, { kind: 'album', albumId: 3 }] }).success).toBe(true);
  });
});

describe('入力の形', () => {
  it('一括操作は action で分ける', () => {
    expect(albumPhotosBulkSchema.safeParse({ action: 'set_price', photoIds: [1], price: 600 }).success).toBe(true);
    expect(albumPhotosBulkSchema.safeParse({ action: 'move', photoIds: [1] }).success).toBe(false);
    expect(albumPhotosBulkSchema.safeParse({ action: 'delete', photoIds: [1] }).success).toBe(false);
  });
  it('アップロードは JPEG・HEIC と SHA-256 が要る', () => {
    const ok = { filename: 'IMG_1.JPG', bytes: 5_000_000, contentType: 'image/jpeg', sha256: 'a'.repeat(64) };
    expect(uploadStartSchema.safeParse(ok).success).toBe(true);
    expect(uploadStartSchema.safeParse({ ...ok, contentType: 'image/png' }).success).toBe(false);
    expect(uploadStartSchema.safeParse({ ...ok, sha256: 'xyz' }).success).toBe(false);
  });
});

describe('表示', () => {
  it('透かしは「施設の名前 SAMPLE」。設定で変えられる', () => {
    expect(photoWatermarkText({ photo_watermark_text: '', facility_name: 'グリーンドーム' })).toBe('グリーンドーム SAMPLE');
    expect(photoWatermarkText({ photo_watermark_text: ' 見本 ', facility_name: 'グリーンドーム' })).toBe('見本');
  });
  it('開催日と価格', () => {
    expect(formatAlbumDate('2026-11-03')).toBe('2026/11/03');
    expect(formatPhotoPrice(1200)).toBe('1,200円');
  });
});

describe('SHA-256', () => {
  it('よく知られた値と一致する', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(new Blob([new TextEncoder().encode('abc')]))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('バイト列の一部(view)でも、その範囲だけを計算する', async () => {
    const buf = new TextEncoder().encode('xxabcxx');
    expect(await sha256Hex(buf.subarray(2, 5))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('形と比べ方', () => {
    expect(isSha256Hex('A'.repeat(64))).toBe(true);
    expect(isSha256Hex('a'.repeat(63))).toBe(false);
    expect(sameSha256('AB'.repeat(32), 'ab'.repeat(32))).toBe(true);
    expect(sameSha256('ab'.repeat(32), 'ac'.repeat(32))).toBe(false);
    expect(sameSha256('ab', 'abc')).toBe(false);
  });
});
