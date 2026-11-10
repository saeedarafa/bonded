// The Supabase client captures `fetch` when it is created (on first import), so install a
// delegating fetch before any test module loads. Tests set `globalThis.__qaFetch`.
type Fetch = typeof fetch;
const g = globalThis as unknown as { __qaFetch?: Fetch; fetch: Fetch };
const real = g.fetch;
g.fetch = ((...args: Parameters<Fetch>) => (g.__qaFetch ?? real)(...args)) as Fetch;
