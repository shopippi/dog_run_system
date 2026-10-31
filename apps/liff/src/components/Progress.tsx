/** 登録の進み具合(3本の細いバー)。L-01〜L-03 */
export function Progress({ step, total = 3, label = '登録の手順' }: { step: number; total?: number; label?: string }) {
  return (
    <div className="progress" role="img" aria-label={`${label} ${total}つのうち${step}つ目`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < step ? 'on' : ''} />
      ))}
    </div>
  );
}
