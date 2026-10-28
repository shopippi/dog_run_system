import {
  HOUSEHOLD_SOURCE_LABELS,
  HOUSEHOLD_STATUS_LABELS,
  JOIN_METHOD_LABELS,
  LEDGER_KIND_LABELS,
  MEMBER_STATUS_LABELS,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
  VISIT_METHOD_LABELS,
  pointsToNextTicket,
  surveyAnswerText,
  type FixedSurveyKey,
  type HouseholdDetail,
  type HouseholdSource,
  type HouseholdStatus,
  type JoinMethod,
  type LedgerKind,
  type MemberStatus,
  type Settings,
  type StaffRole,
  type SurveyAnswerView,
  type TicketStatus,
  type VisitMethod,
} from '@dr/shared';
import { errors } from '../lib/errors';
import { ADMIN_MEDIA_BASE, canSeePersonal } from './admin-visits';
import { listHouseholdDogs } from './dogs';
import { pointBalance, unusedTicketCount } from './points';
import { ticketUsedOnVisitSql } from './tickets';
import { HOUSEHOLD_FIXED_COLUMNS, householdColumnText } from './profile-fields';
import { surveyKindOf } from './survey';


export const householdNotFound = () => errors.notFound('おうちが見つかりませんでした。おうちを探す画面から、もう一度探してください。');

type HouseholdRow = {
  id: number;
  member_no: string;
  display_name: string;
  display_name_auto: number;
  registered_at: string;
  source: HouseholdSource;
  postal_code: string | null;
  referral: string | null;
  transport: string | null;
  /** 2026-10-28 に足したおうちへの質問の回答(担当J。services/profile-fields.ts) */
  preferred_times: string | null;
  event_interests: string | null;
  uses_other_runs: number | null;
  wants_news: number | null;
  status: HouseholdStatus;
  merged_into_id: number | null;
};

export async function getHouseholdRow(db: D1Database, id: number): Promise<HouseholdRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return db
    .prepare(
      `SELECT id, member_no, display_name, display_name_auto, registered_at, source, postal_code, referral, transport,
              preferred_times, event_interests, uses_other_runs, wants_news, status, merged_into_id
         FROM households WHERE id = ?`,
    )
    .bind(id)
    .first<HouseholdRow>();
}

