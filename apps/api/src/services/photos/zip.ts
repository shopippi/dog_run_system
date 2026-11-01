// 購入した写真をまとめる ZIP(PF-7。docs/photo-requirements.md 3.7)。
// 無圧縮(STORE)で、原本のバイトをそのまま流してつなげる(デコード・圧縮をしないので、中のファイルは原本とバイト単位で同じ)。
// 全部をメモリに読まず、1枚ずつ流しながら CRC-32 を数え、後ろの「データ記述子」に書く(ZIP の 0x0008 の印)。
// 4GB を超えるときは ZIP64 の形にする(100枚 × 大きな原本でも開ける)。
// 部品は自前の小さな書き手だけ(deflate は持たない)。Workers とブラウザ(デモ)の両方で動く。

export type ZipEntry = {
  /** ZIP の中のファイル名(UTF-8) */
  name: string;
  /** バイト数(置き場所の記録。流した数と違えば止める) */
  size: number;
  modified: Date;
  /** 中身を読む(順に1つずつ呼ぶ) */
  open: () => Promise<ReadableStream<Uint8Array>>;
};

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const enc = new TextEncoder();

// ---------------------------------------------------------------- CRC-32

type Crc32Fn = (data: Uint8Array, value?: number) => number;

let table: Uint32Array | null = null;
function jsCrc32(data: Uint8Array, value = 0): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = (value ^ U32_MAX) >>> 0;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ U32_MAX) >>> 0;
}

/**
 * CRC-32。Workers(nodejs_compat)では node:zlib の crc32(ネイティブで速い)を使い、
 * 無ければ(ブラウザのデモ)表を使う JavaScript の計算にする。静的に import しないのは、デモのビルドに node: を入れないため
 */
function pickCrc32(): Crc32Fn {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    const zlib = proc?.getBuiltinModule?.('node:zlib') as { crc32?: Crc32Fn } | undefined;
    if (typeof zlib?.crc32 === 'function') {
      const native = zlib.crc32;
      return (data, value = 0) => native(data, value) >>> 0;
    }
  } catch {
    // 使えなければ JavaScript の計算
  }
  return jsCrc32;
}
export const crc32: Crc32Fn = pickCrc32();
export { jsCrc32 };

// ---------------------------------------------------------------- 部品

class Bytes {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  private pos = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  u16(v: number) {
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }
  u32(v: number) {
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
    return this;
  }
  u64(v: number) {
    this.view.setBigUint64(this.pos, BigInt(v), true);
    this.pos += 8;
    return this;
  }
  raw(b: Uint8Array) {
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }
  done(): Uint8Array {
    if (this.pos !== this.buf.length) throw new Error(`zip: header size mismatch ${this.pos} != ${this.buf.length}`);
    return this.buf;
  }
}

/** 日本時間の日時を、ZIP の日付・時刻(MS-DOS の形)にする */
function dosDateTime(d: Date): { date: number; time: number } {
  const j = new Date(d.getTime() + 9 * 3600_000);
  const year = Math.min(Math.max(j.getUTCFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((j.getUTCMonth() + 1) << 5) | j.getUTCDate(),
    time: (j.getUTCHours() << 11) | (j.getUTCMinutes() << 5) | (j.getUTCSeconds() >> 1),
  };
}

/** 汎用の印: 0x0008 = サイズと CRC は後ろのデータ記述子、0x0800 = ファイル名は UTF-8 */
const FLAGS = 0x0008 | 0x0800;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;

type Prepared = { entry: ZipEntry; name: Uint8Array; zip64: boolean; dos: { date: number; time: number } };

function prepare(entries: ZipEntry[], zip64Threshold: number): Prepared[] {
  return entries.map((entry) => ({
    entry,
    name: enc.encode(entry.name),
    zip64: entry.size >= zip64Threshold,
    dos: dosDateTime(entry.modified),
  }));
}

function localHeader(p: Prepared): Uint8Array {
  const extra = p.zip64 ? 20 : 0;
  const b = new Bytes(LOCAL_HEADER + p.name.length + extra)
    .u32(0x04034b50)
    .u16(p.zip64 ? 45 : 20)
    .u16(FLAGS)
    .u16(0) // 無圧縮(STORE)
    .u16(p.dos.time)
    .u16(p.dos.date)
    .u32(0) // CRC はデータ記述子に
    .u32(p.zip64 ? U32_MAX : 0)
    .u32(p.zip64 ? U32_MAX : 0)
    .u16(p.name.length)
    .u16(extra)
    .raw(p.name);
  if (p.zip64) b.u16(0x0001).u16(16).u64(0).u64(0);
  return b.done();
}

function dataDescriptor(p: Prepared, crc: number, size: number): Uint8Array {
  if (p.zip64) return new Bytes(24).u32(0x08074b50).u32(crc).u64(size).u64(size).done();
  return new Bytes(16).u32(0x08074b50).u32(crc).u32(size).u32(size).done();
}

function centralHeader(p: Prepared, crc: number, size: number, offset: number, zip64Threshold: number): Uint8Array {
  const bigSize = p.zip64 || size >= zip64Threshold;
  const bigOffset = offset >= zip64Threshold;
  const extraLen = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0);
  const extra = extraLen ? 4 + extraLen : 0;
  const b = new Bytes(CENTRAL_HEADER + p.name.length + extra)
    .u32(0x02014b50)
    .u16((3 << 8) | 45) // 作った環境(Unix)と版
    .u16(bigSize || bigOffset ? 45 : 20)
    .u16(FLAGS)
    .u16(0)
    .u16(p.dos.time)
    .u16(p.dos.date)
    .u32(crc)
    .u32(bigSize ? U32_MAX : size)
    .u32(bigSize ? U32_MAX : size)
    .u16(p.name.length)
    .u16(extra)
    .u16(0) // コメント
    .u16(0) // ディスク番号
    .u16(0) // 内部属性
    .u32((0o100644 << 16) >>> 0) // 外部属性(ふつうのファイル rw-r--r--)
    .u32(bigOffset ? U32_MAX : offset)
    .raw(p.name);
  if (extra) {
    b.u16(0x0001).u16(extraLen);
    if (bigSize) b.u64(size).u64(size);
    if (bigOffset) b.u64(offset);
  }
  return b.done();
}

