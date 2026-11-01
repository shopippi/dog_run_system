// 透かし(docs/photo-requirements.md 3.3)。プレビュー・サムネイルの全面に、斜めのタイルで文字(「施設の名前 SAMPLE」)を敷く。
// 文字は白の半透明に、細い黒の半透明のふちを付ける(明るい写真でも暗い写真でも読める)。
// 端を切り取っても残るよう、行をずらしながら写真の外側まで敷き詰める。
// Web Worker の OffscreenCanvas でも、画面の canvas でも同じものを描く。

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export const WATERMARK_ANGLE = (-30 * Math.PI) / 180;

export function drawWatermark(g: Ctx2D, width: number, height: number, text: string) {
  const longEdge = Math.max(width, height);
  // 長辺 1200px で 40px 前後。サムネイル(400px)でも読める大きさ
  const size = Math.max(14, Math.round(longEdge / 30));
  g.save();
  g.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const label = text.trim() || 'SAMPLE';
  const textW = g.measureText(label).width;
  const stepX = textW + size * 2.2;
  const stepY = size * 3.2;
  const diag = Math.ceil(Math.sqrt(width * width + height * height));
  g.translate(width / 2, height / 2);
  g.rotate(WATERMARK_ANGLE);
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1, size / 14);
  g.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  g.fillStyle = 'rgba(255, 255, 255, 0.42)';
  let row = 0;
  for (let y = -diag / 2 - stepY; y <= diag / 2 + stepY; y += stepY, row++) {
    const offset = (row % 2) * (stepX / 2);
    for (let x = -diag / 2 - stepX + offset; x <= diag / 2 + stepX; x += stepX) {
      g.strokeText(label, x, y);
      g.fillText(label, x, y);
    }
  }
  g.restore();
}

/** 長辺を longEdge 以下にした大きさ(大きくはしない) */
export function fitLongEdge(width: number, height: number, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
