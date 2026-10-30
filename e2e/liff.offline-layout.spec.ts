import { test } from '@playwright/test';
import { newLineUser } from './helpers';
import { checkScreen } from './households-helpers';
import { registerByApiQuick, showBoundary, showStaleCard, showWaitingCheckin } from './offline-helpers';

// 電波が弱いときの画面(docs/design.md 14章)が、LINE の画面の中に収まり、押す部品が 44px 以上あるか。
// 端末の大きさは e2e/liff.layout.spec.ts と同じ(LINE の上部のバーとステータスバーを除いたもの)。

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0 LIFF';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Line/15.10.0/IAB LIFF';

const DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 603 }, dpr: 2, ua: IOS_UA, dark: false },
  { name: 'Android 小さめ', viewport: { width: 360, height: 680 }, dpr: 3, ua: ANDROID_UA, dark: false },
  { name: 'iPhone 16 ダークモード', viewport: { width: 393, height: 759 }, dpr: 3, ua: IOS_UA, dark: true },
] as const;

for (const d of DEVICES) {
  test.describe(d.name, () => {
    test.use({
      viewport: d.viewport,
      deviceScaleFactor: d.dpr,
      isMobile: true,
      hasTouch: true,
      userAgent: d.ua,
      colorScheme: d.dark ? 'dark' : 'light',
    });

    test('電波が弱いときの画面が、LINE の画面の中に収まる', async ({ page, context, request }) => {
      test.setTimeout(90_000);
      const user = newLineUser('ママ');
      await registerByApiQuick(request, user, ['アルフォンス', 'ニコ']);

      await showWaitingCheckin(page, context, user);
      await checkScreen(page, `p5-offline/${d.name}`, 'L-05 送信を待っているチェックイン', true);
      await page.getByRole('button', { name: '送るのをやめる' }).click();
      await context.setOffline(false);

      await showStaleCard(page, user);
      await checkScreen(page, `p5-offline/${d.name}`, 'L-07 前に開いたときの会員証', true);
      await page.unroute(/\/api\/me$/);

      await showBoundary(page, user);
      await checkScreen(page, `p5-offline/${d.name}`, '画面を表示できなかったとき', true);
    });
  });
}
