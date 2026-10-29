import { DAY_NOTE_MAX, type DayNote, type DayNoteSaved, type DayNotesResponse } from '@dr/shared';
import { useId, useState } from 'react';
import { useLoad } from '../hooks/useLoad';
import { adminApi, adminPatch, adminPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/jst-format';
import { BusyLabel } from './BusyLabel';
import { ErrorNotice } from './ErrorNotice';
import { SkeletonText } from './Skeleton';
import { useToast } from './Toast';

// その日のメモ(docs/design.md 12.3)。「今日の来場」の上と、ダッシュボードの日の詳細で使う。
// 受付スタッフと管理者は書く・直す・消すができる(製作者は見るだけ)。消したメモは操作ログから元に戻せる。

export function DayNotes({
  date,
  onChanged,
  compact = false,
}: {
  date: string;
  /** 書いた・直した・消したあと(グラフやカレンダーを読み直すため) */
  onChanged?: () => void;
  /** 今日の来場の上に置くときの小さな形 */
  compact?: boolean;
}) {
  const { readOnly } = useAuth();
  const { data, error, reload } = useLoad(() => adminApi<DayNotesResponse>(`/day-notes?date=${date}`), [date]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const toast = useToast();
  const inputId = useId();
  const changed = () => {
    void reload();
    onChanged?.();
  };

  const add = async () => {
    setSaveError(null);
    setBusy(true);
    try {
      const res = await adminPost<DayNoteSaved>('/day-notes', { date, body: text });
      setText('');
      changed();
      toast({ message: 'メモを残しました。', undo: { auditId: res.auditId, doneMessage: 'メモを残したのを元に戻しました。', onUndone: changed } });
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`dnote${compact ? ' dnote-compact' : ''}`}>
      {error ? <ErrorNotice error={error} onRetry={() => void reload()} /> : null}
      {!data ? (
        error ? null : (
          <div aria-busy="true">
            <span className="sr-only">読み込んでいます</span>
            <SkeletonText size={14} w="70%" />
          </div>
        )
      ) : data.notes.length === 0 ? (
        readOnly ? <p className="dnote-empty">この日のメモはありません。</p> : null
      ) : (
        <ul className="dnote-list" aria-label="この日のメモ">
          {data.notes.map((n) => (
            <NoteRow key={n.id} note={n} canEdit={!readOnly} onChanged={changed} />
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="dnote-form">
          <label htmlFor={inputId} className="sr-only">
            この日のメモ
          </label>
          <textarea
            id={inputId}
            rows={compact ? 1 : 2}
            maxLength={DAY_NOTE_MAX}
            placeholder="例: 午後から雨。小型犬の集まりがあった。"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="btn sub" disabled={busy || !text.trim()} onClick={() => void add()}>
            <BusyLabel busy={busy} pending="残しています…">
              メモを残す
            </BusyLabel>
          </button>
        </div>
      )}
      {saveError ? <ErrorNotice error={saveError} /> : null}
    </div>
  );
}

function NoteRow({ note, canEdit, onChanged }: { note: DayNote; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const editId = useId();

  const save = async () => {
    setError(null);
    setBusy('save');
    try {
      const res = await adminPatch<DayNoteSaved>(`/day-notes/${note.id}`, { body: text });
      setEditing(false);
      onChanged();
      toast({ message: 'メモを直しました。', undo: { auditId: res.auditId, doneMessage: 'メモを元に戻しました。', onUndone: onChanged } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setError(null);
    setBusy('remove');
    try {
      const res = await adminApi<{ auditId: number | null }>(`/day-notes/${note.id}`, { method: 'DELETE' });
      onChanged();
      toast({ message: 'メモを消しました。', undo: { auditId: res.auditId, doneMessage: 'メモを元に戻しました。', onUndone: onChanged } });
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  return (
    <li className="dnote-item">
      {editing ? (
        <div className="dnote-edit">
          <label htmlFor={editId} className="sr-only">
            メモを直す
          </label>
          <textarea id={editId} rows={2} maxLength={DAY_NOTE_MAX} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="dnote-acts">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setEditing(false);
                setText(note.body);
              }}
            >
              やめる
            </button>
            <button type="button" className="btn sub" disabled={busy !== null || !text.trim()} onClick={() => void save()}>
              <BusyLabel busy={busy === 'save'} pending="保存しています…">
                保存する
              </BusyLabel>
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="dnote-body">{note.body}</p>
          <div className="dnote-meta">
            <span className="dnote-who">
              {note.createdBy ?? 'スタッフ'} · {formatDateTime(note.createdAt).slice(5)}
              {note.updatedBy ? `(${note.updatedBy}が直した)` : ''}
            </span>
            {canEdit && (
              <span className="dnote-acts">
                <button type="button" className="btn ghost" aria-label={`メモ「${note.body.slice(0, 12)}」を直す`} onClick={() => setEditing(true)}>
                  直す
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  aria-label={`メモ「${note.body.slice(0, 12)}」を消す`}
                  disabled={busy !== null}
                  onClick={() => void remove()}
                >
                  消す
                </button>
              </span>
            )}
          </div>
        </>
      )}
      {error ? <ErrorNotice error={error} /> : null}
    </li>
  );
}
