import {
  type HouseholdFamilyMember,
  DOG_SEX_LABELS,
  DOG_SIZE_LABELS,
  DOG_SOCIABILITY_LABELS,
  DOG_STATUS_LABELS,
  formatWeight,
  type DogSummary,
  type HouseholdDetail,
} from '@dr/shared';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DogFace } from '../components/DogFace';
import { FamilyInviteDialog, RemoveFamilyDialog } from '../components/FamilyDialogs';
import { HouseholdProfileDialog } from '../components/HouseholdProfileDialog';
import { ManualPointsDialog } from '../components/ManualPointsDialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { useLoad } from '../hooks/useLoad';
import { adminApi, adminPatch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMonthDay, formatYm, formatYmd } from '../lib/jst-format';

/**
 * M-06 おうちの詳細(A-02)。上に犬の写真と呼び名・会員ID・残高、その下に
 * 家族・ワンちゃん・来場履歴・ポイントの記録・アンケートを並べる。
 */
export function HouseholdPage() {
  const { id } = useParams();
  const { readOnly } = useAuth();
  const { data, error, reload } = useLoad(() => adminApi<HouseholdDetail>(`/households/${id}`), [id]);
  const [notice, setNotice] = useState<ReactNode>(null);

  return (
    <div className="page">
      <div className="hh-back">
        <Link to="/search" className="btn ghost">
          <Icon name="chevron-left" />
          探す画面に戻る
        </Link>
      </div>
      <PageHead
        title="おうちの詳細"
        howto="おうちの家族・ワンちゃん・来場・ポイントをまとめて見る画面です。変えた内容はすべて操作ログに残り、操作ログから元に戻せます。"
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!data ? (
        error ? null : <p className="loading">読み込んでいます…</p>
      ) : (
        <Detail
          d={data}
          canEdit={!readOnly && data.status === 'active'}
          notice={notice}
          onChanged={(d, message) => {
            setNotice(message);
            if (d) void reload();
          }}
        />
      )}
    </div>
  );
}

