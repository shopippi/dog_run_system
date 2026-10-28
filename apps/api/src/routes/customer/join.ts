import { inviteAcceptSchema, normalizeForSearch, toJstIso, type InviteAcceptResult, type InviteInfo } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { parseJson } from '../../lib/validate';
import { serveMedia } from '../../services/dogs';
import { findInvite, inviteStatus, type InviteRow } from '../../services/invites';
import { findActiveMember, type MemberContext } from '../../services/members';
import { alreadyRegistered } from '../../services/register';
import { customAnswerStatements, loadVisibleQuestions, splitAnswers } from '../../services/survey';

export const joinRoutes = new Hono<AppEnv>();

const inviteNotFound = () =>
  errors.notFound('招待が見つかりませんでした。ご家族に、もう一度招待を送ってもらってください。');

function viewerOf(member: MemberContext | null, inv: InviteRow): InviteInfo['viewer'] {
  if (!member) return 'new';
  return member.householdId === inv.household_id ? 'member' : 'other';
}

// 招待の内容(C-12)。おうちの呼び名と犬の写真を見せる
joinRoutes.get('/invites/:code', async (c) => {
  const db = c.env.DB;
  const inv = await findInvite(db, c.req.param('code'));
  if (!inv) throw inviteNotFound();
  const member = await findActiveMember(db, c.get('lineUser').userId);
  const viewer = viewerOf(member, inv);
  const status = inviteStatus(inv, c.get('now'));
  const { results: dogs } = await db
    .prepare(
      `SELECT d.id, d.name, COALESCE(d.breed_other, b.name) AS breed_name, d.thumb_key
         FROM dogs d JOIN breeds b ON b.id = d.breed_id
        WHERE d.household_id = ? AND d.status = 'active' ORDER BY d.id`,
    )
    .bind(inv.household_id)
    .all<{ id: number; name: string; breed_name: string; thumb_key: string | null }>();
  const settings = viewer === 'new' ? await loadSettings(db) : null;
  const questions = viewer === 'new' ? (await loadVisibleQuestions(db)).filter((q) => q.target === 'member') : [];
  const body: InviteInfo = {
    status,
    householdName: inv.household_name,
    dogs: dogs.map((d) => ({
      id: d.id,
      name: d.name,
      breedName: d.breed_name,
      thumbUrl: d.thumb_key && status === 'valid' ? `/api/invites/${inv.code}/photos/${d.id}` : null,
    })),
    expiresAt: inv.expires_at,
    viewer,
    questions,
    terms: settings ? { termsText: settings.terms_text, privacyText: settings.privacy_text } : null,
  };
  return c.json(body);
});

// 招待の画面に出す犬の写真(一覧用の小さな写真だけ)。使える招待を持っている人だけが見られる
joinRoutes.get('/invites/:code/photos/:dogId', async (c) => {
  const db = c.env.DB;
  const inv = await findInvite(db, c.req.param('code'));
  if (!inv || inviteStatus(inv, c.get('now')) !== 'valid') throw errors.notFound('写真が見つかりませんでした。');
  const dog = await db
    .prepare("SELECT thumb_key FROM dogs WHERE id = ? AND household_id = ? AND status = 'active'")
    .bind(Number(c.req.param('dogId')) || 0, inv.household_id)
    .first<{ thumb_key: string | null }>();
  if (!dog?.thumb_key) throw errors.notFound('写真が見つかりませんでした。');
  return serveMedia(c.env.MEDIA, dog.thumb_key);
});

