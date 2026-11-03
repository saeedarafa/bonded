// Persona ids and emails from qa/fixtures/personas.json (the shared test vocabulary).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Persona = { id: string; email: string; display_name: string; timezone: string };
const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'personas.json',
);
const all = JSON.parse(fs.readFileSync(file, 'utf8')).personas as Record<string, Persona>;

export type PersonaName = 'maya' | 'sam' | 'lea' | 'eve' | 'finn' | 'noor';
export const PERSONAS = Object.fromEntries(
  (['maya', 'sam', 'lea', 'eve', 'finn', 'noor'] as const).map((n) => {
    if (!all[n]) throw new Error(`persona ${n} missing from qa/fixtures/personas.json`);
    return [n, all[n]];
  }),
) as Record<PersonaName, Persona>;

export type StackEnv = {
  url: string;
  anonKey: string;
  serviceKey: string;
  jwtSecret?: string;
  /** Direct Postgres URL of the local stack: for the `private` schema, which the API never exposes. */
  dbUrl: string;
  /** Local mail catcher (Mailpit) API base: `supabase status` MAILPIT_URL (QA-11). */
  mailUrl: string;
};

declare module 'vitest' {
  export interface ProvidedContext {
    stack: StackEnv;
    tokens: Record<PersonaName, string>;
  }
}
