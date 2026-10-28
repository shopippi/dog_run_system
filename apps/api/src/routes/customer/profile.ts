import { decodeMultiAnswer, profilePatchSchema, toJstIso, type FixedSurveyKey, type ProfileResponse, type SurveyAnswerValue } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { parseJson } from '../../lib/validate';
import { requireMember, type MemberContext } from '../../services/members';
import { HOUSEHOLD_FIXED_COLUMNS, HOUSEHOLD_PROFILE_SELECT, MEMBER_FIXED_COLUMNS, fromHouseholdColumnValue } from '../../services/profile-fields';
import { customAnswerStatements, loadVisibleQuestions, splitAnswers } from '../../services/survey';

// C-09 プロフィール
export const profileRoutes = new Hono<AppEnv>();

/** 固定の質問の回答を入れている列(services/profile-fields.ts) */
const MEMBER_FIXED = MEMBER_FIXED_COLUMNS;
const HOUSEHOLD_FIXED = HOUSEHOLD_FIXED_COLUMNS;

async function loadProfile(db: D1Database, member: MemberContext): Promise<ProfileResponse> {
  const questions = await loadVisibleQuestions(db);
  const [self, household, answers] = await db.batch([
    db.prepare('SELECT age_group, gender FROM family_members WHERE id = ?').bind(member.memberId),
    db.prepare(`SELECT ${HOUSEHOLD_PROFILE_SELECT} FROM households WHERE id = ?`).bind(member.householdId),
    db
      .prepare(
        `SELECT question_id, answer FROM survey_answers WHERE member_id = ?
         UNION ALL SELECT question_id, answer FROM survey_answers WHERE household_id = ? AND member_id IS NULL`,
      )
      .bind(member.memberId, member.householdId),
  ]);
  const selfRow = (self!.results[0] ?? {}) as Record<string, string | null>;
  const householdRow = (household!.results[0] ?? {}) as Record<string, string | number | null>;
  const custom = new Map((answers!.results as { question_id: number; answer: string | null }[]).map((a) => [a.question_id, a.answer]));
  return {
    questions,
    answers: questions.map((q) => {
      let value: SurveyAnswerValue = null;
      if (q.fixedKey && q.fixedKey in MEMBER_FIXED) value = selfRow[q.fixedKey] ?? null;
      else if (q.fixedKey && q.fixedKey in HOUSEHOLD_FIXED) value = fromHouseholdColumnValue(q.fixedKey as FixedSurveyKey, householdRow[q.fixedKey]);
      else if (!q.fixedKey) {
        // 家族向けの質問は自分の回答、おうち向けの質問はおうちの回答。複数選択は配列にする
        const stored = custom.get(q.id) ?? null;
        value = q.kind === 'multi' ? (stored ? decodeMultiAnswer(stored) : null) : stored;
      }
      return { questionId: q.id, value };
    }),
  };
}

// 自分のアンケートの回答(C-09)
profileRoutes.get('/me/profile', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  return c.json(await loadProfile(c.env.DB, member));
});

// 回答の変更(C-09)。送った質問だけを変える。
// 固定の質問は登録のときと同じ確認(必須の質問は空にできない)。追加の質問は答えなくてもよい(7.2)。
profileRoutes.patch('/me/profile', async (c) => {
  const db = c.env.DB;
  const member = await requireMember(db, c.get('lineUser').userId);
  const { answers } = await parseJson(c, profilePatchSchema);
  const given = new Set(answers.map((a) => a.questionId));
  const questions = (await loadVisibleQuestions(db))
    .filter((q) => given.has(q.id))
    .map((q) => (q.fixedKey ? q : { ...q, required: false }));
  const split = splitAnswers(questions, answers, true);
  const nowIso = toJstIso(c.get('now'));

  const statements: D1PreparedStatement[] = [];
  const memberCols = Object.entries(split.member);
  if (memberCols.length > 0) {
    // 家族向けの固定の質問(年代・性別)は、自分の列
    statements.push(
      db
        .prepare(`UPDATE family_members SET ${memberCols.map(([col]) => `${col} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .bind(...memberCols.map(([, v]) => v), nowIso, member.memberId),
    );
  }
  const householdCols = Object.entries(split.household);
  if (householdCols.length > 0) {
    // おうち向けの固定の質問(郵便番号・きっかけ・来場手段・来たい時間帯など)は、おうちの列。家族みんなで共通
    statements.push(
      db
        .prepare(`UPDATE households SET ${householdCols.map(([col]) => `${col} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .bind(...householdCols.map(([, v]) => v), nowIso, member.householdId),
    );
  }
  // 追加の質問は survey_answers を上書きする
  statements.push(
    ...customAnswerStatements(
      db,
      split.custom,
      { memberIdSql: '?', memberIdArgs: [member.memberId], householdId: member.householdId },
      nowIso,
    ),
  );
  if (statements.length > 0) await db.batch(statements);
  return c.json(await loadProfile(db, member));
});
