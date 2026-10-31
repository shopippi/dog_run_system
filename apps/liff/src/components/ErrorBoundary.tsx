import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearCachedCard } from '../lib/card-cache';

type Props = { children: ReactNode };
type State = { failed: boolean; chunk: boolean };

/** 画面のファイル(分けて読み込む部分)を読めなかったか。電波が弱いときや、新しい版を配信した直後に起きる */
function isChunkError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically|ChunkLoadError|Load failed/i.test(msg);
}

/**
 * 画面ごとのエラーの境界。表示の途中で失敗しても、真っ白にせず、何が起きたかと次にすることを出す(要件定義書 15.1)。
 * 「もう一度読み込む」は画面を読み込み直す(分けて読み込む部分の失敗は、読み込み直すと直る)。
 * 画面が切り替わったら(key が変わったら)元に戻る。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, chunk: false };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, chunk: isChunkError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('画面の表示に失敗しました', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="screen boundary">
        <div className="alert danger" role="alert">
          <p>
            <b>{this.state.chunk ? '電波が弱いため、画面を読み込めませんでした。' : '画面をうまく表示できませんでした。'}</b>
          </p>
          <p>
            {this.state.chunk
              ? '電波のよい場所で「もう一度読み込む」を押してください。ポイントやチェックインの記録はなくなりません。'
              : '「もう一度読み込む」を押してください。直らないときは、画面を閉じて開き直してください。ポイントやチェックインの記録はなくなりません。'}
          </p>
          <button
            type="button"
            className="btn sub"
            onClick={() => {
              // 端末に残した会員証が原因のこともあるので、読み込み直す前に消す(サーバーから読み直す)
              if (!this.state.chunk) clearCachedCard();
              window.location.reload();
            }}
          >
            もう一度読み込む
          </button>
        </div>
      </main>
    );
  }
}
