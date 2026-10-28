import type { DogSummary } from '@dr/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DogForm, draftToInput, emptyDogDraft } from '../../components/DogForm';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useBreeds } from '../../hooks/useBreeds';
import { postJson } from '../../lib/api';
import { uploadDogPhoto } from '../../lib/photo';
import { BackLink } from './DogsPage';

/** ワンちゃんの追加(C-08) */
export function DogNewPage() {
  const { breeds, error: breedsError } = useBreeds();
  const [draft, setDraft] = useState(emptyDogDraft);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

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
      const { dog } = await postJson<{ dog: DogSummary }>('/api/dogs', r.input);
      if (draft.photo) {
        try {
          await uploadDogPhoto(dog.id, draft.photo);
        } catch {
          // 写真はあとから登録し直せる
        }
      }
      navigate('/dogs', { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  if (breedsError) return <main className="screen"><ErrorNotice error={breedsError} /></main>;
  if (!breeds) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;
  return (
    <main className="screen">
      <BackLink to="/dogs" label="ワンちゃんの一覧にもどる" />
      <h2>ワンちゃんを追加</h2>
      <DogForm draft={draft} breeds={breeds} onChange={setDraft} title="新しいワンちゃん" />
      {message && (
        <div className="notice bad" role="alert">
          <p>{message}</p>
        </div>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      <button type="button" className="btn" disabled={busy} onClick={save}>
        {busy ? '追加しています…' : '追加する'}
      </button>
    </main>
  );
}
