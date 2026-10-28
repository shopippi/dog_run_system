import { toJstIso } from '@dr/shared';

/** 操作ログ(audit_log)の書き込み。管理画面でのすべての変更を記録する(15.2) */
export function auditStatement(
  db: D1Database,
  args: {
    staffId: number | null;
    /** スタッフ以外が操作したとき(お客さんが招待からおうちをまとめた、など)。指定すると staffId より優先する */
    actor?: { type: 'member' | 'staff' | 'system'; id: number | null };
    action: string;
    targetType: string;
    /** 対象のID。SQL で指すときは { sql: 'last_insert_rowid()' } のように書く */
    targetId: string | number | { sql: string; args?: unknown[] };
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    undo?: unknown;
    now: Date;
    /** この条件を満たすときだけ書く(同じ操作が二重に記録されないように) */
    onlyIf?: { sql: string; args: unknown[] };
  },
): D1PreparedStatement {
  const targetSql = typeof args.targetId === 'object' ? `CAST((${args.targetId.sql}) AS TEXT)` : '?';
  const values = [
    args.actor?.type ?? 'staff',
    args.actor ? args.actor.id : args.staffId,
    args.action,
    args.targetType,
    ...(typeof args.targetId === 'object' ? (args.targetId.args ?? []) : [String(args.targetId)]),
    args.before === undefined ? null : JSON.stringify(args.before),
    args.after === undefined ? null : JSON.stringify(args.after),
    args.reason ?? null,
    args.undo === undefined ? null : JSON.stringify(args.undo),
    toJstIso(args.now),
  ];
  const cols = `(actor_type, actor_id, action, target_type, target_id, before_value, after_value, reason, undo_info, created_at)`;
  if (args.onlyIf) {
    return db
      .prepare(`INSERT INTO audit_log ${cols} SELECT ?, ?, ?, ?, ${targetSql}, ?, ?, ?, ?, ? WHERE ${args.onlyIf.sql}`)
      .bind(...values, ...args.onlyIf.args);
  }
  return db.prepare(`INSERT INTO audit_log ${cols} VALUES (?, ?, ?, ?, ${targetSql}, ?, ?, ?, ?, ?)`).bind(...values);
}
