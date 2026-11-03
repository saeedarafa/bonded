import { parseEmailAuthCallback as parse } from '@/features/auth/emailLinks';

describe('email auth callback parsing', () => {
  it.each([
    'bonded://auth/callback?code=c',
    'bonded:///auth/callback?code=c',
    'bonded://?code=c',
    'bonded://auth/callback#code=c',
  ])('accepts PKCE %s', (url) => expect(parse(url)).toEqual({ kind: 'pkce', code: 'c' }));

  describe.each(['bonded://auth/callback', 'bonded://'])('token rejection at %s', (base) => {
    it.each([
      '?access_token=a&refresh_token=r',
      '#access_token=a&refresh_token=r&type=magiclink',
      '?access_token=a#refresh_token=r',
      '?code=c&access_token=a&refresh_token=r',
      '#code=c&access_token=a&refresh_token=r',
      '?code=c#access_token=a&refresh_token=r',
      '?access_token=a&refresh_token=r#code=c',
      '?code=c&access_token=',
      '?code=c#refresh_token=',
      '?code=c&%61ccess_token=a',
      '?code=c#provider_token=a',
      '?code=c&id_token=a',
      '?code=c#token_hash=a',
    ])('rejects token-only and mixed credentials %s', (suffix) => {
      expect(parse(`${base}${suffix}`)).toEqual({ kind: 'invalid' });
    });
  });

  it.each([
    'bonded://auth/callback',
    'bonded://auth/callback?code=',
    'bonded://auth/callback#access_token=a',
    'bonded://auth/callback#refresh_token=r',
    'bonded://auth/callback?code=a&code=b',
    'bonded://auth/callback?code=a#code=b',
    'bonded://auth/callback?code=c#access_token=a&refresh_token=r',
    'bonded://auth/callback#error=access_denied&error_code=otp_expired&error_description=private',
    'bonded://?error_code=otp_expired',
  ])('rejects invalid/expired/ambiguous callback %s', (url) => {
    expect(parse(url)).toEqual({ kind: 'invalid' });
  });

  it.each([
    'not a URL',
    'https://other.example/auth/callback?code=c',
    'bonded://j/BND1234?t=invite-secret',
    'bonded://today?code=c',
    'bonded://',
    'bonded://user:password@auth/callback?code=c',
    'bonded://auth:123/callback?code=c',
  ])('leaves unrelated links alone: %s', (url) => expect(parse(url)).toBeNull());
});
