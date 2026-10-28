import type { InviteCreated } from '@dr/shared';
import { useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { QrImage } from '../../components/QrImage';
import { useMe } from '../../hooks/useMe';
import { postJson } from '../../lib/api';
import { inviteUrl, isInLineApp, shareToLine } from '../../lib/liff';
import { BackLink } from '../dogs/DogsPage';

function formatExpiry(iso: string) {
  const [date, time] = [iso.slice(5, 10).replace('-', '/'), iso.slice(11, 16)];
  return `${date.replace(/^0/, '')} ${time}`;
}

/** L-11 家族(招待)(C-11)。LINE のトークで招待を送るか、招待の QR コードを家族に読み取ってもらう。 */
export function FamilyPage() {
  const { me } = useMe();
  const [invite, setInvite] = useState<InviteCreated | null>(null);
  const [mode, setMode] = useState<'qr' | 'sent' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const householdName = me?.registered ? me.household.displayName : '';

  const create = async () => postJson<InviteCreated>('/api/invites', {});

  const sendByLine = async () => {
    setBusy(true);
    setError(null);
    try {
      const inv = await create();
      const text = `${householdName}の会員証に招待します。\nリンクを開くと、同じ会員証でポイントがたまります(${formatExpiry(inv.expiresAt)}まで有効・1回だけ使えます)。\n${inviteUrl(inv.code)}`;
      const sent = await shareToLine(text);
      setInvite(inv);
      setMode(sent ? 'sent' : 'qr');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const showQr = async () => {
    setBusy(true);
    setError(null);
    try {
      setInvite(await create());
      setMode('qr');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <BackLink />
      <h2>家族を招待</h2>
      <p className="small">
        ご家族のLINEを、このおうちにつなげます。つながると、誰がチェックインしても同じ会員証にポイントがたまります。
      </p>
      <div className="notice">
        <p className="small">招待は1回だけ使えます。ご家族1人につき1つ送ってください。</p>
      </div>

      {mode === 'sent' && invite && (
        <div className="notice good" role="status">
          <p>
            <b>招待を送りました。</b>
          </p>
          <p className="small">ご家族がLINEでリンクを開き、「参加する」を押すと完了です。</p>
        </div>
      )}

      {mode === 'qr' && invite && (
        <div className="invite-card">
          <QrImage value={inviteUrl(invite.code)} label="家族の招待のQRコード" />
          <p className="small">ご家族のスマホのLINEのカメラで、このQRコードを読み取ってもらってください。</p>
          <p className="small muted">{formatExpiry(invite.expiresAt)}まで有効</p>
        </div>
      )}

      {error ? <ErrorNotice error={error} /> : null}
      {isInLineApp() && (
        <button type="button" className="btn" disabled={busy} onClick={sendByLine}>
          LINEで招待を送る
        </button>
      )}
      <button type="button" className="btn sub" disabled={busy} onClick={showQr}>
        招待のQRコードを表示する
      </button>
    </main>
  );
}
