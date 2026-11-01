import { toJstIso, type AlbumKind, type PriceList } from '@dr/shared';
import { errors } from '../../lib/errors';
import { auditStatement, latestAuditId } from '../audit';
import { registerAuditDetail } from '../audit-view';
import { registerUndo } from '../undo';

// 段階1-A(管理)。PA-5 価格表(PF-3)。
// - 価格は保存しない。アルバムの写真の価格は、見るたびに価格表から決める(resolvePhotoPrice)。だから価格表を変えると、
//   使っている全アルバムにすぐ反映する。お支払い済みの注文は order_items.unit_price のまま変わらない。
// - 物理削除しない。使わなくするときは status = 'archived'(使っているアルバムはそのまま。新しいアルバムでは選べない)。
// - 種類ごとの既定(is_default_for)は、日付・イベントにそれぞれ1つ。既定の価格表は使わなくできない。

type PriceListRow = {
  id: number;
  name: string;
  unit_price: number;
  album_price: number | null;
  is_default_for: AlbumKind | null;
  status: 'active' | 'archived';
  album_count: number;
};

const SELECT = `SELECT pl.id, pl.name, pl.unit_price, pl.album_price, pl.is_default_for, pl.status,
  (SELECT COUNT(*) FROM albums a WHERE a.price_list_id = pl.id AND a.removed_at IS NULL) AS album_count
  FROM price_lists pl`;

const toPriceList = (r: PriceListRow): PriceList => ({
  id: r.id,
  name: r.name,
  unitPrice: r.unit_price,
  albumPrice: r.album_price,
  isDefaultFor: r.is_default_for,
  status: r.status,
  albumCount: r.album_count,
});

export async function listPriceLists(db: D1Database): Promise<PriceList[]> {
  const { results } = await db.prepare(`${SELECT} ORDER BY pl.status = 'archived', pl.id`).all<PriceListRow>();
  return results.map(toPriceList);
}

const notFound = () => errors.notFound('価格表が見つかりませんでした。画面を読み込み直してください。');

export async function getPriceList(db: D1Database, id: number): Promise<PriceList> {
  const r = await db.prepare(`${SELECT} WHERE pl.id = ?`).bind(id).first<PriceListRow>();
  if (!r) throw notFound();
  return toPriceList(r);
}

/** アルバムに付けられる価格表か(使っている価格表は、使わなくしてあってもそのまま付けておける) */
export async function assertUsablePriceList(db: D1Database, id: number, currentId?: number) {
  const r = await db.prepare('SELECT id, status FROM price_lists WHERE id = ?').bind(id).first<{ id: number; status: string }>();
  if (!r) throw errors.badRequest('選んだ価格表が見つかりませんでした。価格表を選び直してください。');
  if (r.status !== 'active' && r.id !== currentId) {
    throw errors.badRequest('選んだ価格表は「使わない」にしてあります。ほかの価格表を選ぶか、価格表の画面で使うように戻してください。');
  }
}

/** 種類ごとの既定の価格表の番号 */
export async function defaultPriceListId(db: D1Database, kind: AlbumKind): Promise<number> {
  const r = await db.prepare("SELECT id FROM price_lists WHERE is_default_for = ? AND status = 'active'").bind(kind).first<{ id: number }>();
  if (r) return r.id;
  const any = await db.prepare("SELECT id FROM price_lists WHERE status = 'active' ORDER BY id LIMIT 1").first<{ id: number }>();
  if (!any) throw errors.conflict('no_price_list', '使える価格表がありません。先に価格表の画面で価格表を作ってください。');
  return any.id;
}

type Snapshot = { name: string; unitPrice: number; albumPrice: number | null; status: 'active' | 'archived' };
const snap = (p: Pick<PriceList, 'name' | 'unitPrice' | 'albumPrice' | 'status'>): Snapshot => ({
  name: p.name,
  unitPrice: p.unitPrice,
  albumPrice: p.albumPrice,
  status: p.status,
});

