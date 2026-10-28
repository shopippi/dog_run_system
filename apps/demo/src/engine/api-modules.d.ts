// apps/api のコードは、そのまま import して使う(型の確かめは apps/api 側で行う)。
// デモの型チェックに Workers の型を持ち込まないよう、使う部分の形だけをここに書く。
declare module '@api-src/app' {
  export function createApp(): { fetch(request: Request, env: unknown): Response | Promise<Response> };
}
declare module '@api-src/cron' {
  export function runScheduled(cron: string, env: unknown, now: Date): Promise<void>;
}
declare module '@api-src/lib/password' {
  export function hashPassword(password: string): Promise<string>;
}
