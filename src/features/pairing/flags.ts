/**
 * D37 "Join them" entry points for a solo account (10, 11, the Today card). On since BE-26 (#41,
 * inviter approval for typed codes) and MOB-32 (#56, the pending-join UI) are on main: a typed
 * code waits for the inviter's yes, and the joiner's own space becomes the 30-day archive (BE-25).
 * Kept as a kill switch: false hides the three links again.
 */
export const JOIN_FROM_SOLO_ENABLED = true;
