import {
  DOG_PHOTO_KINDS,
  DOG_FIELD_LABELS,
  DOG_SEX_LABELS,
  DOG_SIZE_LABELS,
  DOG_STATUS_LABELS,
  adminDogPatchSchema,
  householdRenameSchema,
  manualPointsSchema,
  normalizeForSearch,
  toJstIso,
  type AdminDogDetail,
  type HouseholdDetail,
  type ManualPointsPreview,
  type ReceptionInvite,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { loadSettings } from '../../lib/settings';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { registerAuditDetail } from '../../services/audit-view';
import { ADMIN_MEDIA_BASE } from '../../services/admin-visits';
import {
  getAdminDogDetail,
  patchDog,
  photoAuditStatement,
  removeDogPhoto,
  requireEditableDog,
  undoDogPhoto,
  undoDogUpdate,
} from '../../services/admin-dogs';
import { getDog, refreshAutoNameStatement, saveDogPhoto, syncHouseholdSearchName } from '../../services/dogs';
import { getHouseholdRow, householdNotFound, loadHouseholdDetail } from '../../services/household-detail';
import { applyManualPoints, previewManualPoints, undoManualPoints } from '../../services/manual-points';
import { createReceptionInvite, removeFamilyMember, undoFamilyRemove } from '../../services/family-admin';
import { registerUndo } from '../../services/undo';

// A-02 おうちの詳細・呼び名の変更、A-03 ポイントの手動登録、A-04 犬の情報の変更、A-06 家族の追加・解除
export const householdDetailRoutes = new Hono<AppEnv>();

/** 変更できるおうち(統合済み・退会のおうちは変えない) */
async function requireActiveHousehold(db: D1Database, id: number) {
  const h = await getHouseholdRow(db, id);
  if (!h) throw householdNotFound();
  if (h.status !== 'active') {
    throw errors.conflict(
      'household_inactive',
      h.status === 'merged'
        ? 'このおうちは別のおうちにまとめられています。まとめた先のおうちを開いて操作してください。'
        : 'このおうちは退会しています。変更が必要なときは製作者に相談してください。',
    );
  }
  return h;
}

// ------------------------------------------------------------
// A-02 おうちの詳細(管理者。製作者は見るだけ)
// ------------------------------------------------------------
householdDetailRoutes.get('/households/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const body: HouseholdDetail = await loadHouseholdDetail(
    db,
    Number(c.req.param('id')),
    c.get('staff').role,
    await loadSettings(db),
    c.get('now'),
  );
  return c.json(body);
});

// 呼び名の変更。空にすると、犬の名前から自動で作る呼び名に戻す
householdDetailRoutes.patch('/households/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const { displayName } = await parseJson(c, householdRenameSchema);
  const h = await requireActiveHousehold(db, id);
  const now = c.get('now');
  const nowIso = toJstIso(now);
  const auto = displayName === '';
  if (auto ? h.display_name_auto === 1 : h.display_name_auto === 0 && h.display_name === displayName) {
    return c.json(await loadHouseholdDetail(db, id, c.get('staff').role, await loadSettings(db), now));
  }
  const statements: D1PreparedStatement[] = auto
    ? [
        db.prepare('UPDATE households SET display_name_auto = 1, updated_at = ? WHERE id = ?').bind(nowIso, id),
        refreshAutoNameStatement(db, id, nowIso),
      ]
    : [
        db
          .prepare('UPDATE households SET display_name = ?, display_name_search = ?, display_name_auto = 0, updated_at = ? WHERE id = ?')
          .bind(displayName, normalizeForSearch(displayName), nowIso, id),
      ];
  statements.push(
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'household.rename',
      targetType: 'household',
      targetId: id,
      before: { displayName: h.display_name, auto: h.display_name_auto === 1 },
      // 自動に戻したときの新しい呼び名は、書き込んだあとの値を記録する
      after: auto ? { auto: true } : { displayName, auto: false },
      undo: { householdId: id },
      now,
    }),
  );
  await db.batch(statements);
  await syncHouseholdSearchName(db, id);
  return c.json(await loadHouseholdDetail(db, id, c.get('staff').role, await loadSettings(db), now));
});

