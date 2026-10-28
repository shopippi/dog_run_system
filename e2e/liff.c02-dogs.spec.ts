import { expect, test } from '@playwright/test';
import { answerSurvey, makePhoto, newLineUser, openLiff } from './helpers';

test('C-02 2頭を写真つきで登録すると、写真は長い辺 800px 以下に縮小されて保存される', async ({ page }) => {
  const user = newLineUser('ママ');
  await openLiff(page, user);
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  await expect(page.getByRole('heading', { name: 'ワンちゃんの登録' })).toBeVisible();

  // 入力が足りないと、何が足りないかを表示する
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.getByRole('alert')).toContainText('名前を入力してください');

  const first = page.locator('fieldset.dog-form').nth(0);
  await first.getByLabel('名前').fill('アル');
  await first.getByRole('combobox', { name: /犬種/ }).selectOption({ label: '柴犬' });
  // サイズは犬種から自動で選ばれる
  await expect(first.getByRole('radio', { name: '中型' })).toBeChecked();
  await first.locator('input[type=file]').setInputFiles({
    name: 'dog.jpg',
    mimeType: 'image/jpeg',
    buffer: await makePhoto(page, 2000, 1500),
  });
  await expect(first.locator('img.av')).toBeVisible();

  await page.getByRole('button', { name: 'もう1頭追加する' }).click();
  const second = page.locator('fieldset.dog-form').nth(1);
  await second.getByLabel('名前').fill('ニコ');
  await second.getByRole('combobox', { name: /犬種/ }).selectOption({ label: 'その他' });
  await second.getByRole('textbox', { name: /犬種を入力/ }).fill('甲斐犬');
  await second.getByRole('radio', { name: '中型' }).check();

  await page.getByRole('button', { name: '次へ' }).click();
  await answerSurvey(page);
  const upload = page.waitForResponse((r) => /\/api\/dogs\/\d+\/photo$/.test(r.url()) && r.status() === 200);
  await page.getByRole('button', { name: '登録する' }).click();
  const uploaded = await (await upload).json();

  await expect(page.getByText('登録が完了しました')).toBeVisible();
  await expect(page.getByText('アル・ニコのおうち')).toBeVisible();

  // 保存された写真の大きさを確かめる
  const size = await page.evaluate(async ({ url, user }) => {
    const [id, name] = user.split(':');
    const res = await fetch(url, { headers: { authorization: `Bearer mock:${id}:${encodeURIComponent(name!)}` } });
    const bmp = await createImageBitmap(await res.blob());
    return { w: bmp.width, h: bmp.height };
  }, { url: uploaded.dog.photoUrl as string, user });
  expect(Math.max(size.w, size.h)).toBe(800);
  expect(size).toEqual({ w: 800, h: 600 });
});
