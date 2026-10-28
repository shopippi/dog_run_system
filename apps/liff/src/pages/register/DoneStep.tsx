import type { RegisterResponse } from '@dr/shared';
import { DogAvatar } from '../../components/DogAvatar';
import type { DogDraft } from '../../components/DogForm';

type Props = {
  result: RegisterResponse;
  drafts: DogDraft[];
  photoFailed: boolean;
  onNext: () => void;
};

/** L-04 登録完了(会員IDの表示)(C-01) */
export function DoneStep({ result, drafts, photoFailed, onNext }: Props) {
  return (
    <main className="screen">
      <div className="welcome-card">
        <p>登録が完了しました</p>
        <div className="faces">
          {result.dogs.map((d, i) => (
            <DogAvatar
              key={d.id}
              name={d.name}
              breedName={d.breedName}
              url={d.thumbUrl}
              previewUrl={drafts[i]?.photo?.previewUrl}
              size={64}
            />
          ))}
        </div>
        <p className="name">{result.householdName}</p>
        <p className="small">会員ID</p>
        <p className="id mono">{result.memberNo}</p>
      </div>
      {photoFailed && (
        <div className="notice gold">
          <p>写真の一部を送れませんでした。会員証の「ワンちゃん」から、あとで登録できます。</p>
        </div>
      )}
      <p className="small muted">
        会員IDは、ご家族で共通です。受付でたずねられたときは、この番号をお伝えください。
      </p>
      <button type="button" className="btn" onClick={onNext}>
        会員証を見る
      </button>
    </main>
  );
}
