import { sha256Hex } from '@dr/shared';
import { describe, expect, it } from 'vitest';
import { crc32, jsCrc32, storeZipSize, storeZipStream, uniqueZipNames, type ZipEntry } from '../src/services/photos/zip';
import { bytesOf, parseStoreZip, readAll } from './p8-delivery-seed';

// 無圧縮(STORE)の ZIP の書き手(PF-7)。中身が原本とバイト単位で同じこと、流しながら作れること、4GB を超える形(ZIP64)

/** 小さく分けて流す(本物の置き場所も、部分ごとに流れてくる) */
function chunked(bytes: Uint8Array, size = 333): ReadableStream<Uint8Array> {
  let pos = 0;
  return new ReadableStream({
    pull(c) {
      if (pos >= bytes.length) return c.close();
      c.enqueue(bytes.slice(pos, pos + size));
      pos += size;
    },
  });
}

const entry = (name: string, bytes: Uint8Array): ZipEntry => ({
  name,
  size: bytes.length,
  modified: new Date('2026-11-03T01:02:04Z'),
  open: async () => chunked(bytes),
});

describe('STORE の ZIP', () => {
  it('CRC-32 は決まった値(ネイティブと JavaScript で同じ)', () => {
    const hello = new TextEncoder().encode('hello');
    expect(jsCrc32(hello)).toBe(0x3610a686);
    expect(crc32(hello)).toBe(0x3610a686);
    // 続きから数えても同じ
    expect(crc32(hello.subarray(3), crc32(hello.subarray(0, 3)))).toBe(0x3610a686);
    const big = bytesOf(100_000);
    expect(crc32(big)).toBe(jsCrc32(big));
  });

  it('中身は元のバイトのまま(SHA-256 が同じ)。大きさは流す前に分かる', async () => {
    const files = [bytesOf(10_000, 1), bytesOf(0, 2), bytesOf(1, 3), bytesOf(4096, 4)];
    const entries = files.map((b, i) => entry(`写真_${i}.jpg`, b));
    const zip = await readAll(storeZipStream(entries));
    expect(zip.length).toBe(storeZipSize(entries));
    const parsed = parseStoreZip(zip);
    expect(parsed.map((p) => p.name)).toEqual(['写真_0.jpg', '写真_1.jpg', '写真_2.jpg', '写真_3.jpg']);
    for (const [i, p] of parsed.entries()) {
      expect(p.method).toBe(0);
      expect(await sha256Hex(p.data)).toBe(await sha256Hex(files[i]!));
      expect(p.crc).toBe(jsCrc32(files[i]!));
    }
    // 頭の印: 0x0008(データ記述子)と 0x0800(UTF-8 の名前)、日本時間の日付 2026-11-03 10:02:04
    const dv = new DataView(zip.buffer);
    expect(dv.getUint16(6, true)).toBe(0x0808);
    expect(dv.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 3);
    expect(dv.getUint16(10, true)).toBe((10 << 11) | (2 << 5) | 2);
  });

  it('4GB を超える形(ZIP64)でも同じように読める(しきい値を下げて確かめる)', async () => {
    const files = [bytesOf(3000, 5), bytesOf(50, 6), bytesOf(2000, 7)];
    const entries = files.map((b, i) => entry(`IMG_${i}.JPG`, b));
    const opts = { zip64Threshold: 1000 };
    const zip = await readAll(storeZipStream(entries, opts));
    expect(zip.length).toBe(storeZipSize(entries, opts));
    const parsed = parseStoreZip(zip);
    for (const [i, p] of parsed.entries()) expect(await sha256Hex(p.data)).toBe(await sha256Hex(files[i]!));
    // ZIP64 の終わりの記録がある
    const dv = new DataView(zip.buffer);
    expect(dv.getUint32(zip.length - 22 - 20, true)).toBe(0x07064b50);
  });

  it('置き場所の記録と大きさが違えば、途中で止める(壊れた ZIP を渡さない)', async () => {
    const e = { ...entry('a.jpg', bytesOf(100)), size: 99 };
    await expect(readAll(storeZipStream([e]))).rejects.toThrow(/大きさが記録と違います/);
  });

  it('同じ名前は (2) を付けて分ける。フォルダの区切りなどは使わない', () => {
    expect(uniqueZipNames(['IMG_1.JPG', 'img_1.jpg', 'IMG_1.JPG', 'a/b.jpg', '', 'noext'])).toEqual([
      'IMG_1.JPG',
      'img_1 (2).jpg',
      'IMG_1 (3).JPG',
      'a_b.jpg',
      'photo.jpg',
      'noext',
    ]);
  });
});
