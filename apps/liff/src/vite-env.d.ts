/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** LIFF アプリのID。空のときはモックで動く(開発・テスト用) */
  readonly VITE_LIFF_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
