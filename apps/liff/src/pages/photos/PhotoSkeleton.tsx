import { Skeleton } from '../../components/Skeleton';

/** 写真の画面の読み込み中(グリッドの形) */
export function PhotoSkeleton() {
  return (
    <main className="screen" aria-busy="true">
      <Skeleton width={120} height={24} />
      <div className="ph-grid">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="ph-cell" />
        ))}
      </div>
    </main>
  );
}
