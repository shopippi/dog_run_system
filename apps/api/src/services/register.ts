import { autoHouseholdName, formatMemberNo, normalizeForSearch, toJstIso } from '@dr/shared';
import type { LineUser } from '../env';
import { errors } from '../lib/errors';
import { nextHouseholdId } from './members';

export type HouseholdDraft = {
  dogNames: string[];
  postalCode?: string | null;
  referral?: string | null;
  transport?: string | null;
  ageGroup?: string | null;
  gender?: string | null;
};

/** おうちの登録と同じまとまりで実行する追加の書き込み(犬・アンケートなど) */
export type ExtraStatements = (ctx: { householdId: number; memberNo: string; nowIso: string }) => D1PreparedStatement[];

/**
 * おうちと最初の家族を作り、会員IDを発行する(C-01)。
 * 会員IDは「これまでの最大の番号 + 1」。同時に登録されて番号がぶつかったときは、番号を取り直してやり直す。
 * おうち・家族・犬・アンケートは1つのまとまり(D1 の batch)で書き込み、途中で失敗したら何も残さない。
 */
export async function registerHousehold(
  db: D1Database,
  now: Date,
  lineUser: LineUser,
  draft: HouseholdDraft,
  extra: ExtraStatements = () => [],
): Promise<{ householdId: number; memberNo: string; householdName: string }> {
  const nowIso = toJstIso(now);
  const householdName = autoHouseholdName(draft.dogNames);

  for (let attempt = 0; attempt < 5; attempt++) {
    const householdId = await nextHouseholdId(db);
    const memberNo = formatMemberNo(householdId);
    const statements = [
      db
        .prepare(
          `INSERT INTO households
             (id, member_no, display_name, display_name_search, display_name_auto, registered_at, source,
              postal_code, referral, transport, status, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, 'new', ?, ?, ?, 'active', ?)`,
        )
        .bind(
          householdId,
          memberNo,
          householdName,
          normalizeForSearch(householdName),
          nowIso,
          draft.postalCode ?? null,
          draft.referral ?? null,
          draft.transport ?? null,
          nowIso,
        ),
      db
        .prepare(
          `INSERT INTO family_members
             (household_id, line_user_id, line_display_name, line_display_name_search, age_group, gender,
              consented_at, joined_at, join_method, status, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'register', 'active', ?)`,
        )
        .bind(
          householdId,
          lineUser.userId,
          lineUser.displayName,
          normalizeForSearch(lineUser.displayName),
          draft.ageGroup ?? null,
          draft.gender ?? null,
          nowIso,
          nowIso,
          nowIso,
        ),
      ...extra({ householdId, memberNo, nowIso }),
    ];
    try {
      await db.batch(statements);
      return { householdId, memberNo, householdName };
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      if (/households\.(id|member_no)/.test(message)) continue; // 番号がぶつかった
      if (/family_members\.line_user_id/.test(message)) throw alreadyRegistered();
      throw e;
    }
  }
  throw errors.conflict('busy', '登録が混み合っています。少し待ってから、もう一度お試しください。');
}

export const alreadyRegistered = () =>
  errors.conflict('already_registered', 'このLINEアカウントは、すでに会員登録が済んでいます。画面を閉じて、もう一度開いてください。');
