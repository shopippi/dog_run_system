import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { d1, daysAgo, householdIdOf } from './analytics-helpers';
import { adminLogin, adminToast, newLineUser, openCheckin, registerViaUi } from './helpers';

// A-01 ダッシュボード(M-05)の通し操作(docs/design.md 12章: 期間の切り替え・KPI のカード・大きなグラフ・
// 日ごとのカレンダーと日の詳細・その日のメモ・どこから来ているか・パネルの CSV)

/** KPI のカードの数(読み上げの名前「来場組数 3組。…」から) */
async function kpiCount(page: Page, label: string): Promise<number> {
  const name = await page.getByRole('region', { name: '期間の集計' }).getByRole('button', { name: new RegExp(`^${label} `) }).getAttribute('aria-label');
  return Number(name!.match(/ ([\d,]+)/)![1]!.replace(/,/g, ''));
}

/** 日別の集計を作り直す(データベースに直接入れた来場を数に入れるため) */
async function refreshStats(page: Page) {
  const res = await page.request.post('/admin/api/system/run/daily_stats', { headers: { 'x-dr-admin': '1' } });
  expect(res.ok()).toBe(true);
}

test.describe('A-01 ダッシュボード', () => {
  test.describe.configure({ mode: 'serial' });
  let memberNo = '';

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage();
    // 今日来たおうち(画面からチェックイン)
    const a = newLineUser('パパ');
    memberNo = (await registerViaUi(page, a, ['ダイズ'])).trim();
    await openCheckin(page, a);
    await page.getByRole('button', { name: 'チェックインする' }).click();
    await page.getByRole('region', { name: 'チェックイン完了' }).waitFor();
    // 前の期間の来場と、しばらく来ていない常連さん(画面からは古い来場を作れないので、データベースに直接入れる)
    const m2 = (await registerViaUi(page, newLineUser('ママ'), ['クルミ'])).trim();
    const h = householdIdOf(m2);
    const values = [200, 150, 120, 40, 35].map((n) => `(${h}, '${daysAgo(n)}', '${daysAgo(n)}T10:00:00+09:00', 1, 'self')`).join(', ');
    d1(`INSERT INTO visits (household_id, visit_date, checked_in_at, dog_count, method) VALUES ${values}`);
    // 郵便番号と、調べた地域(調べ先にはつながないので、表に直接入れる)
    d1(`UPDATE households SET postal_code = '1540001' WHERE member_no = '${memberNo}'`);
    d1(`UPDATE households SET postal_code = '1520004' WHERE member_no = '${m2}'`);
    d1(`INSERT OR IGNORE INTO postal_areas (postal_code, prefecture, city, town, status, looked_up_at) VALUES
        ('1540001', '東京都', '世田谷区', '池尻', 'found', 'x'), ('1520004', '東京都', '目黒区', '鷹番', 'found', 'x')`);
    // 天気(今日と昨日)
    d1(`INSERT OR REPLACE INTO daily_weather (date, weather, temp_max, temp_min, precipitation, station, source, fetched_at) VALUES
        ('${daysAgo(0)}', '晴れ', 21.5, 12, 0, '東京', '気象庁', 'x'), ('${daysAgo(1)}', '雨', 15, 11, 12, '東京', '気象庁', 'x')`);
    await page.close();
  });

  test('期間の切り替え(URL に残る)と、KPI のカードを押すと大きなグラフが切り替わる', async ({ page }) => {
    await adminLogin(page, 'admin', '/dashboard');
    await refreshStats(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ダッシュボード', level: 1 })).toBeVisible();
    const range = page.getByRole('radiogroup', { name: '期間' });
    await expect(range.getByRole('radio', { name: '30日' })).toHaveAttribute('aria-checked', 'true');
    const kpis = page.getByRole('region', { name: '期間の集計' });
    await expect(kpis.getByRole('button', { name: /^来場組数 [1-9]/ })).toBeVisible();
    await expect(page.getByRole('region', { name: '来場組数の推移' })).toBeVisible();
    const in30 = await kpiCount(page, '来場組数');

    // 7日に切り替えると URL に残る
    await range.getByRole('radio', { name: '7日' }).click();
    await expect(page).toHaveURL(/range=7d/);
    await expect(range.getByRole('radio', { name: '7日' })).toHaveAttribute('aria-checked', 'true');

    // 90日: 40日前・35日前の来場も入る(ほかのテストの来場もあるので、30日との差で確かめる)
    await range.getByRole('radio', { name: '90日' }).click();
    await expect(page).toHaveURL(/range=90d/);
    await expect(page.locator('.dsb[aria-busy="false"]')).toBeVisible();
    await expect.poll(() => kpiCount(page, '来場組数')).toBeGreaterThanOrEqual(in30 + 2);

    // KPI のカード: 押すと選択中になり、グラフの見出しが変わる
    const dogs = kpis.getByRole('button', { name: /^来場頭数/ });
    await dogs.click();
    await expect(dogs).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: '来場頭数の推移' })).toBeVisible();
    await expect(page).toHaveURL(/metric=dogs/);
    await kpis.getByRole('button', { name: /^リピート率/ }).click();
    await expect(page.getByRole('region', { name: 'リピート率の推移' })).toBeVisible();

    // グラフの値は ← → で読める(カーソルを乗せたときと同じ吹き出し)
    await kpis.getByRole('button', { name: /^来場組数/ }).click();
    const chart = page.getByRole('group', { name: /来場組数の推移/ });
    await chart.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(chart.locator('.dsb-tip')).toContainText('来場組数');
    await expect(chart.locator('.dsb-tip')).toContainText('前の期間');
    // 前の期間と比べるのをやめる
    const trend = page.getByRole('region', { name: '来場組数の推移' });
    await trend.getByLabel('前の期間と比べる').uncheck();
    await expect(trend.getByRole('list', { name: 'グラフの見方' })).not.toContainText('前の期間');

    // 期間を選ぶ
    await range.getByRole('radio', { name: '期間を選ぶ' }).click();
    await page.getByLabel('始まり').fill(daysAgo(6));
    await expect(page).toHaveURL(new RegExp(`from=${daysAgo(6)}`));
    await expect(page.locator('p.dsb-period')).toContainText('営業日');
    // 24時間は1時間ごと
    await range.getByRole('radio', { name: '24時間' }).click();
    await expect(page.getByRole('region', { name: '来場組数の推移' })).toContainText('1時間ごと');
  });

  test('カレンダーの日を押すと右から詳細が出て、メモを書ける。メモはグラフの印と今日の来場にも出る', async ({ page }) => {
    await adminLogin(page, 'staff', '/dashboard?range=7d');
    const cal = page.getByRole('group', { name: /のカレンダー$/ });
    const todayCell = cal.locator('.dsb-cal-cell.today');
    await expect(todayCell).toHaveAttribute('aria-label', /晴れ 最高21.5℃、来場[1-9]\d*組/);
    await todayCell.click();
    const drawer = page.getByRole('dialog', { name: /の様子$/ });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: '閉じる' })).toBeFocused();
    await expect(drawer).toContainText('晴れ');
    await expect(drawer.getByRole('img', { name: /時間帯ごとの来場/ })).toBeVisible();
    await drawer.getByRole('textbox', { name: 'この日のメモ' }).fill('午後から雨。\n小型犬の集まり。');
    await drawer.getByRole('button', { name: 'メモを残す' }).click();
    await expect(adminToast(page, 'メモを残しました。')).toBeVisible();
    await expect(drawer.getByRole('list', { name: 'この日のメモ' })).toContainText('小型犬の集まり。');
    // 直す
    await drawer.getByRole('button', { name: /を直す$/ }).click();
    await drawer.getByRole('textbox', { name: 'メモを直す' }).fill('午後から雨。小型犬の集まり(10組)。');
    await drawer.getByRole('button', { name: '保存する' }).click();
    await expect(adminToast(page, 'メモを直しました。')).toBeVisible();
    // Esc で閉じると、カレンダーのマスにメモの印。大きなグラフの横軸にも印
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(todayCell).toHaveAttribute('aria-label', /メモ1件/);
    await expect(page.locator('.dsb-mark')).toHaveCount(1);

    // 詳細から、その日の来場の一覧へ(今日なら今日の来場)。上に「この日のメモ」
    await todayCell.click();
    await drawer.getByRole('link', { name: 'この日の来場の一覧を見る' }).click();
    await expect(page.getByRole('heading', { name: /今日の来場/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'この日のメモ' })).toContainText('小型犬の集まり(10組)');
  });

  test('今日の来場の上からメモを書き、消しても元に戻せる。前の日の来場の一覧も開ける', async ({ page }) => {
    await adminLogin(page, 'admin', '/');
    const notes = page.getByRole('region', { name: 'この日のメモ' });
    await notes.getByRole('textbox', { name: 'この日のメモ' }).fill('水飲み場の蛇口を修理した');
    await notes.getByRole('button', { name: 'メモを残す' }).click();
    await expect(notes.getByRole('list', { name: 'この日のメモ' })).toContainText('水飲み場の蛇口を修理した');
    await notes.getByRole('button', { name: /「水飲み場の蛇口を修理した」を消す/ }).click();
    const toast = adminToast(page, 'メモを消しました。');
    await expect(toast).toBeVisible();
    await expect(notes.getByText('水飲み場の蛇口を修理した')).toHaveCount(0);
    await toast.getByRole('button', { name: '元に戻す' }).click();
    await expect(notes.getByText('水飲み場の蛇口を修理した')).toBeVisible();

    // 40日前の来場の一覧(ダッシュボードの日の詳細から開くのと同じ ?date=)
    await page.goto(`/admin/?date=${daysAgo(40)}`);
    await expect(page.getByRole('heading', { name: /来場の一覧/ })).toBeVisible();
    // ほかのテストの来場も入るので、このテストで入れたおうち(クルミ)の行で確かめる
    await expect(page.getByRole('list', { name: 'この日の来場' }).getByRole('listitem').filter({ hasText: 'クルミ' })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'いまいる場所' }).getByRole('link', { name: 'ダッシュボード' })).toBeVisible();
  });

  test('どこから来ているか: 市区町村ごとの行を押すと町域が開く', async ({ page }) => {
    await adminLogin(page, 'admin', '/dashboard?range=90d');
    const table = page.getByRole('table', { name: '市区町村ごとのおうちと来場' });
    await expect(table.getByRole('row', { name: /目黒区/ })).toContainText('2回');
    const setagaya = table.getByRole('button', { name: /世田谷区/ });
    await setagaya.click();
    await expect(setagaya).toHaveAttribute('aria-expanded', 'true');
    await expect(table.getByRole('row', { name: /池尻/ })).toBeVisible();
  });

  test('パネルの「CSV」: 先頭が # の説明行で、日本語の列名(個人情報は入らない)', async ({ page }) => {
    await adminLogin(page, 'admin', '/dashboard?range=30d');
    const panel = page.getByRole('region', { name: '天気と来場' });
    const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: '天気と来場をCSVで保存' }).click()]);
    const bytes = await readFile((await dl.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes.toString('utf8').slice(1).split('\r\n');
    expect(lines[0]).toBe('# グリーンドーム ダッシュボード「天気と来場」(CSV)');
    const header = lines.find((l) => !l.startsWith('#'))!;
    expect(header).toBe('天気,曜日,日数(日),1日あたりの来場組数(組),1日あたりの会員の来場組数(組),1日あたりの会員以外の頭数(頭),1日あたりの来場頭数(頭)');
    expect(lines.join('\n')).not.toContain(memberNo);
    await expect(adminToast(page, /を保存しました。$/)).toBeVisible();
  });

  test('受付スタッフには、管理者向けの指標(継続状況・常連さん・家族・追加したアンケート)と「今すぐ調べる」を出さない', async ({ page }) => {
    await adminLogin(page, 'staff', '/dashboard?range=12m');
    await expect(page.getByRole('region', { name: '期間の集計' })).toBeVisible();
    await expect(page.getByRole('region', { name: '来場頻度' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'しばらく来ていない常連さん' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'おうちの継続状況' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '家族での利用' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '今すぐ調べる' })).toHaveCount(0);
  });

  test('管理者には継続状況と常連さんが出る。製作者はメモを見るだけ', async ({ page, browser }) => {
    await adminLogin(page, 'admin', '/dashboard?range=12m');
    await expect(page.getByRole('region', { name: 'おうちの継続状況' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'しばらく来ていない常連さん' })).toBeVisible();
    const dev = await browser.newPage();
    await adminLogin(dev, 'developer', '/');
    await expect(dev.getByRole('region', { name: 'この日のメモ' })).toBeVisible();
    await expect(dev.getByRole('button', { name: 'メモを残す' })).toHaveCount(0);
    await dev.close();
  });
});
