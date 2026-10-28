import { checkSurveyAnswers, type FixedSurveyKey, type SurveyAnswerInput, type SurveyQuestion } from '@dr/shared';
import { errors } from '../lib/errors';
import type { MemberContext } from './members';
import { HOUSEHOLD_FIXED_COLUMNS, MEMBER_FIXED_COLUMNS, toHouseholdColumnValue } from './profile-fields';

type QuestionRow = {
  id: number;
  fixed_key: FixedSurveyKey | null;
  target: SurveyQuestion['target'];
  kind: 'choice' | 'text';
  /** 1 なら「いくつでも選ぶ」(migrations/0007_profile.sql) */
  multiple: number;
  label: string;
  options: string;
  required: number;
};

/** データベースの kind と multiple を、画面と API の答え方(choice・multi・text)にする */
export const surveyKindOf = (r: { kind: string; multiple?: number | null }): SurveyQuestion['kind'] =>
  r.kind === 'choice' && r.multiple === 1 ? 'multi' : (r.kind as SurveyQuestion['kind']);

const toQuestion = (r: QuestionRow): SurveyQuestion => ({
  id: r.id,
  fixedKey: r.fixed_key,
  target: r.target,
  kind: surveyKindOf(r),
  label: r.label,
  options: JSON.parse(r.options) as string[],
  required: r.required === 1,
});

/** 表示する質問(並び順どおり) */
export async function loadVisibleQuestions(db: D1Database): Promise<SurveyQuestion[]> {
  const { results } = await db
    .prepare(
      'SELECT id, fixed_key, target, kind, multiple, label, options, required FROM survey_questions WHERE visible = 1 ORDER BY sort_order, id',
    )
    .all<QuestionRow>();
  return results.map(toQuestion);
}

/** 固定の質問の回答を保存する列(services/profile-fields.ts) */
const MEMBER_COLUMNS = MEMBER_FIXED_COLUMNS;
const HOUSEHOLD_COLUMNS = HOUSEHOLD_FIXED_COLUMNS;

export type SplitAnswers = {
  member: { age_group?: string | null; gender?: string | null };
  /** おうちの列に入れる値(はい・いいえは 1 / 0、複数選択は JSON の配列) */
  household: Record<string, string | number | null>;
  /** 管理者が追加した質問の回答 */
  custom: { question: SurveyQuestion; value: string | null }[];
};

/** 回答を確かめ、固定の質問(列に入れる)と追加の質問(survey_answers に入れる)に分ける。 */
export function splitAnswers(
  questions: SurveyQuestion[],
  answers: SurveyAnswerInput[],
  enforceRequired: boolean,
): SplitAnswers {
  const checked = checkSurveyAnswers(questions, answers, enforceRequired);
  if (!checked.ok) throw errors.badRequest(checked.message);
  const out: SplitAnswers = { member: {}, household: {}, custom: [] };
  for (const q of questions) {
    const v = checked.values.get(q.id) ?? null;
    if (q.fixedKey && MEMBER_COLUMNS[q.fixedKey]) {
      (out.member as Record<string, string | null>)[MEMBER_COLUMNS[q.fixedKey]!] = v;
    } else if (q.fixedKey && HOUSEHOLD_COLUMNS[q.fixedKey]) {
      out.household[HOUSEHOLD_COLUMNS[q.fixedKey]!] = toHouseholdColumnValue(q.fixedKey, v);
    } else if (!q.fixedKey) {
      out.custom.push({ question: q, value: v });
    }
  }
  return out;
}

/**
 * 追加の質問の回答を書き込む。家族向けの質問は家族に、おうち向けの質問はおうちに付ける。
 * 答えなかった質問も「答えない」として記録し、次から出さない(7.2)。
 */
export function customAnswerStatements(
  db: D1Database,
  custom: SplitAnswers['custom'],
  owner: { memberIdSql: string; memberIdArgs: unknown[]; householdId: number },
  nowIso: string,
): D1PreparedStatement[] {
  return custom.map(({ question, value }) => {
    if (question.target === 'member') {
      return db
        .prepare(
          `INSERT INTO survey_answers (question_id, member_id, answer, skipped, answered_at)
           VALUES (?, (${owner.memberIdSql}), ?, ?, ?)
           ON CONFLICT (question_id, member_id) WHERE member_id IS NOT NULL
           DO UPDATE SET answer = excluded.answer, skipped = excluded.skipped, answered_at = excluded.answered_at`,
        )
        .bind(question.id, ...owner.memberIdArgs, value, value === null ? 1 : 0, nowIso);
    }
    return db
      .prepare(
        `INSERT INTO survey_answers (question_id, household_id, answer, skipped, answered_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (question_id, household_id) WHERE household_id IS NOT NULL
         DO UPDATE SET answer = excluded.answer, skipped = excluded.skipped, answered_at = excluded.answered_at`,
      )
      .bind(question.id, owner.householdId, value, value === null ? 1 : 0, nowIso);
  });
}

/**
 * 登録済みの家族に、まだ出していない質問(7.2)。
 * 管理者が追加した質問のうち、本人(家族向け)またはおうち(おうち向け)がまだ回答も「答えない」もしていないもの。
 * 固定の家族向けの質問(年代・性別)は、まだ答えていなければ出す。
 */
export async function pendingQuestions(db: D1Database, member: MemberContext): Promise<SurveyQuestion[]> {
  const questions = await loadVisibleQuestions(db);
  const { results: answered } = await db
    .prepare(
      `SELECT question_id FROM survey_answers WHERE member_id = ?
       UNION SELECT question_id FROM survey_answers WHERE household_id = ?`,
    )
    .bind(member.memberId, member.householdId)
    .all<{ question_id: number }>();
  const done = new Set(answered.map((r) => r.question_id));
  const self = await db
    .prepare('SELECT age_group, gender FROM family_members WHERE id = ?')
    .bind(member.memberId)
    .first<{ age_group: string | null; gender: string | null }>();
  return questions.filter((q) => {
    if (q.fixedKey) {
      if (q.fixedKey === 'age_group') return !self?.age_group;
      if (q.fixedKey === 'gender') return !self?.gender;
      return false; // おうち向けの固定の質問は、登録のときに最初の1人が答える
    }
    return !done.has(q.id);
  });
}
