import {
  DOG_SEX_LABELS,
  DOG_SIZE_LABELS,
  DOG_SOCIABILITY_LABELS,
  surveyAnswerText,
  EXPORTS,
  EXPORT_NAMES,
  LEDGER_KIND_LABELS,
  MIGRATION_SOURCE_LABELS,
  SURVEY_TARGET_LABELS,
  VISIT_METHOD_LABELS,
  exportQuerySchema,
  toJstDate,
  toJstIso,
  type DogSex,
  type DogSize,
  type DogSociability,
  type ExportName,
  type FixedSurveyKey,
  type LedgerKind,
  type MigrationSource,
  type SurveyTarget,
  type VisitMethod,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireRole } from '../../lib/staff-auth';
import { parseInput } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { toCsv, type CsvValue } from '../../services/csv';
import { HOUSEHOLD_FIXED_COLUMNS, householdColumnText } from '../../services/profile-fields';
import { surveyKindOf } from '../../services/survey';

// A-14 CSV出力(M-18)
// - おうち・家族・ワンちゃん・来場・ポイント台帳・アンケートの回答。列の見出しは日本語、値も画面と同じ言葉にする
// - LINE の表示名と個別のアンケートの回答を含むので、管理者だけ(受付スタッフは 403、製作者は見るだけなので出力できる)
// - 出力したことを操作ログに残す
// 注意: このファイルのルートは管理画面の API 全体に足されるので、use('*') で権限を付けない。ルートごとに付ける。
export const exportRoutes = new Hono<AppEnv>();

const HOUSEHOLD_STATUS: Record<string, string> = { active: '有効', merged: '統合済み', withdrawn: '退会' };
const SOURCE: Record<string, string> = { new: '新規', migration: '旧カードから移行' };
const MEMBER_STATUS: Record<string, string> = { active: '参加中', left: 'おうちから抜けた', withdrawn: '退会' };
const JOIN_METHOD: Record<string, string> = { register: '初回登録', invite: '家族の招待', reception: '受付で追加', merge: 'おうちの統合' };
const DOG_STATUS: Record<string, string> = { active: '登録中', retired: 'おやすみ中', merged: '統合済み' };
const label = (map: Record<string, string>, v: string | null | undefined) => (v == null ? '' : (map[v] ?? v));

type Period = { from?: string; to?: string };
type Table = { header: string[]; rows: CsvValue[][] };

async function households(db: D1Database, now: Date): Promise<Table> {
  const { results } = await db
    .prepare(
      `SELECT h.member_no, h.display_name, h.registered_at, h.source, h.status, m.member_no AS merged_into,
              h.postal_code, h.referral, h.transport, h.preferred_times, h.event_interests, h.uses_other_runs, h.wants_news,
              (SELECT COUNT(*) FROM family_members f WHERE f.household_id = h.id AND f.status = 'active') AS family,
              (SELECT COUNT(*) FROM dogs d WHERE d.household_id = h.id AND d.status = 'active') AS dogs,
              (SELECT COALESCE(SUM(p.delta), 0) FROM point_ledger p WHERE p.household_id = h.id) AS points,
              (SELECT COUNT(*) FROM tickets t WHERE t.household_id = h.id AND t.status = 'unused'
                  AND (t.expires_at IS NULL OR t.expires_at >= ?)) AS tickets,
              (SELECT COUNT(*) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL) AS visits,
              (SELECT MIN(v.visit_date) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL) AS first_visit,
              (SELECT MAX(v.visit_date) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL) AS last_visit
         FROM households h LEFT JOIN households m ON m.id = h.merged_into_id
        ORDER BY h.id`,
    )
    .bind(toJstIso(now))
    .all<Record<string, string | number | null>>();
  return {
    header: [
      '会員ID', 'おうちの呼び名', '登録日時', '登録のしかた', '状態', '統合先の会員ID', '郵便番号', '知ったきっかけ', '来場手段',
      '家族の人数', 'ワンちゃんの数', 'ポイント', '使える無料券', '来場回数', '最初の来場日', '最後の来場日',
      // 2026-10-28 に足した項目(担当J)。列は後ろに足す(前の列の位置を変えない)
      '来たい時間帯', '興味のあるイベント', 'ほかのドッグランの利用', 'お知らせの受け取り',
    ],
    rows: results.map((r) => [
      r.member_no, r.display_name, r.registered_at, label(SOURCE, r.source as string), label(HOUSEHOLD_STATUS, r.status as string),
      r.merged_into, r.postal_code, r.referral, r.transport, r.family, r.dogs, r.points, r.tickets, r.visits, r.first_visit, r.last_visit,
      householdColumnText('preferred_times', r.preferred_times), householdColumnText('event_interests', r.event_interests),
      householdColumnText('uses_other_runs', r.uses_other_runs), householdColumnText('wants_news', r.wants_news),
    ]),
  };
}

