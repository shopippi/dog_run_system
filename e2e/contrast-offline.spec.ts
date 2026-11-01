import { expect, test } from '@playwright/test';
import { newLineUser } from './helpers';
import { lowContrast } from './households-helpers';
import { registerByApiQuick, showBoundary, showStaleCard, showWaitingCheckin } from './offline-helpers';

// 電波が弱いときの画面(docs/design.md 14章)の、文字と背景のコントラスト(WCAG の 4.5:1)。ライトとダークの両方。

const PHONE = { viewport: { width: 393, height: 759 }, isMobile: true, hasTouch: true };

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'ライト' : 'ダーク', () => {
    test('電波が弱いときの画面の文字が背景に対して読める', async ({ browser, request }) => {
      test.setTimeout(90_000);
      const context = await browser.newContext({ ...PHONE, colorScheme: scheme, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const user = newLineUser('ママ');
      await registerByApiQuick(request, user, ['こむぎ']);

      await showWaitingCheckin(page, context, user);
      expect(await lowContrast(page), 'L-05 送信を待っているチェックイン').toEqual([]);
      await page.getByRole('button', { name: '送るのをやめる' }).click();
      await context.setOffline(false);

      await showStaleCard(page, user);
      expect(await lowContrast(page), 'L-07 前に開いたときの会員証').toEqual([]);
      await page.unroute(/\/api\/me$/);

      await showBoundary(page, user);
      expect(await lowContrast(page), '画面を表示できなかったとき').toEqual([]);
      await context.close();
    });
  });
}
