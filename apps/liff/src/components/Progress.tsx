/** 登録の進み具合(3本の細いバー)。L-01〜L-03 */
export function Progress({ step, total = 3 }: { step: number; total?: number }) {
  return (
    <div className="progress" role="img" aria-label={`登録の手順 ${total}つのうち${step}つ目`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < step ? 'on' : ''} />
      ))}
    </div>
  );
}