function Detail({
  d,
  canEdit,
  notice,
  onChanged,
}: {
  d: HouseholdDetail;
  canEdit: boolean;
  notice: ReactNode;
  onChanged: (reload: boolean, message: ReactNode) => void;
}) {
  const activeDogs = d.dogs.filter((x) => x.status === 'active');
  const activeFamily = d.family.filter((m) => m.status === 'active').length;
  const [removing, setRemoving] = useState<HouseholdFamilyMember | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <>
      <section className="panel hh-head" aria-label="おうちの概要">
        <div className="hh-id">
          <span className="stack">
            {(activeDogs.length ? activeDogs : d.dogs).slice(0, 4).map((x) => (
              <DogFace key={x.id} name={x.name} breedName={x.breedName} url={x.thumbUrl} size={64} />
            ))}
          </span>
          <NameBlock d={d} canEdit={canEdit} onChanged={onChanged} />
        </div>
        <div className="kpis hh-kpis">
          <Kpi label="ポイント" value={d.balance} unit="ポイント" />
          <Kpi label="使える無料券" value={d.usableTickets} unit="枚" />
          <Kpi label="次の無料券まで" value={d.toNextTicket} unit="ポイント" />
          <Kpi label="来場" value={d.visitCount} unit="回" />
        </div>
      </section>

      {canEdit && <Actions d={d} onChanged={onChanged} />}

      {d.mergedInto && (
        <div className="alert info">
          <p>
            このおうちは <Link to={`/households/${d.mergedInto.id}`}>{d.mergedInto.displayName}</Link>(
            <span className="mono">{d.mergedInto.memberNo}</span>)にまとめられています。変更はまとめた先のおうちで行ってください。
          </p>
        </div>
      )}
      {notice ? (
        <div className="alert info" role="status">
          {notice}
        </div>
      ) : null}

      <Section title="家族" count={activeFamily} unit="人">
        <ul className="hh-list" aria-label="家族">
          {d.family.map((m) => (
            <li key={m.id} className={`hh-row${m.status !== 'active' ? ' off' : ''}`}>
              <span className="hh-main">
                <b>{m.name ? `${m.name}さん` : '退会した家族'}</b>
                <span className="sub-text">
                  {[m.ageGroup, m.gender].filter(Boolean).join('・') || '年代・性別は未回答'}
                </span>
              </span>
              <span className="hh-meta sub-text">
                {m.joinMethodLabel}
                <span aria-hidden="true"> · </span>
                {formatYmd(m.joinedAt)}から
              </span>
              <span className="hh-end">
                {m.status !== 'active' && (
                  <span className="badge">
                    {m.statusLabel}
                    {m.leftAt ? `(${formatYmd(m.leftAt)})` : ''}
                  </span>
                )}
                {canEdit && m.status === 'active' && activeFamily > 1 && (
                  <button type="button" className="btn ghost danger-text" aria-label={`${m.name ?? '家族'}さんを外す`} onClick={() => setRemoving(m)}>
                    外す
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {canEdit && activeFamily <= 1 && <p className="hh-note sub-text">おうちに残る最後の1人は外せません。</p>}
      </Section>
      {removing && (
        <RemoveFamilyDialog
          d={d}
          m={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            onChanged(
              true,
              <p>
                {removing.name ?? '家族'}さんを外しました。間違えたときは、<Link to="/audit">操作ログ</Link>から元に戻せます。
              </p>,
            );
          }}
        />
      )}

      <Section title="ワンちゃん" count={activeDogs.length} unit="頭">
        <ul className="hh-list" aria-label="ワンちゃん">
          {d.dogs.map((x) => (
            <DogRow key={x.id} dog={x} />
          ))}
        </ul>
      </Section>

      <Section title="来場履歴" count={d.visitCount} unit="回">
        {d.visits.length === 0 ? (
          <p className="empty">まだ来場はありません。</p>
        ) : (
          <ul className="hh-list" aria-label="来場履歴">
            {d.visits.map((v) => (
              <li key={v.id} className={`hh-row${v.cancelled ? ' off' : ''}`}>
                <span className="hh-date mono">
                  <span>{formatYmd(v.date)}</span>
                  <span>{v.time}</span>
                </span>
                <span className="hh-main">
                  <b>{v.dogs.map((x) => x.name).join('・') || '—'}</b>
                  <span className="sub-text">
                    {v.checkedInBy ? `${v.checkedInBy}さん` : v.methodLabel}
                    {v.checkedInBy && v.methodLabel !== 'ご本人' ? `(${v.methodLabel})` : ''}
                  </span>
                </span>
                <span className="hh-end">
                  {v.usedTicket && !v.cancelled && <span className="badge warning">無料券を使用</span>}
                  {v.cancelled && <span className="badge">取り消し済み{v.cancelReason ? `(${v.cancelReason})` : ''}</span>}
                  <span className="hh-delta">{v.cancelled ? '' : v.points > 0 ? `+${v.points}` : '±0'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="ポイントの記録" count={d.ledger.length} unit="件">
        {d.ledger.length === 0 ? (
          <p className="empty">まだポイントの記録はありません。</p>
        ) : (
          <ul className="hh-list" aria-label="ポイントの記録">
            {d.ledger.map((l) => (
              <li key={l.id} className="hh-row">
                <span className="hh-date mono">
                  <span>{formatDateTime(l.at).split(' ')[0]}</span>
                  <span>{formatDateTime(l.at).split(' ')[1]}</span>
                </span>
                <span className="hh-main">
                  <b>{l.kindLabel}</b>
                  {(l.reason || l.actorName) && (
                    <span className="sub-text">
                      {l.reason}
                      {l.reason && l.actorName ? <span aria-hidden="true"> · </span> : null}
                      {l.actorName}
                    </span>
                  )}
                </span>
                <span className="hh-end">
                  <span className={`hh-delta${l.delta < 0 ? ' minus' : ''}`}>
                    {l.delta > 0 ? `+${l.delta}` : l.delta === 0 ? '±0' : `−${Math.abs(l.delta)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <h3 className="hh-sub">無料券</h3>
        {d.tickets.length === 0 ? (
          <p className="empty">無料券はまだありません。</p>
        ) : (
          <ul className="hh-list" aria-label="無料券">
            {d.tickets.map((t) => (
              <li key={t.id} className={`hh-row${t.status !== 'unused' ? ' off' : ''}`}>
                <span className="hh-date mono">
                  <span>{formatYmd(t.issuedAt)}</span>
                </span>
                <span className="hh-main">
                  <b>{t.sourceLabel}</b>
                  <span className="sub-text">
                    {t.expiresAt ? `${formatYmd(t.expiresAt)}まで` : '期限なし'}
                    {t.usedAt ? ` · ${formatYmd(t.usedAt)}に使用` : ''}
                  </span>
                </span>
                <span className="hh-end">
                  <span className={`badge${t.status === 'unused' ? ' warning' : ''}`}>{t.statusLabel}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {d.survey && (
        <Section title="アンケート">
          <div className="hh-survey">
            <div>
              <div className="hp-head">
                <h3 className="hh-sub">おうち</h3>
                {canEdit && (
                  <button type="button" className="btn ghost" onClick={() => setProfileOpen(true)}>
                    おうちの回答を変える
                  </button>
                )}
              </div>
              <Answers list={d.survey.household} />
            </div>
            {d.survey.members.map((m) => (
              <div key={m.memberId}>
                <h3 className="hh-sub">{m.name ? `${m.name}さん` : '家族'}</h3>
                <Answers list={m.answers} />
              </div>
            ))}
          </div>
        </Section>
      )}
      {profileOpen && (
        <HouseholdProfileDialog
          d={d}
          onClose={() => setProfileOpen(false)}
          onDone={() => {
            setProfileOpen(false);
            onChanged(
              true,
              <p>
                おうちの回答を変えました。間違えたときは、<Link to="/audit">操作ログ</Link>から元に戻せます。
              </p>,
            );
          }}
        />
      )}
    </>
  );
}

function Answers({ list }: { list: { label: string; answer: string | null }[] }) {
  return (
    <dl className="hh-answers">
      {list.map((a) => (
        <div key={a.label}>
          <dt>{a.label}</dt>
          <dd className={a.answer ? undefined : 'none'}>{a.answer ?? '未回答'}</dd>
        </div>
      ))}
    </dl>
  );
}

function DogRow({ dog }: { dog: DogSummary }) {
  const facts = [
    dog.breedName,
    DOG_SIZE_LABELS[dog.size],
    dog.sex ? DOG_SEX_LABELS[dog.sex] : null,
    dog.birthYm ? `${formatYm(dog.birthYm)}生まれ` : null,
    formatWeight(dog.weightKg),
    dog.sociability ? `ほかの犬: ${DOG_SOCIABILITY_LABELS[dog.sociability]}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <Link to={`/dogs/${dog.id}`} className={`hh-row hh-dog hh-link${dog.status !== 'active' ? ' off' : ''}`} aria-label={`${dog.name}の情報を見る・変える`}>
        <DogFace name={dog.name} breedName={dog.breedName} url={dog.thumbUrl} size={48} />
        <span className="hh-main">
          <b>{dog.name}</b>
          <span className="sub-text">{facts}</span>
        </span>
        <span className="hh-meta mono">{dog.dogNo}</span>
        <span className="hh-end">
          {dog.status !== 'active' && <span className="badge">{DOG_STATUS_LABELS[dog.status]}</span>}
          <Icon name="chevron-right" />
        </span>
      </Link>
    </li>
  );
}

function Section({ title, count, unit, children }: { title: string; count?: number; unit?: string; children: ReactNode }) {
  const id = `hh-${title}`;
  return (
    <section className="panel hh-section" aria-labelledby={id}>
      <h2 id={id} className="hh-section-title">
        {title}
        {count !== undefined && (
          <span className="sub-text">
            {count}
            {unit}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="kpi" role="group" aria-label={label}>
      <span className="l">{label}</span>
      <span className="v">
        {value}
        <small>{unit}</small>
      </span>
    </div>
  );
}

/** 呼び名と会員ID。呼び名はその場で変えられる(空にすると犬の名前から自動で作る) */
function NameBlock({
  d,
  canEdit,
  onChanged,
}: {
  d: HouseholdDetail;
  canEdit: boolean;
  onChanged: (reload: boolean, message: ReactNode) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(d.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await adminPatch<HouseholdDetail>(`/households/${d.id}`, { displayName: value });
      setEditing(false);
      onChanged(true, <p>呼び名を「{next.displayName}」にしました。間違えたときは、操作ログから元に戻せます。</p>);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form
        className="hh-rename"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="hh-name">おうちの呼び名</label>
          <input id="hh-name" value={value} maxLength={40} autoFocus onChange={(e) => setValue(e.target.value)} />
          <span className="hint">空にして保存すると、ワンちゃんの名前から自動で作ります(例: アル・ニコのおうち)。</span>
        </div>
        <div className="hh-rename-acts">
          <button type="submit" className="btn sub" disabled={busy}>
            {busy ? '保存しています…' : '呼び名を保存'}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setValue(d.displayName);
              setError(null);
            }}
          >
            やめる
          </button>
        </div>
        {error ? <ErrorNotice error={error} /> : null}
      </form>
    );
  }
  return (
    <div className="hh-name">
      <h2>{d.displayName}</h2>
      <p className="sub-text">
        <span className="mono">{d.memberNo}</span>
        <span aria-hidden="true"> · </span>
        {formatMonthDay(d.registeredAt)}に登録
        <span aria-hidden="true"> · </span>
        {d.sourceLabel}
        {d.displayNameAuto ? (
          <>
            <span aria-hidden="true"> · </span>呼び名は自動
          </>
        ) : null}
      </p>
      {d.status !== 'active' && <span className="badge">{d.statusLabel}</span>}
      {canEdit && (
        <button type="button" className="btn ghost hh-rename-open" onClick={() => setEditing(true)}>
          呼び名を変える
        </button>
      )}
    </div>
  );
}

/** おうちに対する操作。主なボタンは「ポイント・無料券を登録」 */
function Actions({ d, onChanged }: { d: HouseholdDetail; onChanged: (reload: boolean, message: ReactNode) => void }) {
  const [open, setOpen] = useState<'points' | 'family' | null>(null);
  return (
    <div className="hh-actions">
      <button type="button" className="btn" onClick={() => setOpen('points')}>
        <Icon name="plus" />
        ポイント・無料券を登録
      </button>
      <button type="button" className="btn sub" onClick={() => setOpen('family')}>
        家族を追加
      </button>
      {open === 'family' && (
        <FamilyInviteDialog
          d={d}
          onClose={() => {
            setOpen(null);
            // 読み取った家族が加わっていれば出す
            onChanged(true, null);
          }}
        />
      )}
      {open === 'points' && (
        <ManualPointsDialog
          d={d}
          onClose={() => setOpen(null)}
          onDone={(r) => {
            setOpen(null);
            onChanged(
              true,
              <p>
                登録しました。いまは {r.balanceAfter}ポイント・使える無料券 {r.ticketsAfter}枚 です。間違えたときは、
                <Link to="/audit">操作ログ</Link>から元に戻せます。
              </p>,
            );
          }}
        />
      )}
    </div>
  );
}
