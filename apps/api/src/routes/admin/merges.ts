import { mergeInputSchema, mergeUndoDeadline, toJstIso, type MergeRecord } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { executeMerge, mergeUndoState, previewMerge, undoMerge } from '../../services/merges';
import { registerUndo } from '../../services/undo';

// A-07 おうちの統合(要件定義書 5.3)。管理者だけ(製作者は見るだけ)
export const mergesRoutes = new Hono<AppEnv>();

// 統合の結果の確認(データは変えない)
mergesRoutes.post('/merges/preview', requireRole('admin'), async (c) => {
  const input = await parseJson(c, mergeInputSchema);
  const db = c.env.DB;
  return c.json(await previewMerge(db, input, c.get('now'), await loadSettings(db)));
});

// 統合の実行
mergesRoutes.post('/merges', requireRole('admin'), async (c) => {
  const input = await parseJson(c, mergeInputSchema);
  const db = c.env.DB;
  const result = await executeMerge(db, input, { type: 'staff', id: c.get('staff').id }, c.get('now'), await loadSettings(db));
  return c.json(result, 201);
});

// 統合を元に戻す(30日以内で、統合後に来場・ポイントの変更がない場合だけ)
mergesRoutes.post('/merges/:id/undo', requireRole('admin'), async (c) => {
  await undoMerge(c.env.DB, Number(c.req.param('id')) || 0, c.get('staff').id, c.get('now'));
  return c.json({ ok: true });
});

type RecordRow = {
  id: number;
  kept_id: number;
  kept_no: string;
  kept_name: string;
  absorbed_id: number;
  absorbed_no: string;
  absorbed_name: string;
  executed_at: string;
  executed_by: string;
  undone_at: string | null;
};

const RECORD_SELECT = `
  SELECT m.id, k.id AS kept_id, k.member_no AS kept_no, k.display_name AS kept_name,
         a.id AS absorbed_id, a.member_no AS absorbed_no, a.display_name AS absorbed_name,
         m.executed_at,
         -- お客さんが招待からまとめたときは「○○さん(お客さん)」
         CASE WHEN m.executed_by_staff_id IS NULL AND m.executed_by_member_id IS NOT NULL
              THEN COALESCE(f.line_display_name || 'さん', '') || '(お客さん)'
              ELSE COALESCE(s.name, '') END AS executed_by,
         m.undone_at
    FROM merges m
    JOIN households k ON k.id = m.kept_household_id
    JOIN households a ON a.id = m.absorbed_household_id
    LEFT JOIN staff_users s ON s.id = m.executed_by_staff_id
    LEFT JOIN family_members f ON f.id = m.executed_by_member_id`;

async function toRecord(db: D1Database, r: RecordRow, now: Date): Promise<MergeRecord> {
  const state = await mergeUndoState(db, r.id, now);
  return {
    id: r.id,
    kept: { id: r.kept_id, memberNo: r.kept_no, displayName: r.kept_name },
    absorbed: { id: r.absorbed_id, memberNo: r.absorbed_no, displayName: r.absorbed_name },
    executedAt: r.executed_at,
    executedBy: r.executed_by,
    undoneAt: r.undone_at,
    undoDeadline: toJstIso(mergeUndoDeadline(r.executed_at)),
    undoStatus: state?.status ?? 'undone',
  };
}

// 統合の記録(元に戻せるかを含む)。おうちを指定すると、そのおうちが関わる統合(新しい順)
mergesRoutes.get('/merges', requireRole('admin'), async (c) => {
  const householdId = Number(c.req.query('householdId')) || 0;
  const db = c.env.DB;
  const { results } = await db
    .prepare(`${RECORD_SELECT} WHERE m.kept_household_id = ?1 OR m.absorbed_household_id = ?1 ORDER BY m.id DESC LIMIT 50`)
    .bind(householdId)
    .all<RecordRow>();
  const merges = await Promise.all(results.map((r) => toRecord(db, r, c.get('now'))));
  return c.json({ merges });
});

mergesRoutes.get('/merges/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const row = await db.prepare(`${RECORD_SELECT} WHERE m.id = ?`).bind(Number(c.req.param('id')) || 0).first<RecordRow>();
  if (!row) throw errors.notFound('統合の記録が見つかりませんでした。画面を読み込み直してください。');
  return c.json(await toRecord(db, row, c.get('now')));
});

// 操作ログ(A-15)からも、同じ条件で元に戻せるようにする。お客さんが招待からまとめたもの(C-12)も同じ
registerUndo('household.merge', async (db, log, ctx) => {
  await undoMerge(db, Number(log.target_id) || 0, ctx.staffId, ctx.now);
});
