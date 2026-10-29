import { DOG_SIZE_LABELS, type DogSummary, type DogVisitRecord } from '@dr/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DogForm, DogPhotoField, dogToDraft, draftToInput, type DogDraft } from '../../components/DogForm';
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
  const { dogs, records, error: dogsError } = useDogs();
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
      toast(`${name}の情報を保存しました`);
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
      {/* ワンちゃんが主役: 上に大きく写真、その下に「写真を変える」 */}
      <DogPhotoField
        layout="hero"
        draft={draft}
        onChange={setDraft}
        breedName={dog.breedName}
        currentPhotoUrl={dog.photoUrl ?? dog.thumbUrl}
      />
      <div className="page-head">
        <h2>{dog.name}</h2>
        <p className="dog-record">{recordText(records.find((r) => r.dogId === dog.id))}</p>
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
        showPhoto={false}
      />
      {message && <MessageNotice message={message} />}
      {error ? <ErrorNotice error={error} /> : null}

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

      <ActionBar sticky>
        <PressButton type="button" className="btn" disabled={busy} onClick={save}>
          <BusyLabel busy={busy && !confirmRetire} busyText="保存しています…">
            保存する
          </BusyLabel>
        </PressButton>
      </ActionBar>

      {/* 登録をおやすみする(内部の値は retired)。暗い話なので目立たせない: 保存の帯よりも下、スクロールしきった所に、
          見出しも区切り線もなく小さな文字だけで置く。確認は下から出るシート */}
      <div className="dog-rest">
        {retireError ? <ErrorNotice error={retireError} /> : null}
        <button type="button" className="dog-rest-link" onClick={() => setConfirmRetire(true)}>
          この子の登録をおやすみする
        </button>
      </div>
    </main>
  );
}

/** その子の来場の記録(「一緒に来た回数 12回・最後に来た日 10月28日」) */
function recordText(r: DogVisitRecord | undefined): string {
  if (!r || r.visits === 0) return 'まだ来場の記録はありません。はじめての日を楽しみにしています。';
  const last = r.lastVisitDate ? `・最後に来た日 ${Number(r.lastVisitDate.slice(5, 7))}月${Number(r.lastVisitDate.slice(8, 10))}日` : '';
  return `一緒に来た回数 ${r.visits}回${last}`;
}
