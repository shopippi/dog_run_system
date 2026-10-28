import { expect, test, type Browser, type CDPSession, type Page } from '@playwright/test';
import { adminLogin, answerSurvey, makePhoto, newLineUser, openLiff, registerViaUi } from './helpers';
import { insertMigrationRequest, putMedia, visitYesterday } from './merge-helpers';

// 担当B(おうちの統合・確認待ち)の画面の見え方。e2e/admin.layout.spec.ts の checkScreen と同じ確かめ方。
// PC(1280)とタブレット縦(768)の2つの幅で確かめる。
const VIEWPORTS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
] as const;

const sessions = new WeakMap<Page, CDPSession>();

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
    // 縦に長い画面の写真(fullPage)を撮ると、Chromium が「指で操作する端末」の設定(pointer: coarse)を外してしまう。
    // 次の画面の確かめが正しく行えるよう、かけ直す
    // (CDP の接続を切ると設定も外れるので、画面ごとに1つの接続をつないだままにする)
    if (touch) {
      let cdp = sessions.get(page);
      if (!cdp) {
        cdp = await page.context().newCDPSession(page);
        sessions.set(page, cdp);
      }
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    }
  }
}

/** 写真つきで登録する */
async function registerWithPhoto(page: Page, user: string, names: [string, ...string[]]) {
  await openLiff(page, user);
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  for (const [i, name] of names.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'もう1頭追加する' }).click();
    const form = page.locator('fieldset.dog-form').nth(i);
    await form.getByLabel('名前').fill(name);
    await form.getByRole('combobox', { name: /犬種/ }).selectOption({ label: i === 0 ? '柴犬' : 'トイプードル' });
    if (i === 0) {
      await form.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page) });
      await form.locator('img.av').waitFor();
    }
  }
  await page.getByRole('button', { name: '次へ' }).click();
  await answerSurvey(page);
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByText('登録が完了しました').waitFor();
  return (await page.locator('.welcome-card .id').textContent())!;
}

/** まとめる2つのおうち(パパ: 写真つきのハル、ママ: はるちゃん・長い名前のワンちゃん) */
async function seed(browser: Browser) {
  const customer = await browser.newPage();
  const papa = newLineUser('パパ');
  const mama = newLineUser('ママ');
  const papaNo = await registerWithPhoto(customer, papa, ['ハル']);
  const mamaNo = await registerViaUi(customer, mama, ['はるちゃん', 'チョコレートクッキー']);
  visitYesterday(papaNo);
  visitYesterday(mamaNo);
  await customer.close();
  return { papaNo, mamaNo };
}

/** 確認待ち: 以前に届いた旧カードの引き継ぎ申請(写真つき。却下だけできる)。おうちをまとめる申請は、もう作らない(C-12)。M-09 旧カードの引き継ぎは e2e/admin.tickets-layout.spec.ts */
async function seedRequests(browser: Browser) {
  const customer = await browser.newPage();
  const papa = newLineUser('パパ');
  const papaNo = await registerViaUi(customer, papa, ['リク']);
  const key = `requests/${papaNo}/card-${Date.now()}.jpg`;
  putMedia(key, await makePhoto(customer, 800, 600));
  insertMigrationRequest(papaNo, { source: 'paper_card', claimedPoints: 7, note: '角が少し破れています' }, key);
  await customer.close();
  return { papaNo };
}

test.describe('おうちの統合・確認待ちの見え方', () => {
  for (const v of VIEWPORTS) {
    test(`${v.name}: M-09 確認待ちが横にはみ出さず、押しやすい大きさになっている`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { papaNo } = await seedRequests(browser);
      const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
      await adminLogin(page, 'admin');
      await expect(page.getByRole('link', { name: /確認待ちが \d+件 あります/ })).toBeVisible();
      await checkScreen(page, v.name, 'M-02 今日の来場(管理者・確認待ちあり)', v.touch);
      await page.getByRole('link', { name: /確認待ちが \d+件 あります/ }).click();

      const migration = page.getByRole('listitem', { name: `旧カードの引き継ぎ リクのおうち ${papaNo}` });
      await expect(migration.getByRole('img', { name: '旧カードの写真' })).toBeVisible();
      await expect.poll(() => migration.getByRole('img', { name: '旧カードの写真' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await expect(migration.getByRole('button', { name: '確かめて承認する' })).toHaveCount(0);
      await checkScreen(page, v.name, 'M-09 確認待ち', v.touch);

      await migration.getByRole('button', { name: '却下する' }).click();
      const dialog = page.getByRole('dialog', { name: '申請を却下する' });
      await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
      await checkScreen(page, v.name, 'M-09 却下の確認', v.touch);
      await dialog.getByRole('button', { name: '却下する' }).click();
      await expect(migration).toHaveCount(0);

      await page.getByRole('tab', { name: '処理済み' }).click();
      await expect(page.getByRole('listitem', { name: `旧カードの引き継ぎ リクのおうち ${papaNo}` })).toBeVisible();
      await checkScreen(page, v.name, 'M-09 確認待ち(処理済み)', v.touch);

      await page.close();
    });

    test(`${v.name}: M-08 おうちの統合が横にはみ出さず、押しやすい大きさになっている`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { papaNo, mamaNo } = await seed(browser);
      const page = await browser.newPage({ viewport: v.viewport, hasTouch: v.touch });
      await adminLogin(page, 'admin', '/merge');

      const picker1 = page.getByRole('group', { name: 'おうち1を探す' });
      await picker1.getByRole('searchbox', { name: '探す言葉' }).fill(papaNo);
      const list1 = picker1.getByRole('list', { name: 'おうち1を探すの候補' });
      await list1.getByRole('button', { name: new RegExp(papaNo) }).waitFor();
      await checkScreen(page, v.name, 'M-08 おうちの統合(探す)', v.touch);
      await list1.getByRole('button', { name: new RegExp(papaNo) }).click();

      const picker2 = page.getByRole('group', { name: 'おうち2を探す' });
      await picker2.getByRole('tab', { name: '写真で探す' }).click();
      await picker2.getByRole('list', { name: 'おうち2を探すの候補' }).getByRole('button', { name: /はるちゃん/ }).first().waitFor();
      await checkScreen(page, v.name, 'M-08 おうちの統合(写真で探す)', v.touch);
      await picker2.getByRole('tab', { name: '名前で探す' }).click();
      await picker2.getByRole('searchbox', { name: '探す言葉' }).fill(mamaNo);
      await picker2.getByRole('list', { name: 'おうち2を探すの候補' }).getByRole('button', { name: new RegExp(mamaNo) }).click();

      const pairing = page.getByRole('listitem', { name: 'はるちゃんの組み合わせ' });
      await pairing.getByRole('radio', { name: 'ハル', exact: true }).check();
      await expect(pairing.getByRole('radio', { name: /^ハル\(/ })).toBeChecked();
      await expect(page.getByRole('region', { name: '4. まとめた後' }).getByText(/ハル・チョコレートクッキーのおうち/)).toBeVisible();
      await checkScreen(page, v.name, 'M-08 おうちの統合(組み合わせと結果)', v.touch);

      await page.getByRole('button', { name: 'まとめる', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'おうちをまとめる' });
      await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
      await checkScreen(page, v.name, 'M-08 おうちの統合(確認)', v.touch);
      await dialog.getByRole('button', { name: 'まとめる' }).click();
      await expect(page.getByRole('status')).toContainText('にまとめました');
      await checkScreen(page, v.name, 'M-08 おうちの統合(まとめた後)', v.touch);
      await page.close();
    });
  }
});
