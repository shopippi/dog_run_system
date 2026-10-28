import {
  MIGRATION_NOTE_MAX,
  MIGRATION_PHOTO_MAX_BYTES,
  MIGRATION_PHOTO_MAX_EDGE,
  MIGRATION_SOURCE_LABELS,
  migrationFormToInput,
  migrationRequestSchema,
  type MigrationRequestItem,
  type MigrationRequestsResponse,
  type MigrationSource,
} from '@dr/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { ChoiceGroup } from '../../components/ChoiceGroup';
import { ErrorNotice, MessageNotice } from '../../components/ErrorNotice';
import { api } from '../../lib/api';
import { resizePhoto } from '../../lib/photo';

const STATUS_LABELS: Record<MigrationRequestItem['status'], { text: string; className: string }> = {
  pending: { text: '確認待ち', className: 'badge cu-info' },
  approved: { text: '引き継ぎ済み', className: 'badge' },
  rejected: { text: '受け付けできませんでした', className: 'badge cu-danger' },
};

function formatDay(iso: string) {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}月${d}日`;
}

type Photo = { blob: Blob; previewUrl: string };

/** L-13 旧カードの引き継ぎ申請(C-10)。旧カードの写真を送り、管理者が確認してポイントを足す(16.1) */
export function MigrationRequestPage() {
  const id = useId();
  const [state, setState] = useState<MigrationRequestsResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [source, setSource] = useState<MigrationSource | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    api<MigrationRequestsResponse>('/api/requests').then(setState).catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  const available = state ? state.sources.filter((s) => s.state === 'none').map((s) => s.source) : [];
  // 申請できるカードが1つだけなら、はじめから選んでおく
  useEffect(() => {
    if (available.length === 1 && source !== available[0]) setSource(available[0]!);
    if (source && available.length > 0 && !available.includes(source)) setSource(null);
  }, [available.join(','), source]);

  if (loadError) return <main className="screen"><ErrorNotice error={loadError} onRetry={load} /></main>;
  if (!state) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;

  const { period } = state;

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setMessage(null);
    try {
      const r = await resizePhoto(file, { maxEdge: MIGRATION_PHOTO_MAX_EDGE, maxBytes: MIGRATION_PHOTO_MAX_BYTES });
      URL.revokeObjectURL(r.previewUrl);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      setPhoto({ blob: r.photo, previewUrl: URL.createObjectURL(r.photo) });
    } catch {
      setMessage('この写真は読み込めませんでした。別の写真を選ぶか、カメラで撮り直してください。');
    } finally {
      setPhotoBusy(false);
    }
  };

  const submit = async () => {
    const parsed = migrationRequestSchema.safeParse(migrationFormToInput({ source, claimedPoints: points, note }));
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? '入力を確かめてください。');
      return;
    }
    if (!photo) {
      setMessage('旧カードの写真を付けてください。ポイントの数が読めるように撮ってください。');
      return;
    }
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('source', parsed.data.source);
      form.append('claimedPoints', parsed.data.claimedPoints === null ? '' : String(parsed.data.claimedPoints));
      form.append('note', parsed.data.note ?? '');
      form.append('photo', photo.blob, 'card.jpg');
      await api('/api/requests', { method: 'POST', body: form });
      URL.revokeObjectURL(photo.previewUrl);
      setPhoto(null);
      setPoints('');
      setNote('');
      setSource(null);
      setSent(true);
      setState(await api<MigrationRequestsResponse>('/api/requests'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  // 受付で直接入力して引き継いだカード(申請の記録がないもの)も、状態の一覧に出す
  const directOnly = state.sources.filter(
    (s) => s.state === 'done' && !state.requests.some((r) => r.source === s.source && r.status === 'approved'),
  );
  const hasHistory = state.requests.length > 0 || directOnly.length > 0;

  return (
    <main className="screen">
      <div className="page-head">
        <h2>旧カードの引き継ぎ</h2>
        <p className="lead">
          LINEのショップカードや紙のスタンプカードのポイントを、この会員証に引き継げます。カードの写真を送ると、管理者が確認してポイントを足します。
        </p>
        {period.open && period.end && <p className="note">申請は{formatDay(period.end)}まで受け付けています。</p>}
      </div>

      {sent && (
        <div className="alert info" role="status">
          <p>
            <b>申請しました。</b>
          </p>
          <p>管理者が確認すると、会員証のポイントに加わります。</p>
        </div>
      )}

      {hasHistory && (
        <section className="section" aria-labelledby={`${id}-history`}>
          <h3 className="section-label" id={`${id}-history`}>
            申請の状態
          </h3>
          <ul className="rows mig-list">
            {state.requests.map((r) => {
              const s = STATUS_LABELS[r.status];
              const migrated = state.sources.find((x) => x.source === r.source)?.migratedPoints;
              return (
                <li key={r.id} className="mig-row">
                  <span className="mig-row-body">
                    <b>{MIGRATION_SOURCE_LABELS[r.source]}</b>
                    <span className="sub-text">
                      <span className="cu-nowrap">{formatDay(r.createdAt)}に申請</span>
                      {r.claimedPoints !== null && <span className="cu-nowrap">・だいたい{r.claimedPoints}ポイント</span>}
                    </span>
                    {r.status === 'approved' && migrated != null && (
                      <span className="sub-text">{migrated}ポイントを引き継ぎました</span>
                    )}
                    {r.status === 'rejected' && (
                      <span className="sub-text">くわしくは受付でおたずねください。もう一度申請することもできます。</span>
                    )}
                  </span>
                  <span className={s.className}>{s.text}</span>
                </li>
              );
            })}
            {directOnly.map((s) => (
              <li key={s.source} className="mig-row">
                <span className="mig-row-body">
                  <b>{MIGRATION_SOURCE_LABELS[s.source]}</b>
                  <span className="sub-text">
                    受付で引き継ぎました{s.migratedPoints !== null && `(${s.migratedPoints}ポイント)`}
                  </span>
                </span>
                <span className="badge">引き継ぎ済み</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!period.open ? (
        <div className="alert info" role="status">
          {period.notStarted && period.start ? (
            <p>旧カードの引き継ぎの申請は、{formatDay(period.start)}から受け付けます。</p>
          ) : (
            <p>旧カードの引き継ぎの申請の受付は終わりました。旧カードをお持ちのときは、受付にお知らせください。</p>
          )}
        </div>
      ) : available.length === 0 ? (
        <p className="cu-empty">引き継げるカードは、すべて申請済みです。</p>
      ) : (
        <>
          <section className="panel mig-form" aria-labelledby={`${id}-form`}>
            <h3 className="section-title" id={`${id}-form`}>
              {hasHistory ? 'ほかのカードを申請する' : '申請する内容'}
            </h3>
            <div className="field">
              <span className="label" id={`${id}-source`}>
                引き継ぐカード<span className="req">必須</span>
              </span>
              <ChoiceGroup
                labelledBy={`${id}-source`}
                options={available.map((s) => ({ value: s, label: MIGRATION_SOURCE_LABELS[s] }))}
                value={source}
                onChange={setSource}
              />
            </div>

            <div className="field">
              <span className="label" id={`${id}-photo-label`}>
                カードの写真<span className="req">必須</span>
              </span>
              {photo && <img className="mig-preview" src={photo.previewUrl} alt="選んだカードの写真" />}
              <label className="up btn sub mig-photo-btn" htmlFor={`${id}-photo`}>
                {photoBusy ? '写真を準備しています…' : photo ? '写真を撮り直す・選び直す' : '写真を撮る・選ぶ'}
              </label>
              <input
                id={`${id}-photo`}
                className="mig-file"
                type="file"
                accept="image/*"
                aria-labelledby={`${id}-photo-label`}
                onChange={(e) => {
                  void pickPhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <span className="hint">
                ポイントの数が読めるように撮ってください。LINEのショップカードは、画面を保存した写真でも大丈夫です。
              </span>
            </div>

            <div className="field">
              <label htmlFor={`${id}-points`}>だいたいのポイント数</label>
              <input
                id={`${id}-points`}
                className="w-points"
                inputMode="numeric"
                maxLength={2}
                autoComplete="off"
                placeholder="例: 7"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
              />
              <span className="hint">分からなければ空欄で大丈夫です。写真を見て管理者が確かめます。</span>
            </div>

            <div className="field">
              <label htmlFor={`${id}-note`}>メモ</label>
              <textarea
                id={`${id}-note`}
                rows={3}
                maxLength={MIGRATION_NOTE_MAX}
                placeholder="例: 紙のカードが2枚あります"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </section>
          {message && <MessageNotice message={message} />}
          {error ? <ErrorNotice error={error} /> : null}
          <button type="button" className="btn" disabled={busy || photoBusy} onClick={submit}>
            {busy ? '送っています…' : '申請する'}
          </button>
        </>
      )}
    </main>
  );
}
