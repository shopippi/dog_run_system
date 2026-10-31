import {
  datesBetween,
  addDays,
  DASHBOARD_MAX_DAYS,
  daysBetween,
  DOG_SIZE_LABELS,
  normalizePostal,
  toJstIso,
  type CsvColumn,
  type CsvValue,
  type DayType,
  type DogSize,
} from '@dr/shared';
import { loadDayFacts } from './day-facts';
import { householdColumnText } from './profile-fields';

// AI に渡しやすい CSV(A-14、docs/design.md 12.2)。
// - 分析パック: 1日1行の横長の表。天気・祝日・休業・イベント・その日のメモ・来場の内訳・無料券
// - おうちごとの表: 1おうち1行。会員IDの代わりに通し番号(おうち番号)を使い、名前・LINEの名前・郵便番号は入れない
// 列名は日本語で、単位を括弧で付ける。各列の意味は、説明行(#)に出す。

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_TYPE: Record<DayType, string> = { weekday: '平日', saturday: '土曜', sunday: '日曜', holiday: '祝日' };
const col = (name: string, desc: string): CsvColumn => ({ name, desc });
/** メモ・イベントは1つのセルに収める(改行は空白に、複数は「 / 」でつなぐ) */
const oneLine = (list: string[]) => list.map((t) => t.replace(/\s*\r?\n\s*/g, ' ').trim()).filter(Boolean).join(' / ');

type Period = { from: string; to: string };

/**
 * 分析パックの期間を決める。空欄なら「利用が始まった日から今日まで」。今日より先は出さない。
 * 長すぎるとき(3年より長い)は、終わりから3年分にする。
 */
export async function resolveAnalysisPeriod(db: D1Database, p: { from?: string; to?: string }, today: string): Promise<Period> {
  let to = p.to && p.to < today ? p.to : today;
  let from = p.from;
  if (!from) {
    const row = await db
      .prepare(
        `SELECT MIN(d) AS d FROM (
           SELECT MIN(date) AS d FROM daily_stats WHERE visit_groups > 0
           UNION ALL SELECT MIN(visit_date) FROM visits WHERE cancelled_at IS NULL
         )`,
      )
      .first<{ d: string | null }>();
    from = row?.d ?? addDays(today, -29);
  }
  if (from > to) to = from;
  if (daysBetween(from, to) + 1 > DASHBOARD_MAX_DAYS) from = addDays(to, -(DASHBOARD_MAX_DAYS - 1));
  return { from, to };
}

export const ANALYSIS_COLUMNS: CsvColumn[] = [
  col('日付', '日本時間の日付(年-月-日)'),
  col('曜日', '日〜土'),
  col('曜日区分', '平日 / 土曜 / 日曜 / 祝日(土日に重なった祝日は土曜・日曜)'),
  col('祝日名', '祝日・休日の名前(内閣府の発表)'),
  col('臨時休業', '臨時休業日なら「休業」。この日の来場はすべて 0 にしています'),
  col('休業の理由', '臨時休業日に管理者が書いた理由'),
  col('天気', '晴れ / 曇り / 雨(降水量 1mm 以上は雨、日照 4時間以上は晴れ、それ以外は曇り)。空欄は記録なし'),
  col('最高気温(℃)', 'アメダスの観測値'),
  col('最低気温(℃)', 'アメダスの観測値'),
  col('降水量(mm)', '1日の合計'),
  col('イベント', 'その日に登録したイベントの名前(複数は「 / 」でつなぐ)'),
  col('その日のメモ', '管理者・受付スタッフが書いたその日のメモ(複数は「 / 」でつなぐ)'),
  col('来場組数(組)', 'その日にチェックインしたおうちの数と、会員以外の入力の件数の合計(取り消しを除く)'),
  col('会員の来場組数(組)', 'その日にチェックインした会員のおうちの数'),
  col('来場頭数(頭)', '来場したワンちゃんの合計(会員 + 会員以外)'),
  col('会員のワンちゃん(頭)', '会員のおうちのワンちゃんの数'),
  col('会員以外のワンちゃん(頭)', '受付で入力した会員以外のワンちゃんの数'),
  col('初めて来たおうち(軒)', 'その日が初めての来場だったおうちの数'),
  col('新しいおうち(軒)', 'その日に会員IDを発行したおうちの数'),
  col('無料券の発行(枚)', 'その日に発行した無料券(ポイントとの交換など)'),
  col('無料券の使用(枚)', 'その日に使われた無料券'),
  // 2026-10-31 予約(21章)。列は後ろに足す
  col('預かりの予約(頭)', 'その日の預かりの予約のワンちゃんの数(確定・お預かり中・利用済み。確認待ち・お断り・キャンセルは除く)'),
  col('お泊まりの予約(頭)', 'その日の夜に泊まる予約のワンちゃんの数(確定・お預かり中・利用済み)'),
];

