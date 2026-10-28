import { breedCreateSchema, breedPatchSchema, orderSchema, type AdminBreed, type AdminBreedsResponse } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { registerAuditDetail } from '../../services/audit-view';
import { registerUndo } from '../../services/undo';

// A-11 犬種の選択肢の管理(M-12)
// - 削除はしない(非表示にする)。非表示にしても、すでに登録した犬の犬種はそのまま表示される(お客さんの選択肢から消えるだけ)
// - 「その他」(is_other)は非表示にできず、並び順は常に最後
// 注意: このファイルのルートは管理画面の API 全体に足されるので、use('*') で権限を付けない。ルートごとに付ける。
export const breedsRoutes = new Hono<AppEnv>();

type Row = { id: number; name: string; default_size: AdminBreed['defaultSize']; visible: number; is_other: number; sort_order: number };

async function listAll(db: D1Database): Promise<AdminBreed[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.name, b.default_size, b.visible, b.is_other,
              (SELECT COUNT(*) FROM dogs d WHERE d.breed_id = b.id AND d.status = 'active') AS dog_count
         FROM breeds b ORDER BY b.is_other, b.sort_order, b.id`,
    )
    .all<Row & { dog_count: number }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    defaultSize: r.default_size,
    visible: r.visible === 1,
    isOther: r.is_other === 1,
    dogCount: r.dog_count,
  }));
}

async function findBreed(db: D1Database, id: number): Promise<Row> {
  const row = await db
    .prepare('SELECT id, name, default_size, visible, is_other, sort_order FROM breeds WHERE id = ?')
    .bind(id)
    .first<Row>();
  if (!row) throw errors.notFound('その犬種が見つかりませんでした。画面を読み込み直してください。');
  return row;
}

async function assertNameFree(db: D1Database, name: string, exceptId = 0) {
  const same = await db
    .prepare('SELECT id, visible FROM breeds WHERE name = ? AND id <> ?')
    .bind(name, exceptId)
    .first<{ id: number; visible: number }>();
  if (same) {
    throw errors.conflict(
      'breed_exists',
      same.visible === 1
        ? `「${name}」はもう選択肢にあります。別の名前にしてください。`
        : `「${name}」は非表示の犬種にあります。一覧の「表示する」で選択肢に戻してください。`,
    );
  }
}

/** 「その他」を、ほかのどの犬種よりも後ろに置く */
const keepOtherLast = (db: D1Database) =>
  db.prepare(
    `UPDATE breeds SET sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 1000 FROM breeds WHERE is_other = 0)
      WHERE is_other = 1 AND sort_order <= (SELECT COALESCE(MAX(sort_order), 0) FROM breeds WHERE is_other = 0)`,
  );

/** 並び順を、ids の順に 10, 20, 30 … で振り直す書き込み */
const orderStatements = (db: D1Database, ids: number[]) =>
  ids.map((id, i) => db.prepare('UPDATE breeds SET sort_order = ? WHERE id = ? AND is_other = 0').bind((i + 1) * 10, id));

async function currentOrder(db: D1Database): Promise<number[]> {
  const { results } = await db
    .prepare('SELECT id FROM breeds WHERE is_other = 0 ORDER BY sort_order, id')
    .all<{ id: number }>();
  return results.map((r) => r.id);
}

// 犬種の一覧(非表示を含む)。管理者(製作者は見るだけ)
breedsRoutes.get('/breeds', requireRole('admin'), async (c) => {
  const body: AdminBreedsResponse = { breeds: await listAll(c.env.DB) };
  return c.json(body);
});

// 犬種を追加する。並び順は「その他」の直前(いちばん後ろ)
breedsRoutes.post('/breeds', requireRole('admin'), async (c) => {
  const input = await parseJson(c, breedCreateSchema);
  const db = c.env.DB;
  await assertNameFree(db, input.name);
  const now = c.get('now');
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO breeds (name, default_size, sort_order, visible, is_other)
         VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM breeds WHERE is_other = 0), 1, 0)`,
      )
      .bind(input.name, input.defaultSize),
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'breed.create',
      targetType: 'breed',
      targetId: { sql: 'last_insert_rowid()' },
      after: { name: input.name, defaultSize: input.defaultSize },
      now,
    }),
    keepOtherLast(db),
  ]);
  return c.json({ id: res[0]!.meta.last_row_id, breeds: await listAll(db) }, 201);
});

// 並べ替え(ids: 「その他」を除いた、並べたい順)
breedsRoutes.post('/breeds/order', requireRole('admin'), async (c) => {
  const { ids } = await parseJson(c, orderSchema);
  const db = c.env.DB;
  const before = await currentOrder(db);
  if (ids.length !== before.length || new Set(ids).size !== ids.length || ids.some((id) => !before.includes(id))) {
    throw errors.conflict('breeds_changed', '犬種の一覧が変わっています。画面を読み込み直してから、並べ替えてください。');
  }
  if (ids.join(',') !== before.join(',')) {
    await db.batch([
      ...orderStatements(db, ids),
      keepOtherLast(db),
      auditStatement(db, {
        staffId: c.get('staff').id,
        action: 'breed.reorder',
        targetType: 'breed',
        targetId: 'order',
        before: { ids: before },
        after: { ids },
        now: c.get('now'),
      }),
    ]);
  }
  const body: AdminBreedsResponse = { breeds: await listAll(db) };
  return c.json(body);
});

