import { expect, test, type Page } from '@playwright/test';
import { newLineUser, openLiff, registerViaUi } from './helpers';

async function sendInvite(page: Page, user: string): Promise<string> {
  await openLiff(page, user, '/family');
  await page.getByRole('button', { name: 'LINEで招待を送る' }).click();
  await expect(page.getByRole('status')).toContainText('招待を送りました');
  const messages = await page.evaluate(() => (window as unknown as { __sharedMessages: string[] }).__sharedMessages);
  return messages.at(-1)!.match(/\/liff(\/invite\/[A-Za-z0-9_-]+)/)![1]!;
}

test('C-11/C-12 パパが招待を送り、ママがLINEで開いて参加すると、同じ会員証になる', async ({ page }) => {
  const papa = newLineUser('パパ');
  const memberNo = await registerViaUi(page, papa, ['アル', 'ニコ']);
  const invitePath = await sendInvite(page, papa);

  const mama = newLineUser('ママ');
  await openLiff(page, mama, invitePath);
  await expect(page.getByRole('heading', { name: 'アル・ニコのおうちに参加しますか?' })).toBeVisible();
  await page.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '40代' }).check();
  await page.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '女性' }).check();
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '参加する' }).click();
  await expect(page.getByText('参加しました')).toBeVisible();
  await page.getByRole('button', { name: '会員証を見る' }).click();

  const card = page.getByRole('region', { name: '会員証' });
  await expect(card.getByText(memberNo)).toBeVisible();
  await expect(card.getByText('アル・ニコのおうち')).toBeVisible();

  // 同じ招待は2回使えない
  await openLiff(page, newLineUser('ばあば'), invitePath);
  await expect(page.getByRole('alert')).toContainText('この招待はもう使われています');
});

test('C-12 すでに別のおうちを持つ人が招待を開くと、まとめる申請になる', async ({ page }) => {
  const papa = newLineUser('パパ');
  await registerViaUi(page, papa, ['アル']);
  const invitePath = await sendInvite(page, papa);

  const mama = newLineUser('ママ');
  const mamaNo = await registerViaUi(page, mama, ['アル']);
  await openLiff(page, mama, invitePath);
  await expect(page.getByRole('heading', { name: 'アルのおうちとまとめますか?' })).toBeVisible();
  await page.getByRole('button', { name: 'おうちをまとめる申請をする' }).click();
  await expect(page.getByRole('status')).toContainText('おうちをまとめる申請をしました');
  await page.getByRole('link', { name: '会員証にもどる' }).click();
  await expect(page.getByRole('region', { name: '会員証' }).getByText(mamaNo)).toBeVisible();
});
