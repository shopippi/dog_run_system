import { PhotoSalesFrame } from './PhotoSalesFrame';

// PA-2 アップロード(段階1-A)。フォルダのドラッグ&ドロップ、アルバムごとの進み具合、飛ばしたファイルの数。プレビュー・サムネイル・中サイズと透かしをブラウザで作る
// 段階0の空の画面。中身は担当の段階1で作る(docs/photo-stage1-brief.md)。
export function PhotoUploadPage() {
  return <PhotoSalesFrame title="写真のアップロード" howto="写真の入ったフォルダを、ここに落としてください。フォルダの名前がアルバムの名前になります。" />;
}
