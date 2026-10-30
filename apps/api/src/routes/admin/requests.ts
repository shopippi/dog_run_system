import {
  MIGRATION_SOURCES,
  migrationInputSchema,
  rejectRequestSchema,
  toJstIso,
  type RequestMigrationView,
  type RequestHousehold,
  type RequestItem,
  type RequestListResponse,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { ADMIN_MEDIA_BASE } from '../../services/admin-visits';
import { auditStatement, latestAuditId } from '../../services/audit';
import { migrationStatus, recordMigration, undoMigration } from '../../services/migration';
import { registerUndo } from '../../services/undo';

// A-05 以前に届いた旧カードの移行の申請の確認(却下だけ)
// (旧カードの引き継ぎは受付で直接入力する形になった(16.1)。おうちをまとめるのは、お客さんが招待から自分でまとめる形になった(C-12)。
//  以前の申請の行は消さずに残す。「まとめる申請」(kind 'merge')は確認待ちに出さず、承認・却下もしない)
export const requestsRoutes = new Hono<AppEnv>();

/** 確認待ちに出す申請(以前の「まとめる申請」を除く) */
const SHOWN = "kind <> 'merge'";

// 確認待ちの件数(メニューの印)。管理者と製作者
requestsRoutes.get('/requests/count', requireRole('admin'), async (c) => {
  const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM requests WHERE status = 'pending' AND ${SHOWN}`).first<{ n: number }>();
  return c.json({ pending: row?.n ?? 0 });
});

type RequestRow = {
  id: number;
  kind: RequestItem['kind'];
  status: RequestItem['status'];
  household_id: number;
  related_household_id: number | null;
  payload: string;
  attachment_key: string | null;
  attachment_deleted_at: string | null;
  created_at: string;
  handled_at: string | null;
  handle_note: string | null;
  requester: string | null;
  handled_by: string | null;
};

/**
 * 旧カードの引き継ぎ申請(C-10)の payload を読む。形は { source: 'line_card' | 'paper_card', claimedPoints, note? }
 * (以前のお客さんの申請 C-10 の形。申請はもう作られない)。形が崩れていても一覧は出す
 */
export function parseMigrationPayload(raw: string): RequestMigrationView | null {
  try {
    const v = JSON.parse(raw) as { source?: unknown; claimedPoints?: unknown; note?: unknown };
    const source = MIGRATION_SOURCES.find((s) => s === v.source);
    if (!source) return null;
    const claimed = v.claimedPoints === null || v.claimedPoints === undefined ? NaN : Number(v.claimedPoints);
    return {
      source,
      claimedPoints: Number.isInteger(claimed) && claimed >= 0 ? claimed : null,
      ...(typeof v.note === 'string' && v.note ? { note: v.note.slice(0, 500) } : {}),
    };
  } catch {
    return null;
  }
}

async function loadHouseholds(db: D1Database, ids: number[]): Promise<Map<number, RequestHousehold>> {
  const map = new Map<number, RequestHousehold>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    const marks = chunk.map(() => '?').join(',');
    const [{ results: hs }, { results: dogs }, { results: balances }] = await Promise.all([
      db
        .prepare(
          `SELECT h.id, h.member_no, h.display_name, h.status, m.member_no AS merged_into
             FROM households h LEFT JOIN households m ON m.id = h.merged_into_id WHERE h.id IN (${marks})`,
        )
        .bind(...chunk)
        .all<{ id: number; member_no: string; display_name: string; status: RequestHousehold['status']; merged_into: string | null }>(),
      db
        .prepare(
          `SELECT d.household_id, d.id, d.name, COALESCE(d.breed_other, b.name) AS breed_name, d.thumb_key
             FROM dogs d JOIN breeds b ON b.id = d.breed_id
            WHERE d.household_id IN (${marks}) AND d.status = 'active' ORDER BY d.id`,
        )
        .bind(...chunk)
        .all<{ household_id: number; id: number; name: string; breed_name: string; thumb_key: string | null }>(),
      db
        .prepare(
          `SELECT household_id, COALESCE(SUM(delta), 0) AS balance FROM point_ledger
            WHERE household_id IN (${marks}) GROUP BY household_id`,
        )
        .bind(...chunk)
        .all<{ household_id: number; balance: number }>(),
    ]);
    for (const h of hs) {
      map.set(h.id, {
        id: h.id,
        memberNo: h.member_no,
        displayName: h.display_name,
        status: h.status,
        mergedIntoMemberNo: h.merged_into,
        dogs: dogs
          .filter((d) => d.household_id === h.id)
          .map((d) => ({
            id: d.id,
            name: d.name,
            breedName: d.breed_name,
            thumbUrl: d.thumb_key ? `${ADMIN_MEDIA_BASE}/${d.thumb_key}` : null,
          })),
        points: balances.find((b) => b.household_id === h.id)?.balance ?? 0,
      });
    }
  }
  return map;
}

// 確認待ちの一覧(A-05・A-08)。古い順。status=handled で処理済み(承認・却下)を新しい順に
requestsRoutes.get('/requests', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const handled = c.req.query('status') === 'handled';
  const { results } = await db
    .prepare(
      `SELECT r.id, r.kind, r.status, r.household_id, r.related_household_id, r.payload, r.attachment_key,
              r.attachment_deleted_at, r.created_at, r.handled_at, r.handle_note,
              m.line_display_name AS requester, s.name AS handled_by
         FROM requests r
         LEFT JOIN family_members m ON m.id = r.requester_member_id
         LEFT JOIN staff_users s ON s.id = r.handled_by_staff_id
        WHERE ${handled ? "r.status <> 'pending'" : "r.status = 'pending'"} AND r.${SHOWN}
        ORDER BY ${handled ? 'r.handled_at DESC, r.id DESC' : 'r.created_at, r.id'}
        LIMIT 200`,
    )
    .all<RequestRow>();
  const households = await loadHouseholds(
    db,
    results.flatMap((r) => (r.related_household_id ? [r.household_id, r.related_household_id] : [r.household_id])),
  );
  const pending = await db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE status = 'pending' AND ${SHOWN}`).first<{ n: number }>();
  const body: RequestListResponse = {
    pending: pending?.n ?? 0,
    pointsPerTicket: (await loadSettings(db)).points_per_ticket,
    requests: results.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      createdAt: r.created_at,
      household: households.get(r.household_id)!,
      related: r.related_household_id ? (households.get(r.related_household_id) ?? null) : null,
      requester: r.requester,
      migration: r.kind === 'migration' ? parseMigrationPayload(r.payload) : null,
      attachmentUrl: r.attachment_key && !r.attachment_deleted_at ? `${ADMIN_MEDIA_BASE}/${r.attachment_key}` : null,
      handledAt: r.handled_at,
      handledBy: r.handled_by,
      handleNote: r.handle_note,
    })),
  };
  return c.json(body);
});

