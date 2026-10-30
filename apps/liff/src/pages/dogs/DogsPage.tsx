import { DOG_SIZE_LABELS } from '@dr/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { useDogs } from '../../hooks/useDogs';
import { postJson } from '../../lib/api';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { DogsSkeleton } from '../skeletons';

/** L-09 犬の管理(C-08) */
export function DogsPage() {
  const { dogs, error, reload } = useDogs();
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState<unknown>(null);
  const toast = useToast();
  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={reload} /></main>;
  if (!dogs) return <DogsSkeleton />;
  const active = dogs.filter((d) => d.status === 'active');
  // おやすみ中(内部の値は retired)のワンちゃん。「戻す」でチェックインに選べるようにする
  const resting = dogs.filter((d) => d.status === 'retired');
  const restore = async (id: number, name: string) => {
    setRestoring(id);
    setRestoreError(null);
    try {
      await postJson(`/api/dogs/${id}/restore`, {});
      toast(`${name}がもどってきました`);
      reload();
    } catch (e) {
      setRestoreError(e);
    } finally {
      setRestoring(null);
    }
  };
  return (
    <main className="screen">
      <div className="page-head">
        <h2>ワンちゃん</h2>
        <p className="lead">写真や名前を変えるときは、ワンちゃんを選んでください。</p>
      </div>
      {active.length === 0 ? (
        <EmptyState icon="paw">まだワンちゃんが登録されていません。一緒に来る子を教えてください。</EmptyState>
      ) : (
      <ul className="rows dog-list">
        {active.map((d) => (
          <li key={d.id}>
            <Link to={`/dogs/${d.id}`} className="dog-row">
              <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={64} />
              <span className="dog-row-body">
                <b>{d.name}</b>
                <span className="sub-text">
                  {d.breedName}・{DOG_SIZE_LABELS[d.size]}
                  {!d.photoUrl && '・写真なし'}
                </span>
              </span>
              <Icon name="chevron-right" />
            </Link>
          </li>
        ))}
      </ul>
      )}
      <Link to="/dogs/new" className="btn sub">
        <Icon name="plus" />
        ワンちゃんを追加する
      </Link>
      {/* おやすみ中のワンちゃんは、一覧の一番下に小さな文字の折りたたみで置く(ふだんは閉じておく) */}
      {resting.length > 0 && (
        <details className="dogs-resting" open={restoreError ? true : undefined}>
          <summary>おやすみ中のワンちゃん({resting.length})</summary>
          {restoreError ? <ErrorNotice error={restoreError} /> : null}
          <ul className="retired-list">
            {resting.map((d) => (
              <li key={d.id}>
                <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
                <span className="dog-rest-name">{d.name}</span>
                <button
                  type="button"
                  className="btn sub dog-rest-back"
                  aria-label={`${d.name}を戻す`}
                  disabled={restoring !== null}
                  onClick={() => void restore(d.id, d.name)}
                >
                  {restoring === d.id ? '戻しています…' : '戻す'}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
