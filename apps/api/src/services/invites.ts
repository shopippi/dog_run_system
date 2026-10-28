import { addHours, addMinutes, toJstIso, type InviteKind } from '@dr/shared';

/** 招待コード。推測できないよう、ランダムな 16 バイトを URL に使える文字にする。 */
export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 家族の招待を作る(C-11、A-06)。
 * お客さん同士の招待は24時間、受付で出す招待は10分間有効で、どちらも1回だけ使える(5.1、5.2)。
 */
export async function createInvite(
  db: D1Database,
  args: {
    householdId: number;
    kind: InviteKind;
    memberId?: number | null;
    staffId?: number | null;
    now: Date;
    ttl: { hours: number } | { minutes: number };
  },
): Promise<{ code: string; expiresAt: string }> {
  const code = newInviteCode();
  const expires = 'hours' in args.ttl ? addHours(args.now, args.ttl.hours) : addMinutes(args.now, args.ttl.minutes);
  const expiresAt = toJstIso(expires);
  await db
    .prepare(
      `INSERT INTO invites (code, household_id, kind, created_by_member_id, created_by_staff_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(code, args.householdId, args.kind, args.memberId ?? null, args.staffId ?? null, toJstIso(args.now), expiresAt)
    .run();
  return { code, expiresAt };
}

export type InviteRow = {
  id: number;
  code: string;
  household_id: number;
  kind: InviteKind;
  expires_at: string;
  used_at: string | null;
  household_name: string;
  household_status: string;
  member_no: string;
};

export async function findInvite(db: D1Database, code: string): Promise<InviteRow | null> {
  return db
    .prepare(
      `SELECT i.id, i.code, i.household_id, i.kind, i.expires_at, i.used_at,
              h.display_name AS household_name, h.status AS household_status, h.member_no
         FROM invites i JOIN households h ON h.id = i.household_id
        WHERE i.code = ?`,
    )
    .bind(code)
    .first<InviteRow>();
}

export function inviteStatus(inv: InviteRow, now: Date): 'valid' | 'expired' | 'used' {
  if (inv.used_at) return 'used';
  // 招待したおうちが統合・退会でなくなった場合も、使えない
  if (inv.expires_at < toJstIso(now) || inv.household_status !== 'active') return 'expired';
  return 'valid';
}