export async function createPriceList(
  db: D1Database,
  input: { name: string; unitPrice: number; albumPrice: number | null },
  ctx: { staffId: number; now: Date },
): Promise<{ priceList: PriceList; auditId: number | null }> {
  const nowIso = toJstIso(ctx.now);
  const res = await db.batch([
    db
      .prepare(
        "INSERT INTO price_lists (name, unit_price, album_price, is_default_for, status, created_at, updated_at) VALUES (?, ?, ?, NULL, 'active', ?, ?)",
      )
      .bind(input.name, input.unitPrice, input.albumPrice, nowIso, nowIso),
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'price_list.create',
      targetType: 'price_list',
      targetId: { sql: 'last_insert_rowid()' },
      after: { ...input, status: 'active' },
      now: ctx.now,
    }),
  ]);
  const id = res[0]!.meta.last_row_id;
  return {
    priceList: await getPriceList(db, id),
    auditId: await latestAuditId(db, { action: 'price_list.create', targetType: 'price_list', targetId: id, staffId: ctx.staffId }),
  };
}

export async function updatePriceList(
  db: D1Database,
  id: number,
  input: Partial<Snapshot>,
  ctx: { staffId: number; now: Date },
): Promise<{ priceList: PriceList; auditId: number | null }> {
  const before = await getPriceList(db, id);
  if (input.status === 'archived' && before.isDefaultFor) {
    throw errors.conflict(
      'price_list_default',
      '種類ごとの既定にしている価格表は、使わないにできません。先に「種類ごとの既定」でほかの価格表を選んでください。',
    );
  }
  const after: Snapshot = { ...snap(before), ...input };
  if (JSON.stringify(after) === JSON.stringify(snap(before))) return { priceList: before, auditId: null };
  await db.batch([
    db
      .prepare('UPDATE price_lists SET name = ?, unit_price = ?, album_price = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(after.name, after.unitPrice, after.albumPrice, after.status, toJstIso(ctx.now), id),
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'price_list.update',
      targetType: 'price_list',
      targetId: id,
      before: snap(before),
      after,
      now: ctx.now,
    }),
  ]);
  return {
    priceList: await getPriceList(db, id),
    auditId: await latestAuditId(db, { action: 'price_list.update', targetType: 'price_list', targetId: id, staffId: ctx.staffId }),
  };
}

async function currentDefaults(db: D1Database): Promise<{ date: number | null; event: number | null }> {
  const { results } = await db.prepare('SELECT id, is_default_for FROM price_lists WHERE is_default_for IS NOT NULL').all<{ id: number; is_default_for: AlbumKind }>();
  return {
    date: results.find((r) => r.is_default_for === 'date')?.id ?? null,
    event: results.find((r) => r.is_default_for === 'event')?.id ?? null,
  };
}

function defaultStatements(db: D1Database, d: { date: number | null; event: number | null }, nowIso: string) {
  const out = [db.prepare('UPDATE price_lists SET is_default_for = NULL, updated_at = ? WHERE is_default_for IS NOT NULL').bind(nowIso)];
  if (d.date) out.push(db.prepare("UPDATE price_lists SET is_default_for = 'date', updated_at = ? WHERE id = ?").bind(nowIso, d.date));
  if (d.event) out.push(db.prepare("UPDATE price_lists SET is_default_for = 'event', updated_at = ? WHERE id = ?").bind(nowIso, d.event));
  return out;
}

