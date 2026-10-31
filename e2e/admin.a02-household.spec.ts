import { expect, test } from '@playwright/test';
import { checkinViaLiff } from './households-helpers';
import { adminLogin, adminToast, newLineUser, registerViaUi } from './helpers';

test('A-02 おうちを探して詳細を開き、家族・ワンちゃん・来場・ポイント・アンケートを見て、呼び名を変える', async ({ browser }) => {
  const customer = await browser.newPage();
  const user = newLineUser('パパ');
  const memberNo = await registerViaUi(customer, user, ['ハルマキ', 'ナツメ']);
  await checkinViaLiff(customer, user);

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await adminLogin(page, 'admin');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('はるまき');
  await page.getByRole('link', { name: 'ハルマキ・ナツメのおうちの詳細を開く' }).click();

  const head = page.getByRole('region', { name: 'おうちの概要' });
  await expect(head.getByRole('heading', { name: 'ハルマキ・ナツメのおうち' })).toBeVisible();
  await expect(head.getByText(memberNo)).toBeVisible();
  await expect(head.getByRole('group', { name: 'ポイント', exact: true })).toContainText('1ポイント');
  await expect(head.getByRole('group', { name: '来場' })).toContainText('1回');
  await expect(page.getByRole('list', { name: '家族' })).toContainText('パパさん');
  await expect(page.getByRole('list', { name: '家族' })).toContainText('30代・女性');
  const dogs = page.getByRole('list', { name: 'ワンちゃん' });
  await expect(dogs).toContainText('ハルマキ');
  await expect(dogs).toContainText(`${memberNo}-2`);
  await expect(page.getByRole('list', { name: '来場履歴' })).toContainText('ハルマキ・ナツメ');
  await expect(page.getByRole('list', { name: 'ポイントの記録' })).toContainText('来場');
  await expect(page.getByRole('region', { name: 'アンケート' })).toContainText('Instagram');

  // 呼び名を変える
  await head.getByRole('button', { name: '呼び名を変える' }).click();
  await head.getByLabel('おうちの呼び名').fill('ハルマキさんち');
  await head.getByRole('button', { name: '呼び名を保存' }).click();
  await expect(head.getByRole('heading', { name: 'ハルマキさんち' })).toBeVisible();
  await expect(adminToast(page, '呼び名を「ハルマキさんち」にしました')).toBeVisible();

  // 新しい呼び名で探せる(道しるべの「おうちを探す」で戻る)
  await page.getByRole('navigation', { name: 'いまいる場所' }).getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('はるまきさんち');
  await expect(page.getByRole('list', { name: '見つかったおうち' }).getByText('ハルマキさんち')).toBeVisible();
});

test('A-02 受付スタッフには、おうちの詳細へのリンクが出ない', async ({ browser }) => {
  const customer = await browser.newPage();
  await registerViaUi(customer, newLineUser('ママ'), ['ポテト']);
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await adminLogin(page, 'staff', '/search');
  await page.getByRole('link', { name: 'おうちを探す' }).click();
  await page.getByRole('searchbox', { name: '探す言葉' }).fill('ぽてと');
  const results = page.getByRole('list', { name: '見つかったおうち' });
  await expect(results.getByRole('button', { name: /ポテトのおうち/ })).toBeVisible();
  await expect(results.getByRole('link')).toHaveCount(0);
});
