// デモの初期データ。半年分の来場・ポイント・無料券・天気・祝日・イベントを、台帳と矛盾しない形で作る。
// 乱数は固定の種から作るので、何度やり直しても同じデータになる(日付だけは「今日」に合わせて動く)。

import {
  addDays,
  autoHouseholdName,
  formatDogNo,
  formatMemberNo,
  normalizeForSearch,
  toJstDate,
  toJstIso,
  weekdayOf,
} from '@dr/shared';
import type { Database, SqlValue } from 'sql.js';
import { ACCOUNTS, DEMO_PASSWORD, FIXED, STAFF } from './fixtures';

export type SeedOptions = {
  now: Date;
  hashPassword: (password: string) => Promise<string>;
  /** 犬の写真(JPEG)を作る。variant で色や形を変える。なければ写真なしで作る */
  makeDogPhoto?: (variant: number, kind: 'photo' | 'thumb') => Promise<Uint8Array>;
  /** 旧カード(紙のスタンプカード)の写真 */
  makeCardPhoto?: () => Promise<Uint8Array>;
  putMedia?: (key: string, bytes: Uint8Array) => Promise<void>;
  /** 写真をつけるおうちの数(先頭から) */
  photoHouseholds?: number;
};

export type SeedSummary = { households: number; visits: number; walkins: number; tickets: number };

// ---------------------------------------------------------------- 乱数

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 固定の値

/** 2026年の祝日(内閣府の発表どおり)と、2027年の1月の祝日 */
export const HOLIDAYS: Record<string, string> = {
  '2026-01-01': '元日',
  '2026-01-12': '成人の日',
  '2026-02-11': '建国記念の日',
  '2026-02-23': '天皇誕生日',
  '2026-03-20': '春分の日',
  '2026-04-29': '昭和の日',
  '2026-05-03': '憲法記念日',
  '2026-05-04': 'みどりの日',
  '2026-05-05': 'こどもの日',
  '2026-05-06': '休日',
  '2026-07-20': '海の日',
  '2026-08-11': '山の日',
  '2026-09-21': '敬老の日',
  '2026-09-22': '休日',
  '2026-09-23': '秋分の日',
  '2026-10-12': 'スポーツの日',
  '2026-11-03': '文化の日',
  '2026-11-23': '勤労感謝の日',
  '2027-01-01': '元日',
  '2027-01-11': '成人の日',
};

/** migrations/0001_init.sql の犬種(id は入れた順) */
const BREEDS = [
  { id: 1, size: 'small', w: 18 }, // トイプードル
  { id: 2, size: 'small', w: 10 }, // チワワ
  { id: 3, size: 'small', w: 10 }, // ミニチュアダックスフンド
  { id: 4, size: 'small', w: 6 }, // ポメラニアン
  { id: 5, size: 'medium', w: 12 }, // 柴犬
  { id: 6, size: 'medium', w: 6 }, // フレンチブルドッグ
  { id: 7, size: 'medium', w: 4 }, // ボーダーコリー
  { id: 8, size: 'large', w: 4 }, // ゴールデンレトリバー
  { id: 9, size: 'large', w: 4 }, // ラブラドールレトリバー
  { id: 10, size: 'small', w: 8 }, // ミックス
  { id: 11, size: 'small', w: 4 }, // その他
] as const;
const OTHER_BREEDS: [string, 'small' | 'medium'][] = [
  ['ジャックラッセルテリア', 'small'],
  ['ビーグル', 'medium'],
  ['ウェルシュコーギー', 'medium'],
  ['シーズー', 'small'],
];

