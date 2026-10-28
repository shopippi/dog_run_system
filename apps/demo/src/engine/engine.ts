// ブラウザの中で動く API。apps/api の createApp() を、sql.js(D1 の代わり)とメモリ(R2 の代わり)で動かす。

import { createApp } from '@api-src/app';
import { runScheduled } from '@api-src/cron';
import { hashPassword } from '@api-src/lib/password';
import { toJstDate, toJstIso } from '@dr/shared';
import type { Database, SqlJsStatic } from 'sql.js';
import { seedDemo, type SeedOptions } from '../seed/seed';
import { CookieJar } from './cookies';
import { DemoD1 } from './d1';
import { installResponsePatch, withHeaders } from './http-patch';
import { MIGRATIONS } from './migrations';
import { DemoR2, type StoredObject } from './r2';
import { store, type SavedState } from './store';

/** 画面(iframe)から届く要求 */
export type BridgeRequest = {
  method: string;
  /** /api/... か /admin/api/...(クエリつき) */
  url: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
};

export type BridgeResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
};

/** wrangler.toml の cron(日本時間 3:10 と 5:10) */
export const NIGHTLY_CRONS = ['10 18 * * *', '10 20 * * *'];

const DAY_MS = 24 * 60 * 60 * 1000;

export type EngineOptions = {
  SQL: SqlJsStatic;
  /** 保存しない(テスト用) */
  memoryOnly?: boolean;
  /** 初期データの写真を作る(ブラウザだけ) */
  photos?: Pick<SeedOptions, 'makeDogPhoto' | 'makeCardPhoto'>;
  /** テスト用: 実際の時刻の代わり */
  clock?: () => number;
};

export class DemoEngine {
  private sql!: Database;
  d1!: DemoD1;
  readonly r2 = new DemoR2();
  private readonly app = createApp();
  private readonly jars = new Map<string, CookieJar>();
  private state: SavedState = { dayOffset: 0, jars: {}, seededAt: 0 };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** 変更があったとき(画面の表示を更新するため) */
  onChange: (() => void) | null = null;

  private constructor(private readonly opts: EngineOptions) {}

  static async create(opts: EngineOptions): Promise<DemoEngine> {
    installResponsePatch();
    const e = new DemoEngine(opts);
    const saved = opts.memoryOnly ? null : await store.loadDb();
    const state = opts.memoryOnly ? null : await store.loadState();
    if (saved && state) {
      e.open(new opts.SQL.Database(saved));
      e.state = state;
      for (const [k, v] of Object.entries(state.jars)) e.jar(k).load(v);
      e.r2.load(await store.loadMedia());
    } else {
      await e.reset();
    }
    e.r2.onChange = (key, value) => {
      if (!e.opts.memoryOnly) void store.putMedia(key, value);
    };
    return e;
  }

  private open(db: Database) {
    this.sql?.close();
    this.sql = db;
    this.sql.run('PRAGMA foreign_keys = ON');
    this.d1 = new DemoD1(this.sql);
    this.d1.onWrite = () => this.scheduleSave();
  }

  /** やり直しの途中は、画面からの要求を待たせる */
  private gate: Promise<void> = Promise.resolve();

  /** 最初からやり直す: 空のデータベースにマイグレーションを当て、初期データを入れる */
  async reset(): Promise<void> {
    let done!: () => void;
    const prev = this.gate;
    this.gate = new Promise((r) => (done = r));
    await prev;
    try {
      await this.resetNow();
    } finally {
      done();
    }
  }

  private async resetNow(): Promise<void> {
    if (!this.opts.memoryOnly) await store.clear();
    this.open(new this.opts.SQL.Database());
    for (const m of MIGRATIONS) this.sql.exec(m.sql);
    this.sql.run('PRAGMA foreign_keys = ON');
    this.jars.clear();
    this.state = { dayOffset: 0, jars: {}, seededAt: this.realNow() };
    const r2 = this.r2;
    const onChange = r2.onChange;
    r2.onChange = null;
    r2.load([]);
    await seedDemo(this.sql, {
      now: this.now(),
      hashPassword,
      ...this.opts.photos,
      putMedia: async (key, bytes) => {
        await r2.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
      },
    });
    r2.onChange = onChange;
    if (!this.opts.memoryOnly) {
      for (const [k, v] of r2.objects) await store.putMedia(k, v as StoredObject);
    }
    await this.saveNow();
    this.onChange?.();
  }

  private realNow() {
    return this.opts.clock ? this.opts.clock() : Date.now();
  }

