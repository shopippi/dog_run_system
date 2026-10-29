import type { CustomerMergeResult, InviteInfo, InviteMergeDog, InviteMergePreview } from '@dr/shared';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DogAvatar } from '../../components/DogAvatar';
import { ErrorNotice } from '../../components/ErrorNotice';
import { postJson } from '../../lib/api';
import { ActionBar } from '../../components/ActionBar';
import { BottomSheet } from '../../components/BottomSheet';
import { BusyLabel } from '../../components/BusyLabel';
import { PressButton } from '../../components/PressButton';

/** 自分のワンちゃんごとの選択。sameAs は招待した側の同じ子(いなければ null) */
type Choice = { sameAs: number | null; keepPhoto: 'mine' | 'theirs' };

/**
 * L-12 招待を受けたときの画面のうち、すでに別のおうちがある人の「おうちを一つにまとめる」(C-12、5.1)。
 * 下見(残るおうち・ポイントの合計・家族・ワンちゃん)→ 確認 → 完了。本人の確認だけで、その場でまとめる。
 * 自分のワンちゃんごとに「招待した側にも同じ子がいるか」を選べる(同じ子なら1頭にまとめ、写真をどちらにするか選ぶ)。
 */
export function MergeFlow({
  code,
  info,
  merge,
  header,
  onDone,
}: {
  code: string;
  info: InviteInfo;
  merge: InviteMergePreview;
  header: ReactNode;
  onDone: () => void;
}) {
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<CustomerMergeResult | null>(null);

  const theirLabel = info.inviterName ? `${info.inviterName}さんのおうち` : merge.theirs.displayName;
  const theirDog = new Map(merge.theirs.dogs.map((d) => [d.id, d]));
  const choiceOf = (dogId: number): Choice => choices[dogId] ?? { sameAs: null, keepPhoto: 'theirs' };
  const setChoice = (dogId: number, next: Partial<Choice>) =>
    setChoices((prev) => {
      const merged = { ...choiceOf(dogId), ...next };
      // 写真を選べないときは、写真がある方にそろえる
      const theirs = merged.sameAs !== null ? theirDog.get(merged.sameAs) : undefined;
      const mine = merge.mine.dogs.find((d) => d.id === dogId);
      if (theirs && mine && !(theirs.hasPhoto && mine.hasPhoto)) merged.keepPhoto = mine.hasPhoto ? 'mine' : 'theirs';
      return { ...prev, [dogId]: merged };
    });
  // 招待した側の1頭は、自分のワンちゃんの1頭とだけ組み合わせられる
  const usedBy = (theirId: number) => merge.mine.dogs.find((d) => choiceOf(d.id).sameAs === theirId)?.id ?? null;

  const totalPoints = merge.theirs.points + merge.mine.points;
  const pointsText =
    merge.result.ticketsIssued > 0
      ? `ポイントは合計 ${totalPoints} ポイント(無料券${merge.result.ticketsIssued}枚と${merge.result.points}ポイント)になり`
      : `ポイントは合計 ${merge.result.points} ポイントになり`;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<CustomerMergeResult>(`/api/invites/${encodeURIComponent(code)}/merge`, {
        dogs: merge.mine.dogs.map((d) => ({ dogId: d.id, ...choiceOf(d.id) })),
      });
      setDone(res);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <main className="screen">
        <div className="page-head">
          <h2>おうちが一つになりました</h2>
          <p className="lead">これからは、{theirLabel}と同じ会員証でポイントがたまります。</p>
        </div>
        <div className="welcome-card">
          <div className="welcome-who">
            <p className="name">{done.householdName}</p>
          </div>
          <div className="welcome-id">
            <span className="label">あなたの会員ID</span>
            <p className="id mono">{done.memberNo}</p>
          </div>
          <div className="welcome-id">
            <span className="label">ポイント</span>
            <p className="id mg-num">
              {done.points}
              <small>ポイント</small>
              {done.tickets > 0 && <span className="mg-tickets">無料券 {done.tickets}枚</span>}
            </p>
          </div>
        </div>
        <PressButton type="button" className="btn" onClick={onDone}>
          会員証を見る
        </PressButton>
      </main>
    );
  }

  const sameDogs = merge.mine.dogs.filter((d) => choiceOf(d.id).sameAs !== null);

  return (
    <main className="screen">
      {header}
      <div className="page-head">
        <h2>おうちを一つにまとめる</h2>
        <p className="lead">
          このLINEは、すでに「{merge.mine.displayName}」({merge.mine.memberNo})で会員証を使っています。{theirLabel}
          とまとめると、会員証が一つになり、ポイントも合わせられます。
        </p>
      </div>

      <section className="section" aria-labelledby="mg-after">
        <h3 className="section-title" id="mg-after">
          まとめた後
        </h3>
        <dl className="mg-summary">
          <div>
            <dt>会員ID</dt>
            <dd className="mono">{merge.result.memberNo}</dd>
          </div>
          <div>
            <dt>ポイント</dt>
            <dd>
              <b className="mg-num">{merge.result.ticketsIssued > 0 ? totalPoints : merge.result.points}</b>
              <span className="sub-text">
                {' '}
                ({theirLabel} {merge.theirs.points} + あなた {merge.mine.points})
              </span>
              {merge.result.ticketsIssued > 0 && (
                <span className="sub-text mg-block">
                  10ポイントごとに無料券になります(無料券{merge.result.ticketsIssued}枚と{merge.result.points}ポイント)
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>来場の記録</dt>
            <dd>
              <b className="mg-num">{merge.result.visits}</b>
              <span className="sub-text">回(どちらの記録も残ります)</span>
            </dd>
          </div>
          <div>
            <dt>家族</dt>
            <dd className="mg-family">{merge.result.family.map((f) => `${f}さん`).join('、')}</dd>
          </div>
        </dl>
        {merge.movingFamily.length > 0 && (
          <p className="note">
            あなたのおうちの{merge.movingFamily.map((f) => `${f}さん`).join('、')}も、一緒に{theirLabel}に移ります。
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="mg-theirs">
        <h3 className="section-title" id="mg-theirs">
          {theirLabel}のワンちゃん
        </h3>
        <ul className="mg-dogs" aria-labelledby="mg-theirs">
          {merge.theirs.dogs.map((d) => (
            <li key={d.id}>
              <DogAvatar name={d.name} breedName={d.breedName} url={d.thumbUrl} size={40} />
              <span className="dog-row-body">
                <b>{d.name}</b>
                <span className="sub-text">{d.breedName}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="mg-mine">
        <div className="page-head">
          <h3 className="section-title" id="mg-mine">
            あなたのワンちゃん
          </h3>
          <p className="hint">同じ子がいれば選んでください。1頭にまとめます。選ばなければ、別の子として移ります。</p>
        </div>
        {merge.mine.dogs.map((d) => (
          <MyDog
            key={d.id}
            dog={d}
            theirs={merge.theirs.dogs}
            theirLabel={theirLabel}
            choice={choiceOf(d.id)}
            usedBy={usedBy}
            onChange={(next) => setChoice(d.id, next)}
          />
        ))}
      </section>

      <Link to="/" className="btn ghost" onClick={onDone}>
        やめる
      </Link>
      <ActionBar>
        <PressButton
          type="button"
          className="btn"
          onClick={() => {
            setError(null);
            setConfirm(true);
          }}
        >
          まとめる
        </PressButton>
      </ActionBar>

      {/* 確認は下から出るシート(docs/design.md 11.3) */}
      <BottomSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        busy={busy}
        title="まとめてよいですか?"
        cancelLabel="もどる"
        actions={
          <PressButton type="button" className="btn" disabled={busy} onClick={run}>
            <BusyLabel busy={busy} busyText="まとめています…">
              まとめる
            </BusyLabel>
          </PressButton>
        }
      >
        <p className="mg-confirm-text">
          {theirLabel}と一つになります。{pointsText}、あなたの会員IDは <span className="mono">{merge.result.memberNo}</span>{' '}
          になります。
        </p>
        {sameDogs.length > 0 && (
          <section className="section" aria-labelledby="mg-same">
            <h3 className="section-label" id="mg-same">
              同じ子として1頭にまとめるワンちゃん
            </h3>
            <ul className="rows" aria-labelledby="mg-same">
              {sameDogs.map((d) => {
                const c = choiceOf(d.id);
                const t = theirDog.get(c.sameAs!)!;
                const photoDog = c.keepPhoto === 'mine' ? d : t;
                return (
                  <li key={d.id} className="dog-row">
                    <DogAvatar name={photoDog.name} breedName={photoDog.breedName} url={photoDog.thumbUrl} size={40} />
                    <span className="dog-row-body">
                      <b>{t.name}</b>
                      <span className="sub-text">
                        あなたの「{d.name}」と同じ子{photoDog.hasPhoto ? `・写真は${c.keepPhoto === 'mine' ? 'あなたの写真' : `${theirLabel}の写真`}` : ''}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <p className="note">
          今の会員ID({merge.mine.memberNo})は使わなくなります。間違えてまとめたときは、受付にご相談ください(30日以内なら元に戻せます)。
        </p>
        {error ? <ErrorNotice error={error} /> : null}
      </BottomSheet>
    </main>
  );
}

function MyDog({
  dog,
  theirs,
  theirLabel,
  choice,
  usedBy,
  onChange,
}: {
  dog: InviteMergeDog;
  theirs: InviteMergeDog[];
  theirLabel: string;
  choice: Choice;
  usedBy: (theirId: number) => number | null;
  onChange: (next: Partial<Choice>) => void;
}) {
  const name = `mg-same-${dog.id}`;
  const same = choice.sameAs !== null ? theirs.find((t) => t.id === choice.sameAs) : undefined;
  const photoChoice = same && same.hasPhoto && dog.hasPhoto;
  return (
    <fieldset className="mg-mine" aria-label={`${dog.name}の同じ子`}>
      <legend className="mg-mine-head">
        <DogAvatar name={dog.name} breedName={dog.breedName} url={dog.thumbUrl} size={48} />
        <span className="dog-row-body">
          <b>{dog.name}</b>
          <span className="sub-text">{dog.breedName}</span>
        </span>
      </legend>
      <p className="section-label" id={`${name}-q`}>
        {theirLabel}にも同じ子がいますか?
      </p>
      <div className="pick-list" role="radiogroup" aria-labelledby={`${name}-q`}>
        <label className="pick-row">
          <input type="radio" name={name} checked={choice.sameAs === null} onChange={() => onChange({ sameAs: null })} />
          <span className="pick-body">
            <b>いない</b>
            <span className="sub-text">別の子として移ります</span>
          </span>
        </label>
        {theirs.map((t) => {
          const taken = usedBy(t.id);
          const disabled = taken !== null && taken !== dog.id;
          return (
            <label key={t.id} className={`pick-row${disabled ? ' mg-disabled' : ''}`}>
              <input
                type="radio"
                name={name}
                checked={choice.sameAs === t.id}
                disabled={disabled}
                onChange={() => onChange({ sameAs: t.id })}
              />
              <DogAvatar name={t.name} breedName={t.breedName} url={t.thumbUrl} size={40} />
              <span className="pick-body">
                <b>{t.name}</b>
                <span className="sub-text">{disabled ? 'ほかの子と同じ子に選んでいます' : '同じ子'}</span>
              </span>
            </label>
          );
        })}
      </div>
      {photoChoice && (
        <>
          <p className="section-label" id={`${name}-photo`}>
            残す写真
          </p>
          <div className="pick-list" role="radiogroup" aria-labelledby={`${name}-photo`}>
            <label className="pick-row">
              <input
                type="radio"
                name={`${name}-photo`}
                checked={choice.keepPhoto === 'theirs'}
                onChange={() => onChange({ keepPhoto: 'theirs' })}
              />
              <DogAvatar name={same.name} breedName={same.breedName} url={same.thumbUrl} size={48} />
              <span className="pick-body">
                <b>{theirLabel}の写真</b>
              </span>
            </label>
            <label className="pick-row">
              <input
                type="radio"
                name={`${name}-photo`}
                checked={choice.keepPhoto === 'mine'}
                onChange={() => onChange({ keepPhoto: 'mine' })}
              />
              <DogAvatar name={dog.name} breedName={dog.breedName} url={dog.thumbUrl} size={48} />
              <span className="pick-body">
                <b>あなたの写真</b>
              </span>
            </label>
          </div>
        </>
      )}
    </fieldset>
  );
}
