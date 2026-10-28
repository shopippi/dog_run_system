import type { PublicSettingsResponse } from '@dr/shared';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../components/ErrorNotice';
import { PageHead } from '../components/PageHead';
import { Section, useLoaded } from '../components/SettingsKit';
import { HELP_FAQS, HELP_SCREENS, type HelpAudience } from '../content/help';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * M-16 使い方・困ったとき(A-16)。よくある質問、画面ごとの使い方、製作者への連絡先。
 * 受付スタッフには、受付で使う画面と質問だけを出す。文章は content/help.ts にある。
 */
export function HelpPage() {
  const { staff } = useAuth();
  const contact = useLoaded(() => adminApi<PublicSettingsResponse>('/settings/public'));
  const canSee = (who: HelpAudience) => who === 'all' || staff?.role !== 'staff';
  const faqs = HELP_FAQS.filter((f) => canSee(f.who));
  const screens = HELP_SCREENS.filter((s) => canSee(s.who));

  return (
    <div className="page cfg-page">
      <PageHead
        title="使い方・困ったとき"
        howto="困ったときは、まず「よくある質問」を見てください。それでも分からないときや、システムが動かないときは、いちばん下の連絡先に連絡してください。"
      />

      <Section title="よくある質問" className="cfg-help">
        <div className="cfg-faqs">
          {faqs.map((f) => (
            <details key={f.q} className="cfg-faq">
              <summary>{f.q}</summary>
              <div className="cfg-faq-a">
                {f.a.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </Section>

      <Section title="画面ごとの使い方" className="cfg-help">
        <div className="cfg-howtos">
          {screens.map((s) => (
            <article key={s.title} className="cfg-howto" aria-label={s.title}>
              <h3>
                <Link to={s.path}>{s.title}</Link>
              </h3>
              <ul className="plain-list">
                {s.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <Section title="製作者への連絡先" desc="システムが動かないとき、データを元に戻してほしいとき、プログラムを変えてほしいときに連絡してください。">
        {contact.error ? <ErrorNotice error={contact.error} onRetry={contact.reload} /> : null}
        {contact.data &&
          (contact.data.developerContact.trim() ? (
            <p className="cfg-contact" aria-label="製作者の連絡先">
              {contact.data.developerContact}
            </p>
          ) : (
            <p className="sub-text">
              まだ登録されていません。管理者が「ルール」の画面の「製作者の連絡先」に入れてください。
            </p>
          ))}
      </Section>
    </div>
  );
}
