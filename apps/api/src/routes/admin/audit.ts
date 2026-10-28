import { auditQuerySchema, toJstIso, type AuditListResponse } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireRole } from '../../lib/staff-auth';
import { parseInput } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { listAudit } from '../../services/audit-view';
import { getUndo, registerUndo, type AuditRow } from '../../services/undo';
import { undoVisitCancel } from '../../services/undo-visit-cancel';

// A-15 操作ログと元に戻す
export const auditRoutes = new Hono<AppEnv>();

// S-03 のチェックインの取り消しは、取り消しを取り消せる
registerUndo('visit.cancel', undoVisitCancel);

// 操作ログの一覧(M-15)。管理者と製作者が見られる。新しい順で、日付と操作の種類で絞れる
auditRoutes.get('/audit', requireRole('admin'), async (c) => {
  const raw = c.req.query();
  const q = parseInput(auditQuerySchema, {
    from: raw.from || undefined,
    to: raw.to || undefined,
    action: raw.action || undefined,
    page: raw.page || undefined,
  });
  const body: AuditListResponse = await listAudit(c.env.DB, q, c.get('staff').role);
  return c.json(body);
});

// 操作を元に戻す(A-15)。管理者だけ。戻し方は services/undo.ts に登録されたものを使う
auditRoutes.post('/audit/:id/undo', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const staff = c.get('staff');
  const now = c.get('now');
  const id = Number(c.req.param('id'));
  const log = Number.isInteger(id)
    ? await db
        .prepare(
          `SELECT id, action, target_type, target_id, before_value, after_value, undo_info, created_at, actor_type, actor_id, undone_at
             FROM audit_log WHERE id = ?`,
        )
        .bind(id)
        .first<AuditRow & { undone_at: string | null }>()
    : null;
  if (!log) throw errors.notFound('操作ログが見つかりませんでした。画面を読み込み直してください。');
  if (log.undone_at) {
    throw errors.conflict('already_undone', 'この操作は、すでに元に戻されています。画面を読み込み直してください。');
  }
  const handler = getUndo(log.action);
  if (!handler) {
    throw errors.conflict(
      'cannot_undo',
      'この操作は、操作ログからは元に戻せません。必要なら、それぞれの画面で直してください。分からないときは製作者に相談してください。',
    );
  }

  // 同時に2回押されても1回だけ戻すよう、先に「元に戻し済み」の印を付けてから戻す。戻せなければ印を外す
  const claim = await db
    .prepare('UPDATE audit_log SET undone_at = ?, undone_by_staff_id = ? WHERE id = ? AND undone_at IS NULL')
    .bind(toJstIso(now), staff.id, log.id)
    .run();
  if (claim.meta.changes !== 1) {
    throw errors.conflict('already_undone', 'この操作は、すでに元に戻されています。画面を読み込み直してください。');
  }
  try {
    await handler(db, log, { staffId: staff.id, now });
  } catch (e) {
    await db.prepare('UPDATE audit_log SET undone_at = NULL, undone_by_staff_id = NULL WHERE id = ?').bind(log.id).run();
    throw e;
  }
  await auditStatement(db, {
    staffId: staff.id,
    action: 'audit.undo',
    targetType: 'audit',
    targetId: log.id,
    before: { action: log.action, targetType: log.target_type, targetId: log.target_id },
    now,
  }).run();
  return c.json({ ok: true });
});
