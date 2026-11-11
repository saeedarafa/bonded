// Jest runs in Node, but the app tsconfig has no Node types, so type just what we use.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as {
  readdirSync: (
    p: string,
    o: { withFileTypes: true },
  ) => { name: string; isDirectory(): boolean }[];
  readFileSync: (p: string, enc: 'utf8') => string;
};

/** App source files under `dir` (relative to the repo root, Jest's cwd), tests excluded. */
export function sourceFiles(dir: string, ext = /\.tsx?$/): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory())
      return e.name === '__tests__' || e.name === 'test' ? [] : sourceFiles(p, ext);
    return ext.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

export function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8');
}
