import type { MeUnregistered, RegisterInput, RegisterResponse } from '@dr/shared';
import { useState } from 'react';
import { postJson } from '../../lib/api';
import { ConsentStep } from './ConsentStep';
import { DoneStep } from './DoneStep';

type Step = 'consent' | 'done';

/** 初回登録の流れ(L-01 → L-04)。 */
export function RegisterFlow({ me, onFinished }: { me: MeUnregistered; onFinished: () => void }) {
  const [step, setStep] = useState<Step>('consent');
  const [result, setResult] = useState<RegisterResponse | null>(null);

  const submit = async (input: RegisterInput) => {
    const res = await postJson<RegisterResponse>('/api/register', input);
    setResult(res);
    setStep('done');
  };

  if (step === 'done' && result) return <DoneStep result={result} onNext={onFinished} />;
  return <ConsentStep me={me} onSubmit={() => submit({ consent: true })} />;
}
