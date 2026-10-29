import type { DogSummary } from '@dr/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DogForm, draftToInput, emptyDogDraft } from '../../components/DogForm';
import { ErrorNotice, MessageNotice } from '../../components/ErrorNotice';
import { useBreeds } from '../../hooks/useBreeds';
import { postJson } from '../../lib/api';
import { uploadDogPhoto } from '../../lib/photo';
import { ActionBar } from '../../components/ActionBar';
import { BusyLabel } from '../../components/BusyLabel';
import { useToast } from '../../components/Toast';
import { DogFormSkeleton } from '../skeletons';
import { PressButton } from '../../components/PressButton';

/** ワンちゃんの追加(C-08) */
export function DogNewPage() {
  const { breeds, error: breedsError } = useBreeds();
  const [draft, setDraft] = useState(emptyDogDraft);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

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
      toast(`${dog.name}を追加しました`);
      navigate('/dogs', { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  if (breedsError) return <main className="screen"><ErrorNotice error={breedsError} /></main>;
  if (!breeds) return <DogFormSkeleton edit={false} />;
  return (
    <main className="screen">
      <div className="page-head">
        <h2>ワンちゃんを追加</h2>
      </div>
      <DogForm draft={draft} breeds={breeds} onChange={setDraft} title="新しいワンちゃん" />
      {message && <MessageNotice message={message} />}
      {error ? <ErrorNotice error={error} /> : null}
      <ActionBar>
        <PressButton type="button" className="btn" disabled={busy} onClick={save}>
          <BusyLabel busy={busy} busyText="追加しています…">
            追加する
          </BusyLabel>
        </PressButton>
      </ActionBar>
    </main>
  );
}