const DOG_NAMES = [
  'もも', 'ココ', 'マロン', 'ソラ', 'ハナ', 'レオ', 'チョコ', 'ムギ', 'ラッキー', 'サクラ', 'モカ', 'ルナ', 'リク',
  'コタロウ', 'きなこ', 'あずき', 'ベル', 'ミルク', 'ナナ', 'ハル', 'くるみ', 'ゴン', 'テン', 'ジロー', 'マル', 'ラテ',
  'ショコラ', 'ユキ', 'さくら', 'ポン', 'ふく', 'こてつ', 'ルル', 'チャチャ', 'わらび', 'おもち', 'ノア', 'ビビ',
];
const PEOPLE = [
  'ゆき', 'Kenji', 'まみ', 'たろう', 'Aya', 'ひろ', 'さとみ', 'Yuta', 'なお', 'えり', 'しん', 'Mika', 'かおり',
  'ともや', 'あや', 'じゅん', 'まゆ', 'Ryo', 'のりこ', 'けい', 'ちひろ', 'Sho', 'りえ', 'ゆうこ', 'だい', 'みほ',
  'はるか', 'Taku', 'みき', 'こうじ',
];
const AGES = ['20代', '30代', '30代', '40代', '40代', '50代', '60代', '70代以上'];
const REFERRALS = ['Instagram', 'Googleマップ', '知人の紹介', '通りがかり', 'ほかのドッグランで聞いた', 'その他'];
const TRANSPORTS = ['車', '車', '車', '徒歩', '自転車', '電車やバス'];
const POSTALS = ['1540001', '1540017', '1520004', '1560043', '1530064', '1580094', '1450062', '1810013', '1820021', '2140014'];

/** 東京の月ごとのおおよその気温(最高・最低) */
const TEMPS: [number, number][] = [
  [10, 1], [11, 2], [14, 5], [19, 10], [23, 15], [26, 19], [30, 23], [31, 24], [27, 21], [22, 15], [17, 9], [12, 4],
];

// ---------------------------------------------------------------- 型

type Dog = {
  id: number;
  no: string;
  name: string;
  breedId: number;
  breedOther: string | null;
  size: string;
  sex: 'male' | 'female';
  birthYm: string;
};
type Member = {
  id: number;
  userId: string;
  name: string;
  age: string;
  gender: string;
  joinedAt: string;
  method: 'register' | 'invite';
};
type Household = {
  id: number;
  regAt: string;
  source: 'new' | 'migration';
  migration: { points: number; source: 'line_card' | 'paper_card' } | null;
  rate: number;
  dogs: Dog[];
  members: Member[];
  postal: string | null;
  referral: string;
  transport: string | null;
};
type Visit = {
  id: number;
  hid: number | null;
  date: string;
  at: string;
  dogIds: number[];
  count: number;
  method: 'self' | 'proxy' | 'walkin';
  memberId: number | null;
  staffId: number | null;
  useTicket: boolean;
};

const at = (date: string, minutes: number) =>
  `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00+09:00`;

// ---------------------------------------------------------------- 本体

