import type { MeResponse, RegisterResponse } from '@dr/shared';
import { pointsToNextTicket, registerSchema, toJstDate } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';
import { parseJson } from '../../lib/validate';
import { findActiveMember, refreshDisplayName } from '../../services/members';
import { findVisitOn } from '../../services/checkins';
import { pointBalance, usableTickets } from '../../services/points';
import { ticketsUsedOn } from '../../services/tickets';
import { insertDogStatements, listHouseholdDogs, normalizeDogInputs } from '../../services/dogs';
import { alreadyRegistered, registerHousehold } from '../../services/register';
import { customAnswerStatements, loadVisibleQuestions, splitAnswers } from '../../services/survey';
import { MEDIA_BASE } from './media';
import { toCardBackgroundView } from '@dr/shared';
import { loadCardBackground } from '../../services/card-background';

export const meRoutes = new Hono<AppEnv>();

// 登録済みか、所属するおうち(C-01、C-06)
meRoutes.get('/me', async (c) => {
  const lineUser = c.get('lineUser');
  const member = await findActiveMember(c.env.DB, lineUser.userId);
  if (!member) {
    const settings = await loadSettings(c.env.DB);
    const body: MeResponse = {
      registered: false,
      lineDisplayName: lineUser.displayName,
      terms: { termsText: settings.terms_text, privacyText: settings.privacy_text },
    };
    return c.json(body);
  }
  const now = c.get('now');
  const db = c.env.DB;
  await refreshDisplayName(db, member, lineUser, now);
  const settings = await loadSettings(db);
  const balance = await pointBalance(db, member.householdId);
  const today = await findVisitOn(db, member.householdId, toJstDate(now));
  const usedToday = await ticketsUsedOn(db, member.householdId, toJstDate(now));
  // あとから足した任意のおうちの質問に、まだ1つも答えていないか(会員証に小さく「答える」を出すだけ。C-03)
  const optional = await db
    .prepare(
      `SELECT (preferred_times IS NULL AND event_interests IS NULL AND uses_other_runs IS NULL AND wants_news IS NULL) AS pending
         FROM households WHERE id = ?`,
    )
    .bind(member.householdId)
    .first<{ pending: number }>();
  const body: MeResponse = {
    registered: true,
    member: { id: member.memberId, lineDisplayName: member.lineDisplayName },
    household: { memberNo: member.memberNo, displayName: member.householdName },
    optionalSurveyPending: optional?.pending === 1,
    cardBackground: toCardBackgroundView(await loadCardBackground(db, member.householdId), MEDIA_BASE),
    card: {
      dogs: await listHouseholdDogs(db, member.householdId, MEDIA_BASE),
      balance,
      pointsPerTicket: settings.points_per_ticket,
      toNextTicket: pointsToNextTicket(balance, settings.points_per_ticket),
      tickets: await usableTickets(db, member.householdId, now),
      todayVisitId: today?.id ?? null,
      todayUsedTicketId: usedToday[0]?.id ?? null,
    },
  };
  return c.json(body);
});

// 初回登録。おうちと会員IDを作る(C-01)
meRoutes.post('/register', async (c) => {
  const lineUser = c.get('lineUser');
  const input = await parseJson(c, registerSchema);
  if (await findActiveMember(c.env.DB, lineUser.userId)) throw alreadyRegistered();
  const dogs = await normalizeDogInputs(c.env.DB, input.dogs);
  const survey = splitAnswers(await loadVisibleQuestions(c.env.DB), input.survey, true);
  const result = await registerHousehold(
    c.env.DB,
    c.get('now'),
    lineUser,
    { dogNames: dogs.map((d) => d.name), ...survey.member, ...survey.household },
    ({ householdId, memberNo, nowIso }) => [
      ...insertDogStatements(c.env.DB, householdId, memberNo, 1, dogs, nowIso),
      ...customAnswerStatements(
        c.env.DB,
        survey.custom,
        {
          memberIdSql: "SELECT id FROM family_members WHERE line_user_id = ? AND status = 'active'",
          memberIdArgs: [lineUser.userId],
          householdId,
        },
        nowIso,
      ),
    ],
  );
  const body: RegisterResponse = {
    memberNo: result.memberNo,
    householdName: result.householdName,
    dogs: await listHouseholdDogs(c.env.DB, result.householdId, MEDIA_BASE),
  };
  return c.json(body, 201);
});