type RequestRecord = {
  id: number;
  kind: RequestItem['kind'];
  status: RequestItem['status'];
  household_id: number;
  related_household_id: number | null;
  payload: string;
  created_at: string;
};

export async function findRequest(db: D1Database, id: number): Promise<RequestRecord> {
  const r = await db
    .prepare('SELECT id, kind, status, household_id, related_household_id, payload, created_at FROM requests WHERE id = ?')
    .bind(id)
    .first<RequestRecord>();
  // 以前の「まとめる申請」は、もう処理しない(見つからない扱い)
  if (!r || r.kind === 'merge') throw errors.notFound('申請が見つかりませんでした。確認待ちの画面を読み込み直してください。');
  return r;
}

export const requestHandled = () =>
  errors.conflict('request_handled', 'この申請は、すでに処理されています。確認待ちの画面を読み込み直してください。');

// 申請の却下(理由つき)。操作ログに残し、操作ログから元に戻せる(確認待ちに戻す)
requestsRoutes.post('/requests/:id/reject', requireRole('admin'), async (c) => {
  const { reason } = await parseJson(c, rejectRequestSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const staff = c.get('staff');
  const r = await findRequest(db, Number(c.req.param('id')) || 0);
  if (r.status !== 'pending') throw requestHandled();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE requests SET status = 'rejected', handled_by_staff_id = ?, handled_at = ?, handle_note = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .bind(staff.id, nowIso, reason, r.id),
    auditStatement(db, {
      staffId: staff.id,
      action: 'request.reject',
      targetType: 'request',
      targetId: r.id,
      before: { status: 'pending', kind: r.kind },
      after: { status: 'rejected' },
      reason,
      undo: { requestId: r.id },
      now,
      // 同時に2回押されても、記録は1回だけ
      onlyIf: {
        sql: `EXISTS (SELECT 1 FROM requests WHERE id = ? AND status = 'rejected' AND handled_at = ? AND handled_by_staff_id = ?)
              AND NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'request.reject' AND target_id = ? AND created_at = ?)`,
        args: [r.id, nowIso, staff.id, String(r.id), nowIso],
      },
    }),
  ]);
  if (results[0]!.meta.changes !== 1) throw requestHandled();
  return c.json({ ok: true });
});