  /** デモの「いま」。「翌日にする」で進めた日数を足す */
  now(): Date {
    return new Date(this.realNow() + this.state.dayOffset * DAY_MS);
  }

  today(): string {
    return toJstDate(this.now());
  }

  get dayOffset() {
    return this.state.dayOffset;
  }

  async advanceDay(): Promise<void> {
    this.state.dayOffset += 1;
    await this.saveNow();
    this.onChange?.();
  }

  /** 夜間の処理(cron)を、いますぐ動かす */
  async runNightly(): Promise<void> {
    for (const cron of NIGHTLY_CRONS) await runScheduled(cron, this.env(), this.now());
    await this.saveNow();
    this.onChange?.();
  }

  jar(name: string): CookieJar {
    let j = this.jars.get(name);
    if (!j) {
      j = new CookieJar();
      this.jars.set(name, j);
    }
    return j;
  }

  private env() {
    // OFFLINE: ブラウザの中だけで動くので、天気・祝日は外に取りに行かない(スキップとして成功にする)
    return { DB: this.d1, MEDIA: this.r2, ENVIRONMENT: 'local', LINE_CHANNEL_ID: 'demo', LINE_LOGIN_MOCK: '1', OFFLINE: '1' };
  }

  /** 画面から届いた要求を、API(Hono)で処理する。クッキーは画面ごとの入れ物で保つ */
  async handle(req: BridgeRequest, jarName: string): Promise<BridgeResponse> {
    await this.gate;
    const now = this.now();
    const jar = this.jar(jarName);
    const headers = new Headers(req.headers);
    headers.set('x-debug-now', now.toISOString());
    const cookie = jar.header(now.getTime());
    if (cookie) headers.set('cookie', cookie);
    else headers.delete('cookie');
    const method = req.method.toUpperCase();
    const hasBody = req.body !== null && method !== 'GET' && method !== 'HEAD';
    const request = withHeaders(
      new Request(new URL(req.url, 'https://demo.invalid'), {
        method,
        headers: req.headers,
        body: hasBody ? req.body : undefined,
      }),
      headers,
    );
    const res = await this.app.fetch(request, this.env());
    const out: [string, string][] = [];
    const setCookies: string[] = [];
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') setCookies.push(value);
      else out.push([key, value]);
    });
    const list = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? setCookies;
    for (const c of list) jar.store(c, now.getTime());
    const cookiesChanged = list.length > 0;
    const body = res.status === 204 || res.status === 304 || method === 'HEAD' ? null : await res.arrayBuffer();
    if (method !== 'GET' && method !== 'HEAD') {
      // 書き込みの操作は、すぐに保存する(直後に再読み込みしても失われないように)
      await this.saveNow();
      this.onChange?.();
    } else if (cookiesChanged) this.scheduleSave();
    return { status: res.status, statusText: res.statusText, headers: out, body };
  }

  /** デモ画面から、API と同じ道すじで呼ぶ(JSON) */
  async call<T = unknown>(jarName: string, method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
    const headers: [string, string][] = [['x-dr-admin', '1']];
    if (body !== undefined) headers.push(['content-type', 'application/json']);
    const res = await this.handle(
      { method, url, headers, body: body === undefined ? null : (new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer) },
      jarName,
    );
    const text = res.body ? new TextDecoder().decode(res.body) : '';
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }

  /** 管理画面のログインをやり直す(前のログインは終える) */
  async loginAs(jarName: string, email: string, password: string): Promise<boolean> {
    const jar = this.jar(jarName);
    if (jar.header(this.now().getTime())) await this.call(jarName, 'POST', '/admin/api/logout', {});
    jar.clear();
    const res = await this.call(jarName, 'POST', '/admin/api/login', { email, password });
    await this.saveNow();
    return res.status === 200;
  }

  /** デモ画面の表示のための読み取り(書き込みはしない) */
  select<T = Record<string, unknown>>(query: string, params: unknown[] = []): T[] {
    const r = this.d1.execute(query, params);
    return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])) as T);
  }

  passphrase(): string {
    const row = this.select<{ value: string }>("SELECT value FROM settings WHERE key = 'checkin_passphrase'")[0];
    return row ? (JSON.parse(row.value) as string) : '';
  }

  nowIso(): string {
    return toJstIso(this.now());
  }

  private scheduleSave() {
    if (this.opts.memoryOnly) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 400);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.opts.memoryOnly) return;
    const bytes = this.sql.export();
    this.d1.afterExport();
    this.state.jars = Object.fromEntries([...this.jars].map(([k, j]) => [k, j.toJSON()]));
    await store.saveDb(bytes);
    await store.saveState(this.state);
  }
}

