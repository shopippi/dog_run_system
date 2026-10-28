import type { DogInput, MeUnregistered, RegisterResponse } from '@dr/shared';
import { useState } from 'react';
import { emptyDogDraft, type DogDraft } from '../../components/DogForm';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useBreeds } from '../../hooks/useBreeds';
import { postJson } from '../../lib/api';
import { uploadDogPhoto } from '../../lib/photo';
import { ConsentStep } from './ConsentStep';
import { DogsStep } from './DogsStep';
import { DoneStep } from './DoneStep';

type Step = 'consent' | 'dogs' | 'done';

/** 初回登録の流れ(L-01 → L-02 → L-04)。 */
export function RegisterFlow({ me, onFinished }: { me: MeUnregistered; onFinished: () => void }) {
  const [step, setStep] = useState<Step>('consent');
  const [drafts, setDrafts] = useState<DogDraft[]>(() => [emptyDogDraft()]);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { breeds, error: breedsError } = useBreeds();

  const submit = async (dogs: DogInput[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<RegisterResponse>('/api/register', { consent: true, dogs });
      // 写真は登録のあとで送る。失敗しても登録は済んでいるので、あとから犬の管理で登録できる。
      let failed = false;
      for (const [i, d] of drafts.entries()) {
        const dog = res.dogs[i];
        if (!d.photo || !dog) continue;
        try {
          const up = await uploadDogPhoto(dog.id, d.photo);
          res.dogs[i] = up.dog;
        } catch {
          failed = true;
        }
      }
      setPhotoFailed(failed);
      setResult(res);
      setStep('done');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done' && result) {
    return <DoneStep result={result} photoFailed={photoFailed} drafts={drafts} onNext={onFinished} />;
  }
  if (step === 'dogs') {
    if (breedsError) return <main className="screen"><ErrorNotice error={breedsError} /></main>;
    if (!breeds) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;
    return (
      <DogsStep
        breeds={breeds}
        drafts={drafts}
        onChange={setDrafts}
        onNext={submit}
        nextLabel="登録する"
        busy={busy}
        error={error}
      />
    );
  }
  return <ConsentStep me={me} onSubmit={async () => setStep('dogs')} />;
}
