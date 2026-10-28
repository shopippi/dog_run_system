import { expect, test } from '@playwright/test';
import { newLineUser, openLiff } from './helpers';

// A-11 犬種を大まかな分け方にする(docs/changes-2026-10-28.md 6章)。選ぶ画面の並びは、一覧の順(日本で多い順)
const BREEDS = [
  'プードル', 'チワワ', 'ダックスフンド', 'ポメラニアン', '柴犬', 'フレンチブルドッグ', 'ミニチュアシュナウザー',
  'ヨークシャーテリア', 'マルチーズ', 'シーズー', 'ゴールデンレトリバー', 'パピヨン', 'コーギー', 'ジャックラッセルテリア',
  'ラブラドールレトリバー', 'ペキニーズ', 'ボーダーコリー', 'キャバリア', 'パグ', 'ビーグル', 'ボストンテリア',
  'ミニチュアピンシャー', 'イタリアングレーハウンド', 'バーニーズマウンテンドッグ', 'ミックス', 'その他',
];

test('A-11 犬種は大まかな分け方で、日本で多い順に並び、「ミックス」「その他」が最後', async ({ page }) => {
  await openLiff(page, newLineUser('ママ'));
  await page.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await page.getByRole('button', { name: '同意して次へ' }).click();
  const select = page.locator('fieldset.dog-form').getByRole('combobox', { name: /犬種/ });
  const options = (await select.locator('option').allTextContents()).filter((o) => o !== '選んでください');
  // ほかのテストが管理画面で犬種を足していても、初期の26件の順と「ミックス」「その他」が最後なのは変わらない
  expect(options.filter((o) => BREEDS.includes(o))).toEqual(BREEDS);
  expect(options.slice(-2)).toEqual(['ミックス', 'その他']);
  for (const old of ['トイプードル', 'ミニチュアダックスフンド', 'カニンヘンダックスフンド', 'ロングコートチワワ']) {
    expect(options).not.toContain(old);
  }
  // 犬種を選ぶと、サイズの初期値が入る
  await select.selectOption({ label: 'ダックスフンド' });
  await expect(page.getByRole('radio', { name: '小型' })).toBeChecked();
  await select.selectOption({ label: 'バーニーズマウンテンドッグ' });
  await expect(page.getByRole('radio', { name: '大型' })).toBeChecked();
});
