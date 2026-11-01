import { expect, test, type Page } from '@playwright/test';
import { newLineUser, openLiff } from './helpers';
import { liffShot } from './liff-shot';
import { addToCartApi, checkoutApi, enablePhotoSales, seedAlbum } from './photos-checkout-helpers';
import { applyDevice, contextOptions, vqaDeviceList, VqaLog, type AuditOptions } from './visual-qa-helpers';

// 段階1-C の画面の見え方の点検(重なり・切れ・はみ出し・押しにくさ・下の帯に隠れる)。e2e/liff.visual-qa.spec.ts と同じ決まり。
// 長いアルバムの名前・長いファイル名・たくさんの行で見る。CI は iPhone SE と「幅 320・文字 150%・ダーク」。VQA_SHOTS で写真を保存する

const LIFF_AUDIT: AuditOptions = { ignore: ['.toast-region'] };
const devices = vqaDeviceList(['se', 'narrow-text150-dark']);

test.beforeAll(() => enablePhotoSales());

async function check(log: VqaLog, page: Page, name: string) {
  await log.check(page, name, { ...LIFF_AUDIT, shoot: (p) => liffShot(page, p) });
}

for (const d of devices) {
  test.describe(`見え方の点検 ${d.label}`, () => {
    test.use(contextOptions(d));
    test.beforeEach(async ({ page }) => {
      await applyDevice(page, d);
    });

    test('カート・まねの支払い・購入完了・法定表示', async ({ page, request }) => {
      test.setTimeout(150_000);
      const log = new VqaLog(d.id);
      const long = seedAlbum({
        name: '第3回 秋のわんわん大運動会 〜みんなで走ろう、グリーンドームの芝生広場〜',
        unitPrice: 12800,
        albumPrice: 128000,
        photos: 3,
        filenames: ['DSC_20261101_093015_Christopherson.JPG', 'IMG_0001.JPG', 'とても長い名前の写真ファイル_こむぎとだいず_2026.JPG'],
      });
      const user = newLineUser('アレキサンダー・エリザベス');
      await addToCartApi(request, user, [
        ...long.photoIds.map((photoId) => ({ kind: 'photo' as const, albumId: long.albumId, photoId })),
        { kind: 'album', albumId: long.albumId },
      ]);
      await openLiff(page, user, '/photos/cart');
      await page.getByText('アルバムまるごとに含まれています').first().waitFor();
      await check(log, page, 'PU-5 カート(長い名前・まるごとに含まれる)');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await log.check(page, 'PU-5 カート(いちばん下)', { ...LIFF_AUDIT, fullPage: false });

      await page.getByRole('button', { name: '購入手続きへ' }).click();
      await page.getByText('練習用の支払いの画面です。お金は動きません。').waitFor();
      await check(log, page, 'PU-5 まねの支払い');

      // 確かめているあいだ(別の注文。支払わない)
      const other = newLineUser('待つ人');
      await addToCartApi(request, other, [{ kind: 'photo', albumId: long.albumId, photoId: long.photoIds[0]! }]);
      const pending = await checkoutApi(request, other);

      await page.getByRole('button', { name: '支払う(練習)' }).click();
      await page.getByRole('heading', { name: 'ご購入ありがとうございます' }).waitFor();
      await check(log, page, 'PU-6 購入完了');

      await openLiff(page, other, `/photos/orders/${pending.orderId}`);
      await page.getByRole('heading', { name: 'お支払いを確かめています' }).waitFor();
      await check(log, page, 'PU-6 購入完了(確かめています)');

      await openLiff(page, user, '/photos/cart');
      await page.getByText('カートは空です。').waitFor();
      await check(log, page, 'PU-5 カート(空)');

      await openLiff(page, user, '/photos/legal');
      await page.getByRole('heading', { name: '特定商取引法に基づく表記・利用規約' }).waitFor();
      await check(log, page, '法定表示');
      log.report();
      expect(log.problems).toEqual([]);
    });
  });
}
