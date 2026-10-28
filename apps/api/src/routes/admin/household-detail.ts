import { householdRenameSchema, normalizeForSearch, toJstIso, type HouseholdDetail } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { registerAuditDetail } from '../../services/audit-view';
import { refreshAutoNameStatement, syncHouseholdSearchName } from '../../services/dogs';
import { getHouseholdRow, householdNotFound, loadHouseholdDetail } from '../../services/household-detail';
import { registerUndo } from '../../services/undo';

// A-02 おうちの詳細・呼び名の変更、A-03 ポイントの手動登録、A-04 犬の情報の変更、A-06 家族の追加・解除
export const householdDetailRoutes = new Hono<AppEnv>();

/** 変更できるおうち(統合済み・退会のおうちは変えない) */
async function requireActiveHousehold(db: D1Database, id: number) {
  const h = await getHouseholdRow(db, id);
  if (!h) throw householdNotFound();
  if (h.status !== 'active') {
    throw errors.conflict(
      'household_inactive',
      h.status === 'merged'
        ? 'このおうちは別のおうちにまとめられています。まとめた先のおうちを開いて操作してください。'
        : 'このおうちは退会しています。変更が必要なときは製作者に相談してください。',
    );
  }
  return h;
}

// ------------------------------------------------------------
// A-02 おうちの詳細(管理者。製作者は見るだけ)
// ------------------------------------------------------------
householdDetailRoutes.get('/households/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const body: HouseholdDetail = await loadHouseholdDetail(
    db,
    Number(c.req.param('id')),
    c.get('staff').role,
    await loadSettings(db),
    c.get('now'),
  );
  return c.json(body);
});

// 呼び名の変更。空にすると、犬の名前から自動で作る呼び名に戻す
householdDetailRoutes.patch('/households/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const { displayName } = await parseJson(c, householdRenameSchema);
  const h = await requireActiveHousehold(db, id);
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const auto = displayName === '';
  if (auto ? h.display_name_auto === 1 : h.display_name_auto === 0 && h.display_name === displayName) {
    return c.json(await loadHouseholdDetail(db, id, c.get('staff').role, await loadSettings(db), now));
  }
  const statements: D1PreparedStatement[] = auto
    ? [
        db.prepare('UPDATE households SET display_name_auto = 1, updated_at = ? WHERE id = ?').bind(nowIso, id),
        refreshAutoNameStatement(db, id, nowIso),
      ]
    : [
        db
          .prepare('UPDATE households SET display_name = ?, display_name_search = ?, display_name_auto = 0, updated_at = ? WHERE id = ?')
          .bind(displayName, normalizeForSearch(displayName), nowIso, id),
      ];
  statements.push(
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'household.rename',
      targetType: 'household',
      targetId: id,
      before: { displayName: h.display_name, auto: h.display_name_auto === 1 },
      // 自動に戻したときの新しい呼び名は、書き込んだあとの値を記録する
      after: auto ? { auto: true } : { displayName, auto: false },
      undo: { householdId: id },
      now,
    }),
  );
  await db.batch(statements);
  await syncHouseholdSearchName(db, id);
  return c.json(await loadHouseholdDetail(db, id, c.get('staff').role, await loadSettings(db), now));
});

registerAuditDetail('household.rename', (b, a) => {
  if (!b) return null;
  const from = b.auto ? `「${b.displayName}」(自動)` : `「${b.displayName}」`;
  const to = a?.auto ? '犬の名前から自動で作る呼び名' : `「${a?.displayName}」`;
  return `${from} → ${to}`;
});

// 呼び名の変更を元に戻す。その後にまた呼び名を変えていたら戻せない
registerUndo('household.rename', async (db, log, ctx) => {
  const before = JSON.parse(log.before_value ?? '{}') as { displayName: string; auto: boolean };
  const after = JSON.parse(log.after_value ?? '{}') as { displayName?: string; auto: boolean };
  const id = Number(log.target_id);
  const h = await requireActiveHousehold(db, id);
  const same = after.auto ? h.display_name_auto === 1 : h.display_name_auto === 0 && h.display_name === after.displayName;
  if (!same) {
    throw errors.conflict(
      'changed_since',
      'このあとに呼び名がまた変えられているため、戻せません。おうちの詳細で呼び名を直してください。',
    );
  }
  const nowIso = toJstIso(ctx.now);
  await db.batch(
    before.auto
      ? [
          db.prepare('UPDATE households SET display_name_auto = 1, updated_at = ? WHERE id = ?').bind(nowIso, id),
          refreshAutoNameStatement(db, id, nowIso),
        ]
      : [
          db
            .prepare('UPDATE households SET display_name = ?, display_name_auto = 0, updated_at = ? WHERE id = ?')
            .bind(before.displayName, nowIso, id),
        ],
  );
  await syncHouseholdSearchName(db, id);
});
