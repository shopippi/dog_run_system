// 管理画面の写真のグリッド(段階0の部品。PA-4 アルバム編集などで使う)。複数選択(クリック・Shift で範囲)は段階1-A が足す。
// 写真はログインのクッキーで読む(adminPhotoThumbUrl)。誰でも開ける URL にはしない。

export type AdminPhotoGridItem = { id: number; url: string | null; label: string; selected?: boolean };

export function AdminPhotoGrid({ items, onToggle }: { items: AdminPhotoGridItem[]; onToggle?: (id: number, e: React.MouseEvent) => void }) {
  return (
    <ul className="ph-agrid" aria-label="写真">
      {items.map((it) => (
        <li key={it.id}>
          <button type="button" className={`ph-acell${it.selected ? ' selected' : ''}`} aria-pressed={!!it.selected} aria-label={it.label} onClick={(e) => onToggle?.(it.id, e)}>
            {it.url && <img src={it.url} alt="" loading="lazy" />}
            <span className="ph-acell-label">{it.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
