import { expect, test, type Page } from '@playwright/test';
import { newLineUser, openLiff } from './helpers';
import { liffShot } from './liff-shot';
import { bookDaycareApi, dayAhead, markExperienced, registerApi, setOverride, showDateInCalendar } from './booking-helpers';

// L-14 予約する・L-15 予約の一覧と内容(C-15・C-16)の見え方。確かめ方は e2e/liff.tickets-layout.spec.ts と同じ。
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0 LIFF';

const DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 603 }, dpr: 2, offset: 20 },
  { name: 'iPhone 16', viewport: { width: 393, height: 759 }, dpr: 3, offset: 24 },
] as const;

async function checkScreen(page: Page, device: string, screen: string) {
  await page.waitForLoadState('networkidle');
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    for (const el of document.querySelectorAll<HTMLElement>('button, a.btn, .menu a, .segment label, .chips label, .bk-row, label.check, .pick-row')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      if (r.height < 43.5) out.push(`ボタンが低い(${Math.round(r.height)}px): ${(el.getAttribute('aria-label') ?? el.textContent)?.trim().slice(0, 20)}`);
      if (r.right > doc.clientWidth + 1) out.push(`ボタンがはみ出し: ${el.textContent?.trim().slice(0, 20)}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.getAttribute('aria-label') ?? el.id}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0) {
        if (['svg', 'img'].includes(el.tagName.toLowerCase())) continue;
        out.push(`文字が枠からはみ出し: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} 「${el.textContent?.trim().slice(0, 16)}」`);
      }
    }
    return out;
  });
  expect(problems, `${device} / ${screen}`).toEqual([]);
  if (process.env.SHOT_DIR) await liffShot(page, `${process.env.SHOT_DIR}/${device}/${screen}.png`);
}

for (const d of DEVICES) {
  test.describe(d.name, () => {
    test.use({ viewport: d.viewport, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: IOS_UA });

    test('予約の画面が、LINE の画面の中に収まる', async ({ page, request }) => {
      test.setTimeout(120_000);
      const user = newLineUser('マルゲリータママ');
      // 長い名前・3頭(はじめての子と、予防注射の年がない子)でも崩れないか
      const u = await registerApi(request, user, [{ name: 'ジョセフィーヌ' }, { name: 'アルフォンス', size: 'medium' }, { name: 'ニコラス', size: 'large' }]);
      await markExperienced(request, u.dogs[0]!.id);
      const date = dayAhead(d.offset);
      await setOverride(request, { date: dayAhead(d.offset + 1), service: 'daycare', closed: true });
      await setOverride(request, { date: dayAhead(d.offset + 2), service: 'daycare', caps: { small: 0, medium: null, large: null } });
      const done = await bookDaycareApi(request, user, [u.dogs[0]!.id], dayAhead(d.offset + 5));
      // 予防注射の年がない子の案内を出すため、1頭の年を消す
      await request.patch(`/api/dogs/${u.dogs[1]!.id}`, {
        headers: { authorization: `Bearer mock:${user.split(':')[0]}:x` },
        data: { rabiesVaccineYear: null, comboVaccineYear: null },
      });

      await openLiff(page, user, '/bookings');
      await page.getByRole('region', { name: 'これからの予約' }).waitFor();
      await checkScreen(page, d.name, 'L-15 予約の一覧');

      await page.getByRole('button', { name: '予約する' }).click();
      await page.getByRole('heading', { name: '予約する' }).waitFor();
      for (const n of ['ジョセフィーヌ', 'アルフォンス']) await page.getByRole('checkbox', { name: new RegExp(n) }).check();
      await checkScreen(page, d.name, 'L-14 予約する(種類とワンちゃん)');
      await page.getByRole('button', { name: '日にちを選ぶ' }).click();
      await (await showDateInCalendar(page, date)).waitFor();
      await checkScreen(page, d.name, 'L-14 予約する(空きのカレンダー)');
      await page.locator(`.bk-cal-cell[data-date="${date}"]`).click();
      await checkScreen(page, d.name, 'L-14 予約する(日にちと時刻)');
      await page.getByRole('button', { name: '次へ' }).click();
      await page.getByLabel('お店へのメモ').fill('ごはんは朝と夕方に1回ずつ。アルフォンスは1日1回お薬を飲みます。');
      for (const box of await page.locator('.bk-check input[type=checkbox]').all()) await box.check();
      await checkScreen(page, d.name, 'L-14 予約する(メモと確かめること)');
      await page.getByRole('button', { name: '内容を確かめる' }).click();
      await page.getByRole('region', { name: '料金の目安' }).waitFor();
      await checkScreen(page, d.name, 'L-14 予約する(内容の確認と料金の目安)');
      await page.getByRole('button', { name: '予約する', exact: true }).click();
      await expect(page.locator('.bk-detail-title .badge')).toHaveText('確認待ち');
      await checkScreen(page, d.name, 'L-15 予約の内容(確認待ち)');

      // お泊まりのカレンダー(チェックイン → チェックアウト)
      await openLiff(page, user, '/bookings/new');
      await page.getByRole('radio', { name: 'お泊まり' }).check();
      await page.getByRole('checkbox', { name: /ジョセフィーヌ/ }).check();
      await page.getByRole('button', { name: '日にちを選ぶ' }).click();
      await (await showDateInCalendar(page, dayAhead(d.offset + 10))).click();
      await (await showDateInCalendar(page, dayAhead(d.offset + 12))).click();
      await checkScreen(page, d.name, 'L-14 予約する(お泊まりの日にち)');

      await openLiff(page, user, `/bookings/${done.id}`);
      await expect(page.locator('.bk-detail-title .badge')).toHaveText('確定');
      await checkScreen(page, d.name, 'L-15 予約の内容(確定)');
      await page.getByRole('button', { name: 'この予約をキャンセルする' }).click();
      await page.getByRole('dialog', { name: '予約をキャンセルしますか' }).waitFor();
      await checkScreen(page, d.name, 'L-15 予約のキャンセル(確認)');
    });
  });
}
