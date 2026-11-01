import type { StaffRole } from '@dr/shared';

export type Bindings = {
  DB: D1Database;
  /** 写真の保存先。R2 がないときは、データベースに保存する部品(lib/d1-media.ts)が入る */
  MEDIA: R2Bucket;
  /** 写真の保存先の種類。"d1" のときは R2 を使っていない(バックアップは R2 がないとできないので、スキップする) */
  MEDIA_BACKEND?: 'r2' | 'd1';
  ASSETS: Fetcher;
  ENVIRONMENT: 'local' | 'test' | 'production';
  LINE_CHANNEL_ID: string;
  /** "1" のとき、LINE の代わりにモックのIDトークンを受け付ける(local / test のみ有効) */
  LINE_LOGIN_MOCK?: string;
  /** "1" のとき、インターネットにつながらない環境(ブラウザだけで動くデモ)。天気・祝日の取得はせず、スキップとして成功にする */
  OFFLINE?: string;
  /**
   * LINE の Messaging API のチャネルアクセストークン(wrangler の secret。予約の確定・お断りのお知らせに使う。21章)。
   * ログインのチャネルとは別のチャネル。なければお知らせは送らず「送っていません(設定がまだ)」と記録する
   */
  LINE_MESSAGING_TOKEN?: string;

  // ---- 写真販売(docs/photo-requirements.md 7章)。どれも無ければ、本番では「準備中」になる ----
  /** 写真販売の R2 のバケット(非公開。原本・購入済み・中サイズ・プレビュー・サムネイル)。wrangler.toml の # を外す */
  PHOTOS?: R2Bucket;
  /** 写真販売のバケットの名前(署名つき URL に使う。公開してよい値) */
  PHOTOS_BUCKET_NAME?: string;
  /** Cloudflare のアカウントID(R2 の S3 互換の宛先 https://<ID>.r2.cloudflarestorage.com。公開してよい値) */
  R2_ACCOUNT_ID?: string;
  /** R2 の API トークンのアクセスキー(wrangler の secret) */
  R2_ACCESS_KEY_ID?: string;
  /** R2 の API トークンのシークレット(wrangler の secret) */
  R2_SECRET_ACCESS_KEY?: string;
  /** Stripe のシークレットキー(wrangler の secret。施設の名義のアカウント) */
  STRIPE_SECRET_KEY?: string;
  /** Stripe の Webhook の署名の秘密(wrangler の secret) */
  STRIPE_WEBHOOK_SECRET?: string;
  /** "1" のとき、Stripe の代わりにまねの支払いを使う(local / test のみ有効。LINE_LOGIN_MOCK と同じ考え方) */
  STRIPE_MOCK?: string;
  /** 代わりの置き場所のダウンロード URL の署名の秘密(local / test。無ければ決まった値) */
  PHOTO_URL_SECRET?: string;
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
