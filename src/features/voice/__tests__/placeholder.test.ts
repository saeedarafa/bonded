import { toAppError } from '@/lib/errors';

import { bodyOrVoice } from '../placeholder';

describe('bodyOrVoice (MOB-55a, BE-42)', () => {
  it('keeps the text of a text row', () => {
    expect(bodyOrVoice('Our first trip')).toBe('Our first trip');
  });

  it('shows a neutral placeholder for a voice row (body null)', () => {
    expect(bodyOrVoice(null)).toBe('Voice note');
  });
});

describe('INVALID_VOICE', () => {
  it('maps to its own message, not the generic one', () => {
    const e = toAppError({ code: 'P0001', message: 'INVALID_VOICE', details: null, hint: null });
    expect(e.kind).toBe('INVALID_VOICE');
    expect(e.message).toBe("That voice note couldn't be saved. Record it again, then send it.");
  });
});
