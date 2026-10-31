import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { authHeaders } from './customer-helpers';

// 預かり・お泊まりの予約(21章。C-15・C-16・A-18〜A-22)の e2e で使う補助。
// e2e のデータベースはテスト全体で共有するので、テストごとに別の日にち(dayAhead の n)を使う(受け入れ数がまざらないように)。

/** 日本時間の今日 */
export function jstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 今日から n 日後(日本時間) */
export function dayAhead(n: number): string {
  const [y, m, d] = jstToday().split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type DogSpec = { name: string; size?: 'small' | 'medium' | 'large' };

/** API でお客さんを登録する。会員IDとワンちゃんを返す(breedId 1 = プードル、9 = ラブラドールレトリバー) */
export async function registerApi(request: APIRequestContext, user: string, dogs: DogSpec[]) {
  const res = await request.post('/api/register', {
    headers: authHeaders(user),
    data: {
      consent: true,
      dogs: dogs.map((d) => ({ name: d.name, breedId: d.size === 'large' ? 9 : 1, size: d.size ?? 'small', rabiesVaccineYear: 2026, comboVaccineYear: 2026 })),
      survey: [
        { questionId: 1, value: '30代' },
        { questionId: 2, value: '女性' },
        { questionId: 4, value: 'Instagram' },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { memberNo: string; dogs: { id: number; name: string }[] };
}

/** API で管理画面にログインする(request のクッキーに残る) */
export async function adminApiLogin(request: APIRequestContext, role: 'admin' | 'staff' | 'developer' = 'admin') {
  const res = await request.post('/admin/api/login', {
    headers: { 'x-dr-admin': '1' },
    data: { email: `${role}@example.com`, password: 'e2e-password-1234' },
  });
  expect(res.status()).toBe(200);
}

/** 管理者として「預かり経験あり」の印を付ける(すぐ確定になる子にする) */
export async function markExperienced(request: APIRequestContext, dogId: number) {
  await adminApiLogin(request, 'admin');
  const res = await request.post(`/admin/api/dogs/${dogId}/stay-experience`, { headers: { 'x-dr-admin': '1' }, data: { experienced: true } });
  expect(res.status(), await res.text()).toBe(200);
}

/** 管理者として、その日の受け入れ数を変える(休み・頭数) */
export async function setOverride(request: APIRequestContext, body: Record<string, unknown>) {
  await adminApiLogin(request, 'admin');
  const res = await request.put('/admin/api/bookings/overrides', { headers: { 'x-dr-admin': '1' }, data: body });
  expect(res.status(), await res.text()).toBe(200);
}

/** API でお客さんとして預かりを予約する */
export async function bookDaycareApi(request: APIRequestContext, user: string, dogIds: number[], date: string, extra: Record<string, unknown> = {}) {
  const opts = (await (await request.get('/api/bookings/options', { headers: authHeaders(user) })).json()) as { rules: { booking_checklist: string[] } };
  const res = await request.post('/api/bookings', {
    headers: authHeaders(user),
    data: {
      service: 'daycare',
      startDate: date,
      endDate: date,
      startTime: '10:00',
      endTime: '16:00',
      dogIds,
      note: 'ごはんは朝だけ',
      checklist: opts.rules.booking_checklist,
      ...extra,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: number; status: string };
}

/** 空きのカレンダーで、その日が見える月まで進める */
export async function showDateInCalendar(page: Page, date: string) {
  const cell = page.locator(`.bk-cal-cell[data-date="${date}"]`);
  for (let i = 0; i < 3 && (await cell.count()) === 0; i++) {
    await page.getByRole('button', { name: '次の月' }).click();
  }
  // 空きの読み込みを待つ
  await expect(page.locator('.bk-cal')).toHaveAttribute('aria-busy', 'false');
  return cell;
}

/** お客さんの予約の流れ(L-14)で、預かりを1日選んで内容の確認まで進む */
export async function requestDaycareViaUi(page: Page, date: string, dogNames: string[] = []) {
  await page.getByRole('heading', { name: '予約する' }).waitFor();
  for (const n of dogNames) await page.getByRole('checkbox', { name: new RegExp(n) }).check();
  await page.getByRole('button', { name: '日にちを選ぶ' }).click();
  await page.getByRole('heading', { name: '日にちと時刻' }).waitFor();
  const cell = await showDateInCalendar(page, date);
  await cell.click();
  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByRole('heading', { name: 'お店へのメモ' }).waitFor();
  await page.getByLabel('お店へのメモ').fill('ごはんは朝と夕方に1回ずつ');
  for (const box of await page.locator('.bk-check input[type=checkbox]').all()) await box.check();
  await page.getByRole('button', { name: '内容を確かめる' }).click();
  await page.getByRole('heading', { name: '内容を確かめる' }).waitFor();
}
