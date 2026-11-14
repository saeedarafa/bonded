import { assertEquals } from 'jsr:@std/assert@1';
import { error, json } from './http.ts';

Deno.test('json: success response is no-store by default', () => {
  const response = json({ ok: true });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('cache-control'), 'no-store');
  assertEquals(response.headers.get('pragma'), 'no-cache');
  assertEquals(response.headers.get('content-type'), 'application/json; charset=utf-8');
});

Deno.test('error: error responses are no-store too', async () => {
  for (const status of [400, 401, 403, 404, 405, 409, 429, 500]) {
    const response = error('SOME_CODE', 'Some message', status);
    assertEquals(response.status, status);
    assertEquals(response.headers.get('cache-control'), 'no-store');
    assertEquals(response.headers.get('pragma'), 'no-cache');
    assertEquals(await response.json(), { error: 'SOME_CODE', message: 'Some message' });
  }
});

Deno.test('json: other caller headers keep the no-store default', () => {
  const response = json({}, 200, { allow: 'POST' });
  assertEquals(response.headers.get('allow'), 'POST');
  assertEquals(response.headers.get('cache-control'), 'no-store');
});

Deno.test('json: an explicit cache-control is an opt-out for public data', () => {
  const response = json({ public: true }, 200, { 'Cache-Control': 'public, max-age=60' });
  assertEquals(response.headers.get('cache-control'), 'public, max-age=60');
  assertEquals(response.headers.get('pragma'), null);
});

Deno.test('json: caller cannot drop content-type', () => {
  const response = json({}, 200, { 'content-type': 'text/plain' });
  assertEquals(response.headers.get('content-type'), 'application/json; charset=utf-8');
});
