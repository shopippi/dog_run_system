import type { Page } from '@playwright/test';

/**
 * お客さん向け画面の写真を撮る(SHOT_DIR のとき)。
 * ヘッダー(上に固定)と主ボタンの帯(下に固定)は、ページ全体の写真ではスクロールの途中の位置に写ってしまうので、
 * 写すあいだだけ流れの中に置く(ヘッダーは一番上、帯は一番下)。
 * 下から出るシートが開いているときは、見えている画面だけを撮る(シートは画面の下に重なっているため)。
 */
export async function liffShot(page: Page, path: string) {
  const sheetOpen = (await page.locator('.sheet-root:not(.closing)').count()) > 0;
  if (sheetOpen) {
    // 下から出る動きが終わってから撮る
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && isFinite(Number(a.effect.getComputedTiming().endTime))).map((a) => a.finished.catch(() => undefined))));
    await page.screenshot({ path });
    return;
  }
  const style = await page.addStyleTag({
    content: `.app-header, .action-bar { position: relative !important; }
      .has-action-bar .screen { padding-bottom: calc(32px + env(safe-area-inset-bottom, 0px)) !important; }
      .has-action-bar .toast-region { bottom: 16px !important; }`,
  });
  await page.screenshot({ path, fullPage: true });
  await style.evaluate((el) => (el as Element).remove());
}
