import {
  BOOKING_SERVICE_LABELS,
  BOOKING_STATUS_LABELS_CUSTOMER,
  bookingWhenText,
  yen,
  type BookingStatus,
  type BookingSummary,
  type MyBookingsResponse,
} from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { PressButton } from '../../components/PressButton';
import { api } from '../../lib/api';
import { BookingsSkeleton } from '../skeletons';

/** 状態の印。色は付けない(確定だけ文字を濃く)。お断りも危険の色にはしない(本当の問題ではないため) */
export function StatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`badge bk-status bk-${status}`}>{BOOKING_STATUS_LABELS_CUSTOMER[status]}</span>;
}

/** L-15 予約の一覧(C-16)。これからの予約と、終わった予約 */
export function BookingsPage() {
  const [data, setData] = useState<MyBookingsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const load = useCallback(() => {
    setError(null);
    api<MyBookingsResponse>('/api/bookings').then(setData).catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error && !data) return <main className="screen"><ErrorNotice error={error} onRetry={load} /></main>;
  if (!data) return <BookingsSkeleton />;

  return (
    <main className="screen">
      <div className="page-head">
        <h2>預かり・お泊まりの予約</h2>
        <p className="lead">LINEから予約できます。お支払いは、これまでどおり受付でお願いします。</p>
      </div>
      <PressButton type="button" className="btn" onClick={() => navigate('/bookings/new')}>
        予約する
      </PressButton>

      <section className="section" aria-labelledby="bk-up">
        <h3 className="section-label" id="bk-up">これからの予約</h3>
        {data.upcoming.length === 0 ? (
          <EmptyState icon="calendar">これからの予約はありません。</EmptyState>
        ) : (
          <BookingRows items={data.upcoming} />
        )}
      </section>

      {data.past.length > 0 && (
        <section className="section" aria-labelledby="bk-past">
          <h3 className="section-label" id="bk-past">これまでの予約</h3>
          <BookingRows items={data.past} />
        </section>
      )}
    </main>
  );
}

function BookingRows({ items }: { items: BookingSummary[] }) {
  return (
    <ul className="rows bk-list" style={{ ['--row-inset' as string]: '16px' }}>
      {items.map((b) => (
        <li key={b.id}>
          <Link to={`/bookings/${b.id}`} className="bk-row">
            <span className="stack bk-dogs">
              {b.dogs.slice(0, 3).map((d) => (
                <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={36} />
              ))}
            </span>
            <span className="bk-row-body">
              <span className="bk-row-top">
                <b>{BOOKING_SERVICE_LABELS[b.service]}</b>
                <StatusBadge status={b.status} />
              </span>
              <span className="sub-text">{bookingWhenText(b)}</span>
              <span className="sub-text">
                {b.dogs.map((d) => d.name).join('・')}・目安 {yen(b.estimateTotal)}
              </span>
            </span>
            <Icon name="chevron-right" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
