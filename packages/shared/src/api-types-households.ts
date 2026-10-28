// API の応答の型と、画面に出す言葉(households: おうちの詳細と記録、操作ログ)。

// ============================================================
// A-15 操作ログ
// ============================================================

/**
 * 操作の種類(audit_log.action)と、画面に出す言葉。action の記号は画面に出さない(15.1)。
 * 新しい操作を記録するときは、ここに言葉を足す(足さなければ「そのほかの変更」と出る)。
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'visit.cancel': 'チェックインの取り消し',
  'visit.proxy': '代理チェックイン',
  'visit.walkin': '会員以外の記録',
  'audit.undo': '元に戻す',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? 'そのほかの変更';
}

/** 操作ログの1行(M-15) */
export type AuditEntry = {
  id: number;
  /** 操作した日時(日本時間) */
  at: string;
  /** 誰が(スタッフの名前。お客さん本人や自動処理のときはその旨) */
  actorName: string;
  /** 何を(操作の種類の言葉) */
  actionLabel: string;
  /** 対象。名前と、会員ID・犬ID(code)で分かるようにする */
  target: { label: string; code: string | null; householdId: number | null };
  /** 変更の中身の短い説明(「「アルのおうち」→「アルくんのおうち」」など) */
  detail: string | null;
  reason: string | null;
  /** 「元に戻す」を出してよいか */
  canUndo: boolean;
  /** 元に戻し済みなら、いつ・誰が */
  undone: { at: string; byName: string } | null;
};

export type AuditListResponse = {
  entries: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
  /** 絞り込みに使える操作の種類(value は送り返すだけで、画面には label を出す) */
  actions: { value: string; label: string }[];
};