export async function setDefaults(
  db: D1Database,
  input: { date: number; event: number },
  ctx: { staffId: number; now: Date },
): Promise<{ auditId: number | null }> {
  if (input.date === input.event) {
    throw errors.badRequest('日付のアルバムとイベントのアルバムには、別々の価格表を選んでください。同じ価格にしたいときは、同じ価格の価格表をもう1つ作ってください。');
  }
  for (const id of [input.date, input.event]) {
    const r = await db.prepare('SELECT status FROM price_lists WHERE id = ?').bind(id).first<{ status: string }>();
    if (!r) throw errors.badRequest('選んだ価格表が見つかりませんでした。画面を読み込み直してください。');
    if (r.status !== 'active') throw errors.badRequest('「使わない」にしてある価格表は、既定にできません。先に使うように戻してください。');
  }
  const before = await currentDefaults(db);
  if (before.date === input.date && before.event === input.event) return { auditId: null };
  await db.batch([
    ...defaultStatements(db, input, toJstIso(ctx.now)),
    auditStatement(db, {
      staffId: ctx.staffId,
      action: 'price_list.defaults',
      targetType: 'price_list',
      targetId: input.date,
      before,
      after: input,
      now: ctx.now,
    }),
  ]);
  return { auditId: await latestAuditId(db, { action: 'price_list.defaults', targetType: 'price_list', targetId: input.date, staffId: ctx.staffId }) };
}

// ---------------------------------------------------------------- 元に戻す(操作ログ)

const changed = () => errors.conflict('price_list_changed', 'この価格表は、そのあとにまた変えられています。価格表の画面で直してください。');

registerUndo('price_list.create', async (db, log, ctx) => {
  const p = await getPriceList(db, Number(log.target_id));
  if (p.albumCount > 0) {
    throw errors.conflict('price_list_in_use', 'この価格表は、もうアルバムで使われています。使わなくするときは、価格表の画面で「使わない」にしてください。');
  }
  if (p.isDefaultFor) throw errors.conflict('price_list_default', 'この価格表は既定にしてあります。先にほかの価格表を既定にしてください。');
  await db.prepare("UPDATE price_lists SET status = 'archived', updated_at = ? WHERE id = ?").bind(toJstIso(ctx.now), p.id).run();
});

registerUndo('price_list.update', async (db, log, ctx) => {
  const p = await getPriceList(db, Number(log.target_id));
  const before = JSON.parse(log.before_value ?? '{}') as Snapshot;
  const after = JSON.parse(log.after_value ?? '{}') as Snapshot;
  if (JSON.stringify(snap(p)) !== JSON.stringify(after)) throw changed();
  if (before.status === 'archived' && p.isDefaultFor) throw errors.conflict('price_list_default', 'この価格表は既定にしてあります。先にほかの価格表を既定にしてください。');
  await db
    .prepare('UPDATE price_lists SET name = ?, unit_price = ?, album_price = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(before.name, before.unitPrice, before.albumPrice, before.status, toJstIso(ctx.now), p.id)
    .run();
});

registerUndo('price_list.defaults', async (db, log, ctx) => {
  const before = JSON.parse(log.before_value ?? '{}') as { date: number | null; event: number | null };
  const after = JSON.parse(log.after_value ?? '{}') as { date: number; event: number };
  const now = await currentDefaults(db);
  if (now.date !== after.date || now.event !== after.event) {
    throw errors.conflict('price_list_changed', '種類ごとの既定は、そのあとにまた変えられています。価格表の画面で選び直してください。');
  }
  await db.batch(defaultStatements(db, before, toJstIso(ctx.now)));
});

const yen = (n: number | null | undefined) => (n == null ? 'なし' : `${n.toLocaleString('ja-JP')}円`);
registerAuditDetail('price_list.create', (_b, a) => (a ? `「${a.name}」1枚 ${yen(a.unitPrice)}・まるごと ${yen(a.albumPrice)}` : null));
registerAuditDetail('price_list.update', (b, a) => {
  if (!b || !a) return null;
  const parts: string[] = [];
  if (b.name !== a.name) parts.push(`名前「${b.name}」→「${a.name}」`);
  if (b.unitPrice !== a.unitPrice) parts.push(`1枚 ${yen(b.unitPrice)} → ${yen(a.unitPrice)}`);
  if (b.albumPrice !== a.albumPrice) parts.push(`まるごと ${yen(b.albumPrice)} → ${yen(a.albumPrice)}`);
  if (b.status !== a.status) parts.push(a.status === 'archived' ? '使わないにした' : '使うように戻した');
  return parts.join('、') || null;
});