async function members(db: D1Database): Promise<Table> {
  const { results } = await db
    .prepare(
      `SELECT h.member_no, h.display_name, f.line_display_name, f.age_group, f.gender, f.joined_at, f.join_method, f.status, f.left_at
         FROM family_members f JOIN households h ON h.id = f.household_id
        ORDER BY h.id, f.id`,
    )
    .all<Record<string, string | null>>();
  return {
    header: ['会員ID', 'おうちの呼び名', 'LINEの名前', '年代', '性別', '参加日時', '参加のしかた', '状態', '抜けた日時'],
    rows: results.map((r) => [
      r.member_no, r.display_name, r.line_display_name, r.age_group, r.gender, r.joined_at,
      label(JOIN_METHOD, r.join_method), label(MEMBER_STATUS, r.status), r.left_at,
    ]),
  };
}

async function dogs(db: D1Database): Promise<Table> {
  const { results } = await db
    .prepare(
      `SELECT d.dog_no, h.member_no, h.display_name, d.name, COALESCE(d.breed_other, b.name) AS breed, d.size, d.sex, d.birth_ym,
              d.status, d.photo_key IS NOT NULL AS has_photo, d.created_at,
              d.weight_kg, d.sociability, d.rabies_vaccine_year, d.combo_vaccine_year,
              (SELECT COUNT(*) FROM visit_dogs vd JOIN visits v ON v.id = vd.visit_id
                WHERE vd.dog_id = d.id AND v.cancelled_at IS NULL) AS visits
         FROM dogs d JOIN households h ON h.id = d.household_id JOIN breeds b ON b.id = d.breed_id
        ORDER BY h.id, d.id`,
    )
    .all<Record<string, string | number | null>>();
  return {
    header: [
      '犬ID', '会員ID', 'おうちの呼び名', '名前', '犬種', 'サイズ', '性別', '生まれた年月', '状態', '写真', '登録日時', '来場回数',
      // 2026-10-28 に足した項目(担当J)。列は後ろに足す
      '体重(kg)', 'ほかの犬との相性', '狂犬病の予防注射の年', '混合ワクチンの年',
    ],
    rows: results.map((r) => [
      r.dog_no, r.member_no, r.display_name, r.name, r.breed, DOG_SIZE_LABELS[r.size as DogSize] ?? r.size,
      r.sex ? DOG_SEX_LABELS[r.sex as DogSex] : '', r.birth_ym, label(DOG_STATUS, r.status as string),
      r.has_photo ? 'あり' : 'なし', r.created_at, r.visits,
      r.weight_kg == null ? '' : Number(r.weight_kg).toFixed(1), r.sociability ? DOG_SOCIABILITY_LABELS[r.sociability as DogSociability] : '',
      r.rabies_vaccine_year, r.combo_vaccine_year,
    ]),
  };
}

