const privateKeys = new Set(['answer', 'body', 'message', 'preview', 'text']);

export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        privateKeys.has(key.toLowerCase()) ? '[redacted]' : redact(item),
      ]),
    );
  }
  return value;
};

// Keep only event metadata in logs. In particular, never pass answer or thread text here.
export const log = (event: string, metadata: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ event, ...(redact(metadata) as Record<string, unknown>) }));
