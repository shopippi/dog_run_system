// Cloudflare D1 の代わりに、sql.js(ブラウザの中の SQLite)を D1Database の形で使えるようにする。
// API(apps/api)のコードをそのまま動かすため、API が使う部分(prepare / bind / first / all / run / raw、
// batch、exec、meta.last_row_id・meta.changes)を D1 と同じ動きにする。

import type { Database, SqlValue } from 'sql.js';

export type D1Meta = {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
  served_by: string;
};

export type D1ResultLike<T = Record<string, unknown>> = {
  success: true;
  results: T[];
  meta: D1Meta;
};

type Row = Record<string, unknown>;

/** D1 の bind に渡せる値。undefined は D1 と同じくエラーにする。 */
function toSqlValue(v: unknown): SqlValue {
  if (v === null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new Error(`D1_TYPE_ERROR: Type '${typeof v}' not supported for value '${String(v)}'`);
}

/** sql.js のエラーを、D1 が投げるエラーと同じ形の文にする(API は文の中身を正規表現で見ている)。 */
function toD1Error(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith('D1_')) return e instanceof Error ? e : new Error(message);
  const code = /constraint failed/i.test(message) ? 'SQLITE_CONSTRAINT' : 'SQLITE_ERROR';
  const err = new Error(`D1_ERROR: ${message}: ${code}`);
  (err as Error & { cause?: unknown }).cause = e;
  return err;
}

type Executed = { columns: string[]; rows: SqlValue[][]; meta: D1Meta };

export class DemoD1 {
  /** 書き込みがあったときに呼ぶ(保存の予約に使う) */
  onWrite: (() => void) | null = null;

  constructor(public sql: Database) {}

  prepare(query: string): DemoD1Statement {
    return new DemoD1Statement(this, query, []);
  }

  /** まとめて実行する。途中で失敗したら、全部を元に戻して同じエラーを投げる(D1 と同じ)。 */
  async batch<T = Row>(statements: DemoD1Statement[]): Promise<D1ResultLike<T>[]> {
    this.sql.run('BEGIN');
    const out: D1ResultLike<T>[] = [];
    try {
      for (const s of statements) out.push(toResult<T>(this.execute(s.query, s.params)));
      this.sql.run('COMMIT');
    } catch (e) {
      try {
        this.sql.run('ROLLBACK');
      } catch {
        // すでに終わっていてもよい
      }
      throw toD1Error(e);
    }
    this.notify(out.some((r) => r.meta.changes > 0));
    return out;
  }

  /** 複数の文をそのまま実行する(マイグレーション用)。 */
  async exec(query: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    try {
      const results = this.sql.exec(query);
      this.notify(true);
      return { count: results.length, duration: performance.now() - started };
    } catch (e) {
      throw toD1Error(e);
    }
  }

  /** D1 の dump は使わない */
  async dump(): Promise<ArrayBuffer> {
    const bytes = this.sql.export();
    this.afterExport();
    return bytes.slice().buffer;
  }

  /** sql.js の export() はデータベースを開き直すので、設定をかけ直す */
  afterExport() {
    this.sql.run('PRAGMA foreign_keys = ON');
  }

  withSession() {
    return this;
  }

  /** 1つの文を実行する(同期)。 */
  execute(query: string, params: unknown[]): Executed {
    const started = performance.now();
    const before = this.totalChanges();
    const stmt = this.sql.prepare(query);
    try {
      if (params.length > 0) stmt.bind(params.map(toSqlValue));
      const columns = stmt.getColumnNames();
      const rows: SqlValue[][] = [];
      while (stmt.step()) rows.push(stmt.get());
      const changes = this.totalChanges() - before;
      const lastRowId = Number(this.sql.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0);
      return {
        columns,
        rows,
        meta: {
          duration: performance.now() - started,
          size_after: 0,
          rows_read: rows.length,
          rows_written: changes,
          last_row_id: lastRowId,
          changed_db: changes > 0,
          changes,
          served_by: 'demo-sqljs',
        },
      };
    } finally {
      stmt.free();
    }
  }

  private totalChanges(): number {
    return Number(this.sql.exec('SELECT total_changes()')[0]?.values[0]?.[0] ?? 0);
  }

  notify(changed: boolean) {
    if (changed) this.onWrite?.();
  }
}

function toObjects<T>(columns: string[], rows: SqlValue[][]): T[] {
  return rows.map((r) => {
    const o: Row = {};
    columns.forEach((c, i) => {
      o[c] = r[i];
    });
    return o as T;
  });
}

function toResult<T>(e: Executed): D1ResultLike<T> {
  return { success: true, results: toObjects<T>(e.columns, e.rows), meta: e.meta };
}

export class DemoD1Statement {
  constructor(
    private readonly db: DemoD1,
    readonly query: string,
    readonly params: unknown[],
  ) {}

  bind(...values: unknown[]): DemoD1Statement {
    // D1 と同じく、値をここで確かめる(undefined はエラー)
    values.forEach(toSqlValue);
    return new DemoD1Statement(this.db, this.query, values);
  }

  private run1(): Executed {
    try {
      const r = this.db.execute(this.query, this.params);
      this.db.notify(r.meta.changes > 0);
      return r;
    } catch (e) {
      throw toD1Error(e);
    }
  }

  async first<T = Row>(colName?: string): Promise<T | null> {
    const r = this.run1();
    const row = toObjects<Row>(r.columns, r.rows)[0];
    if (!row) return null;
    if (colName !== undefined) {
      if (!(colName in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${colName})`);
      return row[colName] as T;
    }
    return row as T;
  }

  async all<T = Row>(): Promise<D1ResultLike<T>> {
    return toResult<T>(this.run1());
  }

  async run<T = Row>(): Promise<D1ResultLike<T>> {
    return toResult<T>(this.run1());
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const r = this.run1();
    const rows = r.rows as unknown as T[];
    return options?.columnNames ? [r.columns as unknown as T, ...rows] : rows;
  }
}
