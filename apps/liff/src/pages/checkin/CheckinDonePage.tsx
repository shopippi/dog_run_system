import { Link, useParams } from 'react-router-dom';

/** L-06 チェックイン完了(C-05 で、受付で見せる画面に仕上げる) */
export function CheckinDonePage() {
  const { id } = useParams();
  return (
    <main className="screen">
      <div className="notice good">
        <p>
          <b>チェックインしました</b>
        </p>
        <p className="small">受付番号 {id}</p>
      </div>
      <Link to="/" className="btn sub as-link">
        会員証にもどる
      </Link>
    </main>
  );
}
