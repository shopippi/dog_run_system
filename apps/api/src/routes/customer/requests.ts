import {
  MIGRATION_PHOTO_MAX_BYTES,
  MIGRATION_PHOTO_MAX_EDGE,
  MIGRATION_SOURCES,
  jpegSize,
  migrationFormToInput,
  migrationRequestSchema,
  toJstDate,
  toJstIso,
  type MigrationRequestItem,
  type MigrationRequestPayload,
  type MigrationRequestsResponse,
  type MigrationSource,
  type MigrationSourceState,
  type RequestStatus,
  type Settings,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { parseInput } from '../../lib/validate';
import { MERGED_HOUSEHOLDS_CTE } from '../../services/merged-households';
import { requireMember } from '../../services/members';

// C-10 旧カードの引き継ぎ申請
export const customerRequestRoutes = new Hono<AppEnv>();

type RequestRow = {
  id: number;
  payload: string;
  status: RequestStatus;
  created_at: string;
  handled_at: string | null;
};

function parsePayload(raw: string): MigrationRequestPayload | null {
  try {
    const p = JSON.parse(raw) as Partial<MigrationRequestPayload>;
    if (!p.source || !(MIGRATION_SOURCES as readonly string[]).includes(p.source)) return null;
    return { source: p.source, claimedPoints: p.claimedPoints ?? null, note: p.note ?? null };
  } catch {
    return null;
  }
}

/** 移行期間(settings.migration_period)。日付は "2026-11-01" の形(日時が入っていても日付の部分で比べる)。両端の日を含む */
function periodOf(settings: Settings, now: Date): MigrationRequestsResponse['period'] {
  const start = settings.migration_period.start ? settings.migration_period.start.slice(0, 10) : null;
  const end = settings.migration_period.end ? settings.migration_period.end.slice(0, 10) : null;
  const today = toJstDate(now);
  const notStarted = start !== null && today < start;
  const open = !notStarted && (!end || today <= end);
  return { start, end, open, notStarted };
}

const formatDay = (ymd: string) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}月${d}日`;
};

/** 自分のおうち(統合でまとめたおうちを含む)の申請と、移行元ごとの状態 */
async function loadState(db: D1Database, householdId: number) {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE ${MERGED_HOUSEHOLDS_CTE}
       SELECT id, payload, status, created_at, handled_at FROM requests
        WHERE kind = 'migration' AND household_id IN (SELECT id FROM hh)
        ORDER BY created_at DESC, id DESC`,
    )
    .bind(householdId)
    .all<RequestRow>();
  const requests: MigrationRequestItem[] = [];
  for (const r of results) {
    const p = parsePayload(r.payload);
    if (!p) continue;
    requests.push({ id: r.id, ...p, status: r.status, createdAt: r.created_at, handledAt: r.handled_at });
  }

  // 台帳の「旧カードから引き継ぎ」。申請の承認でも、受付での直接入力でも記録される(16.1)
  const { results: ledger } = await db
    .prepare(
      `WITH RECURSIVE ${MERGED_HOUSEHOLDS_CTE}
       SELECT migration_source AS source, SUM(delta) AS points, COUNT(*) AS n FROM point_ledger
        WHERE kind = 'migration' AND migration_source IS NOT NULL AND household_id IN (SELECT id FROM hh)
        GROUP BY migration_source`,
    )
    .bind(householdId)
    .all<{ source: MigrationSource; points: number; n: number }>();
  const migrated = new Map(ledger.map((l) => [l.source, l.points]));

  const sources: MigrationSourceState[] = MIGRATION_SOURCES.map((source) => {
    const mine = requests.filter((r) => r.source === source);
    const done = migrated.has(source) || mine.some((r) => r.status === 'approved');
    const state = done ? 'done' : mine.some((r) => r.status === 'pending') ? 'pending' : 'none';
    return { source, state, migratedPoints: migrated.get(source) ?? null };
  });
  return { requests, sources };
}

// 自分のおうちの申請の状態(C-10)
customerRequestRoutes.get('/requests', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const settings = await loadSettings(db);
  const body: MigrationRequestsResponse = {
    ...(await loadState(db, member.householdId)),
    period: periodOf(settings, c.get('now')),
  };
  return c.json(body);
});