registerAuditDetail('household.rename', (b, a) => {
  if (!b) return null;
  const from = b.auto ? `「${b.displayName}」(自動)` : `「${b.displayName}」`;
  const to = a?.auto ? '犬の名前から自動で作る呼び名' : `「${a?.displayName}」`;
  return `${from} → ${to}`;
});

// 呼び名の変更を元に戻す。その後にまた呼び名を変えていたら戻せない
registerUndo('household.rename', async (db, log, ctx) => {
  const before = JSON.parse(log.before_value ?? '{}') as { displayName: string; auto: boolean };
  const after = JSON.parse(log.after_value ?? '{}') as { displayName?: string; auto: boolean };
  const id = Number(log.target_id);
  const h = await requireActiveHousehold(db, id);
  const same = after.auto ? h.display_name_auto === 1 : h.display_name_auto === 0 && h.display_name === after.displayName;
  if (!same) {
    throw errors.conflict(
      'changed_since',
      'このあとに呼び名がまた変えられているため、戻せません。おうちの詳細で呼び名を直してください。',
    );
  }
  const nowIso = toJstIso(ctx.now);
  await db.batch(
    before.auto
      ? [
          db.prepare('UPDATE households SET display_name_auto = 1, updated_at = ? WHERE id = ?').bind(nowIso, id),
          refreshAutoNameStatement(db, id, nowIso),
        ]
      : [
          db
            .prepare('UPDATE households SET display_name = ?, display_name_auto = 0, updated_at = ? WHERE id = ?')
            .bind(before.displayName, nowIso, id),
        ],
  );
  await syncHouseholdSearchName(db, id);
});

// ------------------------------------------------------------
// A-03 ポイント・無料券の手動登録(管理者)
// ------------------------------------------------------------

// 確定の前に、変更後の残高と無料券を見せる
householdDetailRoutes.post('/households/:id/points/preview', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const input = await parseJson(c, manualPointsSchema);
  await requireActiveHousehold(db, id);
  const body: ManualPointsPreview = await previewManualPoints(db, id, input, await loadSettings(db), c.get('now'));
  return c.json(body);
});

householdDetailRoutes.post('/households/:id/points', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const input = await parseJson(c, manualPointsSchema);
  await requireActiveHousehold(db, id);
  const body: ManualPointsPreview = await applyManualPoints(db, {
    householdId: id,
    input,
    staffId: c.get('staff').id,
    settings: await loadSettings(db),
    now: c.get('now'),
  });
  return c.json(body, 201);
});

registerAuditDetail('points.manual', (_b, a) => {
  if (!a) return null;
  const parts: string[] = [];
  if (a.points) parts.push(`ポイント ${a.points > 0 ? '+' : '−'}${Math.abs(a.points)}`);
  if (a.ticketDelta) parts.push(`無料券 ${a.ticketDelta > 0 ? '+' : '−'}${Math.abs(a.ticketDelta)}枚`);
  if (a.ticketsIssued) parts.push(`ポイントがたまって無料券を${a.ticketsIssued}枚発行`);
  return parts.join('、') || null;
});

registerUndo('points.manual', async (db, log, ctx) => undoManualPoints(db, log, ctx, await loadSettings(db)));

// ------------------------------------------------------------
// A-04 犬の情報の変更(管理者。製作者は見るだけ)
// ------------------------------------------------------------

// 犬の編集画面(M-07)の内容: 犬・おうち・選べる犬種・変更の履歴
householdDetailRoutes.get('/dogs/:id', requireRole('admin'), async (c) => {
  const body: AdminDogDetail = await getAdminDogDetail(c.env.DB, Number(c.req.param('id')));
  return c.json(body);
});

// 名前・犬種・サイズ・性別・生まれた年月・登録のおやすみと戻す操作。犬種とサイズは理由つきで履歴に残す(6.1)
householdDetailRoutes.patch('/dogs/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const patch = await parseJson(c, adminDogPatchSchema);
  await patchDog(db, id, patch, c.get('staff').id, c.get('now'));
  const body: AdminDogDetail = await getAdminDogDetail(db, id);
  return c.json(body);
});

