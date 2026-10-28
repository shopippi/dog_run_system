import {
  autoHouseholdName,
  defaultKeepHousehold,
  expiryFor,
  mergeUndoDeadline,
  mergePhotoSide,
  mergeUndoStatus,
  planMergeDogs,
  planMergePoints,
  sameDayVisitDates,
  toJstIso,
  validateDogPairs,
  type MergeDogPair,
  type MergeDogView,
  type MergeHouseholdView,
  type MergeInput,
  type MergePreview,
  type MergeResult,
  type Settings,
} from '@dr/shared';
import { errors } from '../lib/errors';
import { ADMIN_MEDIA_BASE } from './admin-visits';
import { auditStatement } from './audit';
import { refreshDailyStatsForHouseholdsQuietly } from './daily-stats';
import { refreshAutoNameStatement, syncHouseholdSearchName } from './dogs';
import { pointBalance, unusedTicketCount } from './points';

/*
 * おうちの統合(A-07、要件定義書 5.3)。
 *
 * 統合は1つのまとまり(D1 の batch)で書き込む。統合前の状態は merges.snapshot に JSON で残し、
 * 30日以内で、統合後にそのおうちの来場・ポイントの変更がなければ、snapshot から元に戻す。
 *
 * 同じ日に両方のおうちが来場していた場合の扱い:
 *   visits には「おうち + 来場日」の一意の索引(取り消しを除く)があるため、同じ日の2件目を残す側に移せない。
 *   そこで、その日のまとめる側の来場だけは、まとめた側(統合済みのおうち)に残したままにする。
 *   ポイントは減らさない(台帳はそのまま。まとめた側の残高は、統合の台帳の行で残す側へ移る)。
 *   来場履歴では、merges の記録から辿って統合先からも見えるようにする(historyHouseholdIds を使う)。
 *   来場した犬(visit_dogs)は、組み合わせた犬なら残す側の犬に付け替える。
 */

/** D1 の1つの文で使える値の数に収まるよう、ID の一覧を分ける */
const CHUNK = 80;
function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

type HouseholdRow = {
  id: number;
  member_no: string;
  display_name: string;
  display_name_search: string;
  display_name_auto: number;
  registered_at: string;
  postal_code: string | null;
  referral: string | null;
  transport: string | null;
  status: MergeHouseholdView['status'];
  merged_into_id: number | null;
  updated_at: string;
};

type DogRow = {
  id: number;
  dog_no: string;
  household_id: number;
  name: string;
  name_search: string;
  photo_key: string | null;
  thumb_key: string | null;
  breed_id: number;
  breed_other: string | null;
  breed_name: string;
  size: MergeDogView['size'];
  sex: MergeDogView['sex'];
  birth_ym: string | null;
  status: 'active' | 'retired' | 'merged';
  merged_into_id: number | null;
  updated_at: string;
};

type Loaded = {
  row: HouseholdRow;
  view: MergeHouseholdView;
  dogRows: DogRow[];
  /** 取り消しを除いた来場日 */
  visitDates: string[];
  balance: number;
};

const HOUSEHOLD_COLS =
  'id, member_no, display_name, display_name_search, display_name_auto, registered_at, postal_code, referral, transport, status, merged_into_id, updated_at';

function dogView(d: DogRow): MergeDogView {
  return {
    id: d.id,
    dogNo: d.dog_no,
    name: d.name,
    breedName: d.breed_other || d.breed_name,
    size: d.size,
    sex: d.sex,
    birthYm: d.birth_ym,
    photoUrl: d.photo_key ? `${ADMIN_MEDIA_BASE}/${d.photo_key}` : null,
    thumbUrl: d.thumb_key ? `${ADMIN_MEDIA_BASE}/${d.thumb_key}` : null,
  };
}

async function loadHousehold(db: D1Database, id: number, now: Date): Promise<Loaded | null> {
  const row = await db.prepare(`SELECT ${HOUSEHOLD_COLS} FROM households WHERE id = ?`).bind(id).first<HouseholdRow>();
  if (!row) return null;
  const [family, dogs, visits, balance, tickets] = await Promise.all([
    db
      .prepare(
        `SELECT id, COALESCE(line_display_name, '') AS name, join_method FROM family_members
          WHERE household_id = ? AND status = 'active' ORDER BY id`,
      )
      .bind(id)
      .all<{ id: number; name: string; join_method: MergeHouseholdView['family'][number]['joinMethod'] }>(),
    db
      .prepare(
        `SELECT d.id, d.dog_no, d.household_id, d.name, d.name_search, d.photo_key, d.thumb_key, d.breed_id, d.breed_other,
                b.name AS breed_name, d.size, d.sex, d.birth_ym, d.status, d.merged_into_id, d.updated_at
           FROM dogs d JOIN breeds b ON b.id = d.breed_id
          WHERE d.household_id = ? AND d.status IN ('active', 'retired') ORDER BY d.id`,
      )
      .bind(id)
      .all<DogRow>(),
    db
      .prepare('SELECT DISTINCT visit_date FROM visits WHERE household_id = ? AND cancelled_at IS NULL ORDER BY visit_date')
      .bind(id)
      .all<{ visit_date: string }>(),
    pointBalance(db, id),
    unusedTicketCount(db, id, now),
  ]);
  const visitDates = visits.results.map((v) => v.visit_date);
  return {
    row,
    dogRows: dogs.results,
    visitDates,
    balance,
    view: {
      id: row.id,
      memberNo: row.member_no,
      displayName: row.display_name,
      status: row.status,
      registeredAt: row.registered_at,
      family: family.results.map((f) => ({ id: f.id, name: f.name, joinMethod: f.join_method })),
      dogs: dogs.results.filter((d) => d.status === 'active').map(dogView),
      points: balance,
      tickets,
      visits: visitDates.length,
      lastVisit: visitDates.at(-1) ?? null,
    },
  };
}

