import type { ConfigContext, ExpoConfig } from 'expo/config';

import { BUNDLED_NOTIFICATION_SOUNDS, littleThingSoundFile } from '../channels';
import { LITTLE_THING_KINDS } from '../model';

// Jest runs in Node from the repo root, but the app tsconfig has no Node types: type what we use.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync: (p: string) => Uint8Array };

function readBytes(path: string): DataView {
  const raw = fs.readFileSync(path);
  return new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
}

function ascii(bytes: DataView, from: number, to: number): string {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes.getUint8(i));
  return s;
}

function sameBytes(a: DataView, b: DataView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a.getUint8(i) !== b.getUint8(i)) return false;
  return true;
}

/**
 * MOB-65 (D48, CONTRACTS §5): the five gesture sounds. One file per gesture, named exactly as the
 * server's push `sound` (`little_thing_<kind>.wav`), the same file on iOS and Android, under
 * 1.5 s and about 20 KB, and the PO's copy in design-handoff identical to the bundled one.
 */
type Wav = { format: number; channels: number; rate: number; bits: number; seconds: number };

function readWav(bytes: DataView): Wav {
  expect(ascii(bytes, 0, 4)).toBe('RIFF');
  expect(ascii(bytes, 8, 12)).toBe('WAVE');
  expect(ascii(bytes, 12, 16)).toBe('fmt ');
  expect(ascii(bytes, 36, 40)).toBe('data');
  const rate = bytes.getUint32(24, true);
  const blockAlign = bytes.getUint16(32, true);
  const data = bytes.getUint32(40, true);
  expect(data).toBe(bytes.byteLength - 44);
  return {
    format: bytes.getUint16(20, true),
    channels: bytes.getUint16(22, true),
    rate,
    bits: bytes.getUint16(34, true),
    seconds: data / blockAlign / rate,
  };
}

describe('little-things sounds (MOB-65)', () => {
  it.each(LITTLE_THING_KINDS)('%s: PCM WAV, mono, under 1.5 s and ~20 KB', (kind) => {
    const name = littleThingSoundFile(kind);
    expect(name).toBe(`little_thing_${kind}.wav`);
    const bytes = readBytes(`assets/sounds/${name}`);
    const wav = readWav(bytes);
    // Linear PCM 16-bit: accepted by iOS notification sounds and Android channel sounds alike.
    expect(wav).toMatchObject({ format: 1, channels: 1, bits: 16, rate: 11025 });
    expect(wav.seconds).toBeGreaterThan(0.2);
    expect(wav.seconds).toBeLessThan(1.5);
    expect(bytes.byteLength).toBeLessThanOrEqual(32 * 1024);
    // Not silent, not clipped.
    let peak = 0;
    for (let i = 44; i < bytes.byteLength; i += 2) {
      peak = Math.max(peak, Math.abs(bytes.getInt16(i, true)));
    }
    expect(peak).toBeGreaterThan(16000);
    expect(peak).toBeLessThan(32767);
  });

  it.each(LITTLE_THING_KINDS)('%s: the PO copy in design-handoff is the bundled file', (kind) => {
    const name = littleThingSoundFile(kind);
    const bundled = readBytes(`assets/sounds/${name}`);
    const handoff = readBytes(`design-handoff/assets/sounds/${name}`);
    expect(sameBytes(handoff, bundled)).toBe(true);
  });

  it('every gesture has its notification sound on both platforms', () => {
    expect([...BUNDLED_NOTIFICATION_SOUNDS]).toEqual([...LITTLE_THING_KINDS]);
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../../../../app.config') as {
        default: (ctx: ConfigContext) => ExpoConfig;
      };
      config = mod.default({ config: {} } as ConfigContext);
    });
    const plugin = config?.plugins?.find(
      (p): p is [string, { sounds: string[] }] => Array.isArray(p) && p[0] === 'expo-notifications',
    );
    expect(plugin?.[1].sounds).toEqual(
      LITTLE_THING_KINDS.map((kind) => `./assets/sounds/${littleThingSoundFile(kind)}`),
    );
  });
});
