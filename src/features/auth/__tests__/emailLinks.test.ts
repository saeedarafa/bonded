import { parseEmailAuthCallback as parse } from '@/features/auth/emailLinks';

describe('email auth callback parsing', () => {
  it.each(['bonded://auth/callback?code=c', 'bonded:///auth/callback?code=c', 'bonded://?code=c'])(
    'accepts PKCE %s',
    (url) => expect(parse(url)).toEqual({ kind: 'pkce', code: 'c' }),
  );

  it.each([
    'bonded://auth/callback#access_token=a&refresh_token=r&type=magiclink',
    'bonded://auth/callback?access_token=a&refresh_token=r',
    'bonded://#access_token=a&refresh_token=r',
  ])('accepts implicit credentials %s', (url) => {
    expect(parse(url)).toEqual({ kind: 'implicit', access_token: 'a', refresh_token: 'r' });
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
