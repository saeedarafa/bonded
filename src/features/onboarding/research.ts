/**
 * P2 "Your plan" research figures and source lines (D50, board S01 P2). Copy around them lives in
 * `en.json` `onboarding.plan.*`; the numbers and citations live only here.
 *
 * TODO verify against papers (LEAD-13): every figure, study name and year below is from the design
 * hand-off and must be checked against the original papers (with a source note) before launch.
 * No invented numbers: change them here only from the papers.
 */
export const RESEARCH = {
  /** Gottman & Driver: how often partners turned toward each other's bids for attention. */
  turningToward: {
    stayedTogetherPercent: 86,
    splitUpPercent: 33,
    source: 'Gottman & Driver, newlywed couples study',
  },
  /** Aron et al. 1997: the 36 questions that build closeness. */
  personalQuestions: {
    figure: '36',
    source: 'Aron et al., 1997',
  },
  /** Gable et al. 2004 and 2006: responding warmly when a partner shares good news. */
  warmResponses: {
    source: 'Gable et al., 2004 and 2006',
  },
  /** "Bonded turns this into 3 minutes a day …". */
  minutesPerDay: 3,
} as const;