// 旧カードの引き継ぎ申請(C-10)。旧カードの写真をつけて送り、管理者が確認して承認する(16.1、A-05)
customerRequestRoutes.post('/requests', async (c) => {
  const db = c.env.DB;
  const now = c.get('now');
  const member = await requireMember(db, c.get('lineUser').userId);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw errors.badRequest('送られた内容を読み取れませんでした。画面を読み込み直して、もう一度お試しください。');
  }
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' ? v : null;
  };
  const input = parseInput(
    migrationRequestSchema,
    migrationFormToInput({ source: text('source'), claimedPoints: text('claimedPoints'), note: text('note') }),
  );

  // 移行期間の外は受け付けない(未設定なら受け付ける)
  const period = periodOf(await loadSettings(db), now);
  if (!period.open) {
    if (period.notStarted && period.start) {
      throw errors.conflict(
        'migration_not_started',
        `旧カードの引き継ぎの申請は、まだ受け付けていません。${formatDay(period.start)}から申請できます。`,
      );
    }
    throw errors.conflict(
      'migration_closed',
      '旧カードの引き継ぎの申請の受付は終わりました。旧カードをお持ちのときは、受付にお知らせください。',
    );
  }

  // 移行元ごとに1おうち1回まで(16.1)
  const ensureNotDuplicated = async () => {
    const { sources } = await loadState(db, member.householdId);
    const s = sources.find((x) => x.source === input.source)!;
    if (s.state === 'pending') {
      throw errors.conflict('migration_pending', 'このカードは、すでに申請済みです。管理者の確認をお待ちください。');
    }
    if (s.state === 'done') {
      throw errors.conflict('migration_done', 'このカードは、すでに引き継ぎ済みです。もう一度申請する必要はありません。');
    }
  };
  await ensureNotDuplicated();

  // 旧カードの写真(必須)。スマホの中で縮小した JPEG だけを受け付ける
  const photo = form.get('photo');
  if (!(photo instanceof File) || photo.size === 0) {
    throw errors.badRequest('旧カードの写真がありません。「写真を撮る・選ぶ」から写真を付けてください。');
  }
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const size = jpegSize(bytes);
  if (!size) {
    throw errors.badRequest('写真の形式に対応していません。別の写真を選ぶか、カメラで撮り直してください。');
  }
  if (bytes.length > MIGRATION_PHOTO_MAX_BYTES || Math.max(size.width, size.height) > MIGRATION_PHOTO_MAX_EDGE) {
    throw errors.badRequest('写真が大きすぎます。画面を読み込み直して、もう一度写真を選んでください。');
  }

  const key = `requests/${member.memberNo}/${crypto.randomUUID()}.jpg`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });

  const payload: MigrationRequestPayload = { source: input.source, claimedPoints: input.claimedPoints, note: input.note };
  const nowIso = toJstIso(now);
  // 同時に2回押されても1件だけになるよう、確認待ちの同じ申請がないときだけ書き込む
  const result = await db
    .prepare(
      `INSERT INTO requests (kind, household_id, requester_member_id, payload, attachment_key, status, created_at)
       SELECT 'migration', ?1, ?2, ?3, ?4, 'pending', ?5
        WHERE NOT EXISTS (
          SELECT 1 FROM requests WHERE kind = 'migration' AND household_id = ?1 AND status IN ('pending', 'approved')
             AND json_extract(payload, '$.source') = ?6)`,
    )
    .bind(member.householdId, member.memberId, JSON.stringify(payload), key, nowIso, input.source)
    .run();
  if (result.meta.changes !== 1) {
    // 先に届いた申請があった。この写真はどこからも使われないので消す(申請のデータではない)
    await c.env.MEDIA.delete(key);
    await ensureNotDuplicated();
    throw errors.conflict('migration_pending', 'このカードは、すでに申請済みです。管理者の確認をお待ちください。');
  }

  const item: MigrationRequestItem = {
    id: result.meta.last_row_id,
    ...payload,
    status: 'pending',
    createdAt: nowIso,
    handledAt: null,
  };
  return c.json({ request: item }, 201);
});
