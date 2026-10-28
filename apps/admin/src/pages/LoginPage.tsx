import { useState, type FormEvent } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { useAuth } from '../lib/auth';
import { useFacilityName } from '../hooks/useFacilityName';

/** M-01 ログイン(S-01) */
export function LoginPage() {
  const { login } = useAuth();
  const facilityName = useFacilityName();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="panel login-box" onSubmit={submit}>
        <div className="login-head">
          <h1>{facilityName} 受付・管理</h1>
          <p className="howto">メールアドレスとパスワードを入れて「ログイン」を押してください。一度ログインすると、30日間はそのまま使えます。</p>
        </div>
        <div className="field">
          <label htmlFor="email">メールアドレス</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error ? <ErrorNotice error={error} /> : null}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'ログインしています…' : 'ログイン'}
        </button>
        <p className="note">パスワードを忘れたときは、管理者にパスワードの再発行を頼んでください。</p>
      </form>
    </main>
  );
}
