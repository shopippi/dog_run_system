/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" のとき、ブラウザだけで動くデモ(apps/demo)の中で動く */
  readonly VITE_DEMO?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
