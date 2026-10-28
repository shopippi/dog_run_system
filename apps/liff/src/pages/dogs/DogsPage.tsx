import { DOG_SIZE_LABELS } from '@dr/shared';
import { Link } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
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
      <div className="page-head">
        <h2>ワンちゃん</h2>
        <p className="lead">写真や名前を変えるときは、ワンちゃんを選んでください。</p>
      </div>
      <ul className="rows dog-list">
        {active.map((d) => (
          <li key={d.id}>
            <Link to={`/dogs/${d.id}`} className="dog-row">
              <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={48} />
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
      <Link to="/dogs/new" className="btn sub" aria-label="＋ ワンちゃんを追加する">
        <Icon name="plus" />
        ワンちゃんを追加する
      </Link>
      {retired.length > 0 && (
        <section className="section">
          <p className="section-label">登録解除したワンちゃん</p>
          <ul className="retired-list">
            {retired.map((d) => (
              <li key={d.id}>
                <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={32} />
                <span>{d.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
