export const json = (data: unknown, status = 200, headers: HeadersInit = {}): Response => {
  const resultHeaders = new Headers(headers);
  resultHeaders.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers: resultHeaders });
};

export const error = (code: string, message: string, status: number): Response =>
  json({ error: code, message }, status);
