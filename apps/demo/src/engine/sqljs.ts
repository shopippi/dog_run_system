import initSqlJs, { type SqlJsStatic } from 'sql.js';

// SQLite の本体(WASM)は cdnjs から読む。読めないときは jsDelivr を試す。
export const SQLJS_VERSION = '1.14.1';
export const SQLJS_WASM_URLS = [
  `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQLJS_VERSION}/sql-wasm.wasm`,
  `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/sql-wasm.wasm`,
];

let loading: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
  loading ??= (async () => {
    let lastError: unknown = null;
    for (const url of SQLJS_WASM_URLS) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const wasmBinary = await res.arrayBuffer();
        return await initSqlJs({ wasmBinary });
      } catch (e) {
        lastError = e;
      }
    }
    loading = null;
    throw lastError ?? new Error('sql.js');
  })();
  return loading;
}
