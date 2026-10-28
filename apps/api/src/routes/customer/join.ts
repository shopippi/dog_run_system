import {
  customerMergeSchema,
  inviteAcceptSchema,
  normalizeForSearch,
  toJstIso,
  type CustomerMergeResult,
  type InviteAcceptResult,
  type InviteInfo,
  type InviteMergeDog,
  type InviteMergePreview,
  type MergeDogPair,
  type MergeDogView,
  type MergeHouseholdView,
  type MergeNotice,
  type Settings,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { AppError, errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { parseJson } from '../../lib/validate';
import { ADMIN_MEDIA_BASE } from '../../services/admin-visits';
import { serveMedia } from '../../services/dogs';
import { findInvite, inviteStatus, type InviteRow } from '../../services/invites';
import { executeMerge, previewMerge } from '../../services/merges';
import { findActiveMember, type MemberContext } from '../../services/members';
import { pointBalance } from '../../services/points';
import { alreadyRegistered } from '../../services/register';
import { customAnswerStatements, loadVisibleQuestions, splitAnswers } from '../../services/survey';
import { MEDIA_BASE } from './media';

export const joinRoutes = new Hono<AppEnv>();

const inviteNotFound = () =>
  errors.notFound('招待が見つかりませんでした。ご家族に、もう一度招待を送ってもらってください。');

function viewerOf(member: MemberContext | null, inv: InviteRow): InviteInfo['viewer'] {
  if (!member) return 'new';
  return member.householdId === inv.household_id ? 'member' : 'other';
}

const inviteUsed = () =>
  errors.conflict('invite_used', 'この招待はもう使われています。ご家族に、もう一度招待を送ってもらってください。');
const inviteExpired = () =>
  errors.conflict('invite_expired', '招待の期限が切れています。ご家族に、もう一度招待を送ってもらってください。');

/** 招待を送った家族の LINE の表示名(受付で出した招待なら null) */
async function inviterNameOf(db: D1Database, inviteId: number): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT m.line_display_name AS name FROM invites i JOIN family_members m ON m.id = i.created_by_member_id
        WHERE i.id = ? AND m.line_display_name IS NOT NULL AND m.line_display_name <> ''`,
    )
    .bind(inviteId)
    .first<{ name: string }>();
  return row?.name ?? null;
}

/** 管理画面向けの写真の URL から、写真のキーを取り出す */
const mediaKeyOf = (url: string | null) => (url ? url.slice(`${ADMIN_MEDIA_BASE}/`.length) : null);

function mergeHousehold(h: MergeHouseholdView, dog: (d: MergeDogView) => InviteMergeDog) {
  return {
    memberNo: h.memberNo,
    displayName: h.displayName,
    points: h.points,
    tickets: h.tickets,
    visits: h.visits,
    family: h.family.map((f) => f.name),
    dogs: h.dogs.map(dog),
  };
}

/**
 * すでに別のおうちを持つ人が招待を開いたときの、まとめた後の下見(C-12、5.1)。
 * 計算は管理者の統合(A-07)と同じ services/merges.ts を使う。残るのは招待した側のおうち。
 * 写真は、招待した側は招待の写真の URL、自分の側は自分のおうちの写真の URL で返す(どちらも認証つき)。
 */
async function buildMergePreview(
  db: D1Database,
  inv: InviteRow,
  member: MemberContext,
  now: Date,
  settings: Settings,
): Promise<InviteMergePreview> {
  const p = await previewMerge(
    db,
    { keepHouseholdId: inv.household_id, absorbHouseholdId: member.householdId, dogPairs: [] },
    now,
    settings,
  );
  const theirs = mergeHousehold(p.kept, (d) => ({
    id: d.id,
    name: d.name,
    breedName: d.breedName,
    thumbUrl: d.thumbUrl ? `/api/invites/${inv.code}/photos/${d.id}` : null,
    hasPhoto: d.photoUrl !== null,
  }));
  const mine = mergeHousehold(p.absorbed, (d) => ({
    id: d.id,
    name: d.name,
    breedName: d.breedName,
    thumbUrl: d.thumbUrl ? `${MEDIA_BASE}/${mediaKeyOf(d.thumbUrl)}` : null,
    hasPhoto: d.photoUrl !== null,
  }));
  return {
    theirs,
    mine,
    movingFamily: p.absorbed.family.filter((f) => f.id !== member.memberId).map((f) => f.name),
    result: {
      memberNo: p.result.memberNo,
      displayName: p.result.displayName,
      points: p.result.points,
      tickets: p.result.tickets,
      ticketsIssued: p.result.ticketsIssued,
      visits: p.result.visits,
      family: p.result.family.map((f) => f.name),
    },
  };
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
  const merge =
    viewer === 'other' && member && status === 'valid'
      ? await buildMergePreview(db, inv, member, c.get('now'), await loadSettings(db))
      : null;
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
    inviterName: await inviterNameOf(db, inv.id),
    merge,
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

// 招待を受けて参加する(C-12)。別のおうちがある人は、参加ではなく「まとめる」(POST /invites/:code/merge)に進む(5.1)
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
  if (status === 'used') throw inviteUsed();
  if (status === 'expired') throw inviteExpired();
  if (viewer === 'other') {
    throw errors.conflict(
      'use_merge',
      'このLINEは、すでに別のおうちで会員証を使っています。招待を開き直して、「まとめる」から2つのおうちを一つにしてください。',
    );
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
  if (results[0]!.meta.changes !== 1) throw inviteUsed();
  const body: InviteAcceptResult = { result: 'joined', memberNo: inv.member_no, householdName: inv.household_name };
  return c.json(body, 201);
});

/**
 * 招待を開いた人が、本人の確認だけで2つのおうちをまとめる(C-12、5.1・5.3)。
 * 招待を送ったことを、招待した側の同意とみなす。残るのは招待した側のおうち(会員ID)。
 * 実行は管理者の統合(A-07)と同じ services/merges.ts の処理で、操作ログにはお客さんの操作として残す。
 * 元に戻すのは、管理者が30日以内に操作ログ(またはおうちの統合の記録)から。
 */
joinRoutes.post('/invites/:code/merge', async (c) => {
  const db = c.env.DB;
  const now = c.get('now');
  const input = await parseJson(c, customerMergeSchema);
  const inv = await findInvite(db, c.req.param('code'));
  if (!inv) throw inviteNotFound();
  const member = await findActiveMember(db, c.get('lineUser').userId);
  if (!member) {
    throw errors.conflict('not_registered', 'まだ会員証がありません。招待を開き直して、「参加する」から進んでください。');
  }
  if (member.householdId === inv.household_id) {
    throw errors.conflict('already_member', `すでに${inv.household_name}の家族です。会員証を開いてください。`);
  }
  if (inv.household_status === 'merged') throw alreadyMerged();
  if (inv.household_status !== 'active') throw notActive();
  const status = inviteStatus(inv, now);
  if (status === 'used') throw inviteUsed();
  if (status === 'expired') throw inviteExpired();

  // 自分のワンちゃんごとの「同じ子」を、管理者の統合と同じ組み合わせの形にする。
  // 名前と犬種は招待した側のまま(残るおうちの子)。写真は選んだ方。選んだ方に写真がなければ、写真がある方を残す
  const dogsOf = async (householdId: number) => {
    const { results } = await db
      .prepare("SELECT id, photo_key FROM dogs WHERE household_id = ? AND status = 'active'")
      .bind(householdId)
      .all<{ id: number; photo_key: string | null }>();
    return new Map(results.map((d) => [d.id, d.photo_key !== null]));
  };
  const [mine, theirs] = await Promise.all([dogsOf(member.householdId), dogsOf(inv.household_id)]);
  const pairs: MergeDogPair[] = [];
  for (const d of input.dogs) {
    if (!mine.has(d.dogId) || (d.sameAs !== null && !theirs.has(d.sameAs))) throw dogsChanged();
    if (d.sameAs === null) continue;
    let photo: 'keep' | 'absorb' = d.keepPhoto === 'mine' ? 'absorb' : 'keep';
    if (photo === 'absorb' && !mine.get(d.dogId) && theirs.get(d.sameAs)) photo = 'keep';
    if (photo === 'keep' && !theirs.get(d.sameAs) && mine.get(d.dogId)) photo = 'absorb';
    pairs.push({ keep: d.sameAs, absorb: d.dogId, take: 'keep', photo });
  }

  let merged;
  try {
    merged = await executeMerge(
      db,
      { keepHouseholdId: inv.household_id, absorbHouseholdId: member.householdId, dogPairs: pairs },
      { type: 'member', id: member.memberId, inviteId: inv.id },
      now,
      await loadSettings(db),
    );
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code === 'already_merged') throw alreadyMerged();
    if (e.code === 'not_active') throw notActive();
    if (e.status === 400) throw dogsChanged();
    if (e.code === 'merge_changed') {
      // 同時に2回押された・その間に招待が使われた、など。いまの状態に合わせて伝える
      const again = await findInvite(db, inv.code);
      if (again?.used_at) throw inviteUsed();
      throw errors.conflict(
        'merge_changed',
        'まとめる準備をしている間に、おうちの内容が変わりました。招待を開き直して、内容を確かめてからもう一度押してください。',
      );
    }
    throw e;
  }
  const body: CustomerMergeResult = {
    memberNo: merged.memberNo,
    householdName: merged.displayName,
    points: merged.points,
    tickets: merged.tickets,
    ticketsIssued: merged.ticketsIssued,
  };
  return c.json(body, 201);
});

const alreadyMerged = () =>
  errors.conflict('already_merged', 'このおうちはすでにほかのおうちとまとめられています。受付にご相談ください。');
const notActive = () =>
  errors.conflict('not_active', '退会しているおうちとは、まとめられません。受付にご相談ください。');
const dogsChanged = () =>
  errors.badRequest('ワンちゃんの登録が変わりました。招待を開き直して、同じ子を選び直してください。');

/**
 * 「おうちが一つになりました」のお知らせ(C-12)。
 * まとめられた側の家族(まとめた本人以外)に、次に会員証を開いたとき1回だけ出す。元に戻した統合のお知らせは出さない。
 */
joinRoutes.get('/merge-notice', async (c) => {
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT m.id AS merge_id, h.id AS household_id, h.member_no, h.display_name, a.member_no AS previous_member_no
         FROM family_members f
         JOIN merges m ON m.id = f.merge_notice_id
         JOIN households h ON h.id = f.household_id
         JOIN households a ON a.id = m.absorbed_household_id
        WHERE f.line_user_id = ? AND f.status = 'active' AND m.undone_at IS NULL AND h.status = 'active'`,
    )
    .bind(c.get('lineUser').userId)
    .first<{ merge_id: number; household_id: number; member_no: string; display_name: string; previous_member_no: string }>();
  const notice: MergeNotice | null = row
    ? {
        mergeId: row.merge_id,
        memberNo: row.member_no,
        householdName: row.display_name,
        previousMemberNo: row.previous_member_no,
        points: await pointBalance(db, row.household_id),
      }
    : null;
  return c.json({ notice });
});

// お知らせを見た(閉じた)
joinRoutes.post('/merge-notice/seen', async (c) => {
  await c.env.DB.prepare(
    "UPDATE family_members SET merge_notice_id = NULL WHERE line_user_id = ? AND status = 'active' AND merge_notice_id IS NOT NULL",
  )
    .bind(c.get('lineUser').userId)
    .run();
  return c.json({ ok: true });
});
