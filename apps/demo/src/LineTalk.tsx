import richmenu from './assets/richmenu.jpg';

/** リッチメニューの押せる場所(画像 2500×1686 の割合)と、開く画面。docs/line/richmenu.md と同じ */
export const RICH_MENU_AREAS = [
  { label: '会員証', route: '/', x: 0, y: 0, w: 1666, h: 843 },
  { label: 'チェックイン', route: 'checkin', x: 1666, y: 0, w: 834, h: 843 },
  { label: '来場履歴', route: '/history', x: 0, y: 843, w: 833, h: 843 },
  { label: 'ワンちゃん', route: '/dogs', x: 833, y: 843, w: 833, h: 843 },
  { label: '使い方', route: '/help', x: 1666, y: 843, w: 834, h: 843 },
] as const;

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/**
 * LINE 公式アカウントのトーク画面の再現(デモ用)。下にリッチメニュー。
 * 押すと onOpen(route) で、その画面を LINE の中で開いたときと同じように出す。
 */
export function LineTalk({ onOpen, facility }: { onOpen: (route: string) => void; facility: string }) {
  return (
    <div className="lt" role="region" aria-label="LINE のトーク画面">
      <div className="lt-head">
        <span className="lt-back" aria-hidden="true">‹</span>
        <span className="lt-title">{facility}</span>
        <span className="lt-icons" aria-hidden="true">
          <span />
          <span />
        </span>
      </div>
      <div className="lt-body">
        <p className="lt-date">今日</p>
        <div className="lt-msg">
          <span className="lt-avatar" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFFFFF"><ellipse cx="7" cy="8" rx="2" ry="2.6" /><ellipse cx="12" cy="6" rx="2" ry="2.6" /><ellipse cx="17" cy="8" rx="2" ry="2.6" /><ellipse cx="4.6" cy="12.6" rx="1.8" ry="2.3" /><ellipse cx="19.4" cy="12.6" rx="1.8" ry="2.3" /><path d="M12 11c-3.4 0-6.4 3.6-6.4 6.3 0 1.7 1.3 2.7 3 2.7 1.3 0 2.2-.6 3.4-.6s2.1.6 3.4.6c1.7 0 3-1 3-2.7 0-2.7-3-6.3-6.4-6.3z" /></svg>
          </span>
          <div>
            <p className="lt-name">{facility}</p>
            <p className="lt-bubble">
              友だち追加ありがとうございます。{facility}の公式アカウントです。
              <br />
              下のメニューの「会員証」から、はじめての登録ができます(1分ほど)。
            </p>
          </div>
        </div>
        <div className="lt-msg">
          <span className="lt-avatar" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFFFFF"><ellipse cx="7" cy="8" rx="2" ry="2.6" /><ellipse cx="12" cy="6" rx="2" ry="2.6" /><ellipse cx="17" cy="8" rx="2" ry="2.6" /><ellipse cx="4.6" cy="12.6" rx="1.8" ry="2.3" /><ellipse cx="19.4" cy="12.6" rx="1.8" ry="2.3" /><path d="M12 11c-3.4 0-6.4 3.6-6.4 6.3 0 1.7 1.3 2.7 3 2.7 1.3 0 2.2-.6 3.4-.6s2.1.6 3.4.6c1.7 0 3-1 3-2.7 0-2.7-3-6.3-6.4-6.3z" /></svg>
          </span>
          <div>
            <p className="lt-bubble">
              来場のときは、受付の QR コードを「チェックイン」から読み取ってください。10回の来場で、無料券と交換できます。
            </p>
          </div>
        </div>
      </div>
      <div className="lt-menu" role="group" aria-label="リッチメニュー">
        <img src={richmenu} alt="" />
        {RICH_MENU_AREAS.map((a) => (
          <button
            key={a.label}
            type="button"
            aria-label={`リッチメニューの「${a.label}」`}
            style={{ left: pct(a.x, 2500), top: pct(a.y, 1686), width: pct(a.w, 2500), height: pct(a.h, 1686) }}
            onClick={() => onOpen(a.route)}
          />
        ))}
      </div>
      <div className="lt-bar">
        <span>会員証・メニュー ▾</span>
      </div>
    </div>
  );
}

/** LINE の中で開いた画面(LIFF)の上に出る、LINE の帯。× でトークに戻る */
export function LiffBar({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="lt-liffbar">
      <span className="lt-liff-title">{title}</span>
      <button type="button" aria-label="閉じて LINE のトークに戻る" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
