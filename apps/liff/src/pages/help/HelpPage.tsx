import { Icon } from '../../components/Icon';
import { helpItems } from '../../content/help';
import { useMe } from '../../hooks/useMe';

/** お客さん向けの使い方・よくある質問。行を押すと答えが開く */
export function HelpPage() {
  const { me } = useMe();
  const pointsPerTicket = me?.registered ? me.card.pointsPerTicket : 10;
  return (
    <main className="screen">
      <div className="page-head">
        <h2>使い方・よくある質問</h2>
        <p className="lead">知りたいことを押すと、答えが開きます。</p>
      </div>
      <div className="rows help-rows">
        {helpItems({ pointsPerTicket }).map((item) => (
          <details key={item.q}>
            <summary>
              <span>{item.q}</span>
              <Icon name="chevron-right" />
            </summary>
            <div className="help-answer">
              {item.a.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </details>
        ))}
      </div>
      <p className="note">ここにないことは、受付のスタッフにおたずねください。</p>
    </main>
  );
}
