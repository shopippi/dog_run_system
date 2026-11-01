import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

// 段階1-A(管理)の e2e の補助: 小さな JPEG を作る・テスト用のフォルダを作る・API で写真を入れる(画面の準備)

/** ブラウザの canvas で、見分けのつく小さな JPEG を作る(テスト用。中身は色と番号) */
export async function makeJpeg(page: Page, n: number, width = 900, height = 600): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([n, w, h]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      const hue = (n * 47) % 360;
      g.fillStyle = `hsl(${hue} 35% 62%)`;
      g.fillRect(0, 0, w, h);
      g.fillStyle = `hsl(${(hue + 30) % 360} 30% 35%)`;
      g.beginPath();
      g.ellipse(w * 0.5, h * 0.6, w * 0.22, h * 0.24, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(w * 0.5, h * 0.32, h * 0.14, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `600 ${Math.round(h / 10)}px sans-serif`;
      g.fillText(`No.${n}`, w * 0.05, h * 0.15);
      return c.toDataURL('image/jpeg', 0.9);
    },
    [n, width, height] as const,
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

const H = { 'x-dr-admin': '1' };

/** API でアルバムを作り、写真を入れる(ページのログインのクッキーを使う)。アルバムの番号を返す */
export async function apiAlbumWithPhotos(page: Page, name: string, count: number, kind: 'date' | 'event' = 'event'): Promise<number> {
  const r = await page.request.post('/admin/api/photos/albums', { headers: H, data: { name, kind, eventDate: '2026-11-03' } });
  expect(r.status(), await r.text()).toBe(201);
  const albumId = (await r.json()).album.id as number;
  for (let i = 1; i <= count; i++) {
    const bytes = await makeJpeg(page, i + name.length * 7);
    const thumb = await makeJpeg(page, i + name.length * 7, 400, 267);
    const s = await page.request.post(`/admin/api/photos/albums/${albumId}/uploads`, {
      headers: H,
      data: { filename: `IMG_${String(i).padStart(4, '0')}.JPG`, bytes: bytes.length, contentType: 'image/jpeg', sha256: createHash('sha256').update(bytes).digest('hex') },
    });
    const up = await s.json();
    const parts = await (await page.request.post(`/admin/api/photos/uploads/${up.uploadId}/parts`, { headers: H, data: { partNumbers: [1] } })).json();
    const t = parts.parts[0];
    const put = await page.request.put(new URL(t.url).pathname, { headers: t.headers, data: bytes });
    const etag = (await put.json()).etag;
    for (const kind of ['preview', 'thumb', 'view']) {
      const d = await (await page.request.post(`/admin/api/photos/uploads/${up.uploadId}/derivatives`, { headers: H, data: { kind, bytes: thumb.length, contentType: 'image/jpeg' } })).json();
      await page.request.put(new URL(d.url).pathname, { headers: d.headers, data: thumb });
    }
    const c = await page.request.post(`/admin/api/photos/uploads/${up.uploadId}/complete`, { headers: H, data: { parts: [{ partNumber: 1, etag }] } });
    expect((await c.json()).verified).toBe(true);
  }
  return albumId;
}

/** 写真の保存先(SHOT_DIR があるときだけ撮る) */
export async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

export type FakeFolder = { name: string; files: { name: string; bytes: Buffer | string; type?: string }[] };

/**
 * フォルダを落とす(ドラッグ&ドロップ)。
 * Playwright の Chromium では、フォルダ(webkitdirectory)を選ぶ操作を再現できないため、ブラウザの DataTransfer に
 * フォルダの入り口(webkitGetAsEntry が返すもの)のまねを付けて、本物と同じ drop の出来事を送る。画面の側の処理はそのまま通る
 */
export async function dropFolders(target: Locator, folders: FakeFolder[]) {
  const payload = folders.map((f) => ({ name: f.name, files: f.files.map((x) => ({ name: x.name, type: x.type ?? '', bytes: [...Buffer.from(x.bytes)] })) }));
  const dt = await target.page().evaluateHandle((folders) => {
    type FakeEntry = { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void) => void; createReader?: () => unknown };
    const dt = new DataTransfer();
    const entries = new Map<string, FakeEntry>();
    folders.forEach((folder, i) => {
      const files = folder.files.map((x) => new File([new Uint8Array(x.bytes)], x.name, { type: x.type }));
      const children: FakeEntry[] = files.map((f) => ({ isFile: true, isDirectory: false, name: f.name, file: (ok) => ok(f) }));
      const carrier = `.dr-folder-${i}`;
      entries.set(carrier, {
        isFile: false,
        isDirectory: true,
        name: folder.name,
        createReader: () => {
          let done = false;
          return { readEntries: (ok: (e: FakeEntry[]) => void) => ok(done ? [] : ((done = true), children)) };
        },
      });
      dt.items.add(new File([''], carrier));
    });
    const proto = DataTransferItem.prototype as unknown as { webkitGetAsEntry: () => unknown };
    proto.webkitGetAsEntry = function (this: DataTransferItem) {
      const f = this.getAsFile();
      return f ? (entries.get(f.name) ?? { isFile: true, isDirectory: false, name: f.name, file: (ok: (x: File) => void) => ok(f) }) : null;
    };
    return dt;
  }, payload);
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
}

/** makeFolder と同じ中身のフォルダ(落とす用) */
export async function fakeFolder(page: Page, name: string, count: number, extra: Record<string, string> = { 'memo.txt': 'メモ' }): Promise<FakeFolder> {
  const files: FakeFolder['files'] = [];
  for (let i = 1; i <= count; i++) files.push({ name: `IMG_${i}.jpg`, bytes: await makeJpeg(page, i + name.length * 10), type: 'image/jpeg' });
  for (const [f, body] of Object.entries(extra)) files.push({ name: f, bytes: body, type: 'text/plain' });
  return { name, files };
}
