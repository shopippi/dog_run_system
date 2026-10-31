import type { DogSummary, MeRegistered } from '@dr/shared';
import { currentUserKey } from './liff';
import { readJson, removeByPrefix, writeJson } from './storage';

// 会員証の「前に開いたときの内容」を端末に残す(要件定義書 15.3)。
// 電波が弱くても、開いたらすぐに前の内容を出し、裏で最新にする(stale-while-revalidate)。
//
// - LINE のユーザーごとに分ける(キーは LINE のユーザーID のハッシュ。ID そのものは残さない)。保存するのは1人分だけ
// - 残すのは会員証に出す内容だけ: おうちの呼び名・会員ID・ポイント・スタンプ・無料券・ワンちゃんの名前と犬種と写真の場所・背景。
//   LINE の表示名、体重・予防注射などのワンちゃんの詳しい情報、アンケートの回答は残さない
// - おうちから抜けたとき・別のおうちに入ったとき・まとめたとき・登録がなくなったときは消す

const PREFIX = 'dr.card.v1.';
/** これより古い内容は出さない(何日も前のポイントを「いま」のように見せない) */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type Saved = { savedAt: number; me: MeRegistered };

/** 会員証に出すのに要る項目だけにする */
function slimDog(d: DogSummary): DogSummary {
  return {
    id: d.id,
    dogNo: '',
    name: d.name,
    breedId: d.breedId,
    breedName: d.breedName,
    breedOther: null,
    size: d.size,
    sex: null,
    // 誕生月の一言(13章)に使う
    birthYm: d.birthYm,
    weightKg: null,
    sociability: null,
    rabiesVaccineYear: null,
    comboVaccineYear: null,
    status: d.status,
    photoUrl: null,
    thumbUrl: d.thumbUrl,
  };
}

export function slimMe(me: MeRegistered): MeRegistered {
  return {
    registered: true,
    member: { id: me.member.id, lineDisplayName: '' },
    household: { memberNo: me.household.memberNo, displayName: me.household.displayName },
    optionalSurveyPending: false,
    card: { ...me.card, dogs: me.card.dogs.map(slimDog) },
    cardBackground: me.cardBackground,
  };
}

export function loadCachedCard(): { me: MeRegistered; savedAt: number } | null {
  const user = currentUserKey();
  if (!user) return null;
  const saved = readJson<Saved>(PREFIX + user);
  if (!saved?.me?.registered || typeof saved.savedAt !== 'number') return null;
  if (Date.now() - saved.savedAt > MAX_AGE_MS) return null;
  return saved;
}

export function saveCachedCard(me: MeRegistered): void {
  const user = currentUserKey();
  if (!user) return;
  try {
    const slim = slimMe(me);
    // 1人分だけ残す(ほかの LINE ユーザーの分は消す)
    removeByPrefix(PREFIX);
    writeJson(PREFIX + user, { savedAt: Date.now(), me: slim } satisfies Saved);
  } catch {
    // 残せなくても画面は動く(次に開いたときに待つだけ)
  }
}

/** 端末に残した会員証を消す(おうちから抜けた・別のおうちに入った・まとめた・登録がなくなった) */
export function clearCachedCard(): void {
  removeByPrefix(PREFIX);
}
