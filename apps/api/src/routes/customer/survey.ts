import { surveyAnswersSchema, toJstIso } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { parseJson } from '../../lib/validate';
import { findActiveMember, requireMember } from '../../services/members';
import { customAnswerStatements, loadVisibleQuestions, pendingQuestions, splitAnswers } from '../../services/survey';
import { z } from 'zod';

export const surveyRoutes = new Hono<AppEnv>();

// 質問の取得(C-03)。未登録の人には登録で聞く質問を、登録済みの人にはまだ出していない質問を返す。
surveyRoutes.get('/survey', async (c) => {
  const member = await findActiveMember(c.env.DB, c.get('lineUser').userId);
  const questions = member ? await pendingQuestions(c.env.DB, member) : await loadVisibleQuestions(c.env.DB);
  return c.json({ questions });
});

// 登録済みの家族の回答(C-03)。答えずに進んでもよい(7.2)。
surveyRoutes.post('/survey', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const { answers } = await parseJson(c, z.object({ answers: surveyAnswersSchema }));
  const questions = await pendingQuestions(c.env.DB, member);
  const split = splitAnswers(questions, answers, false);
  const nowIso = toJstIso(c.get('now'));
  const db = c.env.DB;
  const statements = customAnswerStatements(
    db,
    split.custom,
    { memberIdSql: '?', memberIdArgs: [member.memberId], householdId: member.householdId },
    nowIso,
  );
  for (const [col, value] of Object.entries(split.member)) {
    if (value) {
      statements.push(
        db.prepare(`UPDATE family_members SET ${col} = ?, updated_at = ? WHERE id = ?`).bind(value, nowIso, member.memberId),
      );
    }
  }
  if (statements.length > 0) await db.batch(statements);
  return c.json({ ok: true });
});
