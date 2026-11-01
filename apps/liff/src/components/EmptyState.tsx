import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** 空の状態(docs/design.md 11.3)。中央に 40px の線のアイコン + 15px の一文 + 必要なら副ボタン */
export function EmptyState({ icon, children, action }: { icon: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={40} />
      </span>
      <p className="empty-text">{children}</p>
      {action}
    </div>
  );
}
