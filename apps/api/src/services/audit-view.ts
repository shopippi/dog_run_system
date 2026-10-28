import { AUDIT_PAGE_SIZE, auditActionLabel, mergeUndoDeadline, type AuditEntry, type AuditQuery, type StaffRole } from '@dr/shared';
import { canUndo, type AuditRow } from './undo';

/**
 * 操作ログの一覧(A-15、M-15)。
 * 対象は「おうちの呼び名・会員ID」「犬の名前・犬ID」のように、画面で分かる形にして返す。
 * 操作の種類は日本語の言葉だけを返す(action の記号は画面に出さない)。
 */

type LogRow = AuditRow & {
  reason: string | null;
  undone_at: string | null;
  undone_by_name: string | null;
  actor_name: string | null;
};

export type TargetView = AuditEntry['target'];

/** 変更の中身の説明。操作ごとに足す */
const describers = new Map<string, (before: any, after: any) => string | null>();

export function registerAuditDetail(action: string, fn: (before: any, after: any) => string | null) {
  describers.set(action, fn);
}

const md = (ymd: string) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}月${d}日`;
};

registerAuditDetail('visit.walkin', (_b, a) => (a?.dogCount ? `${a.dogCount}頭` : null));
registerAuditDetail('visit.proxy', (_b, a) =>
  a?.date ? `${md(a.date)}の来場${a.useTicket ? '(無料券を使用)' : ''}` : null,
);
registerAuditDetail('visit.cancel', (b) => {
  if (!b) return null;
  const parts: string[] = [];
  if (b.points) parts.push('付けたポイントを戻した');
  if (Array.isArray(b.issuedTickets) && b.issuedTickets.length > 0) parts.push(`発行した無料券 ${b.issuedTickets.length}枚を回収`);
  if (b.usedTicket) parts.push('使った無料券を未使用に戻した');
  return parts.length ? parts.join('、') : null;
});

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const TYPE_LABELS: Record<string, string> = {
  staff: 'スタッフ',
  settings: 'ルールの設定',
  merge: 'おうちの統合',
  request: '確認待ちの申請',
  event: 'イベント',
  closure: '臨時休業日',
  breed: '犬種の選択肢',
  survey_question: 'アンケートの質問',
  calendar: '臨時休業日',
  export: 'CSV出力',
  system: '自動処理',
  audit: '操作ログ',
  household: 'おうち',
  dog: 'ワンちゃん',
  visit: '来場',
  family_member: '家族',
};

const keyOf = (type: string, id: string | null) => `${type}:${id ?? ''}`;

/** 対象(種類と ID)を、画面で分かる言葉にする */
export async function resolveTargets(db: D1Database, targets: { type: string; id: string | null }[]): Promise<Map<string, TargetView>> {
  const out = new Map<string, TargetView>();
  const idsOf = (type: string) =>
    [...new Set(targets.filter((t) => t.type === type && t.id && /^\d+$/.test(t.id)).map((t) => Number(t.id)))];
  const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

  const visitIds = idsOf('visit');
  if (visitIds.length) {
    const { results } = await db
      .prepare(
        `SELECT v.id, v.visit_date, v.household_id, v.dog_count, h.display_name, h.member_no
           FROM visits v LEFT JOIN households h ON h.id = v.household_id WHERE v.id IN (${marks(visitIds.length)})`,
      )
      .bind(...visitIds)
      .all<{ id: number; visit_date: string; household_id: number | null; dog_count: number; display_name: string | null; member_no: string | null }>();
    for (const r of results) {
      out.set(keyOf('visit', String(r.id)), {
        label: r.household_id ? `${r.display_name}の${md(r.visit_date)}の来場` : `会員以外 ${r.dog_count}頭(${md(r.visit_date)})`,
        code: r.member_no,
        householdId: r.household_id,
      });
    }
  }

  const householdIds = idsOf('household');
  if (householdIds.length) {
    const { results } = await db
      .prepare(`SELECT id, display_name, member_no FROM households WHERE id IN (${marks(householdIds.length)})`)
      .bind(...householdIds)
      .all<{ id: number; display_name: string; member_no: string }>();
    for (const r of results) {
      out.set(keyOf('household', String(r.id)), { label: r.display_name, code: r.member_no, householdId: r.id });
    }
  }

  const dogIds = idsOf('dog');
  if (dogIds.length) {
    const { results } = await db
      .prepare(
        `SELECT d.id, d.name, d.dog_no, d.household_id, h.display_name
           FROM dogs d JOIN households h ON h.id = d.household_id WHERE d.id IN (${marks(dogIds.length)})`,
      )
      .bind(...dogIds)
      .all<{ id: number; name: string; dog_no: string; household_id: number; display_name: string }>();
    for (const r of results) {
      out.set(keyOf('dog', String(r.id)), { label: `${r.name}(${r.display_name})`, code: r.dog_no, householdId: r.household_id });
    }
  }

  const memberIds = idsOf('family_member');
  if (memberIds.length) {
    const { results } = await db
      .prepare(
        `SELECT m.id, m.line_display_name, m.household_id, h.display_name, h.member_no
           FROM family_members m JOIN households h ON h.id = m.household_id WHERE m.id IN (${marks(memberIds.length)})`,
      )
      .bind(...memberIds)
      .all<{ id: number; line_display_name: string | null; household_id: number; display_name: string; member_no: string }>();
    for (const r of results) {
      out.set(keyOf('family_member', String(r.id)), {
        label: `${r.line_display_name ? `${r.line_display_name}さん` : '退会した家族'}(${r.display_name})`,
        code: r.member_no,
        householdId: r.household_id,
      });
    }
  }

  const staffIds = idsOf('staff');
  if (staffIds.length) {
    const { results } = await db
      .prepare(`SELECT id, name FROM staff_users WHERE id IN (${marks(staffIds.length)})`)
      .bind(...staffIds)
      .all<{ id: number; name: string }>();
    for (const r of results) out.set(keyOf('staff', String(r.id)), { label: `スタッフ: ${r.name}`, code: null, householdId: null });
  }

  for (const t of targets) {
    const k = keyOf(t.type, t.id);
    if (out.has(k)) continue;
    // 臨時休業日は日付で分かるようにする(対象の ID が日付)
    const label =
      t.type === 'calendar' && t.id && /^\d{4}-\d{2}-\d{2}$/.test(t.id) ? `${md(t.id)}(臨時休業日)` : (TYPE_LABELS[t.type] ?? '—');
    out.set(k, { label, code: null, householdId: null });
  }
  return out;
}

function actorNameOf(r: { actor_type: string; actor_name: string | null }) {
  if (r.actor_type === 'system') return '自動処理';
  if (r.actor_type === 'member') return r.actor_name ? `${r.actor_name}さん(お客さん)` : 'お客さん';
  return r.actor_name ?? '(停止したスタッフ)';
}

/**
 * 「元に戻す」を出してよいか。まだ戻しておらず、戻し方が登録されている操作だけ。
 * 統合は 30日以内のときだけ(5.3。30日を過ぎたら製作者に依頼する)
 */
export function auditCanUndo(r: { action: string; created_at: string; undone_at: string | null }, role: StaffRole, now: Date): boolean {
  if (role !== 'admin' || r.undone_at || !canUndo(r.action)) return false;
  if (r.action === 'household.merge') return now.getTime() <= mergeUndoDeadline(r.created_at).getTime();
  return true;
}

export async function listAudit(db: D1Database, q: AuditQuery, role: StaffRole, now: Date) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.from) {
    where.push('a.created_at >= ?');
    args.push(`${q.from}T00:00:00+09:00`);
  }
  if (q.to) {
    where.push('a.created_at <= ?');
    args.push(`${q.to}T23:59:59+09:00`);
  }
  if (q.action) {
    where.push('a.action = ?');
    args.push(q.action);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM audit_log a ${whereSql}`)
    .bind(...args)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.before_value, a.after_value, a.undo_info, a.created_at,
              a.actor_type, a.actor_id, a.reason, a.undone_at,
              CASE a.actor_type WHEN 'staff' THEN s.name WHEN 'member' THEN m.line_display_name END AS actor_name,
              u.name AS undone_by_name
         FROM audit_log a
         LEFT JOIN staff_users s ON a.actor_type = 'staff' AND s.id = a.actor_id
         LEFT JOIN family_members m ON a.actor_type = 'member' AND m.id = a.actor_id
         LEFT JOIN staff_users u ON u.id = a.undone_by_staff_id
         ${whereSql}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${AUDIT_PAGE_SIZE} OFFSET ?`,
    )
    .bind(...args, (q.page - 1) * AUDIT_PAGE_SIZE)
    .all<LogRow>();

  // 「元に戻す」の行は、戻した元の操作の対象を出す
  const undoneIds = results
    .filter((r) => r.target_type === 'audit' && r.target_id && /^\d+$/.test(r.target_id))
    .map((r) => Number(r.target_id));
  const originals = new Map<string, { action: string; target_type: string; target_id: string | null }>();
  if (undoneIds.length) {
    const { results: rows } = await db
      .prepare(`SELECT id, action, target_type, target_id FROM audit_log WHERE id IN (${undoneIds.map(() => '?').join(',')})`)
      .bind(...undoneIds)
      .all<{ id: number; action: string; target_type: string; target_id: string | null }>();
    for (const r of rows) originals.set(String(r.id), r);
  }
  const targetOf = (r: LogRow) => {
    const o = r.target_type === 'audit' ? originals.get(r.target_id ?? '') : undefined;
    return o ? { type: o.target_type, id: o.target_id } : { type: r.target_type, id: r.target_id };
  };
  const targets = await resolveTargets(db, results.map(targetOf));

  const { results: actionRows } = await db.prepare('SELECT DISTINCT action FROM audit_log').all<{ action: string }>();
  const actions = actionRows
    .map((r) => ({ value: r.action, label: auditActionLabel(r.action) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));

  const entries: AuditEntry[] = results.map((r) => {
    const t = targetOf(r);
    const original = r.target_type === 'audit' ? originals.get(r.target_id ?? '') : undefined;
    const before = parseJson(r.before_value);
    const after = parseJson(r.after_value);
    let detail: string | null = null;
    if (original) {
      detail = `「${auditActionLabel(original.action)}」を元に戻した`;
    } else {
      try {
        detail = describers.get(r.action)?.(before, after) ?? null;
      } catch {
        detail = null;
      }
    }
    return {
      id: r.id,
      at: r.created_at,
      actorName: actorNameOf(r),
      actionLabel: auditActionLabel(r.action),
      target: targets.get(keyOf(t.type, t.id)) ?? { label: '—', code: null, householdId: null },
      detail,
      reason: r.reason,
      canUndo: auditCanUndo(r, role, now),
      undone: r.undone_at ? { at: r.undone_at, byName: r.undone_by_name ?? '' } : null,
    };
  });
  return { entries, page: q.page, pageSize: AUDIT_PAGE_SIZE, total: total?.n ?? 0, actions };
}
