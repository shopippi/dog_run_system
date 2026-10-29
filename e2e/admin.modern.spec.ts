import { expect, test, type Page } from '@playwright/test';
import { checkinViaLiff } from './households-helpers';
import { adminLogin, adminToast, newLineUser, registerViaUi } from './helpers';

// 2026-10-29 今風の見直し(docs/design.md 11章)の受付・管理画面。
// スケルトン・トースト(と「元に戻す」)・「/」で検索欄・道しるべ。
// SHOT_DIR があれば、主な画面のスケルトンと読み込み後の写真を「skeleton/」に並べて保存する。

const DESKTOP = { viewport: { width: 1280, height: 800 } };

/** API の応答を、release() を呼ぶまで止める(スケルトンを確かめる・写真に撮るため) */
async function holdApi(page: Page, pattern: string | RegExp) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(pattern, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

async function shot(page: Page, name: string) {
  if (!process.env.SHOT_DIR) return;
  await page.screenshot({ path: `${process.env.SHOT_DIR}/skeleton/${name}.png` });
}

/** 写真を撮る前に、開くときの動き(スケルトンのふわっと出る動きなど)が終わるのを待つ */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

test.describe.configure({ mode: 'serial' });

let memberNo = '';
test.beforeAll(async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  memberNo = await registerViaUi(customer, user, ['コムギ', 'ダイズ']);
  await checkinViaLiff(customer, user);
  await customer.close();
});

