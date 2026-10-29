import { expect, test, type Page } from '@playwright/test';
import { adminLogin } from './helpers';

// 設定まわりの画面(担当C)の見え方。e2e/admin.layout.spec.ts の checkScreen と同じ確かめ方。
// PC(1280×800)とタブレット縦(768×1024)の2つの幅で確かめる。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

/**
 * 1つの画面を確かめる。
 * - 横にはみ出していない(横スクロールが出ない)
 * - 押す部品の高さが、指で操作する端末(hasTouch)では 44px 以上、マウスでは 40px 以上
 * - 入力欄の文字が 16px 以上
 * SHOT_DIR を指定すると、画面の写真を保存する。
 */
async function checkScreen(page: Page, folder: string, screen: string, touch: boolean) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const minHeight = touch ? 44 : 40;
  // 指の操作のエミュレーション(pointer: coarse)が効いてから測る(全体の写真を撮った直後は、一瞬だけ外れていることがある)
  if (touch) {
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim()), { timeout: 5000 })
      .toBe('44px');
  }
  const problems = await page.evaluate((minHeight) => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    const pressables = document.querySelectorAll<HTMLElement>(
      'button, a, [role=tab], .chips label, .pick-row, label.check, summary',
    );
    for (const el of pressables) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20);
      if (r.height < minHeight - 0.5) out.push(`押す部品が低い(${Math.round(r.height)}px): ${name}`);
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
    // 縦に長い画面の写真を撮ると、Chromium が指で操作する端末のまねを外すことがあるので、設定し直す
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    }
  }
}

/** 日本時間の今日 */
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
/** 今月の、今日より2日前の日(月の初めなら null) */
const closedDay = () => {
  const d = Number(today().slice(8));
  return d > 2 ? `${today().slice(0, 8)}${String(d - 2).padStart(2, '0')}` : null;
};

