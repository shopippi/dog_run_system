import { EmptyState } from '../EmptyState';

/** 写真の販売が準備中のとき(PU-1)。GET /api/photos/config の available が false、または API が 503 photo_sales_unavailable */
export function PhotoUnavailable({ message }: { message?: string | null }) {
  return (
    <main className="screen">
      <div className="page-head">
        <h2>写真</h2>
      </div>
      <EmptyState icon="image">{message ?? '写真の販売は準備中です。始まるまで、もうしばらくお待ちください。'}</EmptyState>
    </main>
  );
}
