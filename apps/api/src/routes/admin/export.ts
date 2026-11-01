import {
  BOOKING_SERVICE_LABELS,
  BOOKING_STATUS_LABELS,
  nightsOf,
  type BookingService,
  type BookingStatus,
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
import { csvPreamble, toCsv, type CsvColumn, type CsvValue } from '../../services/csv';
import { analysisHouseholds, analysisPack, resolveAnalysisPeriod } from '../../services/analysis-pack';
import { loadSettings } from '../../lib/settings';
import { ticketUsedOnVisitSql } from '../../services/tickets';
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
/** 表。columns は列の名前(日本語・単位つき)と意味(説明行に出す) */
type Table = { columns: CsvColumn[]; rows: CsvValue[][]; notes?: string[] };
const col = (name: string, desc: string): CsvColumn => ({ name, desc });

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
    columns: [
      col('会員ID', 'おうちの番号(DR-000001 の形)'),
      col('おうちの呼び名', '画面に出るおうちの名前'),
      col('登録日時', '会員IDを発行した日時(日本時間)'),
      col('登録のしかた', '新規 / 旧カードから移行'),
      col('状態', '有効 / 統合済み / 退会'),
      col('統合先の会員ID', 'ほかのおうちにまとめたときの、まとめ先'),
      col('郵便番号', 'お客さんが答えた郵便番号(7桁)'),
      col('知ったきっかけ', 'アンケートの回答'),
      col('来場手段', 'アンケートの回答'),
      col('家族の人数(人)', 'LINEでつながっている家族の数'),
      col('ワンちゃんの数(頭)', '登録中のワンちゃんの数(おやすみ中を除く)'),
      col('ポイント(ポイント)', 'いまのポイント(台帳の合計)'),
      col('使える無料券(枚)', '未使用で期限内の無料券'),
      col('来場回数(回)', 'これまでの来場の回数(取り消しを除く)'),
      col('最初の来場日', '取り消しを除いた最初の来場日'),
      col('最後の来場日', '取り消しを除いた最後の来場日'),
      // 2026-10-28 に足した項目(担当J)。列は後ろに足す(前の列の位置を変えない)
      col('来たい時間帯', 'アンケートの回答(いくつでも。・でつなぐ)'),
      col('興味のあるイベント', 'アンケートの回答(いくつでも。・でつなぐ)'),
      col('ほかのドッグランの利用', '使う / 使わない'),
      col('お知らせの受け取り', '受け取る / 受け取らない'),
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
    columns: [
      col('会員ID', 'おうちの番号'),
      col('おうちの呼び名', '画面に出るおうちの名前'),
      col('LINEの名前', 'LINEの表示名'),
      col('年代', 'アンケートの回答'),
      col('性別', 'アンケートの回答'),
      col('参加日時', 'おうちに加わった日時(日本時間)'),
      col('参加のしかた', '初回登録 / 家族の招待 / 受付で追加 / おうちの統合'),
      col('状態', '参加中 / おうちから抜けた / 退会'),
      col('抜けた日時', 'おうちから抜けた日時'),
    ],
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
    columns: [
      col('犬ID', 'ワンちゃんの番号(DR-000001-1 の形)'),
      col('会員ID', 'おうちの番号'),
      col('おうちの呼び名', '画面に出るおうちの名前'),
      col('名前', 'ワンちゃんの名前'),
      col('犬種', '登録の犬種(その他のときは入力した犬種)'),
      col('サイズ', '小型 / 中型 / 大型'),
      col('性別', 'オス / メス'),
      col('生まれた年月', '年-月'),
      col('状態', '登録中 / おやすみ中 / 統合済み'),
      col('写真', 'あり / なし'),
      col('登録日時', '登録した日時(日本時間)'),
      col('来場回数(回)', 'このワンちゃんが来た回数(取り消しを除く)'),
      // 2026-10-28 に足した項目(担当J)。列は後ろに足す
      col('体重(kg)', '登録の体重'),
      col('ほかの犬との相性', '得意 / ふつう / 苦手'),
      col('狂犬病の予防注射の年', '西暦'),
      col('混合ワクチンの年', '西暦'),
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
              ${ticketUsedOnVisitSql('v')} AS used_ticket, v.method, f.line_display_name, s.name AS staff_name, v.cancelled_at, v.cancel_reason
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
    columns: [
      col('来場日', '日本時間の日付'),
      col('時刻', 'チェックインした時刻(時:分)'),
      col('会員ID', 'おうちの番号(会員以外は空)'),
      col('おうちの呼び名', '画面に出るおうちの名前(会員以外は空)'),
      col('頭数(頭)', 'その来場のワンちゃんの数'),
      col('来たワンちゃん', '名前を・でつなぐ'),
      col('無料券', 'その来場で無料券を使ったら「使った」'),
      col('登録のしかた', 'ご本人 / 代理 / 会員以外の入力'),
      col('チェックインした家族', 'LINEの表示名'),
      col('入力したスタッフ', '代理・会員以外の入力をしたスタッフ'),
      col('取り消した日時', '取り消したときだけ'),
      col('取り消しの理由', '取り消したときだけ'),
    ],
    notes: ['取り消した来場も行として入っています(取り消した日時の列で見分けます)。'],
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
    columns: [
      col('日時', '増減した日時(日本時間)'),
      col('会員ID', 'おうちの番号'),
      col('おうちの呼び名', '画面に出るおうちの名前'),
      col('増減(ポイント)', '増えたら正の数、減ったら負の数'),
      col('種類', '来場 / 無料券と交換 / 取り消し / 移行 / 手動 / 統合 / 失効 など'),
      col('理由', '手動のときに入力した理由'),
      col('旧カード', '引き継ぎのときの移行元'),
      col('有効期限', 'そのポイントの期限'),
      col('操作した人', 'お客さん / スタッフの名前 / 自動'),
    ],
    notes: ['残高は、おうちごとに「増減(ポイント)」を合計した数です。'],
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
    columns: [
      col('会員ID', 'おうちの番号'),
      col('おうちの呼び名', '画面に出るおうちの名前'),
      col('答えた人', 'LINEの表示名(おうちごとの質問は「おうち」)'),
      col('聞く相手', '家族一人ひとり / おうちごと'),
      col('質問', '質問の文'),
      col('回答', '回答(答えないを選んだら「(答えない)」)'),
      col('回答日時', '答えた日時(日本時間)'),
    ],
    rows: out.map((o) => o.row),
  };
}

const BOOKING_SOURCE: Record<string, string> = { customer: 'お客さんがLINEから', staff: '受付で入力' };
const APPROVAL: Record<string, string> = { first_time: 'はじめてのワンちゃん', approve_all: 'すべて承認制' };

/** 預かり・お泊まりの予約(21章)。1つの予約で1行。期間は利用の初日で絞る */
async function bookings(db: D1Database, period: Period): Promise<Table> {
  const where: string[] = [];
  const args: string[] = [];
  if (period.from) {
    where.push('b.start_date >= ?');
    args.push(period.from);
  }
  if (period.to) {
    where.push('b.start_date <= ?');
    args.push(period.to);
  }
  const { results } = await db
    .prepare(
      `SELECT b.id, b.service, b.status, b.start_date, b.end_date, b.start_time, b.end_time, h.member_no, h.display_name,
              (SELECT GROUP_CONCAT(d.name || '(' || CASE bd.size WHEN 'small' THEN '小型' WHEN 'medium' THEN '中型' ELSE '大型' END || ')', '・')
                 FROM booking_dogs bd JOIN dogs d ON d.id = bd.dog_id WHERE bd.booking_id = b.id) AS dogs,
              (SELECT COUNT(*) FROM booking_dogs bd WHERE bd.booking_id = b.id) AS dog_count,
              (SELECT SUM(bd.first_time) FROM booking_dogs bd WHERE bd.booking_id = b.id) AS first_count,
              b.estimate_total, b.source, b.approval_reason, b.created_at, b.decided_at, b.cancelled_at, b.cancel_reason
         FROM bookings b JOIN households h ON h.id = b.household_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY b.start_date, b.id`,
    )
    .bind(...args)
    .all<Record<string, string | number | null>>();
  return {
    columns: [
      col('予約番号', '予約ごとの番号'),
      col('種類', '預かり / お泊まり'),
      col('状態', '確認待ち / 確定 / お断り / キャンセル / お預かり中 / 利用済み / 来なかった'),
      col('利用の初日', '預かりはその日、お泊まりはチェックインの日(日本時間)'),
      col('利用の最後の日', '預かりは同じ日、お泊まりはチェックアウトの日'),
      col('預ける時刻', '預かりは預ける時刻、お泊まりはチェックインの時刻'),
      col('お迎えの時刻', '預かりはお迎えの時刻、お泊まりはチェックアウトの時刻'),
      col('泊数(泊)', 'お泊まりの泊数(預かりは 0)'),
      col('会員ID', 'おうちの番号'),
      col('おうちの呼び名', '画面に出るおうちの名前'),
      col('ワンちゃん', '名前(サイズ)。・でつなぐ'),
      col('頭数(頭)', '予約したワンちゃんの数'),
      col('はじめての子(頭)', '予約したときに、預かりの経験がなかったワンちゃんの数'),
      col('料金の目安(円)', '予約したときの設定で計算した目安。実際のお支払いは受付'),
      col('受け付け方', 'お客さんがLINEから / 受付で入力'),
      col('確認待ちにした理由', 'はじめてのワンちゃん / すべて承認制(すぐ確定なら空欄)'),
      col('申し込んだ日時', '日本時間'),
      col('確定・お断りの日時', '日本時間'),
      col('キャンセルの日時', '日本時間'),
      col('キャンセルの理由', 'お客さんか受付が入れた理由'),
    ],
    rows: results.map((r) => [
      r.id,
      BOOKING_SERVICE_LABELS[r.service as BookingService],
      BOOKING_STATUS_LABELS[r.status as BookingStatus],
      r.start_date,
      r.end_date,
      r.start_time,
      r.end_time,
      nightsOf(r.service as BookingService, r.start_date as string, r.end_date as string),
      r.member_no,
      r.display_name,
      r.dogs,
      r.dog_count,
      r.first_count ?? 0,
      r.estimate_total,
      label(BOOKING_SOURCE, r.source as string),
      label(APPROVAL, r.approval_reason as string | null),
      r.created_at,
      r.decided_at,
      r.cancelled_at,
      r.cancel_reason,
    ]),
    notes: ['料金は目安です。実際のお支払いは受付で行い、この表には入っていません。'],
  };
}

// CSV を出力する。管理者だけ(製作者は見るだけなので出力できる)
// 先頭に「#」で始まる説明行(施設名・出力日時・期間・各列の意味・注意・使い方)を付ける。?plain=1 のときは付けない(docs/design.md 12.2)
exportRoutes.get('/export/:name', requireRole('admin'), async (c) => {
  const name = c.req.param('name') as ExportName;
  if (!EXPORT_NAMES.includes(name)) throw errors.notFound('その種類のCSVはありません。画面を読み込み直してください。');
  const db = c.env.DB;
  const now = c.get('now');
  const today = toJstDate(now);
  const info = EXPORTS[name];
  const plain = c.req.query('plain') === '1';
  let period: Period = info.period
    ? parseInput(exportQuerySchema, { from: c.req.query('from') || undefined, to: c.req.query('to') || undefined })
    : {};
  if (info.ai) period = await resolveAnalysisPeriod(db, period, today);
  const table: Table =
    name === 'analysis' ? await analysisPack(db, period as Required<Period>, today)
    : name === 'analysis_households' ? await analysisHouseholds(db, period as Required<Period>, today, now)
    : name === 'households' ? await households(db, now)
    : name === 'members' ? await members(db)
    : name === 'dogs' ? await dogs(db)
    : name === 'visits' ? await visits(db, period)
    : name === 'ledger' ? await ledger(db, period)
    : name === 'bookings' ? await bookings(db, period)
    : await survey(db);

  await auditStatement(db, {
    staffId: c.get('staff').id,
    action: 'export.csv',
    targetType: 'export',
    targetId: name,
    after: { name: info.label, from: period.from ?? null, to: period.to ?? null, rows: table.rows.length },
    now,
  }).run();

  const settings = await loadSettings(db);
  const periodText = info.period ? (period.from || period.to ? `${period.from ?? 'はじめ'}〜${period.to ?? today}` : 'すべての期間') : null;
  const preamble = plain
    ? []
    : csvPreamble({
        title: `${info.label}(CSV)`,
        facilityName: settings.facility_name,
        exportedAt: toJstIso(now),
        period: periodText,
        unit: info.desc.split('。')[0],
        columns: table.columns,
        notes: [
          ...(table.notes ?? []),
          ...(info.ai
            ? [
                '名前・LINEの名前・会員ID・郵便番号は入っていません。犬種の自由入力は「その他」にしています。',
                '「その日のメモ」「休業の理由」の列は、スタッフが書いた文のままです。お客さんの名前などが書かれていないか、AIに渡す前に確かめてください。',
              ]
            : ['名前やLINEの名前が入っています。ファイルは外に渡さないでください。']),
        ],
        usage: info.ai
          ? [
              'このCSVをそのままAIに渡し、『曜日と天気ごとの来場の傾向を教えて』と聞いてください。',
              '『イベントやメモのある日は、ふだんの日と比べて来場がどう違う?』『来月の土日の来場を予想して』なども聞けます。',
            ]
          : ['表計算ソフトで開くと、この説明は1列目に出ます。説明が要らないときは「説明行を付けない」を選んで出してください。'],
      });

  const stamp = today;
  const range = period.from || period.to ? `_${period.from ?? ''}〜${period.to ?? ''}` : '';
  const jpName = `${info.label}${range}_${stamp}.csv`;
  return new Response(
    toCsv(
      table.columns.map((x) => x.name),
      table.rows,
      preamble,
    ),
    {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}_${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(jpName)}`,
        'cache-control': 'no-store',
      },
    },
  );
});