// 招待を受けて参加する(C-12)。別のおうちがある人は、まとめる申請を作る(5.1)
joinRoutes.post('/invites/:code/accept', async (c) => {
  const db = c.env.DB;
  const lineUser = c.get('lineUser');
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const input = await parseJson(c, inviteAcceptSchema);
  const inv = await findInvite(db, c.req.param('code'));
  if (!inv) throw inviteNotFound();
  const member = await findActiveMember(db, lineUser.userId);
  const viewer = viewerOf(member, inv);
  if (viewer === 'member') {
    throw errors.conflict('already_member', `すでに${inv.household_name}の家族です。会員証を開いてください。`);
  }
  const status = inviteStatus(inv, now);
  if (status === 'used') {
    throw errors.conflict('invite_used', 'この招待はもう使われています。ご家族に、もう一度招待を送ってもらってください。');
  }
  if (status === 'expired') {
    throw errors.conflict('invite_expired', '招待の期限が切れています。ご家族に、もう一度招待を送ってもらってください。');
  }

  if (viewer === 'other' && member) {
    // 別のおうちでポイントをためている人は、その場では参加させない。同じ犬の重複を、管理者が写真を見て整理するため
    const pending = await db
      .prepare(
        `SELECT id FROM requests WHERE kind = 'merge' AND status = 'pending'
            AND ((household_id = ?1 AND related_household_id = ?2) OR (household_id = ?2 AND related_household_id = ?1))`,
      )
      .bind(member.householdId, inv.household_id)
      .first<{ id: number }>();
    const statements: D1PreparedStatement[] = [];
    if (!pending) {
      statements.push(
        db
          .prepare(
            `INSERT INTO requests (kind, household_id, related_household_id, requester_member_id, payload, status, created_at)
             VALUES ('merge', ?, ?, ?, ?, 'pending', ?)`,
          )
          .bind(
            member.householdId,
            inv.household_id,
            member.memberId,
            JSON.stringify({ via: 'invite', inviteCode: inv.code, memberNo: member.memberNo, relatedMemberNo: inv.member_no }),
            nowIso,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          `UPDATE invites SET used_at = ?, used_by_member_id = ?,
                  request_id = ${pending ? '?' : 'last_insert_rowid()'}
            WHERE id = ? AND used_at IS NULL`,
        )
        .bind(...(pending ? [nowIso, member.memberId, pending.id, inv.id] : [nowIso, member.memberId, inv.id])),
    );
    await db.batch(statements);
    const body: InviteAcceptResult = { result: 'requested' };
    return c.json(body, 202);
  }

  // はじめての人: 同意と、本人のアンケート(年代・性別)だけで参加できる。犬の登録は要らない
  if (!input.consent) {
    throw errors.badRequest('利用規約とプライバシーポリシーへの同意が必要です。チェックを入れてください。');
  }
  const questions = (await loadVisibleQuestions(db)).filter((q) => q.target === 'member');
  const survey = splitAnswers(questions, input.survey, true);
  const joinMethod = inv.kind === 'reception' ? 'reception' : 'invite';
  let results: D1Result[];
  try {
    results = await db.batch([
      // 招待がまだ使われていないときだけ、家族を加える(同時に2人が開いても1人だけ)
      db
        .prepare(
          `INSERT INTO family_members
             (household_id, line_user_id, line_display_name, line_display_name_search, age_group, gender,
              consented_at, joined_at, join_method, status, updated_at)
           SELECT household_id, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?
             FROM invites WHERE id = ? AND used_at IS NULL AND expires_at >= ?`,
        )
        .bind(
          lineUser.userId,
          lineUser.displayName,
          normalizeForSearch(lineUser.displayName),
          survey.member.age_group ?? null,
          survey.member.gender ?? null,
          nowIso,
          nowIso,
          joinMethod,
          nowIso,
          inv.id,
          nowIso,
        ),
      db
        .prepare(
          `UPDATE invites SET used_at = ?1,
                  used_by_member_id = (SELECT id FROM family_members WHERE line_user_id = ?2 AND status = 'active')
            WHERE id = ?3 AND used_at IS NULL
              AND EXISTS (SELECT 1 FROM family_members WHERE line_user_id = ?2 AND status = 'active')`,
        )
        .bind(nowIso, lineUser.userId, inv.id),
      ...customAnswerStatements(
        db,
        survey.custom,
        {
          memberIdSql: "SELECT id FROM family_members WHERE line_user_id = ? AND status = 'active'",
          memberIdArgs: [lineUser.userId],
          householdId: inv.household_id,
        },
        nowIso,
      ),
    ]);
  } catch (e) {
    if (/family_members\.line_user_id/.test(String((e as Error)?.message))) throw alreadyRegistered();
    throw e;
  }
  if (results[0]!.meta.changes !== 1) {
    throw errors.conflict('invite_used', 'この招待はもう使われています。ご家族に、もう一度招待を送ってもらってください。');
  }
  const body: InviteAcceptResult = { result: 'joined', memberNo: inv.member_no, householdName: inv.household_name };
  return c.json(body, 201);
});
