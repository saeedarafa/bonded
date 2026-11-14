// Every function response carries per-user or capability data, so none may be
// stored by a client, proxy or OS URL cache (BE-65, SEC advice on #479).
// A caller that deliberately serves public, cacheable data passes its own
// `cache-control` header; `pragma` is then not added.
export const json = (data: unknown, status = 200, headers: HeadersInit = {}): Response => {
  const resultHeaders = new Headers(headers);
  resultHeaders.set('content-type', 'application/json; charset=utf-8');
  if (!resultHeaders.has('cache-control')) {
    resultHeaders.set('cache-control', 'no-store');
    if (!resultHeaders.has('pragma')) resultHeaders.set('pragma', 'no-cache');
  }
  return new Response(JSON.stringify(data), { status, headers: resultHeaders });
};

export const error = (
  code: string,
  message: string,
  status: number,
  headers: HeadersInit = {},
): Response => json({ error: code, message }, status, headers);
