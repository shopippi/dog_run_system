import { addDays, weekdayOf } from '@dr/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startBridge } from './bridge';
import { DemoEngine } from './engine/engine';
import { loadSqlJs } from './engine/sqljs';
import { makeDogPhoto } from './seed/art';
import { ACCOUNTS, DEMO_PASSWORD, STAFF } from './seed/fixtures';
import { SCENES } from './scenes';

type Account = { userId: string; name: string };
type Talk = { id: number; from: string; text: string; at: string };
type Role = 'staff' | 'admin' | 'developer';
type Ui = { accounts: Account[]; who: string; talk: Talk[]; role: Role; hint: string };

const UI_KEY = 'dr.demo.ui';
const DEFAULT_HINT = '手順のボタンを押すと、その場面に必要な状態まで進めます。どこからでも自由に操作できます。';
const defaultUi = (): Ui => ({
  accounts: ACCOUNTS.map(({ userId, name }) => ({ userId, name })),
  who: 'U-demo-mama',
  talk: [],
  role: 'admin',
  hint: DEFAULT_HINT,
});

function loadUi(): Ui {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (raw) return { ...defaultUi(), ...(JSON.parse(raw) as Partial<Ui>) };
  } catch {
    // 保存できない環境でも動く
  }
  return defaultUi();
}
function saveUi(ui: Ui) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // 保存できなくても動く
  }
}

// 起動は1回だけ(画面を作り直しても、データの準備はやり直さない)
let booting: Promise<DemoEngine> | null = null;
function boot(): Promise<DemoEngine> {
  booting ??= (async () => {
    const SQL = await loadSqlJs();
    const engine = await DemoEngine.create({ SQL, photos: { makeDogPhoto } });
    if (!engine.jar('admin').header(engine.now().getTime())) {
      await engine.loginAs('admin', 'admin@example.com', DEMO_PASSWORD);
    }
    return engine;
  })();
  booting.catch(() => {
    booting = null;
  });
  return booting;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function formatDate(d: string) {
  return `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日(${WEEK[weekdayOf(d)]})`;
}

/** LIFF の画面の URL(ハッシュ)。LINE のアカウントはクエリの mockUser で渡す */
function liffHash(route: string, acc: Account) {
  const [path, query = ''] = route.split('?');
  const q = new URLSearchParams(query);
  q.set('mockUser', `${acc.userId}:${acc.name}`);
  return `#${path}?${q.toString()}`;
}

const inviteCodeOf = (text: string) => /\/invite\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;

export function App() {
  const [engine, setEngine] = useState<DemoEngine | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    boot().then(setEngine, (e) => {
      console.error(e);
      setFailed(true);
    });
  }, []);

  if (failed) {
    return (
      <main className="wrap">
        <Header />
        <div className="alert danger" role="alert">
          <p>デモの準備ができませんでした。</p>
          <p>インターネットにつながっているか確かめて、ページを読み込み直してください。続くときは、別のブラウザ(Chrome・Safari・Edge の新しいもの)で開いてください。</p>
        </div>
      </main>
    );
  }
  if (!engine) {
    return (
      <main className="wrap">
        <Header />
        <p className="loading" role="status">
          デモの準備をしています。はじめて開いたときは、半年分の来場データを作るので少し時間がかかります…
        </p>
      </main>
    );
  }
  return <Demo engine={engine} />;
}

function Header() {
  return (
    <header className="head">
      <h1>ドッグラン会員証デモ</h1>
      <p className="lede">
        左がお客さんの LINE の画面、右が受付・管理画面です。どちらも本物の画面と本物の処理が、このブラウザの中だけで動いています(データは架空です)。
        ポイントは「おうち」ごとにたまり、家族の LINE アカウントをつなげられます。
      </p>
    </header>
  );
}

