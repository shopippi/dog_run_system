import type { DownloadResponse } from '@dr/shared';

// 購入した写真の受け取り(PU-7)。サーバーが作った5分の URL を、その場で開いて保存する。
// - ふつう: <a download> を押したのと同じ。応答の Content-Disposition(attachment)で、ブラウザが保存する
//   (R2 の署名つき URL も、代わりの置き場所の Worker の受け取り口も同じ)
// - ブラウザだけで動くデモ: API は親の画面の中で動くので、fetch で受け取ってから保存する

const isDemo = import.meta.env.VITE_DEMO === '1';

export async function saveDownload(res: DownloadResponse): Promise<void> {
  let href = res.url;
  let revoke: string | null = null;
  if (isDemo) {
    const u = new URL(res.url);
    const r = await fetch(u.pathname + u.search);
    if (!r.ok) throw new Error('download failed');
    href = URL.createObjectURL(await r.blob());
    revoke = href;
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = res.filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(revoke!), 60_000);
}