const notFound = () => errors.notFound('おうちが見つかりませんでした。画面を読み込み直して、選び直してください。');

async function loadPair(db: D1Database, input: Pick<MergeInput, 'keepHouseholdId' | 'absorbHouseholdId'>, now: Date) {
  const [kept, absorbed] = await Promise.all([
    loadHousehold(db, input.keepHouseholdId, now),
    loadHousehold(db, input.absorbHouseholdId, now),
  ]);
  if (!kept || !absorbed) throw notFound();
  for (const h of [kept, absorbed]) {
    if (h.row.status === 'merged') {
      throw errors.conflict(
        'already_merged',
        `${h.row.display_name}(${h.row.member_no})は、すでにほかのおうちにまとめられています。まとめた先のおうちを選んでください。`,
      );
    }
    if (h.row.status !== 'active') {
      throw errors.conflict('not_active', `${h.row.display_name}(${h.row.member_no})は退会しているため、まとめられません。退会していないおうちを選び直してください。`);
    }
  }
  return { kept, absorbed };
}

function checkPairs(pairs: MergeDogPair[], kept: Loaded, absorbed: Loaded) {
  const activeIds = (l: Loaded) => l.dogRows.filter((d) => d.status === 'active').map((d) => d.id);
  const problem = validateDogPairs(pairs, activeIds(kept), activeIds(absorbed));
  if (problem) throw errors.badRequest(problem);
}

/**
 * 同じ日に両方のおうちが来場していた分(5.3)。まとめる側のその日の来場と、その来場で付いたポイント。
 * ポイントを差し引くのは、設定 merge_keep_same_day_points が false のときだけ(初期値は差し引かない)。
 */
