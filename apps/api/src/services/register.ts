import { autoHouseholdName, formatMemberNo, normalizeForSearch, toJstDate, toJstIso } from '@dr/shared';
import type { LineUser } from '../env';
import { errors } from '../lib/errors';
import { refreshDailyStatsQuietly } from './daily-stats';
import { nextHouseholdId } from './members';

export type HouseholdDraft = {
  dogNames: string[];
  /** おうちへの固定の質問の回答(列の名前 → 値。services/profile-fields.ts) */
  postal_code?: string | number | null;
  referral?: string | number | null;
  transport?: string | number | null;
  preferred_times?: string | number | null;
  event_interests?: string | number | null;
  uses_other_runs?: string | number | null;
  wants_news?: string | number | null;
  age_group?: string | null;
  gender?: string | null;
};

/** おうちの登録と同じまとまりで実行する追加の書き込み(犬・アンケートなど) */
export type ExtraStatements = (ctx: { householdId: number; memberNo: string; nowIso: string }) => D1PreparedStatement[];

/**
 * おうちと最初の家族を作り、会員IDを発行する(C-01)。
 * 会員IDは「これまでの最大の番号 + 1」。同時に登録されて番号がぶつかったときは、番号を取り直してやり直す。
 * 同時に N 件来ると、1回ごとに少なくとも1件は通るので、最悪 N 回やり直す。やり直しの回数(MAX_ATTEMPTS)は
 * 一度に来る登録の数より多くし、ぶつかった者どうしが同じ時に取り直さないよう、少しだけずらして待つ
 * (以前は5回までで、6件が同時に来ると最後の1件が「混み合っています」になることがあった)。
 * おうち・家族・犬・アンケートは1つのまとまり(D1 の batch)で書き込み、途中で失敗したら何も残さない。
 */
/** 会員IDがぶつかったときに、やり直す回数の上限 */
const MAX_ATTEMPTS = 30;

export async function registerHousehold(
  db: D1Database,
  now: Date,
  lineUser: LineUser,
  draft: HouseholdDraft,
  extra: ExtraStatements = () => [],
): Promise<{ householdId: number; memberNo: string; householdName: string }> {
  const nowIso = toJstIso(now);
  const householdName = autoHouseholdName(draft.dogNames);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const householdId = await nextHouseholdId(db);
    const memberNo = formatMemberNo(householdId);
    const statements = [
      db
        .prepare(
          `INSERT INTO households
             (id, member_no, display_name, display_name_search, display_name_auto, registered_at, source,
              postal_code, referral, transport, preferred_times, event_interests, uses_other_runs, wants_news,
              status, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, 'new', ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        )
        .bind(
          householdId,
          memberNo,
          householdName,
          normalizeForSearch(householdName),
          nowIso,
          draft.postal_code ?? null,
          draft.referral ?? null,
          draft.transport ?? null,
          draft.preferred_times ?? null,
          draft.event_interests ?? null,
          draft.uses_other_runs ?? null,
          draft.wants_news ?? null,
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
          draft.age_group ?? null,
          draft.gender ?? null,
          nowIso,
          nowIso,
          nowIso,
        ),
      ...extra({ householdId, memberNo, nowIso }),
    ];
    try {
      await db.batch(statements);
      // 新規おうち数(日ごとの集計)に入れる
      await refreshDailyStatsQuietly(db, toJstDate(now), now);
      return { householdId, memberNo, householdName };
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      if (/households\.(id|member_no)/.test(message)) {
        // 番号がぶつかった。少しずらしてから取り直す
        await new Promise((r) => setTimeout(r, Math.random() * 20));
        continue;
      }
      if (/family_members\.line_user_id/.test(message)) throw alreadyRegistered();
      throw e;
    }
  }
  throw errors.conflict('busy', '登録が混み合っています。少し待ってから、もう一度お試しください。');
}

export const alreadyRegistered = () =>
  errors.conflict('already_registered', 'このLINEアカウントは、すでに会員登録が済んでいます。画面を閉じて、もう一度開いてください。');
