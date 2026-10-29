import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { checkinOn } from './customer-helpers';
import { newLineUser, openCheckin, openLiff, registerViaUi } from './helpers';
import { liffShot } from './liff-shot';
import { earnPoints } from './tickets-helpers';

// 2026-10-29 の見直し(docs/design.md 11章): スケルトン・下から出るシート・トースト・下に固定した主ボタンの帯。

/** その URL への要求を、release を呼ぶまで止める(読み込み中の形を確かめるため)。止めるのは 1 回だけで、あとはそのまま通す */
async function hold(page: Page, url: RegExp) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(
    url,
    async (route) => {
      await gate;
      await route.fallback();
    },
    { times: 1 },
  );
  return async () => release();
}

test('読み込み中はスケルトンが出て、読み込むと消える(高さはほぼ同じ)', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  // 会員証の情報を 600ms 遅らせる
  await page.route(/\/api\/me$/, async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });
  await openLiff(page, user);
  const busy = page.locator('[aria-busy="true"]');
  await expect(busy.first()).toBeVisible();
  // 読み上げは「読み込んでいます」だけ。形そのものは読み上げない
  await expect(busy.first().getByText('読み込んでいます')).toHaveCount(1);
  await expect(busy.first().locator('.sk-shapes')).toHaveAttribute('aria-hidden', 'true');
  // 120ms 待ってから形が出る
  const skCard = busy.first().locator('.sk-card');
  await expect(skCard).toBeVisible();
  const skBox = (await skCard.boundingBox())!;
  const skButton = (await busy.first().locator('.sk-shapes > .sk').nth(1).boundingBox())!;

  const card = page.getByRole('region', { name: '会員証' });
  await expect(card).toBeVisible();
  await expect(busy).toHaveCount(0);
  // 読み込み後に、会員証とチェックインのボタンの位置・高さが変わらない(がたつかない)
  const box = (await card.boundingBox())!;
  const button = (await page.locator('main > .btn').first().boundingBox())!;
  expect(Math.abs(box.y - skBox.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height - skBox.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(button.y - skButton.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(button.height - skButton.height)).toBeLessThanOrEqual(2);
});

test('スケルトンは 120ms 待ってから出す(すぐに読み込めたときに、ちらつかない)', async ({ page }) => {
  const user = newLineUser('パパ');
  await registerViaUi(page, user, ['ニコ']);
  await openLiff(page, user);
  await page.getByRole('region', { name: '会員証' }).waitFor();
  await page.waitForTimeout(400);
  const release = await hold(page, /\/api\/dogs$/);
  // 押してから 50ms のあいだは、場所だけ取って形は見せない
  const early = await page.evaluate(async () => {
    document.querySelector<HTMLAnchorElement>('nav.menu a[href$="/dogs"]')!.click();
    await new Promise((r) => setTimeout(r, 50));
    const el = document.querySelector('.sk-shapes');
    return { exists: !!el, on: !!el?.classList.contains('on'), busy: !!document.querySelector('[aria-busy="true"]') };
  });
  expect(early).toEqual({ exists: true, on: false, busy: true });
  // 120ms を過ぎると形が出る
  await expect(page.locator('.sk-shapes.on')).toBeVisible();
  await release();
  await expect(page.getByRole('link', { name: /ニコ/ })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test('確認は下から出るシート。「やめる」にフォーカスし、背景・Esc・下へ引っ張る・やめるで閉じる', async ({ page, request }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await earnPoints(request, user, 10);
  await openLiff(page, user);
  const trigger = page.getByRole('button', { name: '無料券と交換する(10ポイント)' });
  const sheet = page.getByRole('dialog', { name: '無料券と交換します' });

  // 開くと「やめる」にフォーカス。後ろの画面は操作・読み上げの対象から外れる
  await trigger.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'やめる' })).toBeFocused();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('button', { name: 'チェックイン(受付のQRを読む)' })).toHaveCount(0);
  // 上の角丸は 20
  expect(await sheet.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('20px');

  // 背景を押すと閉じ、開く前のボタンにフォーカスが戻る
  await page.locator('.sheet-backdrop').click({ position: { x: 20, y: 20 } });
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('button', { name: 'チェックイン(受付のQRを読む)' })).toBeVisible();

  // Esc で閉じる
  await trigger.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // 掴みの印のあたりを下へ引っ張ると閉じる。少しだけなら戻る
  await trigger.click();
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(400);
  const grab = (await page.locator('.sheet-grab').boundingBox())!;
  const x = grab.x + grab.width / 2;
  const y = grab.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(sheet).toBeVisible();
  // 戻る動きが終わるのを待ってから、もう一度引っ張る
  await page.waitForTimeout(400);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 160, { steps: 8 });
  await page.mouse.up();
  await expect(sheet).toHaveCount(0);

  // 「やめる」で閉じても、何も変わらない
  await trigger.click();
  await sheet.getByRole('button', { name: 'やめる' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'スタンプ' }).getByText('10 / 10', { exact: true })).toBeVisible();
});

