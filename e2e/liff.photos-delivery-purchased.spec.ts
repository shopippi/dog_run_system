import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { authHeaders } from './customer-helpers';
import { checkScreen } from './households-helpers';
import { newLineUser, openLiff } from './helpers';
import { liffShot } from './liff-shot';
import { parseStoreZip, resetPhotoSales, seedPurchases, sha256, shot } from './photos-delivery-helpers';
import { newDevicePage, vqaDeviceList, VqaLog } from './visual-qa-helpers';

// PU-7 購入した写真(段階1-D)。一覧(アルバム別・透かしなしの中サイズ)→ 原本のダウンロード → まとめて ZIP。
// 受け取ったファイルが原本とバイト単位で同じこと(SHA-256)を確かめる。見え方(重なり・はみ出し・押す大きさ)も。

test.describe.configure({ timeout: 120_000 });
test.afterAll(() => resetPhotoSales());

const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true } as const;

async function openPurchased(page: Page, user: string) {
  await openLiff(page, user, '/photos/purchased');
  await page.getByRole('heading', { name: '購入した写真', exact: true }).waitFor();
}

/** 写真が読み込まれるまで待つ(認証つきの API から blob にして出す) */
async function waitImages(page: Page, n: number) {
  await expect(page.locator('.ph-grid img')).toHaveCount(n, { timeout: 15_000 });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.ph-grid img')].every((i) => i.complete && i.naturalWidth > 0));
}

test('購入した写真: アルバム別に出て、原本をダウンロードできる(バイト単位で同じ)', async ({ browser, request }) => {
  const page = await browser.newPage(PHONE);
  const user = newLineUser('パパ');
  await page.goto('/liff/');
  const photos = await seedPurchases(page, request, user, [
    { name: '11月1日のドッグラン', eventDate: '2026-11-01', photos: 3 },
    { name: '秋のわんわん運動会', eventDate: '2026-10-12', photos: 2, status: 'ended', saleEndsAt: new Date(Date.now() - 86400_000) },
  ]);
  await openPurchased(page, user);
  await expect(page.getByRole('region', { name: '11月1日のドッグラン' })).toContainText('2026/11/01・3枚');
  // 販売が終わったアルバムの写真も残っている
  await expect(page.getByRole('region', { name: '秋のわんわん運動会' })).toContainText('2026/10/12・2枚');
  await waitImages(page, 5);
  await checkScreen(page, '393x759', 'PU-7 購入した写真', true);
  await liffShot(page, shot('liff-PU-7-purchased'));

  // 1枚を開いて、原本をダウンロード
  await page.getByRole('button', { name: 'IMG_2001.JPGを開く' }).click();
  const sheet = page.getByRole('dialog', { name: 'IMG_2001.JPG' });
  await expect(sheet).toContainText('あと10回ダウンロードできます(24時間で10回まで)');
  await expect(sheet.locator('.pu-view img')).toBeVisible();
  await liffShot(page, shot('liff-PU-7-sheet'));
  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: '原本をダウンロード' }).click()]);
  expect(download.suggestedFilename()).toBe('IMG_2001.JPG');
  const file = readFileSync((await download.path())!);
  expect(sha256(file)).toBe(photos[0]!.sha256);
  await expect(page.getByRole('status').filter({ hasText: 'ダウンロードを始めました' })).toBeVisible();

  // まとめてダウンロード(ZIP。中は原本と同じ)
  await page.getByRole('button', { name: 'まとめてダウンロード' }).click();
  await page.getByRole('region', { name: '11月1日のドッグラン' }).getByRole('button', { name: '全部選ぶ' }).click();
  await page.getByRole('button', { name: 'IMG_2004.JPG', exact: true }).click();
  await expect(page.getByRole('button', { name: '選んだ4枚をダウンロード' })).toBeEnabled();
  await checkScreen(page, '393x759', 'PU-7 まとめてダウンロード', true);
  await liffShot(page, shot('liff-PU-7-select'));
  const [zipDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '選んだ4枚をダウンロード' }).click()]);
  expect(await zipDl.failure()).toBeNull();
  // 日本語のファイル名(Linux のブラウザが C ロケールで動くときは、ファイル名を表せず "download" になる)
  expect(zipDl.suggestedFilename()).toMatch(/^(グリーンドーム_写真_\d{8}\.zip|download)$/);
  const entries = parseStoreZip(readFileSync((await zipDl.path())!));
  const byName = new Map(photos.map((p) => [p.filename, p.sha256]));
  expect(entries.map((e) => e.name).sort()).toEqual(['IMG_2001.JPG', 'IMG_2002.JPG', 'IMG_2003.JPG', 'IMG_2004.JPG']);
  for (const e of entries) {
    expect(e.method, e.name).toBe(0);
    expect(sha256(e.data), e.name).toBe(byName.get(e.name));
  }
  // 選ぶのが終わると、元の一覧に戻る
  await expect(page.getByRole('button', { name: 'まとめてダウンロード' })).toBeVisible();
  await page.close();
});