function endRecords(count: number, cdSize: number, cdOffset: number, zip64Threshold: number): Uint8Array {
  const needZip64 = count >= U16_MAX || cdSize >= zip64Threshold || cdOffset >= zip64Threshold;
  const parts: Uint8Array[] = [];
  if (needZip64) {
    const zip64EndOffset = cdOffset + cdSize;
    parts.push(
      new Bytes(56)
        .u32(0x06064b50)
        .u64(44)
        .u16((3 << 8) | 45)
        .u16(45)
        .u32(0)
        .u32(0)
        .u64(count)
        .u64(count)
        .u64(cdSize)
        .u64(cdOffset)
        .done(),
      new Bytes(20).u32(0x07064b50).u32(0).u64(zip64EndOffset).u32(1).done(),
    );
  }
  parts.push(
    new Bytes(22)
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(needZip64 ? U16_MAX : count)
      .u16(needZip64 ? U16_MAX : count)
      .u32(needZip64 ? U32_MAX : cdSize)
      .u32(needZip64 ? U32_MAX : cdOffset)
      .u16(0)
      .done(),
  );
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// ---------------------------------------------------------------- 全体の大きさ(Content-Length)

/**
 * でき上がる ZIP のバイト数。中身の大きさが分かっているので、流す前に決まる(ダウンロードの進み具合が出る)
 */
export function storeZipSize(entries: Pick<ZipEntry, 'name' | 'size' | 'modified'>[], opts: { zip64Threshold?: number } = {}): number {
  const threshold = opts.zip64Threshold ?? U32_MAX;
  const prepared = prepare(entries.map((e) => ({ ...e, open: async () => new ReadableStream() })), threshold);
  let offset = 0;
  let cdSize = 0;
  for (const p of prepared) {
    const start = offset;
    offset += LOCAL_HEADER + p.name.length + (p.zip64 ? 20 : 0) + p.entry.size + (p.zip64 ? 24 : 16);
    const bigSize = p.zip64 || p.entry.size >= threshold;
    const bigOffset = start >= threshold;
    const extraLen = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0);
    cdSize += CENTRAL_HEADER + p.name.length + (extraLen ? 4 + extraLen : 0);
  }
  return offset + cdSize + endRecords(prepared.length, cdSize, offset, threshold).length;
}

// ---------------------------------------------------------------- 流す

/**
 * 無圧縮の ZIP を流す。中身は1つずつ open して、そのまま後ろへつなげる。
 * 置き場所の記録(size)と流れたバイト数が違えば、途中で止める(壊れた ZIP を渡さない)
 */
export function storeZipStream(entries: ZipEntry[], opts: { zip64Threshold?: number } = {}): ReadableStream<Uint8Array> {
  const threshold = opts.zip64Threshold ?? U32_MAX;
  const prepared = prepare(entries, threshold);
  async function* generate(): AsyncGenerator<Uint8Array> {
    let offset = 0;
    const central: Uint8Array[] = [];
    for (const p of prepared) {
      const start = offset;
      const head = localHeader(p);
      yield head;
      offset += head.length;
      const reader = (await p.entry.open()).getReader();
      let crc = 0;
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.length) continue;
          crc = crc32(value, crc);
          size += value.length;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
      if (size !== p.entry.size) throw new Error(`zip: ${p.entry.name} の大きさが記録と違います(${size} / ${p.entry.size})`);
      offset += size;
      const desc = dataDescriptor(p, crc, size);
      yield desc;
      offset += desc.length;
      central.push(centralHeader(p, crc, size, start, threshold));
    }
    const cdOffset = offset;
    let cdSize = 0;
    for (const c of central) {
      yield c;
      cdSize += c.length;
    }
    yield endRecords(prepared.length, cdSize, cdOffset, threshold);
  }
  const it = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}

/** ZIP の中で同じ名前にならないようにする(IMG_0001.JPG → IMG_0001 (2).JPG)。フォルダの区切りは使わない */
export function uniqueZipNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'photo.jpg';
    const dot = clean.lastIndexOf('.');
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    let name = clean;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}