test('読み込み中はスケルトンを出し、読み込んだら消える。高さはほぼ変わらない(今日の来場)', async ({ browser }) => {
  const page = await browser.newPage(DESKTOP);
  await adminLogin(page, 'admin');
  await page.getByRole('list', { name: '今日の来場' }).waitFor();

  // 600ms 遅らせると、スケルトン(aria-busy)が見えてから消える
  await page.route('**/admin/api/today', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });
  await page.reload();
  const busy = page.locator('[aria-busy="true"]');
  await expect(busy).toBeVisible();
  await expect(busy.getByText('読み込んでいます')).toHaveCount(1);
  const skSummary = await page.locator('.sk-body .summary').boundingBox();
  const skRow = await page.locator('.sk-body .visit').first().boundingBox();
  await expect(busy).toHaveCount(0);
  await expect(page.getByRole('list', { name: '今日の来場' })).toBeVisible();
  const summary = await page.locator('section.summary').boundingBox();
  const row = await page.getByRole('list', { name: '今日の来場' }).getByRole('listitem').first().boundingBox();
  expect(Math.abs(skSummary!.y - summary!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(skSummary!.height - summary!.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(skRow!.height - row!.height)).toBeLessThanOrEqual(2);

  // 30秒ごとの読み直しでは、スケルトンを出さない(最初の1回だけ)。読み直しが遅くても、一覧はそのまま
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.clock.install();
  await page.reload();
  await page.getByRole('list', { name: '今日の来場' }).waitFor();
  await page.route('**/admin/api/today', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  const polled = page.waitForRequest('**/admin/api/today');
  await page.clock.fastForward(31_000);
  await polled;
  await page.waitForTimeout(400);
  await expect(busy).toHaveCount(0);
  await expect(page.getByRole('list', { name: '今日の来場' })).toBeVisible();
  await page.close();
});

test('主な画面のスケルトンの形と、読み込み後の形(写真)', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage(DESKTOP);
  await adminLogin(page, 'admin');
  const found = await page.request.get('/admin/api/households?q=' + encodeURIComponent(memberNo));
  const { households } = (await found.json()) as { households: { id: number; dogs: { id: number }[] }[] };
  const hh = households[0]!;

  const screens: { name: string; path: string; api: RegExp; ready: (p: Page) => Promise<unknown> }[] = [
    { name: 'M-02 今日の来場', path: '/', api: /\/admin\/api\/today$/, ready: (p) => p.getByRole('list', { name: '今日の来場' }).waitFor() },
    { name: 'M-06 おうちの詳細', path: `/households/${hh.id}`, api: /\/admin\/api\/households\/\d+$/, ready: (p) => p.getByRole('region', { name: 'おうちの概要' }).waitFor() },
    { name: 'M-07 犬の編集', path: `/dogs/${hh.dogs[0]!.id}`, api: /\/admin\/api\/dogs\/\d+$/, ready: (p) => p.getByRole('list', { name: '変更の履歴' }).or(p.getByText('まだ変更はありません。')).waitFor() },
    { name: 'M-05 ダッシュボード', path: '/dashboard', api: /\/admin\/api\/dashboard\?/, ready: (p) => p.getByRole('region', { name: '来場の推移' }).locator('.dash-chart.ready').waitFor() },
    { name: 'M-15 操作ログ', path: '/audit', api: /\/admin\/api\/audit\?/, ready: (p) => p.getByRole('list', { name: '操作の一覧' }).or(p.getByText('この条件の操作はありません。')).waitFor() },
    { name: 'M-13 ルール', path: '/settings', api: /\/admin\/api\/settings$/, ready: (p) => p.getByRole('region', { name: '施設の名前' }).waitFor() },
    { name: 'M-12 犬種', path: '/breeds', api: /\/admin\/api\/breeds$/, ready: (p) => p.getByRole('list', { name: '犬種' }).waitFor() },
    { name: 'M-17 システムの状態', path: '/status', api: /\/admin\/api\/system-status$/, ready: (p) => p.getByRole('region', { name: '自動で動く処理' }).waitFor() },
  ];
  for (const s of screens) {
    const release = await holdApi(page, s.api);
    await page.goto(`/admin${s.path}`);
    // ログインの確認中の枠のスケルトン(.sk-shell)ではなく、その画面のスケルトン
    await expect(page.locator('.sk-wrap:not(.sk-shell) .sk').first(), s.name).toBeVisible();
    await settle(page);
    await shot(page, `${s.name}(読み込み中)`);
    release();
    await s.ready(page);
    await expect(page.locator('.sk-wrap'), s.name).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.waitForLoadState('networkidle');
    await settle(page);
    await shot(page, `${s.name}(読み込み後)`);
  }

  // おうちを探す(写真で探す)の読み込み中
  await page.goto('/admin/search');
  const release = await holdApi(page, /\/admin\/api\/households\?q=$/);
  await page.getByRole('tab', { name: '写真で探す' }).click();
  await expect(page.locator('.sk-wrap:not(.sk-shell) .sk').first()).toBeVisible();
  await settle(page);
  await shot(page, 'M-04 おうちを探す(写真・読み込み中)');
  release();
  await page.getByRole('list', { name: '最近来たワンちゃん' }).waitFor();
  await page.waitForLoadState('networkidle');
  await shot(page, 'M-04 おうちを探す(写真・読み込み後)');
  await page.close();
});

test('完了のお知らせはトーストで右下に出て、4秒ほどで消える', async ({ browser }) => {
  const page = await browser.newPage(DESKTOP);
  await adminLogin(page, 'staff');
  const walkin = page.getByRole('region', { name: '会員以外のお客さん' });
  await walkin.getByRole('button', { name: '記録する' }).click();
  const toast = adminToast(page, '会員以外のお客さん 1頭 を記録しました。');
  await expect(toast).toBeVisible();
  // 右下に出る
  const box = (await toast.boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(1280 - 40);
  expect(box.y + box.height).toBeGreaterThan(800 - 40);
  // 画面の中には完了の文を残さない
  await expect(walkin.getByText('を記録しました')).toHaveCount(0);
  await expect(toast).toHaveCount(0, { timeout: 6_000 });

  // 閉じるボタンでも消せる
  await walkin.getByRole('button', { name: '記録する' }).click();
  await adminToast(page, 'を記録しました').getByRole('button', { name: 'お知らせを閉じる' }).click();
  await expect(adminToast(page)).toHaveCount(0);
  await page.close();
});

test('トーストの「元に戻す」で、チェックインの取り消しが元に戻る(管理者)。受付スタッフには「元に戻す」を出さない', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('ママ');
  await registerViaUi(customer, user, ['キビ']);
  await checkinViaLiff(customer, user);
  await customer.close();

  const page = await browser.newPage(DESKTOP);
  await adminLogin(page, 'admin');
  const row = page.getByRole('listitem', { name: /キビ/ });
  await row.getByRole('button', { name: '取り消す' }).click();
  await page.getByRole('dialog', { name: 'チェックインを取り消す' }).getByRole('button', { name: '取り消す' }).click();
  await expect(row.getByText(/取り消し済み/)).toBeVisible();
  const toast = adminToast(page, 'キビのチェックインを取り消しました。');
  await toast.getByRole('button', { name: '元に戻す' }).click();
  await expect(adminToast(page, 'キビの取り消しを元に戻しました。')).toBeVisible();
  await expect(row.getByText(/取り消し済み/)).toHaveCount(0);
  await expect(row.getByRole('button', { name: '取り消す' })).toBeVisible();
  // 操作ログにも「元に戻し済み」と残る
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '操作ログ' }).click();
  await expect(
    page
      .getByRole('list', { name: '操作の一覧' })
      .getByRole('listitem')
      .filter({ hasText: 'キビのおうち' })
      .filter({ has: page.getByText('チェックインの取り消し', { exact: true }) }),
  ).toContainText('元に戻し済み');
  await page.close();

  // 受付スタッフ: 取り消しのトーストは出るが、「元に戻す」はない(操作ログから戻せるのは管理者だけ)
  const staff = await browser.newPage(DESKTOP);
  await adminLogin(staff, 'staff');
  const again = staff.getByRole('listitem', { name: /キビ/ });
  await again.getByRole('button', { name: '取り消す' }).click();
  await staff.getByRole('dialog', { name: 'チェックインを取り消す' }).getByRole('button', { name: '取り消す' }).click();
  const staffToast = adminToast(staff, 'キビのチェックインを取り消しました。');
  await expect(staffToast).toBeVisible();
  await expect(staffToast.getByRole('button', { name: '元に戻す' })).toHaveCount(0);
  await staff.close();
});

