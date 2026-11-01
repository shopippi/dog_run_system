import {
  MIGRATION_SOURCES,
  MIGRATION_SOURCE_LABELS,
  capMigrationPoints,
  migrationCapMessage,
  planMigration,
  type HouseholdHit,
  type HouseholdSearchResponse,
  type MigrationDuplicate,
  type MigrationListResponse,
  type MigrationMember,
  type MigrationRecord,
  type MigrationResult,
  type MigrationSource,
  type MigrationStatus,
  type MigrationSummary,
  type WithAuditId,
} from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BusyLabel } from '../components/BusyLabel';
import { Dialog } from '../components/Dialog';
import { DogFace } from '../components/DogFace';
import { ErrorNotice } from '../components/ErrorNotice';
import { HouseholdPicker } from '../components/HouseholdPicker';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { Loading, Skeleton, SkeletonGhost, SkeletonText } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { ApiError, adminApi, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMonthDay } from '../lib/jst-format';

/**
 * M-09 旧カードの引き継ぎ(A-05、要件定義書 16章)。受付で旧カードを見せてもらったときだけ、管理者が直接入力する。
 * - 「移行期間」: 期間・終わりまでの日数・引き継いだおうちの数とポイントの合計(16.2)
 * - 「直接入力」: おうちを探して選び(おうちの詳細からは選んだ状態で開く)、カードの種類・ポイント数・使っていない特典を入れる。
 *   旧カードを目で確かめたこと・紙のカードを回収したことの印が必須。上限を超えるときは、上限までになることをはっきり出す
 * - 「引き継ぎ済みの一覧」: いつ・誰が・どのおうちに・何ポイント。カードの番号・会員ID・呼び名で探せる。間違えたものは元に戻せる
 */
export function MigrationPage() {
  const [listKey, setListKey] = useState(0);
  return (
    <div className="page">
      <PageHead
        title="旧カードの引き継ぎ"
        howto="お客さんが受付で旧カード(LINEのショップカード・紙のスタンプカード)を見せてくれたときに使います。カードを目で確かめてからポイント数を入れ、紙のカードは回収するか使用済みの印を付けてください。"
        aside={
          <Link to="/switchover" className="btn sub">
            切り替えの手順
          </Link>
        }
      />
      <TransitionSummary key={`s${listKey}`} />
      <DirectMigration onDone={() => setListKey((k) => k + 1)} />
      <MigratedList key={listKey} />
    </div>
  );
}

const PHASE_LABEL: Record<MigrationSummary['phase'], string> = { before: '始まる前', open: '受付中', after: '終わりました' };

/** 移行期間のまとめ(16.2)。期間・終わりまでの日数・引き継いだおうちの数・ポイントの合計 */
function TransitionSummary() {
  const [data, setData] = useState<MigrationSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    adminApi<MigrationSummary>('/migrations/summary')
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch(setError);
  }, []);
  useEffect(load, [load]);
  if (error) return <ErrorNotice error={error} onRetry={load} />;
  const { start, end } = data?.period ?? { start: null, end: null };
  const range = data ? (start || end ? `${start ? formatMonthDay(start) : ''}〜${end ? formatMonthDay(end) : ''}` : '期間を決めていません') : '';
  const soon = data && data.phase === 'open' && data.daysLeft !== null && data.daysLeft <= 14;
  return (
    <section className="panel mg-section" aria-label="移行期間">
      <div className="mi-sum-head">
        <h2 className="mg-title">移行期間</h2>
        {data ? (
          <span className="sub-text">
            {range}
            {start || end ? ` · ${PHASE_LABEL[data.phase]}` : ''}
          </span>
        ) : (
          <SkeletonText size={13} w={200} />
        )}
      </div>
      <div className="kpis mi-kpis">
        <Kpi label="引き継いだおうち" value={data?.households} unit={data ? `/ ${data.activeHouseholds}おうち` : ''} />
        <Kpi label="引き継いだポイント" value={data?.points} unit="ポイント" />
        <Kpi label="特典から出した無料券" value={data?.tickets} unit="枚" />
        <Kpi
          label="終わりまで"
          value={data ? (data.daysLeft === null ? '―' : data.daysLeft < 0 ? '終了' : data.daysLeft) : undefined}
          unit={data && data.daysLeft !== null && data.daysLeft >= 0 ? '日' : ''}
        />
      </div>
      {data && !start && !end && (
        <p className="sub-text">移行期間がまだ決まっていないため、いつでも引き継げます。始まりと終わりは、メニューの「ルール」の「移行期間」で決めます。</p>
      )}
      {soon && (
        <div className="alert warning">
          <p>
            移行期間の終わりまで、あと<b>{data.daysLeft}日</b>です。まだのお客さんに、受付やLINEで声をかけてください。LINEのショップカードを止めるのは、期間が終わってからにしてください(止めると、お客さんのLINEの中のポイントも消えます)。
          </p>
        </div>
      )}
      {data && data.sameCardGroups > 0 && (
        <div className="alert warning">
          <p>
            同じカードの番号で引き継いだおうちが <b>{data.sameCardGroups}組</b> あります。下の一覧の「同じ番号」の印を見て、本当に別のカードか確かめてください。
          </p>
        </div>
      )}
      {data && data.capped.count > 0 && (
        <p className="sub-text">
          上限を超えていたカード: {data.capped.count}枚(引き継がなかったポイントは合わせて{data.capped.points}ポイント)
        </p>
      )}
    </section>
  );
}

