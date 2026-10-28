import type { SurveyQuestion } from '@dr/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** まだ出していない追加のアンケート。取れなかったときは出さずに進める(会員証の利用を止めない)。 */
export function usePendingSurvey() {
  const [questions, setQuestions] = useState<SurveyQuestion[] | null>(null);
  useEffect(() => {
    api<{ questions: SurveyQuestion[] }>('/api/survey')
      .then((r) => setQuestions(r.questions))
      .catch(() => setQuestions([]));
  }, []);
  return { questions, dismiss: () => setQuestions([]) };
}