async function sameDayInfo(db: D1Database, kept: Loaded, absorbed: Loaded, settings: Settings) {
  const dates = sameDayVisitDates(kept.visitDates, absorbed.visitDates);
  if (dates.length === 0) return { dates, points: 0 };
  if (settings.merge_keep_same_day_points) return { dates, points: 0 };
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(l.delta), 0) AS n FROM point_ledger l JOIN visits v ON v.id = l.visit_id
        WHERE v.household_id = ? AND v.cancelled_at IS NULL AND l.kind = 'visit'
          AND v.visit_date IN (SELECT visit_date FROM visits WHERE household_id = ? AND cancelled_at IS NULL)`,
    )
    .bind(absorbed.row.id, kept.row.id)
    .first<{ n: number }>();
  return { dates, points: Math.max(0, row?.n ?? 0) };
}

function buildPreview(
  kept: Loaded,
  absorbed: Loaded,
  pairs: MergeDogPair[],
  settings: Settings,
  sameDay: { dates: string[]; points: number },
): MergePreview {
  const points = planMergePoints(kept.balance, absorbed.balance, settings.points_per_ticket, sameDay.points);
  const dogs = planMergeDogs(kept.view.dogs, absorbed.view.dogs, pairs);
  return {
    kept: kept.view,
    absorbed: absorbed.view,
    suggestedKeepHouseholdId: defaultKeepHousehold(kept.view, absorbed.view),
    result: {
      memberNo: kept.row.member_no,
      // 呼び名を自動で作るおうちは、統合後の犬の名前から作り直す(犬の登録順)
      displayName:
        kept.row.display_name_auto === 1
          ? autoHouseholdName([...dogs].sort((x, y) => x.id - y.id).map((d) => d.name))
          : kept.row.display_name,
      family: [...kept.view.family, ...absorbed.view.family],
      dogs,
      points: points.balanceAfter,
      tickets: kept.view.tickets + absorbed.view.tickets + points.ticketsIssued,
      ticketsIssued: points.ticketsIssued,
      // 同じ日の来場も、どちらも記録として残す
      visits: kept.view.visits + absorbed.view.visits,
    },
    sameDayVisitDates: sameDay.dates,
    sameDayPointsRemoved: sameDay.points,
  };
}

/** 統合の確認(結果のプレビュー)。データは変えない */
export async function previewMerge(db: D1Database, input: MergeInput, now: Date, settings: Settings): Promise<MergePreview> {
  const { kept, absorbed } = await loadPair(db, input, now);
  checkPairs(input.dogPairs, kept, absorbed);
  return buildPreview(kept, absorbed, input.dogPairs, settings, await sameDayInfo(db, kept, absorbed, settings));
}

/** 統合で承認にした、まとめる申請の元の状態(以前の統合の記録にだけある。いまは申請を作らない) */
type RequestState = {
  id: number;
  status: string;
  handled_by_staff_id: number | null;
  handled_at: string | null;
  handle_note: string | null;
};

/** 統合前の状態(元に戻すため)。merges.snapshot に JSON で保存する */
export type MergeSnapshot = {
  version: 1;
  kept: HouseholdRow;
  absorbed: HouseholdRow;
  balances: { kept: number; absorbed: number };
  /** 残す側に移した家族 */
  memberIds: number[];
  /** 残す側に移した犬(組み合わせなかった犬と、登録解除の犬) */
  movedDogIds: number[];
  pairs: { keep: DogRow; absorb: DogRow; take: MergeDogPair['take']; photo?: MergeDogPair['photo']; visitDogIds: number[] }[];
  /** 残す側に移した来場 */
  movedVisitIds: number[];
  /** 同じ日に両方が来場していたため、まとめた側に残した来場 */
  sameDayVisitIds: number[];
  /** 残す側に移した未使用の無料券 */
  movedTicketIds: number[];
  /** 統合で承認にした、まとめる申請(元の状態)。以前の統合の記録にだけある */
  requests?: RequestState[];
};

const MERGE_REASON = 'おうちをまとめたため';
const UNDO_REASON = 'おうちの統合を元に戻したため';

/**
 * まとめる操作をした人。
 * - staff: 管理者がおうちの統合の画面(A-07)でまとめた
 * - member: お客さんが招待を開いて、本人の確認でまとめた(C-12)。id は開いた人の家族ID、inviteId は使った招待
 */
export type MergeActor = { type: 'staff'; id: number } | { type: 'member'; id: number; inviteId: number };

/**
 * 統合を実行する(5.3)。管理者の統合(A-07)と、お客さんが招待からまとめる(C-12)の両方で使う。
 * - ポイントは両方の残高を合計する。まとめた側の残高をゼロにする行と、残す側に足す行を台帳に書く(種類は merge)。
 *   合計が無料券1枚分以上なら、その分の無料券を発行する
 * - 無料券の未使用分は、残す側に付け替える
 * - 家族は全員、残す側に移す(参加方法は変えず、おうちだけ変える)
 * - 組み合わせた犬は1頭にまとめる。まとめる側の犬は「統合済み」にし、来場した犬の記録を残す側の犬に付け替える。
 *   写真・名前・犬種は、管理者が選んだ方を残す
 * - 来場の記録は残す側に移す(同じ日の分は上のコメントのとおり)
 * - 使わなくなった会員IDは「統合済み」にして、統合先を記録する
 * - まとめられた側の家族(まとめた本人を除く)には、次に会員証を開いたときに「おうちが一つになりました」と出す
 * - お客さんがまとめたときは、使った招待を「使用済み」にする(同じ招待で2回まとめない)
 */
export async function executeMerge(
  db: D1Database,
  input: MergeInput,
  actor: MergeActor,
  now: Date,
  settings: Settings,
): Promise<MergeResult> {
  const { kept, absorbed } = await loadPair(db, input, now);
  checkPairs(input.dogPairs, kept, absorbed);
  const k = kept.row.id;
  const a = absorbed.row.id;
  const nowIso = toJstIso(now);
  const staffId = actor.type === 'staff' ? actor.id : null;

  // 移すものを集める
  const pairedAbsorb = new Set(input.dogPairs.map((p) => p.absorb));
  const movedDogIds = absorbed.dogRows.filter((d) => !pairedAbsorb.has(d.id)).map((d) => d.id);
  const keepDogById = new Map(kept.dogRows.map((d) => [d.id, d]));
  const absorbDogById = new Map(absorbed.dogRows.map((d) => [d.id, d]));
  const pairs: MergeSnapshot['pairs'] = [];
  for (const p of input.dogPairs) {
    const { results } = await db.prepare('SELECT id FROM visit_dogs WHERE dog_id = ? ORDER BY id').bind(p.absorb).all<{ id: number }>();
    pairs.push({
      keep: keepDogById.get(p.keep)!,
      absorb: absorbDogById.get(p.absorb)!,
      take: p.take,
      ...(p.photo ? { photo: p.photo } : {}),
      visitDogIds: results.map((r) => r.id),
    });
  }
  const sameDates = new Set(sameDayVisitDates(kept.visitDates, absorbed.visitDates));
  const { results: absorbedVisits } = await db
    .prepare('SELECT id, visit_date, cancelled_at FROM visits WHERE household_id = ? ORDER BY id')
    .bind(a)
    .all<{ id: number; visit_date: string; cancelled_at: string | null }>();
  const stays = (v: (typeof absorbedVisits)[number]) => v.cancelled_at === null && sameDates.has(v.visit_date);
  const movedVisitIds = absorbedVisits.filter((v) => !stays(v)).map((v) => v.id);
  const sameDayVisitIds = absorbedVisits.filter(stays).map((v) => v.id);
  const [{ results: tickets }, { results: members }] = await Promise.all([
    db.prepare("SELECT id FROM tickets WHERE household_id = ? AND status = 'unused' ORDER BY id").bind(a).all<{ id: number }>(),
    db.prepare("SELECT id FROM family_members WHERE household_id = ? AND status = 'active' ORDER BY id").bind(a).all<{ id: number }>(),
  ]);
  const movedTicketIds = tickets.map((t) => t.id);
  const memberIds = members.map((m) => m.id);
  // まとめた本人には完了の画面で伝えるので、お知らせは本人以外に出す
  const noticeIds = memberIds.filter((id) => !(actor.type === 'member' && actor.id === id));

  const snapshot: MergeSnapshot = {
    version: 1,
    kept: kept.row,
    absorbed: absorbed.row,
    balances: { kept: kept.balance, absorbed: absorbed.balance },
    memberIds,
    movedDogIds,
    pairs,
    movedVisitIds,
    sameDayVisitIds,
    movedTicketIds,
  };

  const sameDay = await sameDayInfo(db, kept, absorbed, settings);
  const plan = planMergePoints(kept.balance, absorbed.balance, settings.points_per_ticket, sameDay.points);
  const preview = buildPreview(kept, absorbed, input.dogPairs, settings, sameDay);
  const mergeIdSql = '(SELECT MAX(id) FROM merges)';

  // 確かめた時点から変わっていないこと(同時に2回押された・その間にチェックインがあった、など)。
  // 変わっていれば kept_household_id が NULL になって、まとめ全体が取り消される
  const guardSql = `
    (SELECT COUNT(*) FROM households WHERE id IN (?, ?) AND status = 'active') = 2
    AND (SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE household_id = ?) = ?
    AND (SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE household_id = ?) = ?
    AND (SELECT COUNT(*) FROM visits WHERE household_id = ?) = ?
    AND (SELECT COUNT(*) FROM visits WHERE household_id = ? AND cancelled_at IS NULL) = ?
    AND (SELECT COUNT(*) FROM tickets WHERE household_id = ? AND status = 'unused') = ?
    AND (SELECT COUNT(*) FROM family_members WHERE household_id = ? AND status = 'active') = ?
    AND (SELECT COUNT(*) FROM dogs WHERE household_id IN (?, ?) AND status = 'active') = ?${
      // お客さんがまとめるときは、招待がまだ使われておらず期限内で、本人がまとめる側のおうちにいること
      actor.type === 'member'
        ? `
    AND EXISTS (SELECT 1 FROM invites WHERE id = ? AND household_id = ? AND used_at IS NULL AND expires_at >= ?)
    AND EXISTS (SELECT 1 FROM family_members WHERE id = ? AND household_id = ? AND status = 'active')`
        : ''
    }`;
  const keptVisitCount = await db
    .prepare('SELECT COUNT(*) AS n FROM visits WHERE household_id = ? AND cancelled_at IS NULL')
    .bind(k)
    .first<{ n: number }>();
  const guardArgs = [
    k, a,
    k, kept.balance,
    a, absorbed.balance,
    a, absorbedVisits.length,
    k, keptVisitCount?.n ?? 0,
    a, movedTicketIds.length,
    a, memberIds.length,
    k, a, kept.dogRows.filter((d) => d.status === 'active').length + absorbed.dogRows.filter((d) => d.status === 'active').length,
    ...(actor.type === 'member' ? [actor.inviteId, k, nowIso, actor.id, a] : []),
  ];
  const memberActor = actor.type === 'member' ? actor : null;

  const s: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO merges (kept_household_id, absorbed_household_id, dog_pairs, snapshot, executed_by_staff_id,
                             executed_by_member_id, invite_id, executed_at)
         VALUES (CASE WHEN ${guardSql} THEN ? END, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ...guardArgs,
        k,
        a,
        JSON.stringify(input.dogPairs),
        JSON.stringify(snapshot),
        staffId,
        memberActor?.id ?? null,
        memberActor?.inviteId ?? null,
        nowIso,
      ),
    db
      .prepare("UPDATE households SET status = 'merged', merged_into_id = ?, updated_at = ? WHERE id = ?")
      .bind(k, nowIso, a),
  ];
  for (const ids of chunks(memberIds)) {
    s.push(
      db
        .prepare(`UPDATE family_members SET household_id = ?, updated_at = ? WHERE id IN (${marks(ids.length)})`)
        .bind(k, nowIso, ...ids),
    );
  }
  for (const ids of chunks(movedDogIds)) {
    s.push(db.prepare(`UPDATE dogs SET household_id = ?, updated_at = ? WHERE id IN (${marks(ids.length)})`).bind(k, nowIso, ...ids));
  }
  for (const p of pairs) {
    const chosen = p.take === 'absorb' ? p.absorb : p.keep;
    const other = p.take === 'absorb' ? p.keep : p.absorb;
    const photo = mergePhotoSide(p) === 'absorb' ? p.absorb : p.keep;
    s.push(
      db
        .prepare(
          `UPDATE dogs SET name = ?, name_search = ?, photo_key = ?, thumb_key = ?, breed_id = ?, breed_other = ?, size = ?,
                  sex = ?, birth_ym = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(
          chosen.name,
          chosen.name_search,
          photo.photo_key,
          photo.thumb_key,
          chosen.breed_id,
          chosen.breed_other,
          chosen.size,
          chosen.sex ?? other.sex,
          chosen.birth_ym ?? other.birth_ym,
          nowIso,
          p.keep.id,
        ),
      db
        .prepare("UPDATE dogs SET status = 'merged', merged_into_id = ?, updated_at = ? WHERE id = ?")
        .bind(p.keep.id, nowIso, p.absorb.id),
      ...dogChangeRows(db, p.keep, chosen, other, photo, actor, nowIso, MERGE_REASON),
      db
        .prepare(
          `INSERT INTO dog_changes (dog_id, field, before_value, after_value, reason, actor_type, actor_id, changed_at)
           VALUES (?, 'status', 'active', 'merged', ?, ?, ?, ?)`,
        )
        .bind(p.absorb.id, `${MERGE_REASON}(${p.keep.dog_no} に1頭にまとめた)`, actor.type, actor.id, nowIso),
    );
    for (const ids of chunks(p.visitDogIds)) {
      s.push(db.prepare(`UPDATE visit_dogs SET dog_id = ? WHERE id IN (${marks(ids.length)})`).bind(p.keep.id, ...ids));
    }
  }
  for (const ids of chunks(movedVisitIds)) {
    s.push(db.prepare(`UPDATE visits SET household_id = ? WHERE id IN (${marks(ids.length)})`).bind(k, ...ids));
  }
  for (const ids of chunks(movedTicketIds)) {
    s.push(db.prepare(`UPDATE tickets SET household_id = ? WHERE id IN (${marks(ids.length)})`).bind(k, ...ids));
  }
  const pointExpiry = expiryFor(settings.point_expiry, now);
  const ticketExpiry = expiryFor(settings.ticket_expiry, now);
  const reason = `${absorbed.row.member_no} を ${kept.row.member_no} にまとめた${actor.type === 'member' ? '(お客さんの操作)' : ''}`;
  for (const entry of plan.ledger) {
    const householdId = entry.household === 'kept' ? k : a;
    // 同じ日の来場の分を差し引く行(設定で「残さない」にしたときだけ)
    const sameDayRow = entry.kind === 'merge' && entry.household === 'kept' && entry.delta < 0;
    if (entry.kind === 'merge') {
      s.push(
        db
          .prepare(
            `INSERT INTO point_ledger (household_id, delta, kind, merge_id, reason, actor_type, actor_id, created_at, expires_at)
             VALUES (?, ?, 'merge', ${mergeIdSql}, ?, ?, ?, ?, ?)`,
          )
          .bind(
            householdId,
            entry.delta,
            sameDayRow ? `${reason}(同じ日に両方が来場していた分を差し引く)` : reason,
            actor.type,
            actor.id,
            nowIso,
            entry.delta > 0 ? pointExpiry : null,
          ),
      );
    } else {
      s.push(
        db
          .prepare(
            `INSERT INTO tickets (household_id, issued_at, expires_at, source, status, note)
             VALUES (?, ?, ?, 'merge', 'unused', ?)`,
          )
          .bind(k, nowIso, ticketExpiry, 'おうちをまとめてポイントがたまったため'),
        db
          .prepare(
            `INSERT INTO point_ledger (household_id, delta, kind, ticket_id, merge_id, reason, actor_type, actor_id, created_at)
             VALUES (?, ?, 'ticket_issue', (SELECT MAX(id) FROM tickets), ${mergeIdSql}, ?, ?, ?, ?)`,
          )
          .bind(k, entry.delta, reason, actor.type, actor.id, nowIso),
      );
    }
  }
  // 残す側に答えがないアンケート(郵便番号など)は、まとめる側の答えで補う
  s.push(
    db
      .prepare(
        `UPDATE households SET postal_code = COALESCE(postal_code, ?), referral = COALESCE(referral, ?),
                transport = COALESCE(transport, ?), updated_at = ? WHERE id = ?`,
      )
      .bind(absorbed.row.postal_code, absorbed.row.referral, absorbed.row.transport, nowIso, k),
    refreshAutoNameStatement(db, k, nowIso),
  );
  for (const ids of chunks(noticeIds)) {
    s.push(
      db
        .prepare(`UPDATE family_members SET merge_notice_id = ${mergeIdSql} WHERE id IN (${marks(ids.length)})`)
        .bind(...ids),
    );
  }
  if (memberActor) {
    // 招待は使い切り(5.1)。まとめたら使用済みにする
    s.push(
      db
        .prepare('UPDATE invites SET used_at = ?, used_by_member_id = ? WHERE id = ? AND used_at IS NULL')
        .bind(nowIso, memberActor.id, memberActor.inviteId),
    );
  }
  s.push(
    auditStatement(db, {
      staffId,
      actor: { type: actor.type, id: actor.id },
      action: 'household.merge',
      targetType: 'merge',
      targetId: { sql: 'SELECT MAX(id) FROM merges' },
      before: {
        kept: { householdId: k, memberNo: kept.row.member_no, points: kept.balance, tickets: kept.view.tickets },
        absorbed: { householdId: a, memberNo: absorbed.row.member_no, points: absorbed.balance, tickets: absorbed.view.tickets },
      },
      after: {
        memberNo: kept.row.member_no,
        points: plan.balanceAfter,
        tickets: preview.result.tickets,
        ticketsIssued: plan.ticketsIssued,
        dogPairs: input.dogPairs,
        sameDayVisitIds,
        ...(memberActor ? { byCustomer: true, inviteId: memberActor.inviteId } : {}),
      },
      reason,
      undo: { householdIds: [k, a] },
      now,
    }),
  );

  let results: D1Result[];
  try {
    results = await db.batch(s);
  } catch (e) {
    if (/NOT NULL constraint failed: merges/.test(String((e as Error)?.message))) {
      throw errors.conflict(
        'merge_changed',
        '確認している間に、どちらかのおうちの内容が変わりました。もう一度、まとめた後の結果を確認してから押してください。',
      );
    }
    throw e;
  }
  await syncHouseholdSearchName(db, k);
  // 初来場のおうちの数などが変わるため、日ごとの集計を作り直す
  await refreshDailyStatsForHouseholdsQuietly(db, [k, a], now);
  const mergeId = results[0]!.meta.last_row_id;
  const after = await db.prepare('SELECT display_name FROM households WHERE id = ?').bind(k).first<{ display_name: string }>();
  return {
    mergeId,
    memberNo: kept.row.member_no,
    displayName: after?.display_name ?? kept.row.display_name,
    points: plan.balanceAfter,
    tickets: preview.result.tickets,
    ticketsIssued: plan.ticketsIssued,
    undoDeadline: toJstIso(mergeUndoDeadline(nowIso)),
  };
}

