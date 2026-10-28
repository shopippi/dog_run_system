import { DOG_SIZE_LABELS, type DogSummary } from '@dr/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DogForm, dogToDraft, draftToInput, type DogDraft } from '../../components/DogForm';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useBreeds } from '../../hooks/useBreeds';
import { useDogs } from '../../hooks/useDogs';
import { patchJson, postJson } from '../../lib/api';
import { uploadDogPhoto } from '../../lib/photo';
import { BackLink } from './DogsPage';

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
  const navigate = useNavigate();

  useEffect(() => {
    if (dog && !draft) setDraft(dogToDraft(dog));
  }, [dog, draft]);

  if (dogsError) return <main className="screen"><ErrorNotice error={dogsError} /></main>;
  if (dogs && !dog) {
    return (
      <main className="screen">
        <BackLink to="/dogs" label="ワンちゃんの一覧にもどる" />
        <div className="notice bad"><p>ワンちゃんが見つかりませんでした。一覧から選び直してください。</p></div>
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
      const { name, sex, birthYm, neutered } = r.input;
      await patchJson<{ dog: DogSummary }>(`/api/dogs/${dog.id}`, {
        name,
        sex: sex ?? null,
        birthYm: birthYm ?? null,
        neutered: neutered ?? null,
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
    setError(null);
    try {
      await postJson(`/api/dogs/${dog.id}/retire`, {});
      navigate('/dogs', { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
      setConfirmRetire(false);
    }
  };

  return (
    <main className="screen">
      <BackLink to="/dogs" label="ワンちゃんの一覧にもどる" />
      <h2>{dog.name}</h2>
      <p className="small muted">
        犬種: {dog.breedName}・サイズ: {DOG_SIZE_LABELS[dog.size]}(間違っているときは受付にお知らせください)
      </p>
      <DogForm
        draft={draft}
        breeds={breeds}
        onChange={setDraft}
        breedEditable={false}
        title="登録している内容"
        currentPhotoUrl={dog.thumbUrl}
      />
      {message && (
        <div className="notice bad" role="alert">
          <p>{message}</p>
        </div>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn" disabled={busy} onClick={save}>
        {busy ? '保存しています…' : '保存する'}
      </button>

      <div className="panel retire">
        <b className="small">登録解除</b>
        <p className="small muted">
          亡くなった子や手放した子は、登録解除できます。これまでの来場の記録は残り、チェックインの選択肢に出なくなります。
        </p>
        {confirmRetire ? (
          <>
            <p className="small"><b>{dog.name}</b>を登録解除します。よろしいですか?</p>
            <button type="button" className="btn danger" disabled={busy} onClick={retire}>
              登録解除する
            </button>
            <button type="button" className="btn sub" disabled={busy} onClick={() => setConfirmRetire(false)}>
              やめる
            </button>
          </>
        ) : (
          <button type="button" className="btn sub" onClick={() => setConfirmRetire(true)}>
            {dog.name}を登録解除する
          </button>
        )}
      </div>
    </main>
  );
}
