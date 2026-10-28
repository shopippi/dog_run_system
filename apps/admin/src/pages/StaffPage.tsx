import {
  STAFF_PASSWORD_MIN,
  STAFF_ROLE_LABELS,
  type AdminStaff,
  type AdminStaffResponse,
  type StaffPasswordResult,
} from '@dr/shared';
import { useId, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHead } from '../components/PageHead';
import { RadioSegment, formatJstDateTime, useLoaded } from '../components/SettingsKit';
import { adminApi, adminPatch, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';

const ROLE_OPTIONS = [
  { value: 'staff', label: '受付スタッフ' },
  { value: 'admin', label: '管理者' },
] as const;
type NewRole = (typeof ROLE_OPTIONS)[number]['value'];

/**
 * M-14 スタッフ(A-13)。管理画面のアカウントの追加・停止・再開・パスワードの再発行。
 * 製作者(見るだけ)のアカウントは、ここでは作れない。
 */
export function StaffPage() {
  const { data, setData, error, reload } = useLoaded(() => adminApi<AdminStaffResponse>('/staff'));
  const { readOnly } = useAuth();
  const [suspending, setSuspending] = useState<AdminStaff | null>(null);
  const [resetting, setResetting] = useState<AdminStaff | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const resume = async (s: AdminStaff) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await adminPatch<AdminStaffResponse>(`/staff/${s.id}`, { status: 'active' }));
      setNotice(`${s.name}さんのアカウントを再開しました。`);
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page cfg-page">
      <PageHead
        title="スタッフ"
        howto="管理画面を使う人のアカウントです。やめた人は「停止する」にすると、すぐにログインできなくなります。パスワードを忘れた人には「パスワードを再発行」で新しいパスワードを渡してください。"
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!readOnly && data && (
        <AddStaff
          onAdded={(r, name) => {
            setData(r);
            setNotice(`${name}さんのアカウントを作りました。`);
          }}
        />
      )}
      {data && (
        <section className="panel list-panel" aria-label="スタッフの一覧">
          {actionError ? (
            <div className="cfg-list-msg">
              <ErrorNotice error={actionError} />
            </div>
          ) : null}
          <p className="sr-only" role="status">
            {notice}
          </p>
          <ul className="cfg-list" aria-label="スタッフ">
            {data.staff.map((s) => (
              <li key={s.id} className={`cfg-item cfg-staff${s.status === 'suspended' ? ' cfg-off' : ''}`} aria-label={s.name}>
                <span className="cfg-item-body">
                  <b>
                    {s.name}
                    {s.isMe && <span className="sub-text">(あなた)</span>}
                  </b>
                  <span className="sub-text">
                    {s.email}
                    <span aria-hidden="true"> · </span>
                    {s.lastLoginAt ? `最後のログイン ${formatJstDateTime(s.lastLoginAt)}` : 'まだログインしていません'}
                  </span>
                </span>
                <span className="badges">
                  <span className={`badge${s.role === 'admin' ? ' info' : ''}`}>{STAFF_ROLE_LABELS[s.role]}</span>
                  {s.status === 'suspended' && <span className="badge">停止中</span>}
                  {s.locked && <span className="badge warning">ロック中</span>}
                </span>
                {!readOnly && (
                  <span className="cfg-item-acts">
                    {s.role !== 'developer' && (
                      <button type="button" className="btn ghost" aria-label={`${s.name}さんのパスワードを再発行`} disabled={busy} onClick={() => setResetting(s)}>
                        パスワードを再発行
                      </button>
                    )}
                    {!s.isMe &&
                      (s.status === 'active' ? (
                        <button type="button" className="btn ghost cfg-danger-text" aria-label={`${s.name}さんを停止する`} disabled={busy} onClick={() => setSuspending(s)}>
                          停止する
                        </button>
                      ) : (
                        <button type="button" className="btn ghost" aria-label={`${s.name}さんを再開する`} disabled={busy} onClick={() => void resume(s)}>
                          再開する
                        </button>
                      ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!data && !error && <p className="loading">読み込んでいます…</p>}
      <p className="note">製作者(見るだけ)のアカウントは、製作者が作ります。</p>
      {suspending && (
        <SuspendDialog
          s={suspending}
          onClose={() => setSuspending(null)}
          onDone={(r) => {
            setData(r);
            setNotice(`${suspending.name}さんのアカウントを停止しました。`);
            setSuspending(null);
          }}
        />
      )}
      {resetting && <PasswordDialog s={resetting} onClose={() => setResetting(null)} onDone={() => void reload()} />}
    </div>
  );
}

function AddStaff({ onAdded }: { onAdded: (r: AdminStaffResponse, name: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<NewRole>('staff');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nameId = useId();
  const emailId = useId();
  const passId = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<AdminStaffResponse>('/staff', { name, email, role, password });
      onAdded(r, name.trim());
      setName('');
      setEmail('');
      setPassword('');
      setRole('staff');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel cfg-add" aria-label="スタッフを追加">
      <form
        className="cfg-fieldset"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="cfg-grid2">
          <div className="field">
            <label htmlFor={nameId}>名前</label>
            <input id={nameId} value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={emailId}>メールアドレス</label>
            <input id={emailId} type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          </div>
          <RadioSegment label="役割" options={ROLE_OPTIONS} value={role} onChange={setRole} />
          <div className="field">
            <label htmlFor={passId}>はじめのパスワード</label>
            <input id={passId} value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
            <span className="hint">{STAFF_PASSWORD_MIN}文字以上。本人に伝えてください。</span>
          </div>
        </div>
        <div className="cfg-acts">
          <button type="submit" className="btn" disabled={busy || !name.trim() || !email.trim() || !password}>
            {busy ? '追加しています…' : '追加する'}
          </button>
        </div>
      </form>
      {error ? <ErrorNotice error={error} /> : null}
    </section>
  );
}

function SuspendDialog({ s, onClose, onDone }: { s: AdminStaff; onClose: () => void; onDone: (r: AdminStaffResponse) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await adminPatch<AdminStaffResponse>(`/staff/${s.id}`, { status: 'suspended' }));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="アカウントを停止する"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" disabled={busy} onClick={submit}>
            {busy ? '停止しています…' : '停止する'}
          </button>
        </>
      }
    >
      <p>
        <b>{s.name}さん</b>({s.email})のアカウントを停止します。
      </p>
      <ul className="plain-list">
        <li>ログイン中の画面も、すぐに使えなくなります</li>
        <li>「再開する」で、いつでも元に戻せます</li>
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}

/** パスワードの再発行。ランダムに作ったときは、新しいパスワードをこの画面で1回だけ見せる */
function PasswordDialog({ s, onClose, onDone }: { s: AdminStaff; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'random' | 'manual'>('random');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ password: string | null } | null>(null);
  const id = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminPost<StaffPasswordResult>(`/staff/${s.id}/password`, mode === 'manual' ? { password } : {});
      setResult(r);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (result) {
    return (
      <Dialog
        title="パスワードを再発行しました"
        onClose={onClose}
        footer={
          <button type="button" className="btn sub" data-autofocus onClick={onClose}>
            閉じる
          </button>
        }
      >
        {result.password ? (
          <>
            <p>{s.name}さんの新しいパスワードです。本人に伝えてください。</p>
            <p className="cfg-password mono" aria-label="新しいパスワード">
              {result.password}
            </p>
            <p className="sub-text">この画面を閉じると、もう表示できません。</p>
          </>
        ) : (
          <p>{s.name}さんのパスワードを、入れたものに変えました。本人に伝えてください。</p>
        )}
        <p className="sub-text">ほかの端末でログインしていた画面は、ログアウトしました。</p>
      </Dialog>
    );
  }
  return (
    <Dialog
      title="パスワードを再発行"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn sub" data-autofocus disabled={busy} onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn" disabled={busy || (mode === 'manual' && !password)} onClick={submit}>
            {busy ? '再発行しています…' : '再発行する'}
          </button>
        </>
      }
    >
      <p>
        <b>{s.name}さん</b>の新しいパスワードを作ります。ロックされているときは、ロックも解除します。
      </p>
      <RadioSegment
        label="新しいパスワード"
        options={[
          { value: 'random', label: 'ランダムに作る' },
          { value: 'manual', label: '自分で入れる' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'manual' && (
        <div className="field">
          <label htmlFor={id}>新しいパスワード</label>
          <input id={id} value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          <span className="hint">{STAFF_PASSWORD_MIN}文字以上</span>
        </div>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </Dialog>
  );
}