// 名前・標準のサイズ・表示するかを変える。標準のサイズを変えても、登録済みの犬のサイズは変わらない
breedsRoutes.patch('/breeds/:id', requireRole('admin'), async (c) => {
  const input = await parseJson(c, breedPatchSchema);
  const db = c.env.DB;
  const row = await findBreed(db, Number(c.req.param('id')) || 0);
  if (row.is_other === 1 && input.visible === false) {
    throw errors.badRequest('「その他」は、選択肢にない犬種を入れるために使うので、非表示にできません。');
  }
  if (input.name !== undefined && input.name !== row.name) await assertNameFree(db, input.name, row.id);
  const current = { name: row.name, defaultSize: row.default_size, visible: row.visible === 1 };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input) as [keyof typeof current, unknown][]) {
    if (v === undefined || current[k] === v) continue;
    before[k] = current[k];
    after[k] = v;
  }
  if (Object.keys(after).length > 0) {
    const next = { ...current, ...after } as typeof current;
    await db.batch([
      db
        .prepare('UPDATE breeds SET name = ?, default_size = ?, visible = ? WHERE id = ?')
        .bind(next.name, next.defaultSize, next.visible ? 1 : 0, row.id),
      auditStatement(db, {
        staffId: c.get('staff').id,
        action: 'breed.update',
        targetType: 'breed',
        targetId: row.id,
        before: { name: row.name, ...before },
        after: { name: next.name, ...after },
        now: c.get('now'),
      }),
    ]);
  }
  const body: AdminBreedsResponse = { breeds: await listAll(db) };
  return c.json(body);
});

// ---- 操作ログから元に戻す(A-15) ----

const changedLater = () =>
  errors.conflict('breed_changed', 'この犬種は、そのあとにまた変更されています。犬種の画面で、直接直してください。');

registerUndo('breed.update', async (db, log) => {
  const row = await findBreed(db, Number(log.target_id));
  const before = JSON.parse(log.before_value ?? '{}') as { name: string; defaultSize?: string; visible?: boolean };
  const after = JSON.parse(log.after_value ?? '{}') as { name: string; defaultSize?: string; visible?: boolean };
  const now = { name: row.name, defaultSize: row.default_size, visible: row.visible === 1 };
  if (now.name !== after.name) throw changedLater();
  if (after.defaultSize !== undefined && now.defaultSize !== after.defaultSize) throw changedLater();
  if (after.visible !== undefined && now.visible !== after.visible) throw changedLater();
  if (before.name !== row.name) await assertNameFree(db, before.name, row.id);
  await db
    .prepare('UPDATE breeds SET name = ?, default_size = ?, visible = ? WHERE id = ?')
    .bind(before.name, before.defaultSize ?? row.default_size, (before.visible ?? now.visible) ? 1 : 0, row.id)
    .run();
});

// 追加の取り消しは、削除ではなく非表示にする(その犬種で登録した犬がいれば戻さない)
registerUndo('breed.create', async (db, log) => {
  const id = Number(log.target_id);
  await findBreed(db, id);
  const used = await db.prepare('SELECT COUNT(*) AS n FROM dogs WHERE breed_id = ?').bind(id).first<{ n: number }>();
  if ((used?.n ?? 0) > 0) {
    throw errors.conflict('breed_in_use', 'この犬種で登録したワンちゃんがいるため、元に戻せません。犬種の画面で非表示にしてください。');
  }
  await db.prepare('UPDATE breeds SET visible = 0 WHERE id = ?').bind(id).run();
});

registerUndo('breed.reorder', async (db, log) => {
  const before = (JSON.parse(log.before_value ?? '{}') as { ids: number[] }).ids;
  const now = await currentOrder(db);
  // あとから追加した犬種は、元の並びの後ろに置く
  const ids = [...before.filter((id) => now.includes(id)), ...now.filter((id) => !before.includes(id))];
  await db.batch([...orderStatements(db, ids), keepOtherLast(db)]);
});

// 犬種を大まかな分け方にまとめた記録(migrations/0007_profile.sql が書く。自動処理なので元に戻す操作はない)
registerAuditDetail('breed.consolidate', (before) => {
  if (!Array.isArray(before) || before.length === 0) return null;
  const list = (before as { name: string; dogs: number }[]).map((b) => (b.dogs ? `${b.name}(${b.dogs}頭)` : b.name));
  return `${list.join('・')}を、大まかな犬種にまとめた`;
});