// 申請の承認。旧カードの引き継ぎは対面だけになった(16.1)。以前に届いた引き継ぎの申請は承認せず、却下してから受付で入力してもらう
requestsRoutes.post('/requests/:id/approve', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const r = await findRequest(db, Number(c.req.param('id')) || 0);
  if (r.status !== 'pending') throw requestHandled();
  throw errors.conflict(
    'migration_in_person',
    '旧カードの引き継ぎは、受付で旧カードを確かめて入力する方法だけになりました。この申請は「却下する」で処理し、お客さんに受付で旧カードを見せてもらってください。',
  );
});

// 旧カードの移行の状態(引き継ぎ済みの移行元、いまのポイント、移行期間)
requestsRoutes.get('/households/:id/migration', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  return c.json(await migrationStatus(db, Number(c.req.param('id')) || 0, c.get('now'), await loadSettings(db)));
});

// 旧カードの移行の直接入力(受付で旧カードを見せてもらったときだけ。お客さんの申請はない。16.1)。
// 「旧カードを目で確かめた」「紙のカードは回収した(または使用済みの印を付けた)」の2つの印を必須にする(入力チェック)
requestsRoutes.post('/households/:id/migrate', requireRole('admin'), async (c) => {
  const input = await parseJson(c, migrationInputSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const householdId = Number(c.req.param('id')) || 0;
  const staffId = c.get('staff').id;
  const result = await recordMigration(db, {
    householdId,
    source: input.source,
    points: input.points,
    cardPoints: input.card_points,
    tickets: input.tickets,
    cardRef: input.card_ref,
    note: input.note,
    duplicateOk: input.duplicate_ok,
    lateReason: input.late_reason,
    staffId,
    now,
    settings: await loadSettings(db),
  });
  // 画面のトーストの「元に戻す」のために、操作ログの番号を返す
  const auditId = await latestAuditId(db, { action: 'household.migrate', targetType: 'household', targetId: householdId, staffId });
  return c.json({ ...result, auditId }, 201);
});

// 移行を元に戻す(操作ログ A-15 から)。発行した無料券が使われていれば戻せない
registerUndo('household.migrate', undoMigration);

// 却下を元に戻す(操作ログ A-15 から)。まだ却下のままなら、確認待ちに戻す
registerUndo('request.reject', async (db, log) => {
  const res = await db
    .prepare(
      `UPDATE requests SET status = 'pending', handled_by_staff_id = NULL, handled_at = NULL, handle_note = NULL
        WHERE id = ? AND status = 'rejected'`,
    )
    .bind(Number(log.target_id) || 0)
    .run();
  if (res.meta.changes !== 1) {
    throw errors.conflict(
      'request_changed',
      'この申請は、却下のあとに状態が変わったため、元に戻せません。確認待ちの画面で確かめてください。',
    );
  }
});
