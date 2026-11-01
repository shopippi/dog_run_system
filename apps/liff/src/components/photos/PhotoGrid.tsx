import { useAuthedImage } from '../../hooks/useAuthedImage';

// 写真のグリッド(段階0の部品。PU-3 アルバム詳細・PU-7 購入した写真で使う)。
// 写真は認証つきの API から読む(誰でも開ける URL にしない)。段階1-B が、遅延読み込み・複数選択・購入済みの印を足す。
// 形(props)を変えるときは、使っている画面(1-B・1-D)に合わせる。

export type PhotoGridItem = {
  id: number;
  /** 認証つきの API の URL(photoThumbUrl・purchasedViewUrl) */
  url: string;
  /** 読み上げの名前(「写真 12」など) */
  label: string;
  /** 右上の印(「購入済み」など。色は付けない) */
  badge?: string | null;
  selected?: boolean;
};

export function PhotoGrid({
  items,
  onOpen,
  onToggle,
  selecting = false,
}: {
  items: PhotoGridItem[];
  onOpen?: (id: number) => void;
  /** 複数選択のとき(「カートに入れる」の前に選ぶ) */
  onToggle?: (id: number) => void;
  selecting?: boolean;
}) {
  return (
    <ul className="ph-grid" aria-label="写真">
      {items.map((it) => (
        <li key={it.id}>
          <button
            type="button"
            className={`ph-cell${it.selected ? ' selected' : ''}`}
            aria-label={it.label}
            aria-pressed={selecting ? !!it.selected : undefined}
            onClick={() => (selecting ? onToggle?.(it.id) : onOpen?.(it.id))}
          >
            <Thumb url={it.url} />
            {it.badge && <span className="ph-badge">{it.badge}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thumb({ url }: { url: string }) {
  const src = useAuthedImage(url);
  // 長押しの保存の抑止は気休め(対策の本体は「表示物は透かし付きで価値がない」こと)
  return src ? <img src={src} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()} /> : <span className="ph-ph" aria-hidden="true" />;
}