/** 期間の条件(日付の列に対して) */
function periodWhere(column: string, p: Period): { sql: string; args: string[] } {
  const parts: string[] = [];
  const args: string[] = [];
  if (p.from) {
    parts.push(`${column} >= ?`);
    args.push(p.from);
  }
  if (p.to) {
    parts.push(`${column} <= ?`);
    args.push(p.to);
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
}

async function visits(db: D1Database, p: Period): Promise<Table> {
  const w = periodWhere('v.visit_date', p);
  const { results } = await db
    .prepare(
      `SELECT v.visit_date, v.checked_in_at, h.member_no, h.display_name, v.dog_count,
              (SELECT GROUP_CONCAT(d.name, '・') FROM visit_dogs vd JOIN dogs d ON d.id = vd.dog_id WHERE vd.visit_id = v.id) AS dog_names,
              v.used_ticket, v.method, f.line_display_name, s.name AS staff_name, v.cancelled_at, v.cancel_reason
         FROM visits v
         LEFT JOIN households h ON h.id = v.household_id
         LEFT JOIN family_members f ON f.id = v.checked_in_member_id
         LEFT JOIN staff_users s ON s.id = v.created_by_staff_id
        ${w.sql}
        ORDER BY v.visit_date, v.checked_in_at, v.id`,
    )
    .bind(...w.args)
    .all<Record<string, string | number | null>>();
  return {
    header: [
      '来場日', '時刻', '会員ID', 'おうちの呼び名', '頭数', '来たワンちゃん', '無料券', '登録のしかた', 'チェックインした家族',
      '入力したスタッフ', '取り消した日時', '取り消しの理由',
    ],
    rows: results.map((r) => [
      r.visit_date, String(r.checked_in_at).slice(11, 16), r.member_no, r.display_name, r.dog_count, r.dog_names,
      r.used_ticket ? '使った' : '', VISIT_METHOD_LABELS[r.method as VisitMethod] ?? r.method, r.line_display_name, r.staff_name,
      r.cancelled_at, r.cancel_reason,
    ]),
  };
}

async function ledger(db: D1Database, p: Period): Promise<Table> {
  const w = periodWhere('substr(p.created_at, 1, 10)', p);
  const { results } = await db
    .prepare(
      `SELECT p.created_at, h.member_no, h.display_name, p.delta, p.kind, p.reason, p.migration_source, p.expires_at,
              p.actor_type, s.name AS staff_name
         FROM point_ledger p
         JOIN households h ON h.id = p.household_id
         LEFT JOIN staff_users s ON p.actor_type = 'staff' AND s.id = p.actor_id
        ${w.sql}
        ORDER BY p.created_at, p.id`,
    )
    .bind(...w.args)
    .all<Record<string, string | number | null>>();
  const actor = (r: Record<string, string | number | null>) =>
    r.actor_type === 'member' ? 'お客さん' : r.actor_type === 'staff' ? (r.staff_name ?? 'スタッフ') : '自動';
  return {
    header: ['日時', '会員ID', 'おうちの呼び名', '増減', '種類', '理由', '旧カード', '有効期限', '操作した人'],
    rows: results.map((r) => [
      r.created_at, r.member_no, r.display_name, r.delta, LEDGER_KIND_LABELS[r.kind as LedgerKind] ?? r.kind, r.reason,
      r.migration_source ? MIGRATION_SOURCE_LABELS[r.migration_source as MigrationSource] : '', r.expires_at, actor(r),
    ]),
  };
}

async function survey(db: D1Database): Promise<Table> {
  const { results: questions } = await db
    .prepare('SELECT id, fixed_key, target, kind, multiple, label FROM survey_questions ORDER BY sort_order, id')
    .all<{ id: number; fixed_key: string | null; target: SurveyTarget; kind: 'choice' | 'text'; multiple: number; label: string }>();
  const labelOf = (key: string) => questions.find((q) => q.fixed_key === key)?.label ?? key;
  const { results: fixedMembers } = await db
    .prepare(
      `SELECT h.id AS hid, h.member_no, h.display_name, f.line_display_name, f.age_group, f.gender, f.joined_at
         FROM family_members f JOIN households h ON h.id = f.household_id ORDER BY h.id, f.id`,
    )
    .all<Record<string, string | number | null>>();
  const { results: fixedHouseholds } = await db
    .prepare(
      `SELECT id AS hid, member_no, display_name, postal_code, referral, transport, preferred_times, event_interests,
              uses_other_runs, wants_news, registered_at FROM households ORDER BY id`,
    )
    .all<Record<string, string | number | null>>();
  const { results: custom } = await db
    .prepare(
      `SELECT COALESCE(h.id, hf.id) AS hid, COALESCE(h.member_no, hf.member_no) AS member_no,
              COALESCE(h.display_name, hf.display_name) AS display_name, f.line_display_name,
              a.question_id, a.answer, a.skipped, a.answered_at
         FROM survey_answers a
         LEFT JOIN households h ON h.id = a.household_id
         LEFT JOIN family_members f ON f.id = a.member_id
         LEFT JOIN households hf ON hf.id = f.household_id
        ORDER BY a.id`,
    )
    .all<Record<string, string | number | null>>();

  type Out = { hid: number; order: number; row: CsvValue[] };
  const out: Out[] = [];
  const orderOf = (qid: number) => questions.findIndex((q) => q.id === qid);
  const push = (r: Record<string, string | number | null>, who: CsvValue, target: SurveyTarget, qLabel: string, answer: CsvValue, at: CsvValue, order: number) =>
    out.push({ hid: Number(r.hid), order, row: [r.member_no, r.display_name, who, SURVEY_TARGET_LABELS[target], qLabel, answer, at] });

  for (const r of fixedMembers) {
    for (const key of ['age_group', 'gender'] as const) {
      if (r[key]) push(r, r.line_display_name, 'member', labelOf(key), r[key], r.joined_at, questions.findIndex((q) => q.fixed_key === key));
    }
  }
  for (const r of fixedHouseholds) {
    for (const key of Object.keys(HOUSEHOLD_FIXED_COLUMNS) as FixedSurveyKey[]) {
      const text = householdColumnText(key, r[HOUSEHOLD_FIXED_COLUMNS[key]!]);
      if (text) push(r, 'おうち', 'household', labelOf(key), text, r.registered_at, questions.findIndex((q) => q.fixed_key === key));
    }
  }
  for (const r of custom) {
    const q = questions.find((x) => x.id === r.question_id);
    if (!q) continue;
    const answer = r.skipped ? '(答えない)' : surveyAnswerText(surveyKindOf(q), r.answer as string | null);
    push(r, q.target === 'member' ? r.line_display_name : 'おうち', q.target, q.label, answer, r.answered_at, orderOf(q.id));
  }
  out.sort((a, b) => a.hid - b.hid || a.order - b.order);
  return {
    header: ['会員ID', 'おうちの呼び名', '答えた人', '聞く相手', '質問', '回答', '回答日時'],
    rows: out.map((o) => o.row),
  };
}

// CSV を出力する。管理者だけ(製作者は見るだけなので出力できる)
exportRoutes.get('/export/:name', requireRole('admin'), async (c) => {
  const name = c.req.param('name') as ExportName;
  if (!EXPORT_NAMES.includes(name)) throw errors.notFound('その種類のCSVはありません。画面を読み込み直してください。');
  const db = c.env.DB;
  const now = c.get('now');
  const info = EXPORTS[name];
  const period: Period = info.period
    ? parseInput(exportQuerySchema, { from: c.req.query('from') || undefined, to: c.req.query('to') || undefined })
    : {};
  const table =
    name === 'households' ? await households(db, now)
    : name === 'members' ? await members(db)
    : name === 'dogs' ? await dogs(db)
    : name === 'visits' ? await visits(db, period)
    : name === 'ledger' ? await ledger(db, period)
    : await survey(db);

  await auditStatement(db, {
    staffId: c.get('staff').id,
    action: 'export.csv',
    targetType: 'export',
    targetId: name,
    after: { name: info.label, from: period.from ?? null, to: period.to ?? null, rows: table.rows.length },
    now,
  }).run();

  const stamp = toJstDate(now);
  const range = period.from || period.to ? `_${period.from ?? ''}〜${period.to ?? ''}` : '';
  const jpName = `${info.label}${range}_${stamp}.csv`;
  return new Response(toCsv(table.header, table.rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}_${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(jpName)}`,
      'cache-control': 'no-store',
    },
  });
});
