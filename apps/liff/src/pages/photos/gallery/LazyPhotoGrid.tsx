import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { PhotoGrid, type PhotoGridItem } from '../../../components/photos/PhotoGrid';

// 写真のグリッドの遅延読み込み(PU-3。4G で最初の表示を2秒以内に)。
// 共通の PhotoGrid を包み、画面に入った(入りそうな)マスにだけ写真の URL を渡す。URL が空のマスは読みに行かず、
// 灰色の面のまま。最初の1画面分だけを先に読み、スクロールに合わせて少し先まで読む。一度読んだマスは戻さない。

/** 画面の下のこれだけ先まで、先に読む */
const AHEAD = '0px 0px 320px 0px';

export function LazyPhotoGrid({ items, ...rest }: ComponentProps<typeof PhotoGrid>) {
  const wrap = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set());
  // 選んだ・印が変わっただけでは見張り直さない(並びが変わったときだけ)
  const ids = items.map((i) => i.id).join(',');

  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const order = ids ? ids.split(',').map(Number) : [];
    const cells = [...root.querySelectorAll<HTMLLIElement>('.ph-grid > li')];
    const idOf = (el: Element) => order[cells.indexOf(el as HTMLLIElement)];
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(new Set(order));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const add = entries.filter((e) => e.isIntersecting).map((e) => idOf(e.target)).filter((id): id is number => id !== undefined);
        if (add.length === 0) return;
        for (const e of entries) if (e.isIntersecting) io.unobserve(e.target);
        setSeen((prev) => {
          const next = new Set(prev);
          for (const id of add) next.add(id);
          return next;
        });
      },
      { rootMargin: AHEAD },
    );
    for (const c of cells) io.observe(c);
    return () => io.disconnect();
  }, [ids]);

  const lazy: PhotoGridItem[] = items.map((it) => (seen.has(it.id) ? it : { ...it, url: '' }));
  return (
    <div ref={wrap} className="ph-lazy">
      <PhotoGrid items={lazy} {...rest} />
    </div>
  );
}