function Demo({ engine }: { engine: DemoEngine }) {
  const [ui, setUi] = useState<Ui>(loadUi);
  const [, setTick] = useState(0);
  const [phone, setPhone] = useState<{ route: string; key: number }>({ route: '/', key: 0 });
  const [admin, setAdmin] = useState<{ route: string; key: number }>({ route: '/', key: 0 });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const phoneRef = useRef<HTMLIFrameElement>(null);
  const adminRef = useRef<HTMLIFrameElement>(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const update = useCallback((patch: Partial<Ui>) => {
    setUi((prev) => {
      const next = { ...prev, ...patch };
      saveUi(next);
      return next;
    });
  }, []);

  const account = ui.accounts.find((a) => a.userId === ui.who) ?? ui.accounts[0]!;

  // 受付の「今日の来場」を開いていて、操作の途中(ダイアログ・入力中)でなければ、読み込み直す
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTodayLater = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      const w = adminRef.current?.contentWindow;
      if (!w) return;
      try {
        const hash = w.location.hash || '#/';
        const doc = w.document;
        const busy = doc.querySelector('[role="dialog"]') || doc.activeElement?.matches('input, textarea, select');
        if ((hash === '#/' || hash.startsWith('#/?')) && !busy) w.location.reload();
      } catch {
        // 読み込み直せなくても、30秒ごとに新しくなる
      }
    }, 300);
  }, []);

  // 画面(iframe)との橋渡し
  useEffect(() => {
    engine.onChange = () => setTick((t) => t + 1);
    const stop = startBridge(engine, {
      frames: () => ({ liff: phoneRef.current, admin: adminRef.current }),
      onShare: (text) => {
        const from = uiRef.current.accounts.find((a) => a.userId === uiRef.current.who)?.name ?? '';
        const talk = [...uiRef.current.talk, { id: Date.now(), from, text, at: engine.nowIso() }];
        update({ talk });
        setStatus(`${from}さんが LINE のトークに送りました。`);
      },
      onWrite: (frame) => {
        // お客さんがチェックインしたら、受付の「今日の来場」をすぐに読み込み直す(本物は30秒ごと)
        if (frame === 'liff') refreshTodayLater();
      },
      onScan: () => {
        setStatus('受付の QR コードを読み取りました。');
        return `https://liff.line.me/demo/checkin?k=${encodeURIComponent(engine.passphrase())}`;
      },
    });
    return () => {
      stop();
      engine.onChange = null;
    };
  }, [engine, update, refreshTodayLater]);

  const openPhone = (route: string, who = ui.who) => {
    if (who !== ui.who) update({ who });
    setPhone((p) => ({ route, key: p.key + 1 }));
  };
  const openAdmin = (route: string) => setAdmin((p) => ({ route, key: p.key + 1 }));

  const loginAs = async (role: Role) => {
    const s = STAFF.find((x) => x.role === role)!;
    setBusy(true);
    try {
      const ok = await engine.loginAs('admin', s.email, DEMO_PASSWORD);
      update({ role });
      setStatus(ok ? `${s.label}の${s.name}さんとしてログインしました。` : 'ログインできませんでした。「最初からやり直す」を押してください。');
    } finally {
      setBusy(false);
    }
  };

  const isMember = (userId: string) =>
    engine.select("SELECT 1 FROM family_members WHERE line_user_id = ? AND status = 'active'", [userId]).length > 0;

  const accountNote = (userId: string) => {
    const r = engine.select<{ display_name: string; member_no: string; bal: number }>(
      `SELECT h.display_name, h.member_no,
              COALESCE((SELECT SUM(delta) FROM point_ledger p WHERE p.household_id = h.id), 0) AS bal
         FROM family_members m JOIN households h ON h.id = m.household_id
        WHERE m.line_user_id = ? AND m.status = 'active'`,
      [userId],
    )[0];
    return r ? `${r.display_name}(${r.member_no})・${r.bal}ポイント` : 'まだ会員ではありません';
  };

  const goScene = async (n: number) => {
    const scene = SCENES.find((s) => s.n === n)!;
    let hint = scene.hint;
    const accountsNow = uiRef.current.accounts;
    if (n === 1) {
      // はじめての人がすでに登録済みなら、新しい「はじめての人」を用意する
      let fresh = accountsNow.find((a) => a.userId.startsWith('U-demo-new-') && !isMember(a.userId));
      if (!fresh) {
        const count = accountsNow.filter((a) => a.userId.startsWith('U-demo-new-')).length + 1;
        fresh = { userId: `U-demo-new-${count}`, name: `はじめての人${count}` };
        update({ accounts: [...accountsNow, fresh] });
      }
      openPhone(`/checkin?k=${encodeURIComponent(engine.passphrase())}`, fresh.userId);
      if (ui.role !== 'admin') await loginAs('admin');
      openAdmin('/');
    } else if (n === 2) {
      openPhone(`/checkin?k=${encodeURIComponent(engine.passphrase())}`, 'U-demo-mama');
      if (ui.role !== 'admin') await loginAs('admin');
      openAdmin('/');
    } else if (n === 3) {
      openPhone('/family', 'U-demo-mama');
    } else if (n === 4) {
      const invite = [...uiRef.current.talk].reverse().map((t) => inviteCodeOf(t.text)).find(Boolean);
      if (isMember('U-demo-papa')) {
        openPhone(`/checkin?k=${encodeURIComponent(engine.passphrase())}`, 'U-demo-papa');
      } else if (invite) {
        openPhone(`/invite/${invite}`, 'U-demo-papa');
        hint = 'こむぎパパは、まだ家族になっていません。届いた招待を開きました。参加したあと、もう一度この手順のボタンを押すとチェックインの画面になります。';
      } else {
        openPhone('/family', 'U-demo-mama');
        hint = 'こむぎパパは、まだ家族になっていません。先に手順3で、ママから招待を送ってください(この画面から送れます)。';
      }
      if (ui.role !== 'admin') await loginAs('admin');
      openAdmin('/');
    } else if (n === 5) {
      openPhone('/', 'U-demo-nico');
      if (ui.role !== 'admin') await loginAs('admin');
      openAdmin('/requests');
    } else if (n === 6) {
      openPhone('/', 'U-demo-mama');
      if (ui.role !== 'admin') await loginAs('admin');
      openAdmin('/households/1');
    } else if (n === 7) {
      openPhone('/', 'U-demo-momo');
      if (ui.role !== 'admin') await loginAs('admin');
      openAdmin('/migration');
    } else if (n === 8) {
      await loginAs('staff');
      openAdmin('/search');
    }
    update({ hint: `${n}. ${scene.title} — ${hint}` });
  };

  const nextDay = async () => {
    setBusy(true);
    try {
      await engine.advanceDay();
      // いま開いている画面のまま、読み込み直す
      phoneRef.current?.contentWindow?.location.reload();
      adminRef.current?.contentWindow?.location.reload();
      setStatus(`${formatDate(engine.today())}になりました。チェックインやポイントは、この日の分として記録されます。`);
    } finally {
      setBusy(false);
    }
  };

  const nightly = async () => {
    setBusy(true);
    try {
      await engine.runNightly();
      setStatus('夜間の処理(集計・期限切れの処理・天気の取り込み)を動かしました。');
    } catch (e) {
      console.error(e);
      setStatus('夜間の処理がうまく動きませんでした。少し待ってから、もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setConfirmReset(false);
    setBusy(true);
    setStatus('初期データに戻しています…');
    try {
      await engine.reset();
      await engine.loginAs('admin', 'admin@example.com', DEMO_PASSWORD);
      const fresh = defaultUi();
      saveUi(fresh);
      setUi(fresh);
      setPhone((p) => ({ route: '/', key: p.key + 1 }));
      setAdmin((p) => ({ route: '/', key: p.key + 1 }));
      setStatus('最初の状態に戻しました。手順のボタンから始めてください。');
    } catch (e) {
      console.error(e);
      setStatus('最初の状態に戻せませんでした。ページを読み込み直してから、もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  };

  const today = engine.today();
  const realToday = addDays(today, -engine.dayOffset);
  const staff = STAFF.find((s) => s.role === ui.role)!;

  return (
    <main className="wrap">
      <Header />

      <section className="panel script" aria-labelledby="script-h">
        <h2 id="script-h">打ち合わせ用の手順</h2>
        <ol className="steps">
          {SCENES.map((s) => (
            <li key={s.n}>
              <button type="button" className="step" disabled={busy} onClick={() => void goScene(s.n)}>
                <span className="n">{s.n}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        <p className="hint" data-testid="scene-hint">
          {ui.hint}
        </p>
      </section>

      <section className="panel daybar" aria-label="デモの日付と操作">
        <div className="day">
          <span className="day-label">今日</span>
          <b className="day-value" data-testid="demo-today">
            {formatDate(today)}
          </b>
          {engine.dayOffset > 0 && <span className="day-note">(実際の日付 {formatDate(realToday)} から {engine.dayOffset}日進めています)</span>}
        </div>
        <div className="day-actions">
          <button type="button" className="btn sub" disabled={busy} onClick={() => void nextDay()}>
            翌日にする
          </button>
          <button type="button" className="btn sub" disabled={busy} onClick={() => void nightly()}>
            夜間の処理を今すぐ動かす
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirmReset(true)}>
            最初からやり直す
          </button>
        </div>
        <p className="status" role="status" aria-live="polite">
          {status}
        </p>
      </section>

      <div className="stage">
        <section className="col" aria-labelledby="phone-h">
          <h2 id="phone-h" className="col-title">
            お客さんのスマホ(LINE の中で開く画面)
          </h2>
          <div className="field">
            <label htmlFor="who">LINE のアカウント</label>
            <select
              id="who"
              value={ui.who}
              onChange={(e) => {
                openPhone('/', e.target.value);
              }}
            >
              {ui.accounts.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="note" data-testid="who-note">
              {accountNote(account.userId)}
            </p>
          </div>
          <div className="launch">
            <button type="button" className="btn sub" onClick={() => openPhone(`/checkin?k=${encodeURIComponent(engine.passphrase())}`)}>
              受付の QR を読み取る
            </button>
            <button type="button" className="btn sub" onClick={() => openPhone('/')}>
              リッチメニューから開く
            </button>
          </div>
          <div className="phone">
            <iframe
              key={`${phone.key}:${ui.who}`}
              ref={phoneRef}
              title="お客さんのスマホ"
              src={`liff/index.html${liffHash(phone.route, account)}`}
            />
          </div>

          <section className="panel talk" aria-labelledby="talk-h">
            <h3 id="talk-h">LINE のトーク</h3>
            {ui.talk.length === 0 ? (
              <p className="empty">まだメッセージはありません。家族を招待すると、ここに届きます。</p>
            ) : (
              <ul className="talk-list">
                {[...ui.talk].reverse().map((t) => {
                  const code = inviteCodeOf(t.text);
                  return (
                    <li key={t.id}>
                      <p className="talk-from">
                        {t.from}さんから <span className="mono">{t.at.slice(5, 16).replace('T', ' ')}</span>
                      </p>
                      <p className="talk-text">{t.text}</p>
                      {code && (
                        <button type="button" className="btn sub" onClick={() => openPhone(`/invite/${code}`)}>
                          この招待を開く({account.name}の LINE で)
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </section>

        <section className="col" aria-labelledby="admin-h">
          <h2 id="admin-h" className="col-title">
            受付・管理画面
          </h2>
          <div className="field">
            <span className="label" id="role-label">
              ログインする人
            </span>
            <div className="seg" role="group" aria-labelledby="role-label">
              {STAFF.map((s) => (
                <button
                  key={s.role}
                  type="button"
                  aria-pressed={ui.role === s.role}
                  disabled={busy}
                  onClick={() => void loginAs(s.role).then(() => openAdmin(s.role === 'staff' ? '/' : admin.route))}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="note">
              {staff.label}の{staff.name}さん — メールアドレス <span className="mono">{staff.email}</span>、パスワード <span className="mono">{DEMO_PASSWORD}</span>
            </p>
          </div>
          <div className="console">
            <iframe key={admin.key} ref={adminRef} title="受付・管理画面" src={`admin/index.html#${admin.route}`} />
          </div>
        </section>
      </div>

      {confirmReset && <ResetDialog onCancel={() => setConfirmReset(false)} onConfirm={() => void reset()} />}
    </main>
  );
}

function ResetDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, [onCancel]);
  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="reset-h" onClick={(e) => e.stopPropagation()}>
        <h2 id="reset-h">最初からやり直す</h2>
        <p>いまのデータ(登録・チェックイン・変更)を消して、初期データに戻します。日付も実際の今日に戻ります。</p>
        <div className="dialog-actions">
          <button type="button" className="btn sub" ref={cancelRef} onClick={onCancel}>
            やめる
          </button>
          <button type="button" className="btn danger-fill" onClick={onConfirm}>
            やり直す
          </button>
        </div>
      </div>
    </div>
  );
}
