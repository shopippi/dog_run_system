import { useState } from 'react';
import { Link } from 'react-router-dom';

const KEY = 'dr.profileNudge.later';
/** 「あとで」を押してから、また出すまでの日数 */
const LATER_DAYS = 30;

function hiddenNow(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return Date.now() - at < LATER_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * 会員証の下に小さく出す、任意のアンケート(来たい時間帯など)へのお誘い(C-03、担当J)。
 * 登録のあとのアンケートの画面(SurveyPrompt)は出さず、しつこく促さない。「あとで」で30日間出さない(この端末だけ)。
 */
export function ProfileNudge({ pending }: { pending: boolean | undefined }) {
  const [hidden, setHidden] = useState(hiddenNow);
  if (!pending || hidden) return null;
  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // 保存できなくても、この画面では閉じる
    }
    setHidden(true);
  };
  return (
    <div className="pf-nudge">
      <p className="note">来たい時間帯や、興味のあるイベントを教えてください(選ぶだけ・任意)。</p>
      <div className="pf-nudge-acts">
        <Link to="/profile" className="cu-link">
          答える
        </Link>
        <button type="button" className="pf-nudge-later" onClick={later}>
          あとで答える
        </button>
      </div>
    </div>
  );
}
