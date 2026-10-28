import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { dogSvg, paperCardSvg } from '../apps/demo/src/seed/art';
import { seedDemo } from '../apps/demo/src/seed/seed';
import { authHeaders } from './customer-helpers';
import { sql } from './merge-helpers';

// マニュアルの写真(e2e/manual-shots.spec.ts)の準備。
// デモ(apps/demo)と同じ初期データ(半年分の来場・天気・イベント、こむぎママなどの固定のおうち)を
// e2e のデータベースに入れ、画面の時計と API の「いま」を、今日の 11:30(日本時間)にそろえる。

const run = promisify(execFile);
const API_DIR = path.resolve(__dirname, '../apps/api');
const WORK_DIR = path.resolve(__dirname, '../test-results/manual-seed');

/** 日本時間の今日(実際の時計) */
export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** マニュアルの写真の「いま」。今日の 11:30(日本時間)から、実際に経った時間だけ進める */
export const MANUAL_START = new Date(`${todayJst()}T11:30:00+09:00`);
const realStart = Date.now();
export function manualNow(): Date {
  return new Date(MANUAL_START.getTime() + (Date.now() - realStart));
}
export function manualNowHeader(): string {
  return manualNow().toISOString();
}

/** SQL の値を文に埋め込む(seed は sql.js の run(q, params) で書くので、それを D1 で流せる文にする) */
function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function inline(q: string, params: unknown[]): string {
  let i = 0;
  return q.replace(/\?/g, () => literal(params[i++]));
}

/** ブラウザの canvas で SVG を JPEG にする */
async function svgToJpeg(page: Page, svg: string, width: number, height: number): Promise<Uint8Array> {
  const b64 = await page.evaluate(
    async ([s, w, h]) => {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1]!;
    },
    [svg, width, height] as const,
  );
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** 犬の絵の写真(デモと同じ絵)。variant で色や耳の形が変わる */
export async function dogPhoto(page: Page, variant: number): Promise<{ photo: Buffer; thumb: Buffer }> {
  return {
    photo: Buffer.from(await svgToJpeg(page, dogSvg(variant, 'photo'), 640, 480)),
    thumb: Buffer.from(await svgToJpeg(page, dogSvg(variant, 'thumb'), 240, 240)),
  };
}

/** 犬の絵の写真を、大きな1枚(スマホで選ぶ写真の代わり)で作る */
export async function dogPicture(page: Page, variant: number, width = 1200, height = 900): Promise<Buffer> {
  return Buffer.from(await svgToJpeg(page, dogSvg(variant, 'photo'), width, height));
}

/** 紙のスタンプカード(旧カード)の写真の代わり */
export async function paperCardPhoto(page: Page, stamped = 7): Promise<Buffer> {
  return Buffer.from(await svgToJpeg(page, paperCardSvg(stamped), 800, 560));
}

