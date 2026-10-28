import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * 画面にそのまま出せるエラー。
 * message は「何が起きたか」と「次に何をすればよいか」を日本語で書く(要件定義書 15.1)。
 */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const errors = {
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new AppError(400, 'bad_request', message, details),
  unauthorized: (message = 'ログインの確認ができませんでした。画面を閉じて、もう一度開いてください。') =>
    new AppError(401, 'unauthorized', message),
  forbidden: (message = 'この操作をする権限がありません。管理者に依頼してください。') =>
    new AppError(403, 'forbidden', message),
  notFound: (message = '見つかりませんでした。画面を読み込み直してください。') =>
    new AppError(404, 'not_found', message),
  conflict: (code: string, message: string, details?: Record<string, unknown>) =>
    new AppError(409, code, message, details),
};

export type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};