/** 犬の情報の変更履歴(写真・名前・犬種・サイズ・性別・生まれた年月)。変わった項目だけ書く */
function dogChangeRows(
  db: D1Database,
  before: DogRow,
  chosen: DogRow,
  other: DogRow,
  photoDog: DogRow,
  actor: { type: 'staff' | 'member'; id: number },
  nowIso: string,
  reason: string,
): D1PreparedStatement[] {
  const after = {
    name: chosen.name,
    photo: photoDog.photo_key ? JSON.stringify({ photo: photoDog.photo_key, thumb: photoDog.thumb_key }) : null,
    breed: `${chosen.breed_id}:${chosen.breed_other ?? ''}`,
    size: chosen.size,
    sex: chosen.sex ?? other.sex,
    birth_ym: chosen.birth_ym ?? other.birth_ym,
  };
  const prev = {
    name: before.name,
    photo: before.photo_key ? JSON.stringify({ photo: before.photo_key, thumb: before.thumb_key }) : null,
    breed: `${before.breed_id}:${before.breed_other ?? ''}`,
    size: before.size,
    sex: before.sex,
    birth_ym: before.birth_ym,
  };
  const out: D1PreparedStatement[] = [];
  for (const field of Object.keys(after) as (keyof typeof after)[]) {
    if (after[field] === prev[field]) continue;
    out.push(
      db
        .prepare(
          `INSERT INTO dog_changes (dog_id, field, before_value, after_value, reason, actor_type, actor_id, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(before.id, field, prev[field], after[field], reason, actor.type, actor.id, nowIso),
    );
  }
  return out;
}

type MergeRow = {
  id: number;
  kept_household_id: number;
  absorbed_household_id: number;
  snapshot: string;
  executed_at: string;
  undone_at: string | null;
};

/**
 * 統合のあとに、そのおうちの来場・ポイントの変更があったか(5.3)。
 * 来場(チェックイン・取り消し・犬の追加)、台帳(この統合の行を除く)、無料券の使用、
 * 管理画面での変更(操作ログ)、犬の情報の変更を調べる。
 */
export async function mergeChangedAfter(db: D1Database, m: MergeRow): Promise<boolean> {
  const t = m.executed_at;
  const hh = [m.kept_household_id, m.absorbed_household_id];
  const dogIdsSql = 'SELECT id FROM dogs WHERE household_id IN (?1, ?2) OR merged_into_id IN (SELECT id FROM dogs WHERE household_id IN (?1, ?2))';
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM point_ledger WHERE household_id IN (?1, ?2) AND created_at >= ?3 AND (merge_id IS NULL OR merge_id <> ?4)) AS ledger,
         EXISTS (SELECT 1 FROM visits WHERE household_id IN (?1, ?2) AND (checked_in_at >= ?3 OR cancelled_at >= ?3)) AS visits,
         EXISTS (SELECT 1 FROM visit_dogs vd JOIN visits v ON v.id = vd.visit_id
                  WHERE v.household_id IN (?1, ?2) AND vd.created_at > ?3) AS visit_dogs,
         EXISTS (SELECT 1 FROM tickets WHERE household_id IN (?1, ?2) AND used_at >= ?3) AS tickets,
         EXISTS (SELECT 1 FROM audit_log WHERE created_at > ?3 AND action <> 'household.merge'
                  AND ((target_type = 'household' AND target_id IN (?5, ?6))
                    OR (target_type = 'dog' AND target_id IN (SELECT CAST(id AS TEXT) FROM (${dogIdsSql}))))) AS audit,
         EXISTS (SELECT 1 FROM dog_changes WHERE changed_at > ?3 AND dog_id IN (${dogIdsSql})) AS dogs`,
    )
    // 操作ログの対象の ID は整数の文字列(数値を CAST すると "5.0" になり一致しない)
    .bind(hh[0], hh[1], t, m.id, String(Math.trunc(hh[0]!)), String(Math.trunc(hh[1]!)))
    .first<Record<string, number>>();
  return Object.values(row ?? {}).some((v) => v === 1);
}

const undoBlocked = (status: 'undone' | 'expired' | 'changed') =>
  status === 'undone'
    ? errors.conflict('merge_undone', 'この統合は、すでに元に戻されています。画面を読み込み直してください。')
    : status === 'expired'
      ? errors.conflict(
          'merge_undo_expired',
          'まとめてから30日を過ぎたため、管理画面では元に戻せません。製作者に依頼してください。',
        )
      : errors.conflict(
          'merge_changed_after',
          'まとめた後に、このおうちの来場やポイントの変更があるため、管理画面では元に戻せません。製作者に依頼してください。',
        );

/** 統合を元に戻せるか(画面の表示用) */
export async function mergeUndoState(db: D1Database, mergeId: number, now: Date) {
  const m = await db
    .prepare('SELECT id, kept_household_id, absorbed_household_id, snapshot, executed_at, undone_at FROM merges WHERE id = ?')
    .bind(mergeId)
    .first<MergeRow>();
  if (!m) return null;
  const status = mergeUndoStatus({ executedAt: m.executed_at, undoneAt: m.undone_at, now, changedAfter: false });
  const changed = status === 'ok' ? await mergeChangedAfter(db, m) : false;
  return { merge: m, status: changed ? ('changed' as const) : status };
}

/**
 * 統合を元に戻す(5.3)。30日以内で、統合後にそのおうちの来場・ポイントの変更がない場合だけ。
 * snapshot の状態に戻し、台帳は統合の行を打ち消す行を足す(台帳の行は消さない)。
 * 統合で発行した無料券は回収する。
 */
export async function undoMerge(db: D1Database, mergeId: number, staffId: number, now: Date): Promise<void> {
  const state = await mergeUndoState(db, mergeId, now);
  if (!state) throw errors.notFound('統合の記録が見つかりませんでした。画面を読み込み直してください。');
  if (state.status !== 'ok') throw undoBlocked(state.status);
  const m = state.merge;
  const snap = JSON.parse(m.snapshot) as MergeSnapshot;
  const k = m.kept_household_id;
  const a = m.absorbed_household_id;
  const nowIso = toJstIso(now);
  const [kb, ab] = await Promise.all([pointBalance(db, k), pointBalance(db, a)]);

  // 確かめた時点から変わっていないこと。変わっていれば kept_household_id が NULL になり、まとめ全体が取り消される
  // (お客さんがまとめた記録は executed_by_staff_id が空なので、空にできない列で確かめる)
  const s: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE merges SET undone_at = ?, undone_by_staff_id = ?,
                kept_household_id = CASE WHEN undone_at IS NULL
                  AND (SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE household_id = ?) = ?
                  AND (SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE household_id = ?) = ?
                  AND (SELECT status FROM households WHERE id = ?) = 'merged'
                THEN kept_household_id END
          WHERE id = ?`,
      )
      .bind(nowIso, staffId, k, kb, a, ab, a, m.id),
    db
      .prepare('UPDATE households SET status = ?, merged_into_id = ?, updated_at = ? WHERE id = ?')
      .bind(snap.absorbed.status, snap.absorbed.merged_into_id, nowIso, a),
    db
      .prepare(
        `UPDATE households SET display_name = ?, display_name_search = ?, display_name_auto = ?, postal_code = ?, referral = ?,
                transport = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        snap.kept.display_name,
        snap.kept.display_name_search,
        snap.kept.display_name_auto,
        snap.kept.postal_code,
        snap.kept.referral,
        snap.kept.transport,
        nowIso,
        k,
      ),
  ];
  for (const ids of chunks(snap.memberIds)) {
    s.push(
      db
        .prepare(`UPDATE family_members SET household_id = ?, updated_at = ? WHERE household_id = ? AND id IN (${marks(ids.length)})`)
        .bind(a, nowIso, k, ...ids),
    );
  }
  for (const ids of chunks(snap.movedDogIds)) {
    s.push(db.prepare(`UPDATE dogs SET household_id = ?, updated_at = ? WHERE id IN (${marks(ids.length)})`).bind(a, nowIso, ...ids));
  }
  const actor = { type: 'staff', id: staffId } as const;
  for (const p of snap.pairs) {
    s.push(
      db
        .prepare(
          `UPDATE dogs SET name = ?, name_search = ?, photo_key = ?, thumb_key = ?, breed_id = ?, breed_other = ?, size = ?,
                  sex = ?, birth_ym = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          p.keep.name,
          p.keep.name_search,
          p.keep.photo_key,
          p.keep.thumb_key,
          p.keep.breed_id,
          p.keep.breed_other,
          p.keep.size,
          p.keep.sex,
          p.keep.birth_ym,
          nowIso,
          p.keep.id,
        ),
      db
        .prepare('UPDATE dogs SET status = ?, merged_into_id = ?, updated_at = ? WHERE id = ?')
        .bind(p.absorb.status, p.absorb.merged_into_id, nowIso, p.absorb.id),
      ...dogChangeRows(
        db,
        // 統合後の状態から、統合前の状態に戻す
        { ...p.keep, ...mergedProfile(p) },
        p.keep,
        p.keep,
        p.keep,
        actor,
        nowIso,
        UNDO_REASON,
      ),
      db
        .prepare(
          `INSERT INTO dog_changes (dog_id, field, before_value, after_value, reason, actor_type, actor_id, changed_at)
           VALUES (?, 'status', 'merged', ?, ?, 'staff', ?, ?)`,
        )
        .bind(p.absorb.id, p.absorb.status, UNDO_REASON, staffId, nowIso),
    );
    for (const ids of chunks(p.visitDogIds)) {
      s.push(db.prepare(`UPDATE visit_dogs SET dog_id = ? WHERE id IN (${marks(ids.length)})`).bind(p.absorb.id, ...ids));
    }
  }
  for (const ids of chunks(snap.movedVisitIds)) {
    s.push(db.prepare(`UPDATE visits SET household_id = ? WHERE id IN (${marks(ids.length)})`).bind(a, ...ids));
  }
  for (const ids of chunks(snap.movedTicketIds)) {
    s.push(db.prepare(`UPDATE tickets SET household_id = ? WHERE id IN (${marks(ids.length)})`).bind(a, ...ids));
  }
  s.push(
    // 統合で発行した無料券を回収する
    db
      .prepare(
        `UPDATE tickets SET status = 'void', note = ?
          WHERE status = 'unused' AND id IN (SELECT ticket_id FROM point_ledger WHERE merge_id = ? AND kind = 'ticket_issue')`,
      )
      .bind('おうちの統合を元に戻したため回収', m.id),
    // 「おうちが一つになりました」のお知らせは、まだ見ていなければ出さない
    db.prepare('UPDATE family_members SET merge_notice_id = NULL WHERE merge_notice_id = ?').bind(m.id),
    // 統合の台帳の行を打ち消す(行は消さない)
    db
      .prepare(
        `INSERT INTO point_ledger (household_id, delta, kind, ticket_id, merge_id, reason, actor_type, actor_id, created_at, reverses_id)
         SELECT household_id, -delta, kind, ticket_id, merge_id, ?, 'staff', ?, ?, id
           FROM point_ledger WHERE merge_id = ? AND reverses_id IS NULL ORDER BY id`,
      )
      .bind(UNDO_REASON, staffId, nowIso, m.id),
  );
  for (const r of snap.requests ?? []) {
    s.push(
      db
        .prepare('UPDATE requests SET status = ?, handled_by_staff_id = ?, handled_at = ?, handle_note = ? WHERE id = ?')
        .bind(r.status, r.handled_by_staff_id, r.handled_at, r.handle_note, r.id),
    );
  }
  s.push(
    db
      .prepare(
        `UPDATE audit_log SET undone_at = ?, undone_by_staff_id = ?
          WHERE action = 'household.merge' AND target_type = 'merge' AND target_id = ? AND undone_at IS NULL`,
      )
      .bind(nowIso, staffId, String(m.id)),
    auditStatement(db, {
      staffId,
      action: 'household.merge_undo',
      targetType: 'merge',
      targetId: m.id,
      before: { keptHouseholdId: k, absorbedHouseholdId: a, points: kb },
      after: { points: { kept: snap.balances.kept, absorbed: snap.balances.absorbed } },
      reason: `${snap.absorbed.member_no} と ${snap.kept.member_no} の統合を元に戻した`,
      now,
    }),
  );
  try {
    await db.batch(s);
  } catch (e) {
    if (/NOT NULL constraint failed: merges/.test(String((e as Error)?.message))) {
      throw errors.conflict(
        'merge_changed_after',
        'まとめた後に、このおうちの来場やポイントの変更があったため、元に戻せませんでした。製作者に依頼してください。',
      );
    }
    throw e;
  }
  await refreshDailyStatsForHouseholdsQuietly(db, [k, a], now);
}

/** 統合後の、組み合わせた犬の情報(元に戻すときの変更履歴に使う) */
function mergedProfile(p: MergeSnapshot['pairs'][number]): Partial<DogRow> {
  const chosen = p.take === 'absorb' ? p.absorb : p.keep;
  const other = p.take === 'absorb' ? p.keep : p.absorb;
  const photo = mergePhotoSide(p) === 'absorb' ? p.absorb : p.keep;
  return {
    name: chosen.name,
    photo_key: photo.photo_key,
    thumb_key: photo.thumb_key,
    breed_id: chosen.breed_id,
    breed_other: chosen.breed_other,
    size: chosen.size,
    sex: chosen.sex ?? other.sex,
    birth_ym: chosen.birth_ym ?? other.birth_ym,
  };
}

/**
 * 来場履歴を見るときに含めるおうち(5.3)。
 * そのおうちと、そのおうちにまとめられたおうち(元に戻していない統合をたどる)。
 * 統合前に同じ日に両方が来場していた分は、まとめた側のおうちに残っているため、
 * 来場履歴(C-07・M-06)は visits.household_id IN (この一覧) で探すと、統合先からも見える。
 */
export async function historyHouseholdIds(db: D1Database, householdId: number): Promise<number[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE h(id) AS (
         SELECT ?
         UNION
         SELECT m.absorbed_household_id FROM merges m JOIN h ON m.kept_household_id = h.id WHERE m.undone_at IS NULL
       )
       SELECT id FROM h ORDER BY id`,
    )
    .bind(householdId)
    .all<{ id: number }>();
  return results.map((r) => r.id);
}
