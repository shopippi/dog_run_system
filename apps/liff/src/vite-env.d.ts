/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" のとき、ブラウザだけで動くデモ(apps/demo)の中で動く */
  readonly VITE_DEMO?: string;
  /** LIFF アプリのID。空のときはモックで動く(開発・テスト用) */
  readonly VITE_LIFF_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
