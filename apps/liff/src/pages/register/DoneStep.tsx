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
      <div className="page-head">
        <h2>登録が完了しました</h2>
        <p className="lead">これで会員証が使えます。次からは、受付のQRコードを読み取るだけでチェックインできます。</p>
      </div>
      <div className="welcome-card">
        <div className="welcome-who">
          <div className="stack">
            {result.dogs.map((d, i) => (
              <DogAvatar
                key={d.id}
                name={d.name}
                breedName={d.breedName}
                url={d.thumbUrl}
                previewUrl={drafts[i]?.photo?.previewUrl}
                size={48}
              />
            ))}
          </div>
          <p className="name">{result.householdName}</p>
        </div>
        <div className="welcome-id">
          <span className="label">会員ID</span>
          <p className="id mono">{result.memberNo}</p>
        </div>
      </div>
      <p className="note">会員IDは、ご家族で共通です。受付でたずねられたときは、この番号をお伝えください。</p>
      {photoFailed && (
        <div className="alert warning">
          <p>写真の一部を送れませんでした。会員証の「ワンちゃん」から、あとで登録できます。</p>
        </div>
      )}
      <button type="button" className="btn" onClick={onNext}>
        会員証を見る
      </button>
    </main>
  );
}