/** おうちの詳細(A-02)。アンケートの回答と家族の年代・性別は、管理者と製作者だけに返す(3.2) */
export async function loadHouseholdDetail(
  db: D1Database,
  id: number,
  role: StaffRole,
  settings: Settings,
  now: Date,
): Promise<HouseholdDetail> {
  const h = await getHouseholdRow(db, id);
  if (!h) throw householdNotFound();
  const personal = canSeePersonal(role);

  const mergedInto = h.merged_into_id
    ? await db
        .prepare('SELECT id, member_no AS memberNo, display_name AS displayName FROM households WHERE id = ?')
        .bind(h.merged_into_id)
        .first<{ id: number; memberNo: string; displayName: string }>()
    : null;

  const { results: members } = await db
    .prepare(
      `SELECT id, line_display_name, age_group, gender, join_method, joined_at, status, left_at
         FROM family_members WHERE household_id = ? ORDER BY status = 'active' DESC, joined_at, id`,
    )
    .bind(id)
    .all<{
      id: number;
      line_display_name: string | null;
      age_group: string | null;
      gender: string | null;
      join_method: JoinMethod;
      joined_at: string;
      status: MemberStatus;
      left_at: string | null;
    }>();

  const { results: visitRows } = await db
    .prepare(
      `SELECT v.id, v.visit_date, v.checked_in_at, v.method, ${ticketUsedOnVisitSql('v')} AS used_ticket, v.cancelled_at, v.cancel_reason,
              m.line_display_name AS checked_in_by,
              (SELECT COALESCE(SUM(l.delta), 0) FROM point_ledger l WHERE l.visit_id = v.id AND l.kind = 'visit') AS points
         FROM visits v LEFT JOIN family_members m ON m.id = v.checked_in_member_id
        WHERE v.household_id = ?
        ORDER BY v.visit_date DESC, v.checked_in_at DESC, v.id DESC
        LIMIT 100`,
    )
    .bind(id)
    .all<{
      id: number;
      visit_date: string;
      checked_in_at: string;
      method: VisitMethod;
      used_ticket: number;
      cancelled_at: string | null;
      cancel_reason: string | null;
      checked_in_by: string | null;
      points: number;
    }>();
  const visitIds = visitRows.map((v) => v.id);
  const visitDogs = new Map<number, { id: number; name: string }[]>();
  if (visitIds.length) {
    const { results } = await db
      .prepare(
        `SELECT vd.visit_id, d.id, d.name FROM visit_dogs vd JOIN dogs d ON d.id = vd.dog_id
          WHERE vd.visit_id IN (${visitIds.map(() => '?').join(',')}) ORDER BY vd.id`,
      )
      .bind(...visitIds)
      .all<{ visit_id: number; id: number; name: string }>();
    for (const r of results) {
      const list = visitDogs.get(r.visit_id) ?? [];
      list.push({ id: r.id, name: r.name });
      visitDogs.set(r.visit_id, list);
    }
  }
  const visitCount = await db
    .prepare('SELECT COUNT(*) AS n FROM visits WHERE household_id = ? AND cancelled_at IS NULL')
    .bind(id)
    .first<{ n: number }>();

  const { results: ledger } = await db
    .prepare(
      `SELECT l.id, l.created_at, l.delta, l.kind, l.reason, l.actor_type,
              CASE l.actor_type WHEN 'staff' THEN s.name WHEN 'member' THEN m.line_display_name END AS actor_name
         FROM point_ledger l
         LEFT JOIN staff_users s ON l.actor_type = 'staff' AND s.id = l.actor_id
         LEFT JOIN family_members m ON l.actor_type = 'member' AND m.id = l.actor_id
        WHERE l.household_id = ?
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 200`,
    )
    .bind(id)
    .all<{ id: number; created_at: string; delta: number; kind: LedgerKind; reason: string | null; actor_type: string; actor_name: string | null }>();

  const { results: tickets } = await db
    .prepare(
      `SELECT id, issued_at, expires_at, status, source, used_at FROM tickets
        WHERE household_id = ? ORDER BY status = 'unused' DESC, issued_at DESC, id DESC`,
    )
    .bind(id)
    .all<{ id: number; issued_at: string; expires_at: string | null; status: TicketStatus; source: keyof typeof TICKET_SOURCE_LABELS; used_at: string | null }>();

  const balance = await pointBalance(db, id);
  return {
    id: h.id,
    memberNo: h.member_no,
    displayName: h.display_name,
    displayNameAuto: h.display_name_auto === 1,
    registeredAt: h.registered_at,
    status: h.status,
    statusLabel: HOUSEHOLD_STATUS_LABELS[h.status],
    sourceLabel: HOUSEHOLD_SOURCE_LABELS[h.source],
    mergedInto: mergedInto ?? null,
    balance,
    usableTickets: await unusedTicketCount(db, id, now),
    pointsPerTicket: settings.points_per_ticket,
    toNextTicket: pointsToNextTicket(Math.max(0, balance), settings.points_per_ticket),
    visitCount: visitCount?.n ?? 0,
    family: members.map((m) => ({
      id: m.id,
      name: m.line_display_name,
      ageGroup: personal ? m.age_group : null,
      gender: personal ? m.gender : null,
      joinMethodLabel: JOIN_METHOD_LABELS[m.join_method],
      joinedAt: m.joined_at,
      status: m.status,
      statusLabel: MEMBER_STATUS_LABELS[m.status],
      leftAt: m.left_at,
    })),
    dogs: await listHouseholdDogs(db, id, ADMIN_MEDIA_BASE, true),
    visits: visitRows.map((v) => ({
      id: v.id,
      date: v.visit_date,
      time: v.checked_in_at.slice(11, 16),
      dogs: visitDogs.get(v.id) ?? [],
      checkedInBy: v.checked_in_by,
      methodLabel: VISIT_METHOD_LABELS[v.method],
      points: v.points,
      usedTicket: v.used_ticket === 1,
      cancelled: v.cancelled_at !== null,
      cancelReason: v.cancel_reason,
    })),
    ledger: ledger.map((l) => ({
      id: l.id,
      at: l.created_at,
      delta: l.delta,
      kindLabel: LEDGER_KIND_LABELS[l.kind],
      reason: l.reason,
      actorName: l.actor_type === 'system' ? '自動処理' : l.actor_type === 'member' && l.actor_name ? `${l.actor_name}さん` : l.actor_name,
    })),
    tickets: tickets.map((t) => ({
      id: t.id,
      issuedAt: t.issued_at,
      expiresAt: t.expires_at,
      status: t.status,
      statusLabel: TICKET_STATUS_LABELS[t.status],
      sourceLabel: TICKET_SOURCE_LABELS[t.source],
      usedAt: t.used_at,
    })),
    survey: personal ? await loadSurvey(db, h, members.filter((m) => m.status === 'active')) : null,
  };
}

