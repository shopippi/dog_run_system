import { expect, test, type Page } from '@playwright/test';
import { d1, daysAgo, householdIdOf } from './analytics-helpers';
import { adminLogin, newLineUser, openCheckin, registerViaUi } from './helpers';

// 担当D(分析と自動処理)の画面の見え方(e2e/admin.layout.spec.ts と同じ確かめ方)。
// PC(1280×800)とタブレット縦(768×1024)で、ダッシュボード(M-05)とシステムの状態(M-17)を確かめる。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

/**
 * 1つの画面を確かめる。
 * - 横にはみ出していない(横スクロールが出ない)
 * - 押す部品の高さが、指で操作する端末(hasTouch)では 44px 以上、マウスでは 40px 以上
 *   (一覧の中の「取り消す」などの控えめなボタンも含む)
 * - 入力欄の文字が 16px 以上
 * SHOT_DIR を指定すると、画面の写真を保存する。
 */
async function checkScreen(page: Page, folder: string, screen: string, touch: boolean) {
  await page.waitForLoadState('networkidle');
  // 開くときの動き(ダイアログなど)が終わってから確かめる
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const minHeight = touch ? 44 : 40;
  const problems = await page.evaluate((minHeight) => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    const pressables = document.querySelectorAll<HTMLElement>(
      'button, a, [role=tab], .chips label, .pick-row, label.check',
    );
    for (const el of pressables) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20);
      if (r.height < minHeight - 0.5) out.push(`押す部品が低い(${Math.round(r.height)}px): ${name}`);
      // 横スクロールのメニュー(狭い画面)の中は、はみ出しではない
      const inScroller = el.closest('.nav') !== null && doc.clientWidth < 960;
      if (!inScroller && r.right > doc.clientWidth + 1) out.push(`押す部品がはみ出し: ${name}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.getAttribute('aria-label') ?? el.id}`);
    }
    return out;
  }, minHeight);
  expect(problems, `${folder} / ${screen}`).toEqual([]);
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/${folder}/${screen}.png`, fullPage: true });
  }
}

test.describe('担当D の画面の見え方', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage();
    const a = newLineUser('パパ');
    await registerViaUi(page, a, ['ハル', 'ナツ']);
    await openCheckin(page, a);
    await page.getByRole('button', { name: 'チェックインする' }).click();
    await page.getByRole('region', { name: 'チェックイン完了' }).waitFor();
    const memberNo = await registerViaUi(page, newLineUser('ママ'), ['アキ']);
    const h = householdIdOf(memberNo.trim());
    const values = [300, 200, 100].map((n) => `(${h}, '${daysAgo(n)}', '${daysAgo(n)}T10:00:00+09:00', 1, 'self')`).join(', ');
    d1(`INSERT INTO visits (household_id, visit_date, checked_in_at, dog_count, method) VALUES ${values}`);
    // 天気とイベント(グラフに点が出るように)
    const weather = [1, 2, 3, 4, 5]
      .map((n, i) => `('${daysAgo(n)}', '${['晴れ', '曇り', '雨', '晴れ', '晴れ'][i]}', ${18 + n}, ${10 + n}, 0, '東京', '気象庁', 'x')`)
      .join(', ');
    d1(`INSERT OR IGNORE INTO daily_weather (date, weather, temp_max, temp_min, precipitation, station, source, fetched_at) VALUES ${weather}`);
    d1(`INSERT INTO events (date, name, created_at) VALUES ('${daysAgo(3)}', 'しつけ教室', 'x')`);
    await page.close();
  });

  // 画面の写真(fullPage)を撮ると、指で操作する端末のまねが外れることがあるので、画面ごとに新しいページで開く
  for (const v of VIEWPORTS) {
    test(`${v.name}: ダッシュボードが横にはみ出さず、押しやすい大きさになっている`, async ({ browser }) => {
      test.setTimeout(120_000);
      const open = async (role: 'admin' | 'staff', period: string) => {
        const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
        await adminLogin(page, role, '/dashboard');
        await page.getByRole('radiogroup', { name: '期間' }).getByRole('radio', { name: period }).check();
        await expect(page.locator('p[role=status]', { hasText: '〜' })).toContainText('営業日');
        return page;
      };
      let page = await open('admin', '過去12か月');
      await expect(page.getByRole('list', { name: 'しばらく来ていない常連さん' })).toBeVisible();
      await checkScreen(page, v.name, 'M-05 ダッシュボード', v.touch);
      await page.close();

      page = await open('admin', '期間を選ぶ');
      await expect(page.getByLabel('始まり')).toBeVisible();
      await checkScreen(page, v.name, 'M-05 ダッシュボード(期間を選ぶ)', v.touch);
      await page.close();

      page = await open('staff', '今月');
      await expect(page.getByRole('region', { name: '来場頻度' })).toBeVisible();
      await checkScreen(page, v.name, 'M-05 ダッシュボード(受付スタッフ)', v.touch);
      await page.close();

      // M-17 システムの状態(管理者は簡易、製作者は詳細)
      page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
      await adminLogin(page, 'admin', '/status');
      const stats = page.getByRole('listitem', { name: /日別の集計/ });
      await stats.getByRole('button', { name: '今すぐ実行' }).click();
      await expect(stats.getByRole('status')).toBeVisible();
      await checkScreen(page, v.name, 'M-17 システムの状態', v.touch);
      await page.close();

      page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
      await adminLogin(page, 'developer', '/status');
      await expect(page.getByRole('region', { name: 'データ量' })).toBeVisible();
      await checkScreen(page, v.name, 'M-17 システムの状態(製作者)', v.touch);
      await page.close();
    });
  }
});