test('回数の上限を超えると、いつからまたできるかを日本語で出す', async ({ browser, request }) => {
  const page = await browser.newPage(PHONE);
  const user = newLineUser('ママ');
  await page.goto('/liff/');
  const [photo] = await seedPurchases(page, request, user, [{ name: '11月2日のドッグラン', eventDate: '2026-11-02', photos: 1 }]);
  for (let i = 0; i < 10; i++) {
    const r = await request.post(`/api/photos/purchases/${photo!.id}/download`, { headers: authHeaders(user) });
    expect(r.status()).toBe(200);
  }
  await openPurchased(page, user);
  await page.getByRole('button', { name: 'IMG_2001.JPGを開く' }).click();
  const sheet = page.getByRole('dialog', { name: 'IMG_2001.JPG' });
  await expect(sheet).toContainText('24時間で10回ダウンロードしました');
  await expect(sheet.getByRole('button', { name: '原本をダウンロード' })).toBeDisabled();
  // API も 429(画面で押せなくても、サーバーが断る)
  const r = await request.post(`/api/photos/purchases/${photo!.id}/download`, { headers: authHeaders(user) });
  expect(r.status()).toBe(429);
  const body = await r.json();
  expect(body.error.message).toMatch(/写真1枚につき24時間で10回までです。\d+月\d+日 \d+:\d\dごろから、またダウンロードできます。/);
  await liffShot(page, shot('liff-PU-7-limit'));
  await page.close();
});

test('ほかの人の購入は見えない。何も買っていなければ「まだ購入した写真はありません」', async ({ browser, request }) => {
  const page = await browser.newPage(PHONE);
  const owner = newLineUser('持ち主');
  await page.goto('/liff/');
  const [photo] = await seedPurchases(page, request, owner, [{ name: '11月3日のドッグラン', eventDate: '2026-11-03', photos: 1 }]);
  const other = newLineUser('ほかの人');
  await openPurchased(page, other);
  await expect(page.getByText('まだ購入した写真はありません。')).toBeVisible();
  await expect(page.getByRole('link', { name: '写真を見る' })).toBeVisible();
  await checkScreen(page, '393x759', 'PU-7 購入した写真(まだない)', true);
  await liffShot(page, shot('liff-PU-7-empty'));
  // 番号を知っていても取れない(403)
  expect((await request.post(`/api/photos/purchases/${photo!.id}/download`, { headers: authHeaders(other) })).status()).toBe(403);
  expect((await request.get(`/api/photos/purchases/${photo!.id}/view`, { headers: authHeaders(other) })).status()).toBe(403);
  await page.close();
});

test('見え方の点検(いちばん狭い・文字が大きい・ダーク)', async ({ browser, request }) => {
  const seedPage = await browser.newPage(PHONE);
  await seedPage.goto('/liff/');
  const user = newLineUser('アレキサンダー・エリザベスのおうち');
  await seedPurchases(seedPage, request, user, [
    { name: 'とても長い名前のイベント「秋のわんわん大運動会と写真撮影会」', eventDate: '2026-10-12', photos: 4 },
  ], { paidAt: new Date(Date.now() - 7200_000) });
  await seedPage.close();
  for (const d of vqaDeviceList(['se', 'narrow-text150-dark'])) {
    const page = await newDevicePage(browser, d);
    const log = new VqaLog(d.id);
    await openPurchased(page, user);
    await waitImages(page, 4);
    await log.check(page, 'PU-7 購入した写真', { ignore: ['.toast-region'], shoot: (p) => liffShot(page, p) });
    await page.getByRole('button', { name: 'まとめてダウンロード' }).click();
    await page.getByRole('button', { name: '全部選ぶ' }).click();
    await log.check(page, 'PU-7 まとめてダウンロード', { ignore: ['.toast-region'], shoot: (p) => liffShot(page, p) });
    await page.getByRole('button', { name: 'やめる', exact: true }).click();
    await page.getByRole('button', { name: 'IMG_2001.JPGを開く' }).click();
    await page.getByRole('dialog').waitFor();
    await log.check(page, 'PU-7 写真を開いたところ', { ignore: ['.toast-region'], shoot: (p) => liffShot(page, p) });
    log.report();
    expect(log.problems, d.label).toEqual([]);
    await page.screenshot({ path: shot(`liff-PU-7-vqa-${d.id}`) });
    await page.context().close();
  }
});