function Kpi({ label, value, unit }: { label: string; value: number | string | undefined; unit: string }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      {value === undefined ? (
        <Skeleton w={64} h={30} r={4} />
      ) : (
        <span className="v">
          {value}
          {unit && <small>{unit}</small>}
        </span>
      )}
    </div>
  );
}

/** 数の入力欄の値を、0 以上の整数として読む。読めなければ null */
function parseCount(v: string): number | null {
  const t = v.normalize('NFKC').trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  return Number(t);
}

/** 移行元(LINEのショップカード / 紙のスタンプカード)を選ぶ */
function SourceChoice({
  value,
  onChange,
  done,
}: {
  value: MigrationSource | null;
  onChange: (s: MigrationSource) => void;
  /** 引き継ぎ済みの移行元(選べない) */
  done: Partial<Record<MigrationSource, boolean>>;
}) {
  return (
    <div className="field">
      <span className="label" id="mi-src-label">
        旧カードの種類
      </span>
      <div className="chips" role="radiogroup" aria-labelledby="mi-src-label">
        {MIGRATION_SOURCES.map((s) => (
          <label key={s} className={done[s] ? 'rq-chip-off' : undefined}>
            <input type="radio" name="mi-src" checked={value === s} disabled={done[s]} onChange={() => onChange(s)} />
            <span>
              {MIGRATION_SOURCE_LABELS[s]}
              {done[s] ? '(引き継ぎ済み)' : ''}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** 入力の中身(確認のダイアログに渡す) */
type Draft = {
  memberId: number;
  /** 画面に出す呼び方(「パパさん」など) */
  memberName: string;
  source: MigrationSource;
  cardPoints: number;
  points: number;
  tickets: number;
  cardRef: string;
  note: string;
  lateReason: string;
};

/** 直接入力(16.1)。おうちを選び、カードの種類・ポイント数・特典・2つの確認の印を入れて「引き継ぐ」 */
function DirectMigration({ onDone }: { onDone: () => void }) {
  const { readOnly } = useAuth();
  const [params, setParams] = useSearchParams();
  const [picked, setPicked] = useState<HouseholdHit | null>(null);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [source, setSource] = useState<MigrationSource | null>(null);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [pointsText, setPointsText] = useState('');
  const [ticketsText, setTicketsText] = useState('0');
  const [cardRef, setCardRef] = useState('');
  const [note, setNote] = useState('');
  const [lateReason, setLateReason] = useState('');
  const [capTold, setCapTold] = useState(false);
  const [confirmedCard, setConfirmedCard] = useState(false);
  const [collectedCard, setCollectedCard] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  // おうちの詳細の「旧カードを引き継ぐ」から開いたときは、そのおうちを選んだ状態にする(?member=DR-000123)
  // 一度だけ使う(「選び直す」のあとに、また選ばないように)
  const [member, setMember] = useState(() => params.get('member'));
  useEffect(() => {
    if (!member) return;
    let alive = true;
    adminApi<HouseholdSearchResponse>(`/households?q=${encodeURIComponent(member)}`)
      .then((r) => {
        const hit = r.households.find((h) => h.memberNo === member && h.status === 'active');
        if (alive && hit) setPicked((p) => p ?? hit);
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [member]);

  const load = useCallback(async (id: number) => {
    setError(null);
    try {
      const s = await adminApi<MigrationStatus>(`/households/${id}/migration`);
      setStatus(s);
      // だれのカードか: 選んでいた人がまだ家族にいればそのまま。いなければ初めの選択(今日チェックインした人など)
      setMemberId((prev) => (prev && s.members.some((m) => m.id === prev) ? prev : s.defaultMemberId));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    if (picked) void load(picked.id);
  }, [picked, load]);

  const reset = () => {
    setPointsText('');
    setTicketsText('0');
    setCardRef('');
    setNote('');
    setLateReason('');
    setCapTold(false);
    setConfirmedCard(false);
    setCollectedCard(false);
  };

  if (readOnly) {
    return (
      <section className="panel mg-section" aria-label="直接入力">
        <h2 className="mg-title">直接入力</h2>
        <p className="empty">製作者のアカウントでは、旧カードの引き継ぎは入力できません。</p>
      </section>
    );
  }
  const cardPoints = parseCount(pointsText);
  const max = status?.maxPoints ?? 0;
  const capped = cardPoints !== null && status !== null && cardPoints > max;
  const points = cardPoints === null ? null : capMigrationPoints(cardPoints, max).points;
  const tickets = parseCount(ticketsText);
  const ticketsOver = tickets !== null && status !== null && tickets > status.maxTickets;
  const chosen = status?.members.find((m) => m.id === memberId) ?? null;
  const doneMap = chosen ? Object.fromEntries(MIGRATION_SOURCES.map((s) => [s, Boolean(chosen.done[s])])) : {};
  const allDone = chosen ? MIGRATION_SOURCES.every((s) => chosen.done[s]) : false;
  // 選んだ人のカードで、まだ引き継いでいない種類を選んでおく
  const sourceNow = source && !doneMap[source] ? source : (MIGRATION_SOURCES.find((x) => !doneMap[x]) ?? null);
  const late = status?.phase === 'after' && status.lateEntry;
  const open = !!status && (status.inPeriod || late);
  const ready =
    points !== null &&
    (!capped || capTold) &&
    tickets !== null &&
    !ticketsOver &&
    !!sourceNow &&
    !!chosen &&
    open &&
    (!late || lateReason.trim().length > 0) &&
    confirmedCard &&
    collectedCard;
  return (
    <section className="panel mg-section" aria-label="直接入力">
      <h2 className="mg-title">直接入力</h2>
      {!picked ? (
        <HouseholdPicker
          label="引き継ぐおうちを探す"
          onPick={(h) => {
            setPicked(h);
            reset();
          }}
        />
      ) : (
        <>
          <div className="mg-slot" role="group" aria-label="引き継ぐおうち">
            <span className="stack">
              {picked.dogs.map((d) => (
                <DogFace key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={48} />
              ))}
            </span>
            <span className="mg-slot-body">
              <b>{picked.displayName}</b>
              <span className="sub-text">
                <span className="mono">{picked.memberNo}</span>
                {status ? ` · いま ${status.points}ポイント` : ''}
              </span>
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setPicked(null);
                setStatus(null);
                setError(null);
                reset();
                setMember(null);
                if (params.has('member')) setParams({}, { replace: true });
              }}
            >
              選び直す
            </button>
          </div>
          {status && !open && (
            <div className="alert warning">
              <p>
                いまは旧カードの引き継ぎを受け付ける期間の外です({status.period.start ?? ''}〜{status.period.end ?? ''})。期間を変えるときは、ルールの設定で移行期間を直してください。
              </p>
            </div>
          )}
          {status && late && (
            <div className="alert warning">
              <p>移行期間は{status.period.end ?? ''}で終わっています。受け付けるときは、下に理由を書いてください(操作ログに残ります)。</p>
            </div>
          )}
          {!status && !error && (
            <Loading>
              <div className="field">
                <SkeletonText size={13} w={96} />
                <div className="chips">
                  <Skeleton w={176} h="var(--control-h)" r={8} />
                  <Skeleton w={160} h="var(--control-h)" r={8} />
                </div>
              </div>
              <div className="field rq-points">
                <SkeletonText size={13} w={136} />
                <Skeleton w={160} h={44} r={8} />
              </div>
            </Loading>
          )}
          {status && <CardsDone status={status} />}
          {status && <MemberChoice status={status} value={memberId} onChange={setMemberId} />}
          {status && !chosen ? null : status && allDone ? (
            <p className="sub-text">
              {memberLabel(status, chosen!)}の旧カードは、両方とも引き継ぎが済んでいます。ほかの家族のカードなら、「だれのカード」を選び直してください。
            </p>
          ) : status ? (
            <>
              <SourceChoice value={sourceNow} onChange={setSource} done={doneMap} />
              <div className="mi-fields">
                <div className="field rq-points">
                  <label htmlFor="mi-points">旧カードのポイント数</label>
                  <input
                    id="mi-points"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="例: 7"
                    aria-describedby="mi-points-hint"
                    value={pointsText}
                    onChange={(e) => {
                      setPointsText(e.target.value);
                      setCapTold(false);
                    }}
                  />
                  <span className="hint" id="mi-points-hint">
                    カードに残っている数をそのまま入れます(上限 {max}ポイント)
                  </span>
                </div>
                {status.maxTickets > 0 && (
                  <div className="field rq-points">
                    <label htmlFor="mi-tickets">使っていない特典</label>
                    <input
                      id="mi-tickets"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-describedby="mi-tickets-hint"
                      value={ticketsText}
                      onChange={(e) => setTicketsText(e.target.value)}
                    />
                    <span className={ticketsOver ? 'err' : 'hint'} id="mi-tickets-hint">
                      {ticketsOver
                        ? `旧カードの特典から出せる無料券は、最大${status.maxTickets}枚です。`
                        : `LINEの特典チケットや、ゴールまでたまって使っていない紙のカード。1枚で無料券1枚(最大${status.maxTickets}枚)`}
                    </span>
                  </div>
                )}
              </div>
              {capped && cardPoints !== null && (
                <div className="alert warning" role="status">
                  <p>{migrationCapMessage(cardPoints, max)}</p>
                  <label className="check">
                    <input type="checkbox" checked={capTold} onChange={(e) => setCapTold(e.target.checked)} />
                    上限までになることを、お客さんに伝えた
                  </label>
                </div>
              )}
              {points !== null && (
                <p className="rq-preview" role="status">
                  いま {status.points}ポイント → 引き継ぎ後 <b>{planMigration(status.points, points).balanceAfter}ポイント</b>
                  {tickets ? `・無料券 +${tickets}枚` : ''}
                </p>
              )}
              <div className="mi-fields">
                <div className="field">
                  <label htmlFor="mi-ref">カードの番号(任意)</label>
                  <input id="mi-ref" type="text" autoComplete="off" maxLength={40} placeholder="例: No.0123" value={cardRef} onChange={(e) => setCardRef(e.target.value)} />
                  <span className="hint">紙のカードに番号があれば。同じカードがほかのおうちで使われていないかを確かめます</span>
                </div>
                <div className="field">
                  <label htmlFor="mi-note">メモ(任意)</label>
                  <input id="mi-note" type="text" autoComplete="off" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              {late && (
                <div className="field">
                  <label htmlFor="mi-late">期間のあとに受け付ける理由</label>
                  <input
                    id="mi-late"
                    type="text"
                    autoComplete="off"
                    maxLength={200}
                    placeholder="例: 期間中に来られなかった"
                    value={lateReason}
                    onChange={(e) => setLateReason(e.target.value)}
                  />
                </div>
              )}
              <fieldset className="mi-checks">
                <legend className="label">受付での確認(両方に印を付けてください)</legend>
                <label className="check">
                  <input type="checkbox" checked={confirmedCard} onChange={(e) => setConfirmedCard(e.target.checked)} />
                  旧カードを目で確かめた
                </label>
                <label className="check">
                  <input type="checkbox" checked={collectedCard} onChange={(e) => setCollectedCard(e.target.checked)} />
                  紙のカードは回収した(または使用済みの印を付けた)
                </label>
              </fieldset>
              <div className="mg-actions">
                <button type="button" className="btn" disabled={!ready} onClick={() => setConfirming(true)}>
                  引き継ぐ
                </button>
              </div>
            </>
          ) : null}
          {error ? <ErrorNotice error={error} /> : null}
        </>
      )}
      {confirming && picked && status && chosen && sourceNow && points !== null && cardPoints !== null && tickets !== null && (
        <DirectConfirm
          household={picked}
          balance={status.points}
          draft={{ memberId: chosen.id, memberName: memberLabel(status, chosen), source: sourceNow, cardPoints, points, tickets, cardRef: cardRef.trim(), note: note.trim(), lateReason: lateReason.trim() }}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            reset();
            void load(picked.id);
            onDone();
            toast({
              message:
                `${r.memberName ? `${r.memberName}さんの` : ''}${MIGRATION_SOURCE_LABELS[r.source]}の${r.points}ポイント${r.tickets ? `と無料券${r.tickets}枚` : ''}を引き継ぎました。` +
                `いまのポイントは${r.balance}ポイントです。`,
              undo: {
                auditId: r.auditId ?? null,
                doneMessage: `${MIGRATION_SOURCE_LABELS[r.source]}の引き継ぎを元に戻しました。`,
                onUndone: () => {
                  void load(picked.id);
                  onDone();
                },
              },
            });
          }}
        />
      )}
    </section>
  );
}

function DirectConfirm({
  household,
  balance,
  draft,
  onClose,
  onDone,
}: {
  household: HouseholdHit;
  balance: number;
  draft: Draft;
  onClose: () => void;
  onDone: (r: MigrationResult & Partial<WithAuditId>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dups, setDups] = useState<MigrationDuplicate[] | null>(null);
  const [dupChecked, setDupChecked] = useState(false);
  const plan = planMigration(balance, draft.points);
  const label = MIGRATION_SOURCE_LABELS[draft.source];
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await adminPost<MigrationResult & WithAuditId>(`/households/${household.id}/migrate`, {
          member_id: draft.memberId,
          source: draft.source,
          points: draft.points,
          card_points: draft.cardPoints,
          tickets: draft.tickets,
          confirmed_card: true,
          collected_card: true,
          ...(draft.cardRef ? { card_ref: draft.cardRef } : {}),
          ...(draft.note ? { note: draft.note } : {}),
          ...(draft.lateReason ? { late_reason: draft.lateReason } : {}),
          ...(dups && dupChecked ? { duplicate_ok: true } : {}),
        }),
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_card' && Array.isArray(e.details?.matches)) {
        setDups(e.details.matches as MigrationDuplicate[]);
      }
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="旧カードのポイントを引き継ぐ"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || (!!dups && !dupChecked)} onClick={submit}>
            <BusyLabel busy={busy} pending="引き継いでいます…">
              {dups ? '別のカードとして引き継ぐ' : '引き継ぐ'}
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        <b>{household.displayName}</b>(<span className="mono">{household.memberNo}</span>)に、<b>{draft.memberName}</b>の{label}から<b>{draft.points}ポイント</b>
        {draft.tickets > 0 && (
          <>
            と<b>無料券{draft.tickets}枚</b>
          </>
        )}
        を引き継ぎます。
      </p>
      <ul className="plain-list">
        <li>
          ポイントは {balance} → {plan.balanceAfter}ポイントになります
        </li>
        {draft.cardPoints > draft.points && (
          <li>
            旧カードの{draft.cardPoints}ポイントのうち、上限を超える{draft.cardPoints - draft.points}ポイントは引き継ぎません
          </li>
        )}
        {draft.cardRef && <li>カードの番号: {draft.cardRef}</li>}
        <li>{draft.memberName}の{label}の引き継ぎは、この1回だけです(カード1枚ごとに1回)</li>
        <li>間違えたときは、お知らせの「元に戻す」か、下の「引き継ぎ済みの一覧」から元に戻せます</li>
      </ul>
      {error && !dups ? <ErrorNotice error={error} /> : null}
      {dups && (
        <div className="alert warning" role="alert">
          <p>{error instanceof ApiError ? error.message : ''}</p>
          <ul className="plain-list">
            {dups.map((d) => (
              <li key={`${d.memberNo}-${d.at}`}>
                {d.householdName}(<span className="mono">{d.memberNo}</span>){d.memberName ? `・${d.memberName}さんのカード` : ''} · {formatDateTime(d.at)}
              </li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={dupChecked} onChange={(e) => setDupChecked(e.target.checked)} />
            カードを見比べて、別のカードだと確かめた
          </label>
        </div>
      )}
    </Dialog>
  );
}

/** 引き継ぎ済みの一覧(いつ・誰が・どのおうち・何ポイント・元に戻す)。会員ID・呼び名・カードの番号で探せる */
function MigratedList() {
  const { readOnly } = useAuth();
  const [data, setData] = useState<MigrationListResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const [undoing, setUndoing] = useState<MigrationRecord | null>(null);
  const toast = useToast();
  const reload = useCallback(async (query: string) => {
    try {
      setData(await adminApi<MigrationListResponse>(`/migrations${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void reload(q), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [reload, q]);

  return (
    <section className="panel mg-section" aria-label="引き継ぎ済みの一覧">
      <div className="mi-sum-head">
        <h2 className="mg-title">引き継ぎ済みの一覧</h2>
        <div className="search-field mi-search">
          <Icon name="search" size={20} />
          <input
            type="search"
            aria-label="引き継ぎ済みの一覧を探す"
            placeholder="会員ID・呼び名・カードの番号"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {error ? <ErrorNotice error={error} onRetry={() => void reload(q)} /> : null}
      {!data ? (
        error ? null : (
          <Loading>
            <ul className="mi-list">
              <MigratedHead />
              {Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="mi-row">
                  <span className="mi-when">
                    <SkeletonText size={14} w={120} />
                    <SkeletonText size={13} w={56} />
                  </span>
                  <span className="mi-main">
                    <SkeletonText size={14} w={[150, 120, 170][i]} />
                    <SkeletonText size={13} w={200} />
                  </span>
                  <span className="mi-points">
                    <Skeleton w={56} h={20} r={4} />
                  </span>
                  <span className="mi-end">
                    <SkeletonGhost w={56} />
                  </span>
                </li>
              ))}
            </ul>
          </Loading>
        )
      ) : data.records.length === 0 ? (
        <p className="empty">{q.trim() ? '見つかりませんでした。会員IDやカードの番号で探してみてください。' : 'まだ引き継いだ旧カードはありません。'}</p>
      ) : (
        <ul className="mi-list" aria-label="引き継ぎ済みの旧カード">
          <MigratedHead />
          {data.records.map((r) => (
            <li
              key={r.auditId}
              className={`mi-row${r.undone ? ' off' : ''}`}
              aria-label={`${r.householdName} ${r.memberNo} ${MIGRATION_SOURCE_LABELS[r.source]}`}
            >
              <span className="mi-when">
                <span className="mono">{formatDateTime(r.at)}</span>
                <span className="sub-text">{r.staffName ?? '(停止したスタッフ)'}</span>
              </span>
              <span className="mi-main">
                <b>{r.householdName}</b>
                <span className="sub-text">
                  <span className="mono">{r.memberNo}</span> · {r.memberName ? `${r.memberName}さんの` : ''}
                  {MIGRATION_SOURCE_LABELS[r.source]}
                  {r.cardRef ? ` · 番号 ${r.cardRef}` : ''}
                </span>
                {(r.note || r.lateReason) && (
                  <span className="sub-text">
                    {r.lateReason ? `期間のあと: ${r.lateReason}` : ''}
                    {r.lateReason && r.note ? ' · ' : ''}
                    {r.note ?? ''}
                  </span>
                )}
                {!r.undone && r.sameCardMemberNos.length > 0 && (
                  <span className="badges mi-badges">
                    <span className="badge warning">同じ番号: {r.sameCardMemberNos.join('、')}</span>
                  </span>
                )}
              </span>
              <span className="mi-points">
                <span>
                  <b>{r.points}</b>
                  <small>ポイント</small>
                </span>
                {r.cardPoints > r.points && <span className="sub-text">旧カード {r.cardPoints}</span>}
                {r.tickets > 0 && <span className="sub-text">無料券 {r.tickets}枚</span>}
              </span>
              <span className="mi-end">
                {r.undone ? (
                  <span className="badge">元に戻しました {formatDateTime(r.undone.at)}</span>
                ) : readOnly ? null : (
                  <button type="button" className="btn ghost" onClick={() => setUndoing(r)}>
                    元に戻す
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {undoing && (
        <UndoDialog
          r={undoing}
          onClose={() => setUndoing(null)}
          onDone={() => {
            toast(`${undoing.householdName}の${MIGRATION_SOURCE_LABELS[undoing.source]}の引き継ぎを元に戻しました。`);
            setUndoing(null);
            void reload(q);
          }}
        />
      )}
    </section>
  );
}

function UndoDialog({ r, onClose, onDone }: { r: MigrationRecord; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminPost(`/audit/${r.auditId}/undo`);
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="引き継ぎを元に戻す"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy} onClick={submit}>
            <BusyLabel busy={busy} pending="元に戻しています…">
              元に戻す
            </BusyLabel>
          </button>
        </>
      }
    >
      <p>
        <b>{r.householdName}</b>(<span className="mono">{r.memberNo}</span>)の、{MIGRATION_SOURCE_LABELS[r.source]}から引き継いだ
        <b>{r.points}ポイント</b>
        {r.tickets > 0 ? `と無料券${r.tickets}枚` : ''}を取り消します。
      </p>
      <ul className="plain-list">
        <li>引き継いだポイントを差し引きます</li>
        {r.tickets > 0 && <li>特典から出した無料券を回収します(使われていれば元に戻せません)</li>}
        <li>元に戻したあとは、同じカードをもう一度入力できます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

/** 引き継ぎ済みの一覧の見出し(列の名前)。スクロールしても上に残る */
function MigratedHead() {
  return (
    <li className="mi-row mi-head list-head" aria-hidden="true">
      <span>日時・担当</span>
      <span>おうち</span>
      <span>ポイント</span>
      <span />
    </li>
  );
}

/** 家族の呼び方。LINE の名前がなければ「家族(1人目)」など */
function memberLabel(status: MigrationStatus, m: MigrationMember): string {
  return m.name ? `${m.name}さん` : `家族(${status.members.findIndex((x) => x.id === m.id) + 1}人目)`;
}

/** だれのカードか(おうちの家族 = LINE アカウント)。カード1枚ごとに1回なので、引き継ぐたびに選ぶ(2026-10-30 の決定) */
function MemberChoice({ status, value, onChange }: { status: MigrationStatus; value: number | null; onChange: (id: number) => void }) {
  if (status.members.length === 0) {
    return <p className="sub-text">このおうちには、いまLINEでつながっている家族がいません。家族を追加してから引き継いでください。</p>;
  }
  return (
    <div className="field">
      <span className="label" id="mi-member-label">
        だれのカード
      </span>
      <div className="chips" role="radiogroup" aria-labelledby="mi-member-label">
        {status.members.map((m) => {
          const done = MIGRATION_SOURCES.filter((s) => m.done[s]).map((s) => MIGRATION_SOURCE_LABELS[s]);
          return (
            <label key={m.id}>
              <input type="radio" name="mi-member" checked={value === m.id} onChange={() => onChange(m.id)} />
              <span>
                {memberLabel(status, m)}
                {done.length > 0 ? `(${done.join('・')}は済み)` : ''}
              </span>
            </label>
          );
        })}
      </div>
      {value === null && <span className="hint">受付の前にいる人のカードを選んでください</span>}
    </div>
  );
}

/** このおうちで、もう引き継いだカード(だれの・どのカード・何ポイント) */
function CardsDone({ status }: { status: MigrationStatus }) {
  if (status.cards.length === 0) return null;
  return (
    <div className="field">
      <span className="label" id="mi-cards-label">
        このおうちで引き継いだカード
      </span>
      <ul className="plain-list mi-cards" aria-labelledby="mi-cards-label">
        {status.cards.map((c) => (
          <li key={`${c.memberId ?? 'x'}-${c.source}-${c.date}`}>
            {c.memberName ? `${c.memberName}さん` : c.memberId === null ? 'だれのカードか記録なし' : '家族'}の{MIGRATION_SOURCE_LABELS[c.source]}:{' '}
            {c.points}ポイント{c.tickets > 0 ? `・無料券${c.tickets}枚` : ''}({formatMonthDay(c.date)})
          </li>
        ))}
      </ul>
    </div>
  );
}
