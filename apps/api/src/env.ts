import type { StaffRole } from '@dr/shared';

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: 'local' | 'test' | 'production';
  LINE_CHANNEL_ID: string;
  /** "1" のとき、LINE の代わりにモックのIDトークンを受け付ける(local / test のみ有効) */
  LINE_LOGIN_MOCK?: string;
};

/** LINE の IDトークンを検証して分かった、お客さんのLINEアカウント */
export type LineUser = {
  userId: string;
  displayName: string;
};

/** ログイン中の管理画面の利用者 */
export type StaffUser = {
  id: number;
  email: string;
  name: string;
  role: StaffRole;
};

export type Variables = {
  now: Date;
  lineUser: LineUser;
  staff: StaffUser;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
