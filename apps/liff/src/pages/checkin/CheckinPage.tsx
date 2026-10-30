import { toJstIso, type CheckinStatus } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { ApiError, api, postJson } from '../../lib/api';
import {
  acknowledgeOutbox,
  cancelPending,
  enqueueCheckin,
  outboxStatus,
  retryNow,
  subscribeOutbox,
  type OutboxStatus,
} from '../../lib/checkin-outbox';
import { canScan, scanCheckinCode } from '../../lib/liff';
import { ActionBar } from '../../components/ActionBar';
import { BusyLabel } from '../../components/BusyLabel';
import { EmptyState } from '../../components/EmptyState';
import { CheckinSkeleton } from '../skeletons';
import { PressButton } from '../../components/PressButton';

/** L-05 チェックイン(C-04)。受付のQRコードから開く → 来た犬を選ぶ → 確定。無料券は会員証で右へスライドして使う(8章) */
export function CheckinPage() {
  const [params, setParams] = useSearchParams();
  const passphrase = params.get('k');
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const outbox = useOutbox();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api<CheckinStatus>('/api/checkins/today');
      setStatus(s);
      // はじめは全員を選んでおく(すでに記録された犬は除く)
      const done = new Set(s.visit?.dogIds ?? []);
      setSelected(new Set(s.dogs.filter((d) => !done.has(d.id)).map((d) => d.id)));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
    // 完了の画面のファイルを先に読んでおく(送れた直後に電波が切れても、完了の画面を出せるように)
    void import('./CheckinDonePage').catch(() => undefined);
  }, [load]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 送信は「送信待ち」に入れてから送る(電波が弱くても、なくさず・二重にせず送り続ける。15.3)
  const submit = () => {
    if (!passphrase) return;
    setError(null);
    if (!enqueueCheckin({ passphrase, dogIds: [...selected] })) {
      setError(new ApiError(0, 'no_user', 'LINEのログイン情報を確かめられませんでした。画面を閉じて、もう一度開いてください。'));
    }
  };

  // サーバーが受け付けたときだけ、完了の画面に進む(受け付ける前に「チェックインできました」とは出さない)
  useEffect(() => {
    if (outbox.kind === 'done') {
      acknowledgeOutbox();
      navigate(`/checkin/done/${outbox.result.visitId}`, { replace: true });
    } else if (outbox.kind === 'failed') {
      const e = outbox.error;
      acknowledgeOutbox();
      setError(e);
      // 家族が先にチェックインしていた場合は、追加の画面に切り替える
      if (e instanceof ApiError && e.code === 'already_checked_in') void load();
    }
  }, [outbox, navigate, load]);

  const addDogs = async () => {
    if (!status?.visit) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/checkins/${status.visit.id}/dogs`, { dogIds: [...selected] });
      navigate(`/checkin/done/${status.visit.id}`, { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const scan = async () => {
    const k = await scanCheckinCode().catch(() => null);
    if (k) setParams({ k }, { replace: true });
  };

  // 送信待ちのチェックインがあるときは、電波がなくて今日の状態が読めなくても、待っていることを出す
  if (outbox.kind === 'waiting') return <WaitingToSend status={outbox} dogs={status?.dogs ?? []} />;

  if (!status) {
    if (!error) return <CheckinSkeleton />;
    return (
      <main className="screen">
        <ErrorNotice error={error} onRetry={load} />
      </main>
    );
  }

  const visit = status.visit;
  const remaining = status.dogs.filter((d) => !visit?.dogIds.includes(d.id));

  if (visit) {
    // 5.5 家族がすでにチェックインしている日。犬の追加だけができる(ポイントは増えない)
    return (
      <main className="screen">
        <div className="page-head">
          <h2>チェックイン</h2>
        </div>
        <div className="alert info">
          <p>
            <b>{visit.isMe ? '今日はチェックイン済みです。' : `今日は${visit.checkedInBy || 'ご家族'}さんがチェックイン済みです。`}</b>
          </p>
          <p>ポイントは1日1回です。一緒に来たワンちゃんを追加できます。</p>
        </div>
        {remaining.length > 0 ? (
          <>
            <DogChecklist dogs={remaining} selected={selected} onToggle={toggle} />
            {error ? <ErrorNotice error={error} /> : null}
            <button type="button" className="btn ghost" onClick={() => navigate(`/checkin/done/${visit.id}`)}>
              チェックインの画面を見る
            </button>
            <ActionBar>
              <PressButton type="button" className="btn" disabled={busy || selected.size === 0} onClick={addDogs}>
                <BusyLabel busy={busy} busyText="追加しています…">
                  ワンちゃんを追加する
                </BusyLabel>
              </PressButton>
            </ActionBar>
          </>
        ) : (
          <>
            <p className="lead">登録しているワンちゃんは、みんな記録されています。</p>
            <PressButton type="button" className="btn" onClick={() => navigate(`/checkin/done/${visit.id}`)}>
              チェックインの画面を見る
            </PressButton>
          </>
        )}
      </main>
    );
  }

  if (!passphrase) {
    return (
      <main className="screen">
        <div className="page-head">
          <h2>チェックイン</h2>
          <p className="lead">受付にあるQRコードを、LINEのカメラで読み取ってください。</p>
        </div>
        {canScan() && (
          <PressButton type="button" className="btn" onClick={scan}>
            QRコードを読み取る
          </PressButton>
        )}
      </main>
    );
  }

  const sending = outbox.kind === 'sending';

  return (
    <main className="screen">
      <div className="page-head">
        <h2>チェックイン</h2>
        <p className="lead">今日来たワンちゃんを選んで、「チェックインする」を押してください。</p>
      </div>
      {status.dogs.length > 0 ? (
        <DogChecklist dogs={status.dogs} selected={selected} onToggle={toggle} />
      ) : (
        <EmptyState icon="paw">登録しているワンちゃんがいません。会員証の「ワンちゃん」から登録してください。</EmptyState>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      <ActionBar>
        <PressButton type="button" className="btn" disabled={sending || selected.size === 0} onClick={submit}>
          <BusyLabel busy={sending} busyText="チェックインしています…">
            チェックインする
          </BusyLabel>
        </PressButton>
      </ActionBar>
    </main>
  );
}

/** 送信待ちの状態(画面の部品に配る) */
function useOutbox(): OutboxStatus {
  const [s, setS] = useState<OutboxStatus>(outboxStatus);
  useEffect(() => subscribeOutbox(setS), []);
  return s;
}

/**
 * 電波が弱くて、チェックインがまだ届いていないとき(15.3)。押した内容は端末に保存してあり、つながったら自動で送る。
 * 届くまでは「チェックインできました」とは出さない。
 */
function WaitingToSend({ status, dogs }: { status: Extract<OutboxStatus, { kind: 'waiting' }>; dogs: CheckinStatus['dogs'] }) {
  const picked = dogs.filter((d) => status.pending.dogIds.includes(d.id));
  const pressedAt = toJstIso(new Date(status.pending.pressedAt)).slice(11, 16);
  return (
    <main className="screen">
      <div className="page-head">
        <h2>チェックイン</h2>
      </div>
      <div className="alert warning waiting-send" role="status" aria-live="polite">
        <p>
          <b>電波が弱いため、送信を待っています。</b>
        </p>
        <p>つながったら自動で送ります。この画面を開いたままにしてください。送れたら「チェックイン完了」の画面に切り替わります。</p>
        <p className="note">
          「チェックインする」を押した時刻 <span className="mono">{pressedAt}</span>
          {status.offline ? '・いまは電波が届いていません' : '・送り直しています'}
        </p>
        <button type="button" className="btn sub" onClick={retryNow}>
          今すぐ送る
        </button>
      </div>
      {picked.length > 0 && (
        <div className="pick-list" aria-label="送るワンちゃん">
          {picked.map((d) => (
            <div key={d.id} className="pick-row static">
              <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
              <span className="pick-body">
                <b>{d.name}</b>
                <span className="sub-text">{d.breedName}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn ghost" onClick={cancelPending}>
        送るのをやめる
      </button>
      <ActionBar>
        <PressButton type="button" className="btn" disabled>
          <BusyLabel busy busyText="送信を待っています…">
            チェックインする
          </BusyLabel>
        </PressButton>
      </ActionBar>
    </main>
  );
}

function DogChecklist({
  dogs,
  selected,
  onToggle,
}: {
  dogs: CheckinStatus['dogs'];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="pick-list" role="group" aria-label="今日来たワンちゃん">
      {dogs.map((d) => (
        <label key={d.id} className="pick-row">
          <input type="checkbox" checked={selected.has(d.id)} onChange={() => onToggle(d.id)} />
          <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
          <span className="pick-body">
            <b>{d.name}</b>
            <span className="sub-text">{d.breedName}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
