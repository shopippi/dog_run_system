import { MAX_DOGS_AT_REGISTER, type Breed, type DogInput } from '@dr/shared';
import { useState } from 'react';
import { DogForm, draftToInput, emptyDogDraft, type DogDraft } from '../../components/DogForm';
import { ErrorNotice, MessageNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { Progress } from '../../components/Progress';
import { ActionBar } from '../../components/ActionBar';
import { BusyLabel } from '../../components/BusyLabel';
import { PressButton } from '../../components/PressButton';

type Props = {
  breeds: Breed[];
  drafts: DogDraft[];
  onChange: (drafts: DogDraft[]) => void;
  onNext: (dogs: DogInput[]) => Promise<void> | void;
  nextLabel: string;
  error?: unknown;
  busy?: boolean;
};

/** L-02 犬の登録(写真つき)(C-02)。何頭でも追加できる。 */
export function DogsStep({ breeds, drafts, onChange, onNext, nextLabel, error, busy }: Props) {
  const [message, setMessage] = useState<string | null>(null);

  const next = () => {
    const inputs: DogInput[] = [];
    for (const [i, d] of drafts.entries()) {
      const r = draftToInput(d);
      if ('error' in r) {
        setMessage(drafts.length > 1 ? `${i + 1}頭目: ${r.error}` : r.error);
        return;
      }
      inputs.push(r.input);
    }
    setMessage(null);
    void onNext(inputs);
  };

  return (
    <main className="screen">
      <Progress step={2} />
      <div className="page-head">
        <h2>ワンちゃんの登録</h2>
        <p className="lead">いっしょに来るワンちゃんを登録してください。受付では、写真と名前でお客さまを確認します。</p>
      </div>
      {drafts.map((d, i) => (
        <DogForm
          key={d.key}
          draft={d}
          breeds={breeds}
          title={drafts.length > 1 ? `${i + 1}頭目` : 'ワンちゃん'}
          onChange={(nd) => onChange(drafts.map((x) => (x.key === d.key ? nd : x)))}
          onRemove={drafts.length > 1 ? () => onChange(drafts.filter((x) => x.key !== d.key)) : undefined}
        />
      ))}
      {drafts.length < MAX_DOGS_AT_REGISTER && (
        <button type="button" className="btn sub" onClick={() => onChange([...drafts, emptyDogDraft()])}>
          <Icon name="plus" />
          もう1頭追加する
        </button>
      )}
      {message && <MessageNotice message={message} />}
      {error ? <ErrorNotice error={error} /> : null}
      <ActionBar>
        <PressButton type="button" className="btn" disabled={busy} onClick={next}>
          <BusyLabel busy={!!busy} busyText="登録しています…">
            {nextLabel}
          </BusyLabel>
        </PressButton>
      </ActionBar>
    </main>
  );
}