test.describe('設定まわりの画面の見え方', () => {
  test.describe.configure({ mode: 'serial' });

  // アンケートの集計を見るための質問(ほかのテストのお客さんに出ないよう、すぐ非表示にする)
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await adminLogin(page, 'admin');
    const headers = { 'x-dr-admin': '1' };
    const created = await page.request.post('/admin/api/survey-questions', {
      headers,
      data: { target: 'household', kind: 'choice', label: '見え方の確認用の質問', options: ['はい', 'いいえ', 'どちらでもない'] },
    });
    const { id } = (await created.json()) as { id: number };
    await page.request.patch(`/admin/api/survey-questions/${id}`, { headers, data: { visible: false } });
    // カレンダーに出すイベントと臨時休業日(休業日は、今月の今日より前の日にして、テストの後で戻す)
    await page.request.post('/admin/api/events', { headers, data: { date: today(), name: '見え方の確認用のイベント', kind: 'イベント' } });
    await page.request.post('/admin/api/events', { headers, data: { date: today(), name: '2つ目のイベント', kind: '貸し切り' } });
    await page.request.post('/admin/api/events', { headers, data: { date: today(), name: '3つ目のイベント', kind: 'その他' } });
    if (closedDay()) await page.request.post('/admin/api/closures', { headers, data: { date: closedDay(), note: '見え方の確認' } });
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await adminLogin(page, 'admin');
    if (closedDay()) await page.request.delete(`/admin/api/closures/${closedDay()}`, { headers: { 'x-dr-admin': '1' } });
    await page.close();
  });

  for (const v of VIEWPORTS) {
    test(`${v.name}: 横にはみ出さず、押しやすい大きさになっている`, async ({ browser }) => {
      test.setTimeout(120_000);
      const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
      await adminLogin(page, 'admin');

      // M-13 ルールの設定
      await page.getByRole('link', { name: 'ルール' }).click();
      await page.getByRole('region', { name: '受付のQRコード' }).getByRole('img', { name: '受付のQRコード' }).waitFor();
      await checkScreen(page, v.name, 'M-13 ルールの設定', v.touch);
      await page.getByRole('button', { name: '合言葉を作り直す' }).click();
      await page.getByRole('dialog', { name: '受付のQRコードを作り直す' }).waitFor();
      await checkScreen(page, v.name, 'M-13 合言葉を作り直す', v.touch);
      await page.getByRole('button', { name: 'やめる' }).click();

      // M-12 犬種の選択肢
      await page.getByRole('link', { name: '犬種' }).click();
      await page.getByRole('list', { name: '犬種' }).getByRole('listitem', { name: 'その他' }).waitFor();
      await checkScreen(page, v.name, 'M-12 犬種の選択肢', v.touch);
      await page.getByRole('button', { name: 'チワワを変える' }).click();
      await page.getByRole('dialog', { name: '犬種を変える' }).waitFor();
      await checkScreen(page, v.name, 'M-12 犬種を変える', v.touch);
      await page.getByRole('button', { name: 'やめる' }).click();

      // M-11 アンケートの設定
      await page.getByRole('link', { name: 'アンケート' }).click();
      await page.getByRole('list', { name: '質問' }).getByRole('listitem', { name: '年代' }).waitFor();
      await checkScreen(page, v.name, 'M-11 アンケートの設定', v.touch);
      await page.getByRole('button', { name: 'このドッグランを知ったきっかけを変える' }).click();
      await page.getByRole('dialog', { name: '質問を変える' }).waitFor();
      await checkScreen(page, v.name, 'M-11 質問を変える', v.touch);
      await page.getByRole('button', { name: 'やめる' }).click();
      await page.getByRole('button', { name: '見え方の確認用の質問の集計' }).first().click();
      await page.getByRole('dialog', { name: '回答の集計' }).getByRole('list').waitFor();
      await checkScreen(page, v.name, 'M-11 回答の集計', v.touch);
      await page.getByRole('button', { name: '閉じる' }).click();

      // M-14 スタッフ
      await page.getByRole('link', { name: 'スタッフ' }).click();
      const staffRow = page.getByRole('list', { name: 'スタッフ' }).getByRole('listitem', { name: '受付' }).first();
      await staffRow.waitFor();
      await checkScreen(page, v.name, 'M-14 スタッフ', v.touch);
      await staffRow.getByRole('button', { name: '受付さんのパスワードを再発行' }).click();
      const pw = page.getByRole('dialog', { name: 'パスワードを再発行' });
      await pw.getByRole('radio', { name: '自分で入れる' }).click();
      await checkScreen(page, v.name, 'M-14 パスワードを再発行', v.touch);
      await pw.getByRole('button', { name: 'やめる' }).click();
      await staffRow.getByRole('button', { name: '受付さんを停止する' }).click();
      await page.getByRole('dialog', { name: 'アカウントを停止する' }).waitFor();
      await checkScreen(page, v.name, 'M-14 アカウントを停止する', v.touch);
      await page.getByRole('button', { name: 'やめる' }).click();

      // M-10 イベント・休業日
      await page.getByRole('link', { name: 'イベント・休業日' }).click();
      await page.getByRole('region', { name: 'カレンダー' }).getByRole('button', { name: /今日/ }).waitFor();
      await checkScreen(page, v.name, 'M-10 イベント・休業日', v.touch);

      // M-18 CSV出力
      await page.getByRole('link', { name: 'CSV出力' }).click();
      await page.getByRole('radio', { name: '来場' }).check();
      await checkScreen(page, v.name, 'M-18 CSV出力', v.touch);

      // M-16 使い方・困ったとき(よくある質問を1つ開いたところ)
      await page.getByRole('link', { name: '使い方・困ったとき' }).click();
      await page.getByText('ポイントが付かない').click();
      await checkScreen(page, v.name, 'M-16 使い方・困ったとき', v.touch);

      await page.close();
    });
  }

  test('受付スタッフの使い方・困ったとき', async ({ browser }) => {
    const v = VIEWPORTS[1];
    const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
    await adminLogin(page, 'staff', '/help');
    await page.getByText('ポイントが付かない').waitFor();
    await checkScreen(page, v.name, 'M-16 使い方・困ったとき(受付スタッフ)', v.touch);
    await page.close();
  });

  test('製作者(見るだけ)のルールの設定', async ({ browser }) => {
    const v = VIEWPORTS[0];
    const page = await browser.newPage({ viewport: v.viewport });
    await adminLogin(page, 'developer', '/settings');
    await page.getByRole('region', { name: '受付のQRコード' }).waitFor();
    await checkScreen(page, v.name, 'M-13 ルールの設定(製作者・見るだけ)', v.touch);
    await page.close();
  });
});