/** 日ごとの予約のワンちゃんの数(「サービス:日付」→ 頭数)。確定・お預かり中・利用済みだけ */
async function bookedDogsByDay(db: D1Database, from: string, to: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT b.service, b.occupy_from, b.occupy_to, COUNT(*) AS n
         FROM booking_dogs bd JOIN bookings b ON b.id = bd.booking_id
        WHERE b.status IN ('confirmed', 'checked_in', 'completed') AND b.occupy_from <= ? AND b.occupy_to >= ?
        GROUP BY b.id`,
    )
    .bind(to, from)
    .all<{ service: string; occupy_from: string; occupy_to: string; n: number }>();
  const out = new Map<string, number>();
  for (const r of results) {
    for (const d of datesBetween(r.occupy_from < from ? from : r.occupy_from, r.occupy_to > to ? to : r.occupy_to)) {
      const k = `${r.service}:${d}`;
      out.set(k, (out.get(k) ?? 0) + r.n);
    }
  }
  return out;
}

/** 分析パック(1日1行) */
export async function analysisPack(db: D1Database, period: Period, today: string): Promise<{ columns: CsvColumn[]; rows: CsvValue[][]; notes: string[] }> {
  const facts = await loadDayFacts(db, period.from, period.to, today);
  const booked = await bookedDogsByDay(db, period.from, period.to);
  const rows: CsvValue[][] = facts.map((f) => [
    f.date,
    WEEKDAY[f.weekday],
    DAY_TYPE[f.dayType],
    f.holidayName,
    f.closed ? '休業' : '',
    f.closedNote,
    f.weather,
    f.tempMax,
    f.tempMin,
    f.precipitation,
    oneLine(f.events),
    oneLine(f.noteBodies),
    f.groups,
    f.memberGroups,
    f.dogs,
    f.dogsMember,
    f.dogsWalkin,
    f.firstVisitHouseholds,
    f.newHouseholds,
    f.ticketsIssued,
    f.ticketsUsed,
    booked.get(`daycare:${f.date}`) ?? 0,
    booked.get(`boarding:${f.date}`) ?? 0,
  ]);
  return {
    columns: ANALYSIS_COLUMNS,
    rows,
    notes: [
      '1行が1日です。来場がなかった日も 0 の行があります。',
      '会員以外の来場は頭数だけを記録しています(どのおうちかは分かりません)。',
      '臨時休業日は来場をすべて 0 にしています。平均を出すときは、臨時休業の行を除いてください。',
      'その日のメモは、スタッフが書いた文のままです。',
    ],
  };
}

export const ANALYSIS_HOUSEHOLD_COLUMNS: CsvColumn[] = [
  col('おうち番号', 'このファイルの中だけの通し番号(登録の古い順。会員IDとは別)'),
  col('登録した月', '会員IDを発行した年-月'),
  col('登録のしかた', '新規 / 旧カードから移行'),
  col('都道府県', '郵便番号から調べた都道府県(空欄は郵便番号なし・まだ調べていない)'),
  col('市区町村', '郵便番号から調べた市区町村'),
  col('知ったきっかけ', 'アンケートの回答'),
  col('来場手段', 'アンケートの回答'),
  col('来たい時間帯', 'アンケートの回答(いくつでも。・でつなぐ)'),
  col('興味のあるイベント', 'アンケートの回答(いくつでも。・でつなぐ)'),
  col('ほかのドッグランの利用', '使う / 使わない'),
  col('家族の人数(人)', 'LINEでつながっている家族の数'),
  col('ワンちゃんの数(頭)', '登録中のワンちゃんの数'),
  col('ワンちゃんのサイズ', '登録中のワンちゃんのサイズ(・でつなぐ)'),
  col('犬種', '登録中のワンちゃんの犬種(・でつなぐ。自由入力の犬種は「その他」)'),
  col('期間中の来場回数(回)', '期間の中で来場した回数(取り消し・臨時休業日を除く)'),
  col('これまでの来場回数(回)', '今日までに来場した回数(取り消しを除く)'),
  col('最初の来場日', '日本時間の日付'),
  col('最後の来場日', '日本時間の日付'),
  col('最後の来場から(日)', '最後の来場日から今日までの日数'),
  col('いまのポイント(ポイント)', 'ポイント台帳の合計'),
  col('使える無料券(枚)', '未使用で期限内の無料券'),
];

/** おうちごとの表(有効なおうちだけ。1おうち1行) */
export async function analysisHouseholds(
  db: D1Database,
  period: Period,
  today: string,
  now: Date,
): Promise<{ columns: CsvColumn[]; rows: CsvValue[][]; notes: string[] }> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.registered_at, h.source, h.postal_code, h.referral, h.transport, h.preferred_times, h.event_interests,
              h.uses_other_runs,
              (SELECT COUNT(*) FROM family_members f WHERE f.household_id = h.id AND f.status = 'active') AS family,
              (SELECT COALESCE(SUM(p.delta), 0) FROM point_ledger p WHERE p.household_id = h.id) AS points,
              (SELECT COUNT(*) FROM tickets t WHERE t.household_id = h.id AND t.status = 'unused'
                  AND (t.expires_at IS NULL OR t.expires_at >= ?3)) AS tickets,
              (SELECT COUNT(*) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL
                  AND v.visit_date BETWEEN ?1 AND ?2
                  AND NOT EXISTS (SELECT 1 FROM calendar c WHERE c.date = v.visit_date AND c.is_closed = 1)) AS visits_in,
              (SELECT COUNT(*) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL AND v.visit_date <= ?4) AS visits_all,
              (SELECT MIN(v.visit_date) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL) AS first_visit,
              (SELECT MAX(v.visit_date) FROM visits v WHERE v.household_id = h.id AND v.cancelled_at IS NULL AND v.visit_date <= ?4) AS last_visit
         FROM households h
        WHERE h.status = 'active'
        ORDER BY h.registered_at, h.id`,
    )
    .bind(period.from, period.to, toJstIso(now), today)
    .all<Record<string, string | number | null>>();
  const ids = results.map((r) => Number(r.id));
  const [{ results: dogs }, { results: areas }] = await Promise.all([
    db
      .prepare(
        `SELECT d.household_id, d.size, CASE WHEN d.breed_other IS NOT NULL THEN 'その他' ELSE b.name END AS breed
           FROM dogs d JOIN breeds b ON b.id = d.breed_id
          WHERE d.status = 'active' AND d.household_id IN (SELECT value FROM json_each(?))
          ORDER BY d.id`,
      )
      .bind(JSON.stringify(ids))
      .all<{ household_id: number; size: DogSize; breed: string }>(),
    db.prepare("SELECT postal_code, prefecture, city FROM postal_areas WHERE status = 'found'").all<{ postal_code: string; prefecture: string | null; city: string | null }>(),
  ]);
  const areaOf = new Map(areas.map((a) => [a.postal_code, a]));
  const rows: CsvValue[][] = results.map((r, i) => {
    const mine = dogs.filter((d) => d.household_id === Number(r.id));
    const code = normalizePostal(r.postal_code as string | null);
    const area = code ? areaOf.get(code) : undefined;
    const last = r.last_visit as string | null;
    return [
      i + 1,
      String(r.registered_at).slice(0, 7),
      r.source === 'migration' ? '旧カードから移行' : '新規',
      area?.prefecture ?? '',
      area?.city ?? '',
      r.referral,
      r.transport,
      householdColumnText('preferred_times', r.preferred_times),
      householdColumnText('event_interests', r.event_interests),
      householdColumnText('uses_other_runs', r.uses_other_runs),
      r.family,
      mine.length,
      mine.map((d) => DOG_SIZE_LABELS[d.size] ?? d.size).join('・'),
      mine.map((d) => d.breed).join('・'),
      r.visits_in,
      r.visits_all,
      r.first_visit,
      last,
      last ? daysBetween(last, today) : '',
      r.points,
      r.tickets,
    ];
  });
  return {
    columns: ANALYSIS_HOUSEHOLD_COLUMNS,
    rows,
    notes: [
      '1行が1つのおうちです(統合済み・退会のおうちは入っていません)。',
      'おうち番号は、このファイルの中だけの番号です。会員IDや名前とは結びつけられません。',
    ],
  };
}
