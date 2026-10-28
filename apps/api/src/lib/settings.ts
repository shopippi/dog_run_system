import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@dr/shared';

/** settings テーブルを読み、保存されていない項目は初期値で補う。 */
export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const stored: Record<string, unknown> = {};
  for (const row of results) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      // 壊れた値は無視して初期値を使う
    }
  }
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  const parsed = settingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  // 一部の値が不正な場合は、項目ごとに初期値へ戻す
  const fallback: Record<string, unknown> = { ...DEFAULT_SETTINGS, checkin_passphrase: stored.checkin_passphrase };
  for (const key of Object.keys(settingsSchema.shape) as (keyof Settings)[]) {
    const one = settingsSchema.shape[key].safeParse(stored[key]);
    if (one.success) fallback[key] = one.data;
  }
  return settingsSchema.parse(fallback);
}
