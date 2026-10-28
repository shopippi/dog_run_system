import {
  checkSettingsPatch,
  checkinUrlFor,
  toJstIso,
  type PublicSettingsResponse,
  type SettingKey,
  type Settings,
  type SettingsResponse,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { auditStatement } from '../../services/audit';
import { registerUndo } from '../../services/undo';

// A-12 ルールの設定(M-13)
// 注意: このファイルのルートは管理画面の API 全体('/')に足されるので、use('*') で権限を付けない。ルートごとに付ける。
export const settingsRoutes = new Hono<AppEnv>();

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function toResponse(settings: Settings): SettingsResponse {
  return { settings, checkinUrl: checkinUrlFor(settings.liff_id, settings.checkin_passphrase) };
}

function upsertStatement(db: D1Database, key: string, value: unknown, nowIso: string, staffId: number) {
  return db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by_staff_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
         updated_by_staff_id = excluded.updated_by_staff_id`,
    )
    .bind(key, JSON.stringify(value), nowIso, staffId);
}

/**
 * 設定を変える。変わった項目だけを書き込み、操作ログに変更前と変更後を残す(元に戻せる)。
 * 何も変わっていなければ、何も書かない。
 */
async function saveSettings(db: D1Database, patch: Partial<Settings>, staffId: number, now: Date): Promise<Settings> {
  const current = await loadSettings(db);
  const before: Partial<Record<SettingKey, unknown>> = {};
  const after: Partial<Record<SettingKey, unknown>> = {};
  for (const [key, value] of Object.entries(patch) as [SettingKey, unknown][]) {
    if (value === undefined || same(current[key], value)) continue;
    before[key] = current[key];
    after[key] = value;
  }
  const keys = Object.keys(after);
  if (keys.length === 0) return current;
  const nowIso = toJstIso(now);
  await db.batch([
    ...keys.map((k) => upsertStatement(db, k, after[k as SettingKey], nowIso, staffId)),
    auditStatement(db, {
      staffId,
      action: 'settings.update',
      targetType: 'settings',
      targetId: keys.join(','),
      before,
      after,
      now,
    }),
  ]);
  return loadSettings(db);
}

// 受付スタッフも見られる設定(A-16 使い方・困ったとき)。製作者の連絡先だけを返す
settingsRoutes.get('/settings/public', async (c) => {
  const settings = await loadSettings(c.env.DB);
  const body: PublicSettingsResponse = { developerContact: settings.developer_contact };
  return c.json(body);
});

// ルールの設定を見る。管理者(製作者は見るだけ)
settingsRoutes.get('/settings', requireRole('admin'), async (c) => c.json(toResponse(await loadSettings(c.env.DB))));

// ルールの設定を変える。変える項目だけを送る
settingsRoutes.patch('/settings', requireRole('admin'), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw errors.badRequest('送られた内容を読み取れませんでした。画面を読み込み直して、もう一度お試しください。');
  }
  const checked = checkSettingsPatch(body);
  if (!checked.ok) throw errors.badRequest(checked.message, checked.key ? { path: checked.key } : undefined);
  const saved = await saveSettings(c.env.DB, checked.data, c.get('staff').id, c.get('now'));
  return c.json(toResponse(saved));
});

/** 新しい合言葉(32文字の16進数)。最初のマイグレーションと同じ形 */
function newPassphrase(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 受付のQRコードの合言葉を作り直す。古いQRコードは使えなくなる(操作ログから元に戻せる)
settingsRoutes.post('/settings/checkin-passphrase', requireRole('admin'), async (c) => {
  const saved = await saveSettings(c.env.DB, { checkin_passphrase: newPassphrase() }, c.get('staff').id, c.get('now'));
  return c.json(toResponse(saved));
});

// 操作ログから元に戻す(A-15)。そのあとに同じ項目がまた変えられていたら、戻さない
registerUndo('settings.update', async (db, log, ctx) => {
  const before = JSON.parse(log.before_value ?? '{}') as Partial<Record<SettingKey, unknown>>;
  const after = JSON.parse(log.after_value ?? '{}') as Partial<Record<SettingKey, unknown>>;
  const current = await loadSettings(db);
  for (const key of Object.keys(after) as SettingKey[]) {
    if (!same(current[key], after[key])) {
      throw errors.conflict(
        'settings_changed',
        'この設定は、そのあとにまた変更されています。ルールの設定の画面で、直接直してください。',
      );
    }
  }
  const checked = checkSettingsPatch(before);
  if (!checked.ok) throw errors.conflict('settings_invalid', '元の値に戻せませんでした。ルールの設定の画面で、直接直してください。');
  const nowIso = toJstIso(ctx.now);
  await db.batch(
    Object.entries(checked.data).map(([k, v]) => upsertStatement(db, k, v, nowIso, ctx.staffId)),
  );
});
