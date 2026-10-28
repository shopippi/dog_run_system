import { DOG_SIZE_LABELS, type DogSummary } from '@dr/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DogForm, dogToDraft, draftToInput, type DogDraft } from '../../components/DogForm';
import { ErrorNotice, MessageNotice } from '../../components/ErrorNotice';
import { useBreeds } from '../../hooks/useBreeds';
import { useDogs } from '../../hooks/useDogs';
import { patchJson, postJson } from '../../lib/api';
import { uploadDogPhoto } from '../../lib/photo';

/** ワンちゃんの変更・登録解除(C-08)。犬種とサイズは受付で変える(6.1) */
export function DogEditPage() {
  const { id } = useParams();
  const { dogs, error: dogsError } = useDogs();
  const { breeds } = useBreeds();
  const dog = dogs?.find((d) => String(d.id) === id && d.status === 'active');
  const [draft, setDraft] = useState<DogDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [retireError, setRetireError] = useState<unknown>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (dog && !draft) setDraft(dogToDraft(dog));
  }, [dog, draft]);

  if (dogsError) return <main className="screen"><ErrorNotice error={dogsError} /></main>;
  if (dogs && !dog) {
    return (
      <main className="screen">
        <div className="alert danger" role="alert">
          <p>ワンちゃんが見つかりませんでした。一覧から選び直してください。</p>
        </div>
      </main>
    );
  }
  if (!dog || !draft || !breeds) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;

  const save = async () => {
    const r = draftToInput(draft);
    if ('error' in r) {
      setMessage(r.error);
      return;
    }
    setMessage(null);
    setBusy(true);
    setError(null);
    try {
      const { name, sex, birthYm } = r.input;
      await patchJson<{ dog: DogSummary }>(`/api/dogs/${dog.id}`, {
        name,
        sex: sex ?? null,
        birthYm: birthYm ?? null,
      });
      if (draft.photo) await uploadDogPhoto(dog.id, draft.photo);
      navigate('/dogs', { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const retire = async () => {
    setBusy(true);
    setRetireError(null);
    try {
      await postJson(`/api/dogs/${dog.id}/retire`, {});
      navigate('/dogs', { replace: true });
    } catch (e) {
      setRetireError(e);
      setBusy(false);
      setConfirmRetire(false);
    }
  };

  return (
    <main className="screen">
      <div className="page-head">
        <h2>{dog.name}</h2>
        <p className="lead">
          犬種: {dog.breedName}・サイズ: {DOG_SIZE_LABELS[dog.size]}(間違っているときは受付にお知らせください)
        </p>
      </div>
      <DogForm
        draft={draft}
        breeds={breeds}
        onChange={setDraft}
        breedEditable={false}
        title="登録している内容"
        currentPhotoUrl={dog.thumbUrl}
      />
      {message && <MessageNotice message={message} />}
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn" disabled={busy} onClick={save}>
        {busy ? '保存しています…' : '保存する'}
      </button>

      <section className="section retire">
        <h3 className="section-label">登録解除</h3>
        <p className="body-text muted-text">
          亡くなった子や手放した子は、登録解除できます。これまでの来場の記録は残り、チェックインの選択肢に出なくなります。
        </p>
        {retireError ? <ErrorNotice error={retireError} /> : null}
        {confirmRetire ? (
          <div className="confirm-inline">
            <p>
              <b>{dog.name}</b>を登録解除します。よろしいですか?
            </p>
            <div className="actions">
              <button type="button" className="btn sub danger" disabled={busy} onClick={retire}>
                登録解除する
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirmRetire(false)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn sub danger" onClick={() => setConfirmRetire(true)}>
            {dog.name}を登録解除する
          </button>
        )}
      </section>
    </main>
  );
}
