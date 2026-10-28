import type { Context } from 'hono';
import type { z } from 'zod';
import { errors } from './errors';

/** 入力をチェックする。だめなときは、最初の問題を日本語で返す。 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  const message = first?.message && /[ぁ-んァ-ヶ一-龠]/.test(first.message)
    ? first.message
    : '入力された内容を確認できませんでした。入力をやり直してください。';
  throw errors.badRequest(message, { path: first?.path.join('.') });
}

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw errors.badRequest('送られた内容を読み取れませんでした。画面を読み込み直して、もう一度お試しください。');
  }
  return parseInput(schema, body);
}
