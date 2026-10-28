import type { AuditActor } from '@dr/shared';

/**
 * 操作ログから「元に戻す」(A-15)。
 * 各機能は、自分の操作(action)を元に戻す処理をここに登録する。登録はルートのファイルの読み込み時に行う。
 * 元に戻せない操作は登録しない(操作ログの画面には「元に戻す」が出ない)。
 */
export type AuditRow = {
  id: number;
  action: string;
  target_type: string;
  target_id: string | null;
  before_value: string | null;
  after_value: string | null;
  undo_info: string | null;
  created_at: string;
  actor_type: AuditActor;
  actor_id: number | null;
};

export type UndoContext = { staffId: number; now: Date };

/** 元に戻す処理。戻せないときは AppError を投げる(「何が起きたか」「次にどうするか」を日本語で) */
export type UndoHandler = (db: D1Database, log: AuditRow, ctx: UndoContext) => Promise<void>;

const handlers = new Map<string, UndoHandler>();

export function registerUndo(action: string, handler: UndoHandler): void {
  handlers.set(action, handler);
}

export function getUndo(action: string): UndoHandler | undefined {
  return handlers.get(action);
}

export function canUndo(action: string): boolean {
  return handlers.has(action);
}
