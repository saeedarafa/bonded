/**
 * Demo data for the store frames (MOB-26). Test personas only: Maya (the viewer, orange) and Sam
 * (her partner, sky) from qa/fixtures/personas.json, a test checks the names match. Numbers and
 * times are the board's. No prices (they only come from RevenueCat offerings), no ratings or
 * reviews.
 */
export const STORE_DEMO = {
  me: 'Maya',
  partner: 'Sam',
  /** Day of the couple's run on Today and the widget. */
  day: 12,
  /** Streak shown on Today's chip (the board shows 11 before today's answer). */
  streakChip: 11,
  /** Streak on the thread, widget and "the feeling" frame. */
  streak: 12,
  /** Badge unlocked on "the feeling" frame, and the next one. */
  badge: 7,
  nextBadge: 14,
  /** Thread replies on the medium widget. */
  replies: 4,
  /** "New in" on Today's question card. */
  newIn: '14:22:09',
  /** "Next question in" on the medium widget. */
  nextIn: '9h 41m',
  /** Reactions on the partner's answer in the thread. */
  loves: 1,
} as const;

/** First letter of a name, for the avatar circles. */
export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}
