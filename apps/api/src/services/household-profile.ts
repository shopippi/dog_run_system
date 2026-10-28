import { toJstIso, type FixedSurveyKey, type HouseholdProfileResponse, type SurveyAnswerInput, type SurveyQuestion } from '@dr/shared';
import { errors } from '../lib/errors';
import { auditStatement } from './audit';
import {
  HOUSEHOLD_FIXED_COLUMNS,
  HOUSEHOLD_PROFILE_SELECT,
  fromHouseholdColumnValue,
  householdColumnText,
  type HouseholdProfileRow,
} from './profile-fields';
import { loadVisibleQuestions, splitAnswers } from './survey';
import type { AuditRow, UndoContext } from './undo';

// 管理者がおうちのアンケートの回答(おうちへの固定の質問)を見る・変える(A-02、M-06。担当J)。
// 郵便番号・知ったきっかけ・来場手段・来たい時間帯・興味のあるイベント・ほかのドッグラン・お知らせ。
// 変えた内容は操作ログに前後を残し、操作ログから元に戻せる。

/** 操作ログに出す、列の短い名前 */
export const HOUSEHOLD_PROFILE_LABELS: Record<string, string> = {
  postal_code: '郵便番号',
  referral: '知ったきっかけ',
  transport: '来場手段',
  preferred_times: '来たい時間帯',
  event_interests: '興味のあるイベント',
  uses_other_runs: 'ほかのドッグラン',
  wants_news: 'お知らせ',
};

const columnOf = (q: SurveyQuestion) => (q.fixedKey ? HOUSEHOLD_FIXED_COLUMNS[q.fixedKey] : undefined);

async function householdQuestions(db: D1Database): Promise<SurveyQuestion[]> {
  return (await loadVisibleQuestions(db)).filter((q) => q.target === 'household' && columnOf(q));
}

async function loadRow(db: D1Database, householdId: number): Promise<HouseholdProfileRow> {
  const row = await db.prepare(`SELECT ${HOUSEHOLD_PROFILE_SELECT} FROM households WHERE id = ?`).bind(householdId).first<HouseholdProfileRow>();
  if (!row) throw errors.notFound('おうちが見つかりませんでした。おうちを探す画面から、もう一度探してください。');
  return row;
}

export async function loadHouseholdProfile(db: D1Database, householdId: number): Promise<HouseholdProfileResponse> {
  const questions = await householdQuestions(db);
  const row = await loadRow(db, householdId);
  return {
    questions,
    answers: questions.map((q) => ({ questionId: q.id, value: fromHouseholdColumnValue(q.fixedKey!, row[columnOf(q)!]) })),
  };
}

/** 回答を変える。送った質問だけを変え、変わった列だけを操作ログに残す */
export async function patchHouseholdProfile(
  db: D1Database,
  args: { householdId: number; answers: SurveyAnswerInput[]; staffId: number; now: Date },
): Promise<void> {
  const all = await householdQuestions(db);
  const given = new Set(args.answers.map((a) => a.questionId));
  if ([...given].some((id) => !all.some((q) => q.id === id))) {
    throw errors.badRequest('おうちのアンケートの質問が変わりました。画面を読み込み直してから、もう一度変えてください。');
  }
  const questions = all.filter((q) => given.has(q.id));
  const split = splitAnswers(questions, args.answers, true);
  const row = await loadRow(db, args.householdId);
  const before: Record<string, string | number | null> = {};
  const after: Record<string, string | number | null> = {};
  for (const [col, value] of Object.entries(split.household)) {
    if ((row[col] ?? null) === (value ?? null)) continue;
    before[col] = row[col] ?? null;
    after[col] = value ?? null;
  }
  const cols = Object.keys(after);
  if (cols.length === 0) return;
  await db.batch([
    db
      .prepare(`UPDATE households SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...cols.map((c) => after[c]), toJstIso(args.now), args.householdId),
    auditStatement(db, {
      staffId: args.staffId,
      action: 'household.profile',
      targetType: 'household',
      targetId: args.householdId,
      before,
      after,
      undo: { householdId: args.householdId },
      now: args.now,
    }),
  ]);
}

/** 操作ログに出す説明(「来たい時間帯: 未回答 → 平日の昼・土日の午前」) */
export function describeHouseholdProfile(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string | null {
  if (!after) return null;
  const keyOf = (col: string) => Object.entries(HOUSEHOLD_FIXED_COLUMNS).find(([, c]) => c === col)?.[0] as FixedSurveyKey | undefined;
  const text = (col: string, v: unknown) => {
    const key = keyOf(col);
    return (key ? householdColumnText(key, v as string | number | null) : null) ?? '未回答';
  };
  return Object.keys(after)
    .map((col) => `${HOUSEHOLD_PROFILE_LABELS[col] ?? col}: ${text(col, before?.[col])} → ${text(col, after[col])}`)
    .join('、');
}

/** 元に戻す。そのあとに同じ項目がまた変えられていたら戻せない */
export async function undoHouseholdProfile(db: D1Database, log: AuditRow, ctx: UndoContext) {
  const before = JSON.parse(log.before_value ?? '{}') as Record<string, string | number | null>;
  const after = JSON.parse(log.after_value ?? '{}') as Record<string, string | number | null>;
  const id = Number(log.target_id);
  const row = await loadRow(db, id);
  const cols = Object.keys(after).filter((c) => Object.values(HOUSEHOLD_FIXED_COLUMNS).includes(c));
  if (cols.some((c) => (row[c] ?? null) !== (after[c] ?? null))) {
    throw errors.conflict(
      'changed_since',
      'このあとに同じ回答がまた変えられているため、戻せません。おうちの詳細の「おうちの回答を変える」で直してください。',
    );
  }
  if (cols.length === 0) return;
  await db
    .prepare(`UPDATE households SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((c) => before[c] ?? null), toJstIso(ctx.now), id)
    .run();
}
