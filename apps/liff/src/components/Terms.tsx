import { Icon } from './Icon';

/** 利用規約とプライバシーポリシー。行を押すと本文が開く(L-01・L-12) */
export function Terms({ termsText, privacyText }: { termsText: string; privacyText: string }) {
  return (
    <div className="rows terms-rows">
      <details>
        <summary>
          <span>利用規約を読む</span>
          <Icon name="chevron-right" />
        </summary>
        <p className="terms">{termsText}</p>
      </details>
      <details>
        <summary>
          <span>プライバシーポリシーを読む</span>
          <Icon name="chevron-right" />
        </summary>
        <p className="terms">{privacyText}</p>
      </details>
    </div>
  );
}