/** アンケートの回答。固定の質問は households / family_members の列、追加の質問は survey_answers から読む */
async function loadSurvey(
  db: D1Database,
  h: HouseholdRow,
  members: { id: number; line_display_name: string | null; age_group: string | null; gender: string | null }[],
): Promise<NonNullable<HouseholdDetail['survey']>> {
  const { results: questions } = await db
    .prepare('SELECT id, fixed_key, target, kind, multiple, label, visible FROM survey_questions ORDER BY sort_order, id')
    .all<{ id: number; fixed_key: string | null; target: 'member' | 'household'; kind: 'choice' | 'text'; multiple: number; label: string; visible: number }>();
  const memberIds = members.map((m) => m.id);
  const { results: answers } = await db
    .prepare(
      `SELECT question_id, member_id, household_id, answer FROM survey_answers
        WHERE household_id = ? ${memberIds.length ? `OR member_id IN (${memberIds.map(() => '?').join(',')})` : ''}`,
    )
    .bind(h.id, ...memberIds)
    .all<{ question_id: number; member_id: number | null; household_id: number | null; answer: string | null }>();
  const answerOf = (qid: number, owner: { memberId?: number; householdId?: number }) => {
    const a = answers.find(
      (x) => x.question_id === qid && (owner.memberId ? x.member_id === owner.memberId : x.household_id === owner.householdId),
    );
    return a ? { found: true, value: a.answer } : { found: false, value: null };
  };
  /** 回答を画面に出す文にする(複数選択は「・」でつなぐ) */
  const textOf = (q: { kind: 'choice' | 'text'; multiple: number }, v: string | null) => surveyAnswerText(surveyKindOf(q), v);
  // おうちへの固定の質問は、おうちの列(はい・いいえ・複数選択は文にする)
  const fixedHousehold: Record<string, string | null> = {};
  for (const [key, col] of Object.entries(HOUSEHOLD_FIXED_COLUMNS)) {
    fixedHousehold[key] = householdColumnText(key as FixedSurveyKey, (h as unknown as Record<string, string | number | null>)[col!]);
  }

  const household: SurveyAnswerView[] = [];
  for (const q of questions.filter((x) => x.target === 'household')) {
    if (q.fixed_key) {
      household.push({ label: q.label, answer: fixedHousehold[q.fixed_key] ?? null });
      continue;
    }
    const a = answerOf(q.id, { householdId: h.id });
    if (q.visible === 1 || a.found) household.push({ label: q.label, answer: textOf(q, a.value) });
  }
  return {
    household,
    members: members.map((m) => {
      const fixed: Record<string, string | null> = { age_group: m.age_group, gender: m.gender };
      const list: SurveyAnswerView[] = [];
      for (const q of questions.filter((x) => x.target === 'member')) {
        if (q.fixed_key) {
          list.push({ label: q.label, answer: fixed[q.fixed_key] ?? null });
          continue;
        }
        const a = answerOf(q.id, { memberId: m.id });
        if (q.visible === 1 || a.found) list.push({ label: q.label, answer: textOf(q, a.value) });
      }
      return { memberId: m.id, name: m.line_display_name, answers: list };
    }),
  };
}
