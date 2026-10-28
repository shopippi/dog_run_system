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
