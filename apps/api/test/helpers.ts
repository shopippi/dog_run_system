import { SELF } from 'cloudflare:test';

export const BASE = 'https://dogrun.test';

export type CallOptions = {
  /** お客さんとして呼ぶときの LINE ユーザー(例: 'U001:パパ') */
  user?: string;
  method?: string;
  body?: unknown;
  /** 現在時刻を指定する(x-debug-now) */
  now?: string;
  headers?: Record<string, string>;
};

/** API を呼んで、状態コードと JSON を返す。 */
export async function call<T = any>(path: string, opts: CallOptions = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.user) {
    const [id, name = ''] = opts.user.split(':');
    headers.authorization = `Bearer mock:${id}:${encodeURIComponent(name)}`;
  }
  if (opts.now) headers['x-debug-now'] = opts.now;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await SELF.fetch(`${BASE}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json as T };
}

export { fakeJpeg } from '../../../packages/shared/test/fake-jpeg';

/** 登録で使う犬の入力(breedId 1 = トイプードル、5 = 柴犬、11 = その他) */
export const dog = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  breedId: 1,
  size: 'small',
  ...extra,
});

/** お客さんを登録する。会員IDと犬を返す。 */
export async function registerUser(user: string, dogs = [dog('アル')], extra: Record<string, unknown> = {}) {
  const res = await call('/api/register', { user, body: { consent: true, dogs, survey: survey(), ...extra } });
  if (res.status !== 201) throw new Error(`登録に失敗: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { memberNo: string; householdName: string; dogs: { id: number; dogNo: string; name: string }[] };
}

/** 固定のアンケートの必須の回答(1 = 年代、2 = 性別、4 = 知ったきっかけ) */
export const survey = (extra: { questionId: number; value: string | null }[] = []) => [
  { questionId: 1, value: '30代' },
  { questionId: 2, value: '女性' },
  { questionId: 4, value: 'Instagram' },
  ...extra,
];

/** 受付の固定QRコードの合言葉 */
export async function passphrase(): Promise<string> {
  const { env } = await import('cloudflare:test');
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'checkin_passphrase'").first<{ value: string }>();
  return JSON.parse(row!.value) as string;
}

/** チェックインする */
export async function checkin(user: string, dogIds: number[], opts: { useTicket?: boolean; now?: string } = {}) {
  return call('/api/checkins', {
    user,
    now: opts.now,
    body: { passphrase: await passphrase(), dogIds, useTicket: opts.useTicket ?? false },
  });
}

/** 台帳にポイントを直接入れる(テストの準備用) */
export async function givePoints(memberNo: string, delta: number) {
  const { env } = await import('cloudflare:test');
  await env.DB.prepare(
    `INSERT INTO point_ledger (household_id, delta, kind, actor_type, created_at)
     SELECT id, ?, 'manual', 'system', '2026-01-01T00:00:00+09:00' FROM households WHERE member_no = ?`,
  )
    .bind(delta, memberNo)
    .run();
}

/** 家族をおうちに足す(招待の機能を使わずに準備する) */
export async function addFamily(memberNo: string, lineUserId: string, name: string) {
  const { env } = await import('cloudflare:test');
  await env.DB.prepare(
    `INSERT INTO family_members (household_id, line_user_id, line_display_name, joined_at, join_method, status, updated_at)
     SELECT id, ?, ?, '2026-01-01T00:00:00+09:00', 'invite', 'active', '2026-01-01T00:00:00+09:00' FROM households WHERE member_no = ?`,
  )
    .bind(lineUserId, name, memberNo)
    .run();
}

/** 管理画面のアカウントを作る(テスト用) */
export async function createStaff(email: string, role: 'staff' | 'admin' | 'developer', password = 'password-1234') {
  const { env } = await import('cloudflare:test');
  const { hashPassword } = await import('../src/lib/password');
  await env.DB.prepare(
    `INSERT INTO staff_users (email, name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', '2026-01-01T00:00:00+09:00', '2026-01-01T00:00:00+09:00')`,
  )
    .bind(email, role === 'admin' ? '管理者' : role === 'staff' ? '受付' : '製作者', await hashPassword(password), role)
    .run();
}

/** 管理画面にログインして、クッキーを返す */
export async function login(email: string, password = 'password-1234', now?: string): Promise<string> {
  const res = await adminCall('/admin/api/login', { body: { email, password }, now });
  if (res.status !== 200) throw new Error(`ログインに失敗: ${res.status} ${JSON.stringify(res.body)}`);
  return res.cookie!;
}

/** 管理画面向け API を呼ぶ(クッキーと x-dr-admin ヘッダーつき) */
export async function adminCall<T = any>(
  path: string,
  opts: { cookie?: string; method?: string; body?: unknown; now?: string; noAdminHeader?: boolean } = {},
): Promise<{ status: number; body: T; cookie?: string }> {
  const headers: Record<string, string> = {};
  if (!opts.noAdminHeader) headers['x-dr-admin'] = '1';
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.now) headers['x-debug-now'] = opts.now;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie?.match(/dr_sid=([^;]*)/)?.[1];
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json as T, cookie: cookie ? `dr_sid=${cookie}` : undefined };
}
