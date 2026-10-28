import type { DogInput, MeUnregistered, RegisterResponse, SurveyQuestion } from '@dr/shared';
import { useEffect, useState } from 'react';
import { emptyDogDraft, type DogDraft } from '../../components/DogForm';
import { ErrorNotice } from '../../components/ErrorNotice';
import { toAnswers, type SurveyValues } from '../../components/SurveyForm';
import { useBreeds } from '../../hooks/useBreeds';
import { api, postJson } from '../../lib/api';
import { uploadDogPhoto } from '../../lib/photo';
import { ConsentStep } from './ConsentStep';
import { DogsStep } from './DogsStep';
import { DoneStep } from './DoneStep';
import { SurveyStep } from './SurveyStep';

type Step = 'consent' | 'dogs' | 'survey' | 'done';

/** 初回登録の流れ(L-01 同意 → L-02 犬 → L-03 アンケート → L-04 完了)。 */
export function RegisterFlow({ me, onFinished }: { me: MeUnregistered; onFinished: () => void }) {
  const [step, setStep] = useState<Step>('consent');
  const [drafts, setDrafts] = useState<DogDraft[]>(() => [emptyDogDraft()]);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { breeds, error: breedsError } = useBreeds();
  const [dogs, setDogs] = useState<DogInput[]>([]);
  const [questions, setQuestions] = useState<SurveyQuestion[] | null>(null);
  const [answers, setAnswers] = useState<SurveyValues>({});

  useEffect(() => {
    api<{ questions: SurveyQuestion[] }>('/api/survey')
      .then((r) => setQuestions(r.questions))
      .catch(setError);
  }, []);

  const submit = async () => {
    if (!questions) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<RegisterResponse>('/api/register', {
        consent: true,
        dogs,
        survey: toAnswers(questions, answers),
      });
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
  if (step === 'survey') {
    if (!questions) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;
    return (
      <SurveyStep
        questions={questions}
        values={answers}
        onChange={setAnswers}
        onBack={() => setStep('dogs')}
        onNext={submit}
        busy={busy}
        error={error}
      />
    );
  }
  if (step === 'dogs') {
    if (breedsError) return <main className="screen"><ErrorNotice error={breedsError} /></main>;
    if (!breeds) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;
    return (
      <DogsStep
        breeds={breeds}
        drafts={drafts}
        onChange={setDrafts}
        onNext={(d) => {
          setDogs(d);
          setStep('survey');
          window.scrollTo(0, 0);
        }}
        nextLabel="次へ"
      />
    );
  }
  return <ConsentStep me={me} onSubmit={async () => setStep('dogs')} />;
}