// 写真の差し替え・回転。画面側で縮小(と回転)した JPEG を受け取る。前の写真は R2 に残し、元に戻せる
householdDetailRoutes.post('/dogs/:id/photo', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const dog = await requireEditableDog(db, id);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw errors.badRequest('写真を受け取れませんでした。写真を選び直して、もう一度お試しください。');
  }
  const kind = (DOG_PHOTO_KINDS as readonly string[]).includes(String(form.get('kind'))) ? String(form.get('kind')) : 'replace';
  const staffId = c.get('staff').id;
  const now = c.get('now');
  const saved = await saveDogPhoto(db, c.env.MEDIA, id, form, { type: 'staff', id: staffId }, now);
  await photoAuditStatement(db, {
    staffId,
    dogId: id,
    action: kind === 'rotate' ? 'dog.photo_rotate' : 'dog.photo',
    before: { photo: dog.photo_key, thumb: dog.thumb_key },
    after: { photo: saved.photoKey, thumb: saved.thumbKey },
    now,
  }).run();
  return c.json({ dog: await getDog(db, id, ADMIN_MEDIA_BASE) });
});

// 写真の削除(photo_key を空にする。R2 の写真は消さない)
householdDetailRoutes.delete('/dogs/:id/photo', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  await removeDogPhoto(db, id, c.get('staff').id, c.get('now'));
  return c.json({ dog: await getDog(db, id, ADMIN_MEDIA_BASE) });
});

const DOG_VALUE_TEXT: Record<string, (v: any) => string> = {
  name: (v) => v,
  breedName: (v) => v,
  size: (v) => DOG_SIZE_LABELS[v as keyof typeof DOG_SIZE_LABELS] ?? v,
  sex: (v) => (v ? (DOG_SEX_LABELS[v as keyof typeof DOG_SEX_LABELS] ?? v) : '未登録'),
  birthYm: (v) => (v ? `${String(v).slice(0, 4)}年${Number(String(v).slice(5, 7))}月` : '未登録'),
  status: (v) => DOG_STATUS_LABELS[v as keyof typeof DOG_STATUS_LABELS] ?? v,
};
const DOG_VALUE_LABEL: Record<string, string> = {
  name: DOG_FIELD_LABELS.name!,
  breedName: DOG_FIELD_LABELS.breed!,
  size: DOG_FIELD_LABELS.size!,
  sex: DOG_FIELD_LABELS.sex!,
  birthYm: DOG_FIELD_LABELS.birth_ym!,
  status: DOG_FIELD_LABELS.status!,
};
registerAuditDetail('dog.update', (b, a) => {
  if (!a) return null;
  return Object.keys(DOG_VALUE_LABEL)
    .filter((k) => k in a)
    .map((k) => `${DOG_VALUE_LABEL[k]}: ${DOG_VALUE_TEXT[k]!(b?.[k])} → ${DOG_VALUE_TEXT[k]!(a[k])}`)
    .join('、');
});
registerUndo('dog.update', undoDogUpdate);
registerUndo('dog.photo', undoDogPhoto);
registerUndo('dog.photo_rotate', undoDogPhoto);
registerUndo('dog.photo_remove', undoDogPhoto);

// ------------------------------------------------------------
// A-06 家族の追加・解除(管理者)
// ------------------------------------------------------------

// 受付での家族の追加。10分間だけ使える招待QRの URL を返す(5.2)
householdDetailRoutes.post('/households/:id/invite-qr', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  await requireActiveHousehold(db, id);
  const body: ReceptionInvite = await createReceptionInvite(db, {
    householdId: id,
    staffId: c.get('staff').id,
    settings: await loadSettings(db),
    now: c.get('now'),
  });
  return c.json(body, 201);
});

// 家族を外す(5.4)。最後の1人は外せない。操作ログから元に戻せる
householdDetailRoutes.delete('/households/:id/family/:fid', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  await requireActiveHousehold(db, id);
  await removeFamilyMember(db, { householdId: id, memberId: Number(c.req.param('fid')) || 0, staffId: c.get('staff').id, now: c.get('now') });
  return c.json({ ok: true });
});

registerAuditDetail('family.invite', () => '受付で招待のQRコードを表示');
registerUndo('family.remove', undoFamilyRemove);