test('トーストの「元に戻す」で、ポイントの手動登録が元に戻る', async ({ browser }) => {
  const page = await browser.newPage(DESKTOP);
  await adminLogin(page, 'admin', '/search');
  await page.getByRole('searchbox', { name: '探す言葉' }).fill(memberNo);
  await page.getByRole('link', { name: /の詳細を開く$/ }).first().click();
  const points = page.getByRole('region', { name: 'おうちの概要' }).getByRole('group', { name: 'ポイント', exact: true });
  const before = Number((await points.locator('.v').textContent())!.replace(/\D/g, ''));
  await page.getByRole('button', { name: 'ポイント・無料券を登録' }).click();
  const dialog = page.getByRole('dialog', { name: 'ポイント・無料券の手動登録' });
  await dialog.getByRole('button', { name: 'ポイントを1ふやす' }).click();
  await dialog.getByRole('radio', { name: 'お詫び' }).check();
  await dialog.getByRole('button', { name: '内容を確かめる' }).click();
  await page.getByRole('dialog', { name: 'この内容で登録しますか' }).getByRole('button', { name: '登録する' }).click();
  await expect(points).toContainText(`${before + 1}ポイント`);
  await adminToast(page, `いまは ${before + 1}ポイント`).getByRole('button', { name: '元に戻す' }).click();
  await expect(adminToast(page, 'ポイント・無料券の登録を元に戻しました。')).toBeVisible();
  await expect(points).toContainText(`${before}ポイント`);
  await page.close();
});

test('「/」で検索欄にフォーカスする。入力欄にいるときは文字として入る', async ({ browser }) => {
  const page = await browser.newPage(DESKTOP);
  await adminLogin(page, 'staff', '/search');
  const search = page.getByRole('searchbox', { name: '探す言葉' });
  await expect(search).toBeFocused();
  await search.blur();
  await page.locator('h1').click();
  await expect(search).not.toBeFocused();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  // 入力欄の中で押した「/」は、そのまま文字になる
  await page.keyboard.type('DR-/');
  await expect(search).toHaveValue('DR-/');

  // 検索欄のない画面では何もしない
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '今日の来場' }).click();
  await page.locator('h1').click();
  await page.keyboard.press('/');
  await expect(page.locator('input:focus')).toHaveCount(0);

  // 代理チェックインの検索欄にも効く
  await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '代理チェックイン' }).click();
  const proxySearch = page.getByRole('searchbox', { name: '探す言葉' });
  await proxySearch.blur();
  await page.locator('h1').click();
  await page.keyboard.press('/');
  await expect(proxySearch).toBeFocused();
  await page.close();
});

test('下の階層では道しるべを出し、リンクで戻れる(おうちの詳細・犬の編集)', async ({ browser }) => {
  const page = await browser.newPage(DESKTOP);
  await adminLogin(page, 'admin', '/search');
  await page.getByRole('searchbox', { name: '探す言葉' }).fill(memberNo);
  await page.getByRole('link', { name: 'コムギ・ダイズのおうちの詳細を開く' }).click();
  const crumbs = page.getByRole('navigation', { name: 'いまいる場所' });
  await expect(crumbs).toHaveText(/おうちを探す\s*›\s*コムギ・ダイズのおうち/);
  await expect(crumbs.getByText('コムギ・ダイズのおうち')).toHaveAttribute('aria-current', 'page');

  // 犬の編集: おうちを探す › おうち › 犬
  await page.getByRole('link', { name: 'ダイズの情報を見る・変える' }).click();
  await expect(crumbs).toHaveText(/おうちを探す\s*›\s*コムギ・ダイズのおうち\s*›\s*ダイズ/);
  await crumbs.getByRole('link', { name: 'コムギ・ダイズのおうち' }).click();
  await expect(page).toHaveURL(/\/admin\/households\/\d+$/);
  await expect(page.getByRole('region', { name: 'おうちの概要' }).getByRole('heading', { name: 'コムギ・ダイズのおうち' })).toBeVisible();

  await crumbs.getByRole('link', { name: 'おうちを探す' }).click();
  await expect(page).toHaveURL(/\/admin\/search$/);
  await expect(page.getByRole('heading', { name: 'おうちを探す', level: 1 })).toBeVisible();
  // 上の階層の画面には、道しるべを出さない
  await expect(crumbs).toHaveCount(0);
  await page.close();
});
