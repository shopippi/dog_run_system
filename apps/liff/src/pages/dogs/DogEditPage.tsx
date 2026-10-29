import { DOG_SIZE_LABELS, type DogSummary } from '@dr/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DogForm, dogToDraft, draftToInput, type DogDraft } from '../../components/DogForm';
import { ErrorNotice, MessageNotice } from '../../components/ErrorNotice';
import { useBreeds } from '../../hooks/useBreeds';
import { useDogs } from '../../hooks/useDogs';
import { patchJson, postJson } from '../../lib/api';
import { uploadDogPhoto } from '../../lib/photo';
import { ActionBar } from '../../components/ActionBar';
import { BottomSheet } from '../../components/BottomSheet';
import { BusyLabel } from '../../components/BusyLabel';
import { useToast } from '../../components/Toast';
import { DogFormSkeleton } from '../skeletons';
import { PressButton } from '../../components/PressButton';

/** ワンちゃんの変更と、登録のおやすみ(C-08)。犬種とサイズは受付で変える(6.1) */
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
  const toast = useToast();

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
  if (!dog || !draft || !breeds) return <DogFormSkeleton />;

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
      const { name, sex, birthYm, weightKg, sociability, rabiesVaccineYear, comboVaccineYear } = r.input;
      await patchJson<{ dog: DogSummary }>(`/api/dogs/${dog.id}`, {
        name,
        sex: sex ?? null,
        birthYm: birthYm ?? null,
        weightKg: weightKg ?? null,
        sociability: sociability ?? null,
        rabiesVaccineYear: rabiesVaccineYear ?? null,
        comboVaccineYear: comboVaccineYear ?? null,
      });
      if (draft.photo) await uploadDogPhoto(dog.id, draft.photo);
      toast('保存しました');
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
      toast(`${dog.name}の登録をおやすみしました`);
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

      {/* 登録をおやすみする(内部の値は retired)。見出しも説明も置かず、一番下に小さく置く。確認は下から出るシート */}
      <div className="dog-rest">
        {retireError ? <ErrorNotice error={retireError} /> : null}
        <button type="button" className="dog-rest-link" onClick={() => setConfirmRetire(true)}>
          この子の登録をおやすみする
        </button>
      </div>
      <BottomSheet
        open={confirmRetire}
        onClose={() => setConfirmRetire(false)}
        busy={busy}
        title={`${dog.name}の登録をおやすみします`}
        actions={
          <PressButton type="button" className="btn" disabled={busy} onClick={retire}>
            <BusyLabel busy={busy} busyText="手続きしています…">
              おやすみする
            </BusyLabel>
          </PressButton>
        }
      >
        <p>来場の記録はそのまま残り、いつでも戻せます。</p>
      </BottomSheet>

      <ActionBar>
        <PressButton type="button" className="btn" disabled={busy} onClick={save}>
          <BusyLabel busy={busy && !confirmRetire} busyText="保存しています…">
            保存する
          </BusyLabel>
        </PressButton>
      </ActionBar>
    </main>
  );
}
