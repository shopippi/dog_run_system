import { type AdminBookingListResponse } from '@dr/shared';
import { useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PageHead } from '../../components/PageHead';
import { Loading, SkeletonCircle, SkeletonText } from '../../components/Skeleton';
import { useLoad } from '../../hooks/useLoad';
import { adminApi } from '../../lib/api';
import { publishPendingBookings } from '../../hooks/usePendingBookings';
import { BookingDialog } from './BookingDialog';
import { BookingRowButton } from './parts';

/**
 * M-21 確認待ちの予約(A-19)。はじめてのワンちゃんがいる予約(「すべて承認制」のときはすべての予約)。
 * 押して内容を確かめ、承認するかお断りする(お客さんへの一言を添えられる)。確定・お断りは LINE でお知らせする。
 */
export function BookingPendingPage() {
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useLoad(async () => {
    const r = await adminApi<AdminBookingListResponse>('/bookings?status=pending');
    publishPendingBookings(r.bookings.length);
    return r;
  }, []);
  return (
    <div className="page">
      <PageHead
        title="確認待ちの予約"
        howto="はじめてのワンちゃんがいる予約は、お店が確認してから確定します。押して内容を確かめ、「承認する」か「お断りする」を選んでください。結果はお客さんにLINEで届きます。"
      />
      {list.error ? <ErrorNotice error={list.error} onRetry={() => void list.reload()} /> : null}
      <section className="panel list-panel">
        {!list.data ? (
          !list.error && (
            <Loading>
              <ul className="bk-adm-list">
                {Array.from({ length: 3 }, (_, i) => (
                  <li key={i}>
                    <span className="bk-adm-row">
                      <SkeletonCircle size={44} />
                      <span className="bk-adm-body">
                        <SkeletonText size={15} w={180} />
                        <SkeletonText size={13} w={220} />
                        <SkeletonText size={13} w={160} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Loading>
          )
        ) : list.data.bookings.length === 0 ? (
          <p className="empty">確認待ちの予約はありません。</p>
        ) : (
          <ul className="bk-adm-list" aria-label="確認待ちの予約">
            {list.data.bookings.map((b) => (
              <li key={b.id}>
                <BookingRowButton b={b} onOpen={setOpenId} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {openId !== null && <BookingDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => void list.reload()} />}
    </div>
  );
}