test('完了はトーストで知らせ、3秒で消える。下の帯より上に出る', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await openLiff(page, user, '/profile');
  await page.getByRole('heading', { name: 'プロフィール' }).waitFor();
  await page.getByLabel('お住まいの郵便番号').fill('1234567');
  await page.getByRole('button', { name: '保存する' }).click();
  const toast = page.locator('.toast');
  await expect(page.getByRole('status')).toHaveText('保存しました');
  await expect(toast).toBeVisible();
  // 画面の中に完了の文を残さない
  await expect(page.locator('main').getByText('保存しました')).toHaveCount(0);
  // 下に固定した帯に重ならない
  const t = (await toast.boundingBox())!;
  const bar = (await page.locator('.action-bar').boundingBox())!;
  expect(t.y + t.height).toBeLessThanOrEqual(bar.y);
  // 3 秒で消える
  await expect(toast).toHaveCount(0, { timeout: 4500 });
  await expect(page.getByRole('status')).toHaveText('');
});

for (const path of ['/dogs/new', '/profile', '/dogs/:id']) {
  test(`下に固定した主ボタンの帯で、最後の入力欄が隠れない(${path})`, async ({ page }) => {
    const user = newLineUser('ママ');
    await registerViaUi(page, user, ['アル']);
    if (path === '/dogs/:id') {
      await openLiff(page, user, '/dogs');
      await page.getByRole('link', { name: /アル/ }).click();
    } else {
      await openLiff(page, user, path);
    }
    const bar = page.locator('.action-bar');
    await expect(bar.getByRole('button')).toBeVisible();
    // 開いたときから、主ボタンは画面の中(スクロールしなくても押せる)
    const viewport = page.viewportSize()!;
    const barBox = (await bar.boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(viewport.height + 1);
    // 任意の項目も開いて、ページを一番下までスクロールする
    const more = page.locator('details.pf-more');
    if ((await more.count()) > 0 && !(await more.evaluate((d: HTMLDetailsElement) => d.open))) {
      await more.locator('summary').click();
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const lastBottom = await page.evaluate(() => {
      const els = [...document.querySelectorAll<HTMLElement>('main input:not([type=file]), main select, main .segment, main .chips, main .pf-checks')];
      const visible = els.filter((el) => el.getBoundingClientRect().height > 0);
      return Math.max(...visible.map((el) => el.getBoundingClientRect().bottom));
    });
    const top = (await bar.boundingBox())!.y;
    expect(lastBottom).toBeLessThanOrEqual(top);
    if (path === '/dogs/:id') {
      // 「この子の登録をおやすみする」は、スクロールしきったときに保存の帯よりも下にだけ見える
      const rest = (await page.getByRole('button', { name: 'この子の登録をおやすみする' }).boundingBox())!;
      const barNow = (await bar.boundingBox())!;
      expect(rest.y).toBeGreaterThanOrEqual(barNow.y + barNow.height - 1);
      expect(rest.y + rest.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  });
}

test.describe('動きあり', () => {
  test.use({ reducedMotion: 'no-preference' });
test('画面の切り替え: 新しい画面はふわっと出る。戻るときは動かさない', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await openLiff(page, user);
  await page.getByRole('region', { name: '会員証' }).waitFor();
  // はじめの表示は動かさない
  await expect(page.locator('.route')).not.toHaveClass(/enter/);
  await page.getByRole('link', { name: '来場履歴' }).click();
  await expect(page.locator('.route')).toHaveClass(/enter/);
  await page.goBack();
  await page.getByRole('region', { name: '会員証' }).waitFor();
  await expect(page.locator('.route')).not.toHaveClass(/enter/);
});
});


test('空の状態は、線のアイコンと一文', async ({ page }) => {
  const user = newLineUser('ママ');
  await registerViaUi(page, user, ['アル']);
  await openLiff(page, user, '/history');
  const empty = page.locator('.empty');
  await expect(empty).toContainText('まだ来場の記録がありません。');
  const icon = empty.locator('svg');
  await expect(icon).toHaveAttribute('width', '40');
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
});

// 主な画面の、スケルトンと読み込み後の写真(SHOT_DIR のとき)。形と高さが近いことも確かめる
for (const scheme of ['light', 'dark'] as const) {
  test(`主な画面のスケルトンと読み込み後(${scheme === 'light' ? 'ライト' : 'ダーク'})`, async ({ browser, request }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage({
      viewport: { width: 393, height: 759 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
    });
    const user = newLineUser('ママ');
    await registerViaUi(page, user, ['アル', 'ニコ']);
    await checkinOn(request, user, '2026-10-01');
    await checkinOn(request, user, '2026-10-05');
    await checkinOn(request, user, '2026-10-12');
    const dir = process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/スケルトン${scheme === 'dark' ? '(ダーク)' : ''}` : null;
    if (dir) fs.mkdirSync(dir, { recursive: true });

    // part: 画面の一部だけが読み込み中になる画面(家族の一覧)は、その部分の位置を比べる
    const screens: { name: string; url: RegExp; open: () => Promise<void>; loaded: () => Promise<unknown>; part?: string }[] = [
      {
        name: 'L-07 会員証',
        url: /\/api\/me$/,
        open: () => openLiff(page, user),
        loaded: () => page.getByRole('region', { name: 'スタンプ' }).waitFor(),
      },
      {
        name: 'L-09 ワンちゃん',
        url: /\/api\/dogs$/,
        open: () => openLiff(page, user, '/dogs'),
        loaded: () => page.getByRole('link', { name: /ニコ/ }).waitFor(),
      },
      {
        name: 'L-08 来場履歴',
        url: /\/api\/me\/visits$/,
        open: () => openLiff(page, user, '/history'),
        loaded: () => page.getByRole('heading', { name: '2026年10月' }).waitFor(),
      },
      {
        name: 'L-10 プロフィール',
        url: /\/api\/me\/profile$/,
        open: () => openLiff(page, user, '/profile'),
        loaded: () => page.getByRole('heading', { name: 'プロフィール' }).waitFor(),
      },
      {
        name: 'L-05 チェックイン',
        url: /\/api\/checkins\/today$/,
        open: () => openCheckin(page, user),
        loaded: () => page.getByRole('button', { name: 'チェックインする' }).waitFor(),
      },
      {
        name: 'L-11 家族',
        url: /\/api\/family$/,
        open: () => openLiff(page, user, '/family'),
        loaded: () => page.getByRole('region', { name: 'いまの家族' }).waitFor(),
        part: 'section.fam-section',
      },
    ];
    for (const s of screens) {
      const release = await hold(page, s.url);
      await s.open();
      const shapes = page.locator('[aria-busy="true"] .sk-shapes.on').first();
      await shapes.waitFor();
      await page.waitForTimeout(300);
      // 形が画面の幅に収まっている
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, s.name).toBe(false);
      const skTop = await shapes.evaluate(
        (el, part) => (part ? el.parentElement! : (el.firstElementChild as HTMLElement)).getBoundingClientRect().top,
        s.part ?? null,
      );
      if (dir) await page.screenshot({ path: `${dir}/${s.name}(読み込み中).png` });
      await release();
      await s.loaded();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await page.waitForLoadState('networkidle');
      // 一番上の部品の位置は、読み込みの前後で同じ
      const top = await page.evaluate(
        (part) => (part ? document.querySelector(part)! : document.querySelector('main.screen')!.firstElementChild!).getBoundingClientRect().top,
        s.part ?? null,
      );
      expect(Math.abs(top - skTop), s.name).toBeLessThanOrEqual(2);
      if (dir) await page.screenshot({ path: `${dir}/${s.name}(読み込み後).png` });
    }
    if (dir) {
      await openLiff(page, user);
      await page.getByRole('region', { name: 'スタンプ' }).waitFor();
      await liffShot(page, `${dir}/L-07 会員証(全体).png`);
    }
    await page.close();
  });
}
