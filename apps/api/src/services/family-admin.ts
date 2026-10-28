import { toJstIso, type ReceptionInvite, type Settings } from '@dr/shared';
import { errors } from '../lib/errors';
import { auditStatement } from './audit';
import { createInvite } from './invites';
import type { AuditRow, UndoContext } from './undo';

/** 受付で出す招待の URL。LIFF ID が設定されていれば LINE の URL、なければ同じドメインの /liff/ の URL */
export function inviteUrlFor(settings: Settings, code: string): string {
  return settings.liff_id ? `https://liff.line.me/${settings.liff_id}/invite/${code}` : `/liff/invite/${code}`;
}

/** 受付での家族の追加(A-06、5.2)。10分間(設定で変えられる)だけ使える招待を作る */
export async function createReceptionInvite(
  db: D1Database,
  args: { householdId: number; staffId: number; settings: Settings; now: Date },
): Promise<ReceptionInvite> {
  const ttlMinutes = args.settings.reception_invite_ttl_minutes;
  const inv = await createInvite(db, {
    householdId: args.householdId,
    kind: 'reception',
    staffId: args.staffId,
    now: args.now,
    ttl: { minutes: ttlMinutes },
  });
  await auditStatement(db, {
    staffId: args.staffId,
    action: 'family.invite',
    targetType: 'household',
    targetId: args.householdId,
    after: { expiresAt: inv.expiresAt },
    now: args.now,
  }).run();
  return { code: inv.code, url: inviteUrlFor(args.settings, inv.code), expiresAt: inv.expiresAt, ttlMinutes };
}

/**
 * 家族を外す(A-06、5.4)。ポイント・来場はおうちに残る。外れた人は新しいおうちとして登録し直せる。
 * おうちに残る最後の1人は外せない(退会の扱いにする)。
 */
export async function removeFamilyMember(
  db: D1Database,
  args: { householdId: number; memberId: number; staffId: number; now: Date },
): Promise<void> {
  const m = await db
    .prepare('SELECT id, household_id, line_display_name, status FROM family_members WHERE id = ?')
    .bind(args.memberId)
    .first<{ id: number; household_id: number; line_display_name: string | null; status: string }>();
  if (!m || m.household_id !== args.householdId) {
    throw errors.notFound('家族が見つかりませんでした。おうちの詳細を開き直してください。');
  }
  if (m.status !== 'active') {
    throw errors.conflict('member_not_active', 'この家族は、すでにおうちから外れています。画面を読み込み直してください。');
  }
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM family_members WHERE household_id = ? AND status = 'active'")
    .bind(args.householdId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) <= 1) {
    throw errors.conflict(
      'last_member',
      'おうちに残る最後の1人は外せません。おうちをやめる(退会する)ときは、製作者に相談してください。',
    );
  }
  const nowIso = toJstIso(args.now);
  const results = await db.batch([
    db
      .prepare("UPDATE family_members SET status = 'left', left_at = ?, updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(nowIso, nowIso, m.id),
    auditStatement(db, {
      staffId: args.staffId,
      action: 'family.remove',
      targetType: 'family_member',
      targetId: m.id,
      before: { status: 'active', name: m.line_display_name },
      after: { status: 'left' },
      undo: { memberId: m.id, householdId: args.householdId },
      now: args.now,
      onlyIf: { sql: "EXISTS (SELECT 1 FROM family_members WHERE id = ? AND status = 'left' AND left_at = ?)", args: [m.id, nowIso] },
    }),
  ]);
  if (results[0]!.meta.changes !== 1) {
    throw errors.conflict('member_not_active', 'この家族は、すでにおうちから外れています。画面を読み込み直してください。');
  }
}

const alreadyElsewhere = () =>
  errors.conflict(
    'member_elsewhere',
    'この家族は、すでに別のおうちに入っているため、戻せません。必要なら、受付の招待QRで家族に加え直してください。',
  );

/** 家族を外したのを元に戻す。本人がすでに別のおうちにいれば戻せない */
export async function undoFamilyRemove(db: D1Database, log: AuditRow, ctx: UndoContext): Promise<void> {
  const undo = JSON.parse(log.undo_info ?? '{}') as { memberId: number; householdId: number };
  const m = await db
    .prepare('SELECT id, household_id, line_user_id, status FROM family_members WHERE id = ?')
    .bind(undo.memberId)
    .first<{ id: number; household_id: number; line_user_id: string | null; status: string }>();
  if (!m) throw errors.notFound('家族が見つかりませんでした。画面を読み込み直してください。');
  if (m.status !== 'left') {
    throw errors.conflict('member_not_left', 'この家族は、外れた状態ではありません(退会した人は戻せません)。おうちの詳細で確かめてください。');
  }
  const h = await db.prepare('SELECT status FROM households WHERE id = ?').bind(m.household_id).first<{ status: string }>();
  if (h?.status !== 'active') {
    throw errors.conflict('household_inactive', 'このおうちは統合済みか退会済みのため、戻せません。製作者に相談してください。');
  }
  if (m.line_user_id) {
    const other = await db
      .prepare("SELECT id FROM family_members WHERE line_user_id = ? AND status = 'active' AND id <> ?")
      .bind(m.line_user_id, m.id)
      .first();
    if (other) throw alreadyElsewhere();
  }
  try {
    await db
      .prepare("UPDATE family_members SET status = 'active', left_at = NULL, updated_at = ? WHERE id = ? AND status = 'left'")
      .bind(toJstIso(ctx.now), m.id)
      .run();
  } catch (e) {
    if (/UNIQUE constraint failed: family_members/.test(String((e as Error)?.message))) throw alreadyElsewhere();
    throw e;
  }
}
