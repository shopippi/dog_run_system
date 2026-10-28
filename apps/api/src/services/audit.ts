import { toJstIso } from '@dr/shared';

/** 操作ログ(audit_log)の書き込み。管理画面でのすべての変更を記録する(15.2) */
export function auditStatement(
  db: D1Database,
  args: {
    staffId: number;
    action: string;
    targetType: string;
    targetId: string | number;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    undo?: unknown;
    now: Date;
    /** この条件を満たすときだけ書く(同じ操作が二重に記録されないように) */
    onlyIf?: { sql: string; args: unknown[] };
  },
): D1PreparedStatement {
  const values = [
    'staff',
    args.staffId,
    args.action,
    args.targetType,
    String(args.targetId),
    args.before === undefined ? null : JSON.stringify(args.before),
    args.after === undefined ? null : JSON.stringify(args.after),
    args.reason ?? null,
    args.undo === undefined ? null : JSON.stringify(args.undo),
    toJstIso(args.now),
  ];
  const cols = `(actor_type, actor_id, action, target_type, target_id, before_value, after_value, reason, undo_info, created_at)`;
  if (args.onlyIf) {
    return db
      .prepare(`INSERT INTO audit_log ${cols} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${args.onlyIf.sql}`)
      .bind(...values, ...args.onlyIf.args);
  }
  return db.prepare(`INSERT INTO audit_log ${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...values);
}
