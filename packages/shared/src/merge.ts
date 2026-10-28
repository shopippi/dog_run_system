import type { LedgerKind } from './constants';

// おうちの統合の計算(要件定義書 5.3、A-07)。データベースを使わない純粋な関数だけを置き、API と画面で共有する。

/** 同じ犬の組み合わせ。take は、写真・名前・犬種をどちらの犬から残すか */
export type MergeDogPair = { keep: number; absorb: number; take: 'keep' | 'absorb' };

/** 統合を元に戻せる日数(3.3、5.3) */
export const MERGE_UNDO_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 犬の組み合わせを確かめる。問題があれば、画面にそのまま出せる日本語を返す。
 * - keep は残すおうちの、absorb はまとめるおうちの、登録中の犬であること
 * - 1頭の犬を2回組み合わせないこと
 */
export function validateDogPairs(pairs: MergeDogPair[], keepDogIds: number[], absorbDogIds: number[]): string | null {
  const keepSet = new Set(keepDogIds);
  const absorbSet = new Set(absorbDogIds);
  const usedKeep = new Set<number>();
  const usedAbsorb = new Set<number>();
  for (const p of pairs) {
    if (!keepSet.has(p.keep) || !absorbSet.has(p.absorb)) {
      return 'ワンちゃんの登録が変わりました。画面を読み込み直して、同じワンちゃんを組み合わせ直してください。';
    }
    if (usedKeep.has(p.keep) || usedAbsorb.has(p.absorb)) {
      return '1頭のワンちゃんを、2頭と組み合わせることはできません。組み合わせを選び直してください。';
    }
    usedKeep.add(p.keep);
    usedAbsorb.add(p.absorb);
  }
  return null;
}

/** 残す会員IDの初期値。登録が古い方(同じ日時なら会員IDの番号が小さい方) */
export function defaultKeepHousehold(a: { id: number; registeredAt: string }, b: { id: number; registeredAt: string }): number {
  const ta = new Date(a.registeredAt).getTime();
  const tb = new Date(b.registeredAt).getTime();
  if (ta !== tb) return ta < tb ? a.id : b.id;
  return Math.min(a.id, b.id);
}

export type MergeLedgerPlan = { household: 'kept' | 'absorbed'; delta: number; kind: Extract<LedgerKind, 'merge' | 'ticket_issue'> };

export type MergePointsPlan = {
  /** 合計(無料券の発行の前) */
  total: number;
  /** 統合で発行する無料券の枚数。無料券には自動で替えない(8章)ため、いつも 0 */
  ticketsIssued: number;
  /** 統合後の残すおうちの残高 */
  balanceAfter: number;
  /** 台帳に書く行。まとめた側の残高をゼロにする行、残す側に足す行 */
  ledger: MergeLedgerPlan[];
};

/**
 * ポイントの合算(5.3)。両方の残高を合計する。無料券1枚分以上になっても、自動では交換しない(8章)。
 * 例: 7ポイントと5ポイント → 合計12ポイント(交換はお客さんが会員証で押す)
 */
export function planMergePoints(
  keptBalance: number,
  absorbedBalance: number,
  pointsPerTicket: number,
  /** 同じ日の来場の分を差し引くとき、その点数(設定 merge_keep_same_day_points が false のとき。初期値は差し引かない) */
  sameDayPoints = 0,
): MergePointsPlan {
  const ledger: MergeLedgerPlan[] = [];
  if (absorbedBalance !== 0) {
    ledger.push({ household: 'absorbed', delta: -absorbedBalance, kind: 'merge' });
    ledger.push({ household: 'kept', delta: absorbedBalance, kind: 'merge' });
  }
  if (sameDayPoints > 0) ledger.push({ household: 'kept', delta: -sameDayPoints, kind: 'merge' });
  const total = keptBalance + absorbedBalance - sameDayPoints;
  void pointsPerTicket;
  return { total, ticketsIssued: 0, balanceAfter: total, ledger };
}

/** 統合で残す犬の情報。写真・名前・犬種(サイズを含む)は選んだ方から、性別と生まれた年月は空でない方から */
export type MergeDogProfile = {
  id: number;
  name: string;
  breedName: string;
  size: string;
  sex: string | null;
  birthYm: string | null;
  photoUrl: string | null;
  thumbUrl: string | null;
};

/**
 * 統合後の犬の一覧(5.3)。
 * - 組み合わせた犬は1頭にする。犬IDは残すおうちの犬のもの。写真・名前・犬種は take で選んだ方
 * - 組み合わせなかった犬は、両方ともそのまま残す(まとめるおうちの犬は、残すおうちに移る)
 */
export function planMergeDogs<D extends MergeDogProfile>(
  keepDogs: D[],
  absorbDogs: D[],
  pairs: MergeDogPair[],
): (D & { mergedFromId: number | null })[] {
  const absorbById = new Map(absorbDogs.map((d) => [d.id, d]));
  const pairByKeep = new Map(pairs.map((p) => [p.keep, p]));
  const pairedAbsorb = new Set(pairs.map((p) => p.absorb));
  const out: (D & { mergedFromId: number | null })[] = [];
  for (const k of keepDogs) {
    const p = pairByKeep.get(k.id);
    const a = p ? absorbById.get(p.absorb) : undefined;
    if (!p || !a) {
      out.push({ ...k, mergedFromId: null });
      continue;
    }
    const chosen = p.take === 'absorb' ? a : k;
    const other = p.take === 'absorb' ? k : a;
    out.push({
      ...k,
      name: chosen.name,
      breedName: chosen.breedName,
      size: chosen.size,
      photoUrl: chosen.photoUrl,
      thumbUrl: chosen.thumbUrl,
      sex: chosen.sex ?? other.sex,
      birthYm: chosen.birthYm ?? other.birthYm,
      mergedFromId: a.id,
    });
  }
  for (const a of absorbDogs) if (!pairedAbsorb.has(a.id)) out.push({ ...a, mergedFromId: null });
  return out;
}

/**
 * 両方のおうちが来場していた日(取り消しを除く)。
 * この日のまとめる側の来場は、来場の一意の索引(おうち+来場日)にぶつかるため、まとめる側のおうちに残す
 * (ポイントは減らさない。来場履歴では統合先からも見えるようにする)。
 */
export function sameDayVisitDates(keptDates: string[], absorbedDates: string[]): string[] {
  const kept = new Set(keptDates);
  return [...new Set(absorbedDates.filter((d) => kept.has(d)))].sort();
}

/** 統合を元に戻せる期限(実行から30日後) */
export function mergeUndoDeadline(executedAt: string): Date {
  return new Date(new Date(executedAt).getTime() + MERGE_UNDO_DAYS * DAY_MS);
}

/**
 * 統合を元に戻せるか(5.3)。
 * - ok: 戻せる
 * - undone: すでに戻した
 * - expired: 30日を過ぎた
 * - changed: 統合後に、そのおうちの来場・ポイントの変更がある
 */
export function mergeUndoStatus(args: {
  executedAt: string;
  undoneAt: string | null;
  now: Date;
  changedAfter: boolean;
}): 'ok' | 'undone' | 'expired' | 'changed' {
  if (args.undoneAt) return 'undone';
  if (args.now.getTime() > mergeUndoDeadline(args.executedAt).getTime()) return 'expired';
  if (args.changedAfter) return 'changed';
  return 'ok';
}
