/**
 * 統合でまとめたおうちも含めた、おうちの範囲(5.3)。
 * 統合された側のおうちは status = 'merged'、merged_into_id = 残した側のおうち になる。
 * 統合が重なっている場合(A に B をまとめ、その A を C にまとめた)も辿れるよう、再帰で集める。
 *
 * 使い方: `WITH RECURSIVE ${MERGED_HOUSEHOLDS_CTE} SELECT ... WHERE household_id IN (SELECT id FROM hh)`
 * 最初の ? に、残した側(いまのおうち)の id を入れる。
 */
export const MERGED_HOUSEHOLDS_CTE = `hh(id) AS (
  SELECT ?
  UNION
  SELECT h.id FROM households h JOIN hh ON h.merged_into_id = hh.id WHERE h.status = 'merged'
)`;
