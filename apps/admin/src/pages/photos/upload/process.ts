import type { PhotoDerivative } from '@dr/shared';
import type { DeriveRequest, DeriveResult } from './derivatives.worker';

// 写真をブラウザで準備する(SHA-256・プレビュー・サムネイル・中サイズ)。Web Worker を2つまで使い、画面を止めない。
// HEIC をこの端末で読めないとき(Chrome など)は、heic2any(MIT)で JPEG にしてから、もう一度 Worker に頼む。
// heic2any は大きいので、HEIC の写真が来たときにだけ読み込む。原本は HEIC のまま送る(変換したものはプレビューを作るだけに使う)。

export type Prepared = { sha256: string; width: number; height: number; blobs: Record<PhotoDerivative, Blob> };

export class PrepareError extends Error {}

type Job = { req: DeriveRequest; resolve: (r: DeriveResult) => void };

class WorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, (r: DeriveResult) => void>();
  private seq = 0;

  constructor(private readonly size: number) {}

  private spawn(): Worker {
    const w = new Worker(new URL('./derivatives.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<DeriveResult>) => {
      const done = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      done?.(e.data);
      this.idle.push(w);
      this.pump();
    };
    this.workers.push(w);
    return w;
  }

  private pump() {
    while (this.queue.length) {
      const w = this.idle.pop() ?? (this.workers.length < this.size ? this.spawn() : null);
      if (!w) return;
      const job = this.queue.shift()!;
      this.pending.set(job.req.id, job.resolve);
      w.postMessage(job.req);
    }
  }

  run(req: Omit<DeriveRequest, 'id'>): Promise<DeriveResult> {
    return new Promise((resolve) => {
      this.queue.push({ req: { ...req, id: ++this.seq }, resolve });
      this.pump();
    });
  }

  close() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}

let pool: WorkerPool | null = null;
const getPool = () => (pool ??= new WorkerPool(Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1))));

/** 使い終わったら Worker を止める(画面を離れたとき) */
export function closePreparePool() {
  pool?.close();
  pool = null;
}

async function heicToJpeg(file: Blob): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  return Array.isArray(out) ? out[0]! : out;
}

export async function preparePhoto(file: File, watermark: string, isHeic: boolean): Promise<Prepared> {
  let r = await getPool().run({ original: file, watermark });
  if (!r.ok && r.reason === 'decode' && isHeic) {
    let jpeg: Blob;
    try {
      jpeg = await heicToJpeg(file);
    } catch {
      throw new PrepareError('HEIC の写真を読み込めませんでした。iPhone の設定で「互換性優先」にして撮るか、JPEG にしてから落としてください。');
    }
    r = await getPool().run({ original: file, decodable: jpeg, watermark, sha256: r.sha256 ?? undefined });
  }
  if (!r.ok) {
    throw new PrepareError(
      r.reason === 'decode' ? '写真を読み込めませんでした。壊れていないか確かめて、もう一度落としてください。' : 'プレビューを作れませんでした。画面を読み込み直して、もう一度落としてください。',
    );
  }
  return { sha256: r.sha256, width: r.width, height: r.height, blobs: r.blobs };
}
