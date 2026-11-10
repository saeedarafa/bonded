import type { Href } from 'expo-router';

/** Where the answer flow (19, 20, 21, 22) lives for one question. */
export type QuestionPaths = {
  /** Today (18/23/24), or the question's History entry (30), which routes a pack question by state. */
  home: Href;
  answer: Href;
  reveal: Href;
  revealed: Href;
  thread: Href;
};

/**
 * MOB-49: the same screens answer today's question (`/today/...`) or any other `couple_questions`
 * row, such as a started pack question (`/history/<id>/...`). Pure, so routes are tested per case.
 */
export function questionPaths(questionId?: string): QuestionPaths {
  if (!questionId)
    return {
      home: '/today',
      answer: '/today/answer',
      reveal: '/today/reveal',
      revealed: '/today/revealed',
      thread: '/today/thread',
    };
  return {
    home: `/history/${questionId}`,
    answer: `/history/${questionId}/answer`,
    reveal: `/history/${questionId}/reveal`,
    revealed: `/history/${questionId}/revealed`,
    thread: `/history/${questionId}/thread`,
  };
}
