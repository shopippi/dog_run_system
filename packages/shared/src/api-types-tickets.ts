// API の応答の型(tickets)。無料券の交換と使用(8章、C-06・C-07・A-02・S-02)

/** 無料券と交換した結果(POST /api/tickets/exchange) */
export type TicketExchangeResult = {
  ticketId: number;
  /** 交換で引いたポイント */
  pointsUsed: number;
  /** 交換した後のポイント残高 */
  balance: number;
  /** 使える無料券の枚数(交換した券を含む) */
  unusedTickets: number;
};

/** 使った無料券の表示内容(POST /api/tickets/:id/use の応答と、GET /api/tickets/:id) */
export type TicketUseDetail = {
  ticketId: number;
  memberNo: string;
  householdName: string;
  /** 使った日時(日本時間) */
  usedAt: string;
  /** 使った日(日本時間) */
  usedDate: string;
  /** 今日使った券か(前の日の画面は、受付で見せても使えない) */
  isToday: boolean;
  /** その日の来場に結びつけたか(チェックインがまだなら、チェックインしたときに結びつける) */
  visitId: number | null;
  /** 応答を作ったときのサーバーの時刻(日本時間)。画面の時計の合わせに使う */
  serverTime: string;
  /** 使える無料券の残り */
  unusedTickets: number;
};

/** 無料券の記録の1件(来場履歴 L-08 に出す)。exchange: ポイントと交換 / use: 使用 */
export type TicketEvent = {
  kind: 'exchange' | 'use';
  ticketId: number;
  /** 日時(日本時間) */
  at: string;
  /** 交換で引いたポイント(使用のときは 0) */
  points: number;
};

/** GET /api/tickets/history の応答(新しい順) */
export type TicketHistoryResponse = { events: TicketEvent[] };

/** 管理画面で「無料券を使用済みにする」の結果(POST /admin/api/households/:id/tickets/:tid/use) */
export type AdminTicketUseResult = { ticketId: number; usedAt: string; visitId: number | null };

// ---------------------------------------------------------------
// A-05 旧カードの引き継ぎ(対面だけ)。引き継ぎ済みの一覧
// ---------------------------------------------------------------

/** 引き継ぎ済みの1件(GET /admin/api/migrations) */
export type MigrationRecord = {
  /** 操作ログの番号(「元に戻す」は POST /admin/api/audit/:id/undo) */
  auditId: number;
  /** 引き継いだ日時(日本時間) */
  at: string;
  /** 入力したスタッフの名前 */
  staffName: string | null;
  householdId: number;
  memberNo: string;
  householdName: string;
  source: import('./constants').MigrationSource;
  points: number;
  /** 元に戻した日時と人(戻していなければ null) */
  undone: { at: string; byName: string | null } | null;
};

export type MigrationListResponse = {
  records: MigrationRecord[];
  /** 一度に引き継げるポイントの上限(設定 migration_max_points) */
  maxPoints: number;
};