export async function seedDemo(sql: Database, opts: SeedOptions): Promise<SeedSummary> {
  const rand = mulberry32(20261028);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const weighted = <T extends { w: number }>(arr: readonly T[]): T => {
    let r = rand() * arr.reduce((s, x) => s + x.w, 0);
    for (const x of arr) if ((r -= x.w) < 0) return x;
    return arr[arr.length - 1]!;
  };

  const now = opts.now;
  const nowIso = toJstIso(now);
  const today = toJstDate(now);
  const nowMinutes = Number(nowIso.slice(11, 13)) * 60 + Number(nowIso.slice(14, 16));
  const START = addDays(today, -182);
  const days: string[] = [];
  for (let d = START; d < today; d = addDays(d, 1)) days.push(d);

  // ---- 天気・休業日・イベント
  const weather = new Map<string, { w: '晴れ' | '曇り' | '雨'; max: number; min: number; rain: number }>();
  for (const d of days) {
    const month = Number(d.slice(5, 7));
    const rainy = month === 6 ? 0.35 : month === 9 ? 0.3 : month === 7 ? 0.25 : 0.17;
    const r = rand();
    const w = r < rainy ? '雨' : r < rainy + 0.28 ? '曇り' : '晴れ';
    const [tmax, tmin] = TEMPS[month - 1]!;
    const jitter = () => Math.round((rand() * 5 - 2.5) * 10) / 10;
    weather.set(d, {
      w,
      max: Math.round((tmax + jitter() - (w === '雨' ? 2 : 0)) * 10) / 10,
      min: Math.round((tmin + jitter()) * 10) / 10,
      rain: w === '雨' ? Math.round((3 + rand() * 30) * 10) / 10 : w === '曇り' && rand() < 0.3 ? 0.5 : 0,
    });
  }
  const firstWeekdayFrom = (d: string) => {
    while (weekdayOf(d) === 0 || weekdayOf(d) === 6 || HOLIDAYS[d]) d = addDays(d, 1);
    return d;
  };
  const closed = new Map<string, string>([
    [firstWeekdayFrom(addDays(today, -121)), '芝生の手入れのため休業'],
    [firstWeekdayFrom(addDays(today, -47)), '台風のため臨時休業'],
  ]);
  for (const d of closed.keys()) {
    if (closed.get(d)!.includes('台風')) weather.set(d, { w: '雨', max: 22.5, min: 18.1, rain: 86.5 });
  }
  const nextSaturday = (d: string) => {
    while (weekdayOf(d) !== 6) d = addDays(d, 1);
    return d;
  };
  const events = [
    { date: nextSaturday(addDays(today, -150)), name: 'しつけ教室', kind: '教室', memo: '講師: ドッグトレーナー 1名。参加 12組' },
    { date: nextSaturday(addDays(today, -96)), name: '初夏の写真撮影会', kind: '撮影会', memo: 'カメラマンによる撮影。予約制' },
    { date: nextSaturday(addDays(today, -33)), name: 'ハロウィン仮装の日', kind: '季節の催し', memo: '仮装したワンちゃんにおやつのプレゼント' },
    { date: nextSaturday(addDays(today, 12)), name: '保護犬の譲渡会', kind: '譲渡会', memo: '地域の保護団体と共催' },
  ];
  const eventDates = new Set(events.map((e) => e.date));

  const isOpen = (d: string) => !closed.has(d);
  const isWeekend = (d: string) => weekdayOf(d) === 0 || weekdayOf(d) === 6 || Boolean(HOLIDAYS[d]);
  const dayWeight = (d: string) => {
    if (!isOpen(d)) return 0;
    let w = isWeekend(d) ? 2.6 : 1;
    const wx = weather.get(d)?.w;
    if (wx === '雨') w *= 0.25;
    else if (wx === '曇り') w *= 0.85;
    if (eventDates.has(d)) w *= 2.2;
    return w;
  };

  // ---- おうち・家族・犬
  let dogSeq = 0;
  let memberSeq = 0;
  const households: Household[] = [];
  const usedUsers = new Set<string>();

  const makeDog = (h: Household, name: string, breedId?: number, sex?: 'male' | 'female'): Dog => {
    const b = breedId ? BREEDS.find((x) => x.id === breedId)! : weighted(BREEDS);
    let breedOther: string | null = null;
    let size: string = b.size;
    if (b.id === 11) {
      const o = pick(OTHER_BREEDS);
      breedOther = o[0];
      size = o[1];
    }
    const year = 2013 + Math.floor(rand() * 12);
    const dog: Dog = {
      id: ++dogSeq,
      no: formatDogNo(formatMemberNo(h.id), h.dogs.length + 1),
      name,
      breedId: b.id,
      breedOther,
      size,
      sex: sex ?? (rand() < 0.5 ? 'male' : 'female'),
      birthYm: `${year}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}`,
    };
    h.dogs.push(dog);
    return dog;
  };
  const makeMember = (h: Household, m: Partial<Member> & { joinedAt: string }): Member => {
    let name = m.name ?? pick(PEOPLE);
    while (!m.name && usedUsers.has(name)) name = pick(PEOPLE) + (rand() < 0.5 ? '' : String(Math.floor(rand() * 90) + 10));
    usedUsers.add(name);
    const member: Member = {
      id: ++memberSeq,
      userId: m.userId ?? `U-demo-h${String(h.id).padStart(3, '0')}-${h.members.length + 1}`,
      name,
      age: m.age ?? pick(AGES),
      gender: m.gender ?? (rand() < 0.62 ? '女性' : rand() < 0.9 ? '男性' : '答えない'),
      joinedAt: m.joinedAt,
      method: m.method ?? (h.members.length === 0 ? 'register' : 'invite'),
    };
    h.members.push(member);
    return member;
  };
  const newHousehold = (id: number, regAt: string, rate: number, extra: Partial<Household> = {}): Household => {
    const h: Household = {
      id,
      regAt,
      source: 'new',
      migration: null,
      rate,
      dogs: [],
      members: [],
      postal: rand() < 0.7 ? pick(POSTALS) : null,
      referral: pick(REFERRALS),
      transport: rand() < 0.85 ? pick(TRANSPORTS) : null,
      ...extra,
    };
    households.push(h);
    return h;
  };

  // 固定のおうち(手順で使う)
  const account = (id: string) => ACCOUNTS.find((a) => a.userId === id)!;
  const hKomugi = newHousehold(FIXED.komugi, at(addDays(START, 1), 10 * 60 + 20), 0, { referral: 'Instagram', transport: '車', postal: '1540001' });
  makeDog(hKomugi, 'こむぎ', 1, 'female');
  makeDog(hKomugi, 'だいず', 5, 'male');
  makeMember(hKomugi, { userId: 'U-demo-mama', name: account('U-demo-mama').name, age: '30代', gender: '女性', joinedAt: hKomugi.regAt });
  makeMember(hKomugi, { userId: 'U-demo-baaba', name: account('U-demo-baaba').name, age: '60代', gender: '女性', joinedAt: at(addDays(START, 40), 11 * 60) });

  const hTaka = newHousehold(FIXED.taka, at(addDays(START, 2), 9 * 60 + 40), 0, { referral: '通りがかり', transport: '徒歩', postal: '1520004' });
  makeDog(hTaka, 'アル', 5, 'male');
  makeMember(hTaka, { userId: 'U-demo-taka', name: account('U-demo-taka').name, age: '40代', gender: '男性', joinedAt: hTaka.regAt });

  const hNico = newHousehold(FIXED.nico, at(addDays(START, 60), 13 * 60 + 5), 0, { referral: '知人の紹介', transport: '車', postal: '1520004' });
  makeDog(hNico, 'アル', 5, 'male');
  makeDog(hNico, 'ニコ', 1, 'female');
  makeMember(hNico, { userId: 'U-demo-nico', name: account('U-demo-nico').name, age: '40代', gender: '女性', joinedAt: hNico.regAt });

  const hMomo = newHousehold(FIXED.momo, at(addDays(START, 3), 15 * 60 + 30), 0, { referral: 'Googleマップ', transport: '自転車' });
  makeDog(hMomo, 'もも', 3, 'female');
  makeMember(hMomo, { userId: 'U-demo-momo', name: account('U-demo-momo').name, age: '50代', gender: '女性', joinedAt: hMomo.regAt });

  // そのほかのおうち(26件)。登録日の順に番号をふる
  const regDates: string[] = [];
  for (let i = 0; i < 26; i++) {
    const offset = i < 7 ? Math.floor(rand() * 15) : Math.floor(rand() * 178);
    regDates.push(addDays(START, offset));
  }
  regDates.sort();
  const twoMembers = new Set<number>();
  while (twoMembers.size < 4) twoMembers.add(5 + Math.floor(rand() * 26));
  regDates.forEach((d, i) => {
    const id = 5 + i;
    const r = rand();
    const rate = r < 0.15 ? 0.22 : r < 0.45 ? 0.09 : 0.035;
    const early = d < addDays(START, 30);
    const migration = early && rand() < 0.5 ? { points: 2 + Math.floor(rand() * 7), source: rand() < 0.7 ? ('line_card' as const) : ('paper_card' as const) } : null;
    const h = newHousehold(id, at(d, 9 * 60 + Math.floor(rand() * 8 * 60)), rate, {
      source: migration ? 'migration' : 'new',
      migration,
    });
    const n = rand() < 0.6 ? 1 : rand() < 0.75 ? 2 : 3;
    const names = new Set<string>();
    while (names.size < n) names.add(pick(DOG_NAMES));
    for (const name of names) makeDog(h, name);
    const first = [...names][0]!;
    makeMember(h, {
      joinedAt: h.regAt,
      name: rand() < 0.3 ? `${first}${rand() < 0.7 ? 'ママ' : 'パパ'}` : undefined,
    });
    if (twoMembers.has(id)) {
      const join = addDays(d, 5 + Math.floor(rand() * 40));
      if (join < today) makeMember(h, { joinedAt: at(join, 10 * 60 + Math.floor(rand() * 300)) });
    }
  });

  // ---- 来場
  const visits: Visit[] = [];
  const randomTime = (d: string) => {
    const span = isWeekend(d) ? 8 * 60 : 7 * 60;
    return at(d, 9 * 60 + Math.floor(rand() * span));
  };
  const memberOn = (h: Household, iso: string) => {
    const ok = h.members.filter((m) => m.joinedAt <= iso);
    return ok.length ? pick(ok) : h.members[0]!;
  };
  const dogsFor = (h: Household) => {
    if (h.dogs.length === 1 || rand() < 0.8) return h.dogs.map((d) => d.id);
    const sub = h.dogs.filter(() => rand() < 0.5);
    return (sub.length ? sub : [h.dogs[0]!]).map((d) => d.id);
  };
  const addVisit = (h: Household, iso: string, opts: { proxy?: boolean; dogIds?: number[] } = {}) => {
    const proxy = opts.proxy ?? rand() < 0.07;
    const dogIds = opts.dogIds ?? dogsFor(h);
    visits.push({
      id: 0,
      hid: h.id,
      date: iso.slice(0, 10),
      at: iso,
      dogIds,
      count: dogIds.length,
      method: proxy ? 'proxy' : 'self',
      memberId: proxy ? null : memberOn(h, iso).id,
      staffId: proxy ? (rand() < 0.7 ? 1 : 2) : null,
      useTicket: false,
    });
  };

  // 固定のおうち: 決まった回数だけ、週末にまんべんなく来る(今日は来ていない)
  const fixedVisits = (h: Household, count: number, dogIds?: number[]) => {
    const from = addDays(h.regAt.slice(0, 10), 1);
    const cands = days.filter((d) => d >= from && isOpen(d) && isWeekend(d) && weather.get(d)?.w !== '雨');
    for (let i = 0; i < count; i++) {
      const d = cands[Math.min(cands.length - 1, Math.floor(((i + 0.5) * cands.length) / count))]!;
      addVisit(h, randomTime(d), { proxy: false, dogIds });
    }
  };
  fixedVisits(hKomugi, 19);
  fixedVisits(hTaka, 7);
  fixedVisits(hNico, 5);
  fixedVisits(hMomo, 4);

  // そのほかのおうち: 曜日・天気・イベントで来やすさが変わる。合計がおよそ 560 件になるように調整する
  const randomHouseholds = households.filter((h) => h.id >= 5);
  let expected = 0;
  for (const h of randomHouseholds) for (const d of days) if (d > h.regAt.slice(0, 10)) expected += h.rate * dayWeight(d);
  const scale = 555 / expected;
  for (const h of randomHouseholds) {
    for (const d of days) {
      if (d <= h.regAt.slice(0, 10)) continue;
      if (rand() < Math.min(0.85, h.rate * scale * dayWeight(d))) addVisit(h, randomTime(d));
    }
    // 登録の日にも来ている(登録はドッグランの受付で行うことが多い)
    if (rand() < 0.7) addVisit(h, at(h.regAt.slice(0, 10), Math.min(17 * 60 + 30, Number(h.regAt.slice(11, 13)) * 60 + Number(h.regAt.slice(14, 16)) + 3)));
  }
  // 今日の来場(いまの時刻より前に、数組。写真のあるおうちを中心に)
  const todayVisitors = randomHouseholds.filter((h) => h.regAt.slice(0, 10) < today).slice(0, 10);
  if (nowMinutes >= 9 * 60 + 30) {
    const n = Math.min(5, Math.floor((nowMinutes - 9 * 60) / 45) + 1);
    for (let i = 0; i < n; i++) {
      const h = todayVisitors[(i * 3) % todayVisitors.length]!;
      const m = 9 * 60 + Math.floor(((nowMinutes - 15 - 9 * 60) * (i + 0.5)) / n);
      addVisit(h, at(today, m), { proxy: false });
    }
  }

  // 1日1回(同じおうちの同じ日の来場は1つにする)
  const seen = new Set<string>();
  const memberVisits = visits
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((v) => {
      const k = `${v.hid}:${v.date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  // 会員以外のお客さん
  const walkins: Visit[] = [];
  for (const d of days) {
    const p = Math.min(0.9, 0.22 * dayWeight(d));
    if (rand() < p) {
      const count = rand() < 0.7 ? 1 : 2;
      walkins.push({ id: 0, hid: null, date: d, at: randomTime(d), dogIds: [], count, method: 'walkin', memberId: null, staffId: 1, useTicket: false });
    }
  }
  if (nowMinutes >= 10 * 60) {
    walkins.push({ id: 0, hid: null, date: today, at: at(today, 9 * 60 + 40), dogIds: [], count: 1, method: 'walkin', memberId: null, staffId: 1, useTicket: false });
  }

  const allVisits = [...memberVisits, ...walkins].sort((a, b) => a.at.localeCompare(b.at));
  allVisits.forEach((v, i) => {
    v.id = i + 1;
  });

  // ---- 書き込み(待ち時間のある処理は、まとめて書き込む前に済ませる)
  const hashes: string[] = [];
  for (const _ of STAFF) hashes.push(await opts.hashPassword(DEMO_PASSWORD));
  let cardKey: string | null = null;
  if (opts.makeCardPhoto && opts.putMedia) {
    cardKey = `requests/${formatMemberNo(hMomo.id)}/demo-paper-card.jpg`;
    await opts.putMedia(cardKey, await opts.makeCardPhoto());
  }
  const run = (q: string, params: SqlValue[] = []) => sql.run(q, params);
  sql.run('BEGIN');
  try {
    // スタッフ
    for (const [i, s] of STAFF.entries()) {
      run(
        `INSERT INTO staff_users (id, email, name, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        [i + 1, s.email, s.name, hashes[i]!, s.role, at(START, 9 * 60), at(START, 9 * 60)],
      );
    }

    // おうち・家族・犬
    for (const h of households.sort((a, b) => a.id - b.id)) {
      const name = autoHouseholdName(h.dogs.map((d) => d.name));
      run(
        `INSERT INTO households (id, member_no, display_name, display_name_search, display_name_auto, registered_at, source,
                                 postal_code, referral, transport, status, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'active', ?)`,
        [h.id, formatMemberNo(h.id), name, normalizeForSearch(name), h.regAt, h.source, h.postal, h.referral, h.transport, h.regAt],
      );
      for (const m of h.members) {
        run(
          `INSERT INTO family_members (id, household_id, line_user_id, line_display_name, line_display_name_search, age_group, gender,
                                       consented_at, joined_at, join_method, status, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
          [m.id, h.id, m.userId, m.name, normalizeForSearch(m.name), m.age, m.gender, m.joinedAt, m.joinedAt, m.method, m.joinedAt],
        );
      }
      for (const d of h.dogs) {
        run(
          `INSERT INTO dogs (id, dog_no, household_id, name, name_search, breed_id, breed_other, size, sex, birth_ym, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          [d.id, d.no, h.id, d.name, normalizeForSearch(d.name), d.breedId, d.breedOther, d.size, d.sex, d.birthYm, h.regAt, h.regAt],
        );
      }
      if (h.migration) {
        run(
          `INSERT INTO point_ledger (household_id, delta, kind, migration_source, reason, actor_type, actor_id, created_at)
           VALUES (?, ?, 'migration', ?, '旧カードからの引き継ぎ(受付で確認)', 'staff', 2, ?)`,
          [h.id, h.migration.points, h.migration.source, h.regAt],
        );
      }
    }

    // 来場・ポイント・無料券(来場の順に、台帳と同じ計算をする)
    const balance = new Map<number, number>(households.map((h) => [h.id, h.migration?.points ?? 0]));
    const unused = new Map<number, number[]>();
    let ticketSeq = 0;
    const komugiVisits = memberVisits.filter((v) => v.hid === FIXED.komugi);
    for (const v of allVisits) {
      if (v.hid === null) {
        run(
          `INSERT INTO visits (id, household_id, visit_date, checked_in_at, dog_count, method, created_by_staff_id)
           VALUES (?, NULL, ?, ?, ?, 'walkin', ?)`,
          [v.id, v.date, v.at, v.count, v.staffId],
        );
        continue;
      }
      const hid = v.hid;
      const tickets = unused.get(hid) ?? [];
      const forced = hid === FIXED.komugi ? komugiVisits.indexOf(v) === 14 : null;
      const fixed = hid <= 4;
      v.useTicket = tickets.length > 0 && (forced ?? (!fixed && rand() < 0.45));
      run(
        `INSERT INTO visits (id, household_id, checked_in_member_id, visit_date, checked_in_at, dog_count, used_ticket, method, created_by_staff_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.id, hid, v.memberId, v.date, v.at, v.count, v.useTicket ? 1 : 0, v.method, v.staffId],
      );
      for (const dogId of v.dogIds) {
        run(
          `INSERT INTO visit_dogs (visit_id, dog_id, visit_date, added_by_member_id, created_at) VALUES (?, ?, ?, ?, ?)`,
          [v.id, dogId, v.date, v.memberId, v.at],
        );
      }
      const actorType = v.staffId ? 'staff' : 'member';
      const actorId = v.staffId ?? v.memberId;
      if (v.useTicket) {
        const t = tickets.shift()!;
        run(`UPDATE tickets SET status = 'used', used_visit_id = ?, used_at = ? WHERE id = ?`, [v.id, v.at, t]);
      }
      run(
        `INSERT INTO point_ledger (household_id, delta, kind, visit_id, actor_type, actor_id, created_at)
         VALUES (?, 1, 'visit', ?, ?, ?, ?)`,
        [hid, v.id, actorType, actorId, v.at],
      );
      let b = balance.get(hid)! + 1;
      while (b >= 10) {
        const tid = ++ticketSeq;
        run(
          `INSERT INTO tickets (id, household_id, issued_at, source, issued_visit_id, status) VALUES (?, ?, ?, 'points', ?, 'unused')`,
          [tid, hid, v.at, v.id],
        );
        run(
          `INSERT INTO point_ledger (household_id, delta, kind, visit_id, ticket_id, actor_type, actor_id, created_at)
           VALUES (?, -10, 'ticket_issue', ?, ?, ?, ?, ?)`,
          [hid, v.id, tid, actorType, actorId, v.at],
        );
        tickets.push(tid);
        b -= 10;
      }
      balance.set(hid, b);
      unused.set(hid, tickets);
    }

    // 日別の集計(前日まで。毎晩の処理と同じ内容)
    const firstVisit = new Map<number, string>();
    for (const v of memberVisits) if (v.hid && !firstVisit.has(v.hid)) firstVisit.set(v.hid, v.date);
    for (const d of days) {
      const vs = allVisits.filter((v) => v.date === d);
      run(
        `INSERT INTO daily_stats (date, visit_groups, dogs_member, dogs_walkin, new_households, first_visit_households, tickets_used, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d,
          vs.length,
          vs.filter((v) => v.hid).reduce((s, v) => s + v.count, 0),
          vs.filter((v) => !v.hid).reduce((s, v) => s + v.count, 0),
          households.filter((h) => h.regAt.slice(0, 10) === d).length,
          [...firstVisit.values()].filter((x) => x === d).length,
          vs.filter((v) => v.useTicket).length,
          at(addDays(d, 1), 3 * 60 + 10),
        ],
      );
    }

    // 天気・カレンダー・イベント
    for (const [d, w] of weather) {
      run(
        `INSERT INTO daily_weather (date, weather, temp_max, temp_min, precipitation, station, source, fetched_at)
         VALUES (?, ?, ?, ?, ?, '東京', '気象庁(デモ用の値)', ?)`,
        [d, w.w, w.max, w.min, w.rain, at(addDays(d, 1), 5 * 60 + 10)],
      );
    }
    const calEnd = addDays(today, 90) > '2026-12-31' ? addDays(today, 90) : '2026-12-31';
    for (let d = START; d <= calEnd; d = addDays(d, 1)) {
      const wd = weekdayOf(d);
      const holiday = HOLIDAYS[d] ?? null;
      const type = holiday ? 'holiday' : wd === 0 ? 'sunday' : wd === 6 ? 'saturday' : 'weekday';
      run(
        `INSERT INTO calendar (date, weekday, holiday_name, day_type, is_closed, closed_note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [d, wd, holiday, type, closed.has(d) ? 1 : 0, closed.get(d) ?? null, at(START, 9 * 60)],
      );
    }
    for (const e of events) {
      run(`INSERT INTO events (date, name, kind, memo, created_at) VALUES (?, ?, ?, ?, ?)`, [
        e.date,
        e.name,
        e.kind,
        e.memo,
        at(addDays(e.date, -20), 10 * 60),
      ]);
    }

    // 確認待ち: まとめる申請(nico.mama が taka_papa の招待を開いた)
    const takaMember = hTaka.members[0]!;
    const nicoMember = hNico.members[0]!;
    const reqAt = toJstIso(new Date(now.getTime() - 26 * 60 * 60 * 1000));
    run(
      `INSERT INTO requests (id, kind, household_id, related_household_id, requester_member_id, payload, status, created_at)
       VALUES (1, 'merge', ?, ?, ?, ?, 'pending', ?)`,
      [
        hNico.id,
        hTaka.id,
        nicoMember.id,
        JSON.stringify({ via: 'invite', inviteCode: 'demo-merge-invite', memberNo: formatMemberNo(hNico.id), relatedMemberNo: formatMemberNo(hTaka.id) }),
        reqAt,
      ],
    );
    run(
      `INSERT INTO invites (code, household_id, kind, created_by_member_id, created_at, expires_at, used_by_member_id, used_at, request_id)
       VALUES ('demo-merge-invite', ?, 'family', ?, ?, ?, ?, ?, 1)`,
      [hTaka.id, takaMember.id, toJstIso(new Date(now.getTime() - 27 * 3600e3)), toJstIso(new Date(now.getTime() - 3 * 3600e3)), nicoMember.id, reqAt],
    );

    // 確認待ち: 旧カードの引き継ぎ申請(紙のスタンプカード)
    run(
      `INSERT INTO requests (id, kind, household_id, requester_member_id, payload, attachment_key, status, created_at)
       VALUES (2, 'migration', ?, ?, ?, ?, 'pending', ?)`,
      [
        hMomo.id,
        hMomo.members[0]!.id,
        JSON.stringify({ source: 'paper_card', points: 7, tickets: 0, note: '紙のスタンプカードに7個押してあります' }),
        cardKey,
        toJstIso(new Date(now.getTime() - 5 * 3600e3)),
      ],
    );

    // ルール: 旧カードの移行期間(前後1か月)と、困ったときの連絡先
    run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('migration_period', ?, ?)`, [
      JSON.stringify({ start: addDays(today, -30), end: addDays(today, 30) }),
      nowIso,
    ]);
    run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('developer_contact', ?, ?)`, [
      'デモ用の連絡先です(製作者 山本 / 090-0000-0000)',
      nowIso,
    ]);

    sql.run('COMMIT');
  } catch (e) {
    sql.run('ROLLBACK');
    throw e;
  }

  // 犬の写真(先頭のおうちだけ。時間がかかりすぎないように)
  if (opts.makeDogPhoto && opts.putMedia) {
    const limit = opts.photoHouseholds ?? 10;
    let variant = 0;
    for (const h of households.filter((x) => x.id <= limit)) {
      for (const d of h.dogs) {
        const key = `dogs/${d.no}/demo-${d.id}`;
        await opts.putMedia(`${key}.jpg`, await opts.makeDogPhoto(variant, 'photo'));
        await opts.putMedia(`${key}_thumb.jpg`, await opts.makeDogPhoto(variant, 'thumb'));
        // 写真を入れ終えてから書き込む(1つずつの書き込みなので、途中で止まっても矛盾しない)
        sql.run('UPDATE dogs SET photo_key = ?, thumb_key = ? WHERE id = ?', [`${key}.jpg`, `${key}_thumb.jpg`, d.id]);
        variant++;
      }
    }
  }

  return {
    households: households.length,
    visits: memberVisits.length,
    walkins: walkins.length,
    tickets: Number(sql.exec('SELECT COUNT(*) FROM tickets')[0]?.values[0]?.[0] ?? 0),
  };
}
