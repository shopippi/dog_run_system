import { BOOKING_SERVICE_LABELS, DOG_SIZE_LABELS, bookingWhenText, type BookingDetail } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BottomSheet } from '../../components/BottomSheet';
import { BusyLabel } from '../../components/BusyLabel';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useToast } from '../../components/Toast';
import { api, postJson } from '../../lib/api';
import { BookingDetailSkeleton } from '../skeletons';
import { StatusBadge } from './BookingsPage';
import { EstimateBlock } from './EstimateBlock';

/** "2026-11-03T18:00:00+09:00" → "11月3日 18:00" */
function deadlineText(iso: string) {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}月${d}日 ${iso.slice(11, 16).replace(/^0/, '')}`;
}

/** 状態ごとの一言(何が起きているか・次にすること) */
function statusLead(b: BookingDetail): string {
  switch (b.status) {
    case 'pending':
      return b.approvalReason === 'first_time'
        ? 'はじめてのワンちゃんがいるため、お店が確認しています。確定したらLINEでお知らせします。'
        : 'お店が確認しています。確定したらLINEでお知らせします。';
    case 'confirmed':
      return '予約が確定しています。当日は受付でお声がけください。';
    case 'declined':
      return '申し訳ありません。この予約はお受けできませんでした。別の日で予約し直すか、お店にご相談ください。';
    case 'cancelled':
      return 'この予約はキャンセルしました。';
    case 'checked_in':
      return 'お預かりしています。';
    case 'completed':
      return 'ご利用ありがとうございました。';
    case 'no_show':
      return 'この日はご来店がありませんでした。';
  }
}

/** L-15 予約の内容(C-16)。LINE のお知らせのリンク(/bookings/:id)からも開く */
export function BookingDetailPage() {
  const { id } = useParams();
  const [b, setB] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);
  const toast = useToast();
  const load = useCallback(() => {
    setError(null);
    api<BookingDetail>(`/api/bookings/${id}`).then(setB).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  const cancel = async () => {
    setBusy(true);
    setCancelError(null);
    try {
      setB(await postJson<BookingDetail>(`/api/bookings/${id}/cancel`, {}));
      setConfirming(false);
      toast('予約をキャンセルしました。');
    } catch (e) {
      setCancelError(e);
    } finally {
      setBusy(false);
    }
  };

  if (error && !b) return <main className="screen"><ErrorNotice error={error} onRetry={load} /></main>;
  if (!b) return <BookingDetailSkeleton />;

  const open = b.status === 'pending' || b.status === 'confirmed';

  return (
    <main className="screen">
      <div className="page-head">
        <div className="bk-detail-title">
          <h2>{BOOKING_SERVICE_LABELS[b.service]}の予約</h2>
          <StatusBadge status={b.status} />
        </div>
        <p className="lead">{statusLead(b)}</p>
      </div>

      {b.decisionMessage && (
        <div className="bk-message">
          <p className="section-label">お店から</p>
          <p className="bk-pre">{b.decisionMessage}</p>
        </div>
      )}

      <dl className="bk-summary rows">
        <div>
          <dt>日にち</dt>
          <dd>{bookingWhenText(b)}</dd>
        </div>
        {b.note && (
          <div>
            <dt>お店へのメモ</dt>
            <dd className="bk-pre">{b.note}</dd>
          </div>
        )}
        {b.requestedBy && (
          <div>
            <dt>申し込んだ人</dt>
            <dd>{b.requestedBy}さん</dd>
          </div>
        )}
      </dl>

      <section className="section" aria-labelledby="bk-dogs-h">
        <h3 className="section-label" id="bk-dogs-h">ワンちゃん</h3>
        <ul className="rows" style={{ ['--row-inset' as string]: '68px' }}>
          {b.dogs.map((d) => (
            <li key={d.id} className="dog-row bk-dog">
              <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
              <span className="dog-row-body">
                <b>{d.name}</b>
                <span className="sub-text">
                  {d.breedName}・{DOG_SIZE_LABELS[d.size]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <EstimateBlock estimate={b.estimate} />

      {open &&
        (b.canCancel ? (
          <>
            <p className="note">キャンセルは {deadlineText(b.cancelDeadline)} までできます。予約を変えるときは、キャンセルしてから入れ直してください。</p>
            <button type="button" className="btn sub" onClick={() => setConfirming(true)}>
              この予約をキャンセルする
            </button>
          </>
        ) : (
          <p className="note" role="note">
            キャンセルの期限({deadlineText(b.cancelDeadline)})を過ぎました。キャンセル・変更は、お店に直接ご連絡ください。
          </p>
        ))}

      <Link to="/bookings" className="btn ghost">
        予約の一覧へ
      </Link>

      <BottomSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        busy={busy}
        title="予約をキャンセルしますか"
        actions={
          <button type="button" className="btn" disabled={busy} onClick={cancel}>
            <BusyLabel busy={busy} busyText="キャンセルしています…">
              キャンセルする
            </BusyLabel>
          </button>
        }
      >
        <p className="body-text">{bookingWhenText(b)}の{BOOKING_SERVICE_LABELS[b.service]}をキャンセルします。もう一度予約するときは、予約の画面から入れ直してください。</p>
        {cancelError ? <ErrorNotice error={cancelError} /> : null}
      </BottomSheet>
    </main>
  );
}
