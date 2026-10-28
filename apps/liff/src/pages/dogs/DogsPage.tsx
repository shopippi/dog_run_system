import { DOG_SIZE_LABELS } from '@dr/shared';
import { Link } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useDogs } from '../../hooks/useDogs';

/** L-09 犬の管理(C-08) */
export function DogsPage() {
  const { dogs, error, reload } = useDogs();
  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={reload} /></main>;
  if (!dogs) return <main className="screen"><p className="loading">読み込んでいます…</p></main>;
  const active = dogs.filter((d) => d.status === 'active');
  const retired = dogs.filter((d) => d.status === 'retired');
  return (
    <main className="screen">
      <BackLink />
      <h2>ワンちゃん</h2>
      <p className="small muted">写真や名前を変えるときは、ワンちゃんを選んでください。</p>
      <ul className="dog-list">
        {active.map((d) => (
          <li key={d.id}>
            <Link to={`/dogs/${d.id}`} className="dog-row">
              <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={56} />
              <span className="dog-row-body">
                <b>{d.name}</b>
                <span className="small muted">
                  {d.breedName}・{DOG_SIZE_LABELS[d.size]}
                  {!d.photoUrl && '・写真なし'}
                </span>
              </span>
              <span className="chev" aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/dogs/new" className="btn sub as-link">
        ＋ ワンちゃんを追加する
      </Link>
      {retired.length > 0 && (
        <div className="panel">
          <b className="small">登録解除したワンちゃん</b>
          {retired.map((d) => (
            <div key={d.id} className="dog-row static">
              <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
              <span className="small muted">{d.name}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

export function BackLink({ to = '/', label = '会員証にもどる' }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="back-link">
      ‹ {label}
    </Link>
  );
}