async function putObjects(objects: { key: string; bytes: Uint8Array }[]) {
  mkdirSync(WORK_DIR, { recursive: true });
  const queue = [...objects];
  const worker = async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      const file = path.join(WORK_DIR, o.key.replace(/[^A-Za-z0-9._-]/g, '_'));
      writeFileSync(file, o.bytes);
      // ローカルの保存先は、同時に書くとまれに失敗するので、3回まで試す
      for (let attempt = 1; ; attempt++) {
        try {
          await run(
            'npx',
            ['wrangler', 'r2', 'object', 'put', `dog-run-media/${o.key}`, '--file', file, '--content-type', 'image/jpeg', '--local', '--persist-to', '.wrangler/e2e'],
            { cwd: API_DIR },
          );
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
        }
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/**
 * デモと同じ初期データを、e2e のデータベースに入れる(空のデータベースのときだけ)。
 * スタッフは e2e/start-server.sh が作ったアカウントをそのまま使い、名前だけデモにそろえる。
 */
export async function seedManualData(browser: Browser) {
  const page = await browser.newPage();
  const statements: string[] = [];
  const objects: { key: string; bytes: Uint8Array }[] = [];
  const fakeDb = {
    run(q: string, params: unknown[] = []) {
      const t = q.trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(t)) return fakeDb;
      if (/^INSERT INTO staff_users/i.test(t)) return fakeDb;
      statements.push(`${inline(t, params)};`);
      return fakeDb;
    },
    exec() {
      return [{ columns: ['n'], values: [[0]] }];
    },
  };
  await seedDemo(fakeDb as never, {
    now: MANUAL_START,
    hashPassword: async () => 'unused',
    makeDogPhoto: (variant, kind) =>
      kind === 'photo' ? svgToJpeg(page, dogSvg(variant, kind), 640, 480) : svgToJpeg(page, dogSvg(variant, kind), 240, 240),
    makeCardBackground: () => svgToJpeg(page, dogSvg(3, 'photo'), 1200, 900),
    putMedia: async (key, bytes) => {
      objects.push({ key, bytes });
    },
    photoHouseholds: 12,
  });
  await page.close();

  // 写真の保存先(R2)に先に入れてから、データベースに書く
  await putObjects(objects);
  mkdirSync(WORK_DIR, { recursive: true });
  const file = path.join(WORK_DIR, 'seed.sql');
  writeFileSync(
    file,
    [
      ...statements,
      // e2e のアカウント(1 管理者・2 受付・3 製作者)の名前を、デモの名前にそろえる
      "UPDATE staff_users SET name = '田中' WHERE email = 'admin@example.com';",
      "UPDATE staff_users SET name = '佐藤' WHERE email = 'staff@example.com';",
      "UPDATE staff_users SET name = '山本' WHERE email = 'developer@example.com';",
    ].join('\n'),
  );
  await run('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/e2e', '--file', file, '--yes'], {
    cwd: API_DIR,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** データベースにもう初期データが入っているか(開発中に同じサーバーで何度も撮るとき用) */
export function alreadySeeded(): boolean {
  return (sql("SELECT COUNT(*) AS n FROM households WHERE member_no = 'DR-000001'")[0]?.n as number) > 0;
}

/**
 * 画面の時計と API の「いま」を manualNow() にそろえる。
 * API には x-debug-now を付ける(テストの環境だけで効く)。
 */
export async function useManualClock(context: BrowserContext) {
  await context.clock.install({ time: manualNow() });
  await context.route(/\/(admin\/)?api\//, async (route) => {
    await route.continue({ headers: { ...route.request().headers(), 'x-debug-now': manualNowHeader() } });
  });
}

/** お客さんのスマホ(iPhone 16)の画面 */
export async function phoneContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 393, height: 759 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/14.0.0',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  await useManualClock(context);
  return context;
}

/** 受付・管理画面(PC 1280×800) */
export async function desktopContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await useManualClock(context);
  return context;
}

type DogSpec = { name: string; breed: string; size: 'small' | 'medium' | 'large'; sex?: 'male' | 'female'; birthYm?: string; variant?: number };

/** API でお客さんを登録する(犬の写真は、デモと同じ犬の絵)。会員IDを返す */
export async function registerByApi(page: Page, user: string, dogs: DogSpec[]): Promise<string> {
  const headers = authHeaders(user);
  const breeds = ((await (await page.request.get('/api/breeds', { headers })).json()) as { breeds: { id: number; name: string }[] }).breeds;
  const res = await page.request.post('/api/register', {
    headers: { ...headers, 'x-debug-now': manualNowHeader() },
    data: {
      consent: true,
      dogs: dogs.map((d) => ({ name: d.name, breedId: breeds.find((b) => b.name === d.breed)!.id, size: d.size, sex: d.sex ?? null, birthYm: d.birthYm ?? null })),
      survey: [
        { questionId: 1, value: '40代' },
        { questionId: 2, value: '女性' },
        { questionId: 4, value: '知人の紹介' },
      ],
    },
  });
  if (res.status() !== 201) throw new Error(`登録に失敗: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { memberNo: string; dogs: { id: number; name: string }[] };
  for (const [i, d] of dogs.entries()) {
    if (d.variant === undefined) continue;
    const { photo, thumb } = await dogPhoto(page, d.variant);
    const up = await page.request.post(`/api/dogs/${body.dogs[i]!.id}/photo`, {
      headers: { ...headers, 'x-debug-now': manualNowHeader() },
      multipart: {
        photo: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo },
        thumb: { name: 'thumb.jpg', mimeType: 'image/jpeg', buffer: thumb },
      },
    });
    if (up.status() !== 200) throw new Error(`写真の登録に失敗: ${up.status()} ${await up.text()}`);
  }
  return body.memberNo;
}

/** 要素を画面の上のほうに出す(スクロールの入れ物が何でも効くよう、scrollIntoView を使う) */
export async function scrollToTop(locator: Locator, margin = 16) {
  await locator.evaluate((el, m) => {
    (el as HTMLElement).style.scrollMarginTop = `${m}px`;
    el.scrollIntoView({ block: 'start' });
  }, margin);
}
