import Svg, { Path } from 'react-native-svg';

/**
 * Line icons from the Components board (24 × 24 grid, round caps). Decorative by default
 * (hidden from screen readers): the parent control carries the label.
 */
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const paths = {
  today: [
    'M12 2c1.5 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-6 .5 1.5 1.3 2.3 2.5 2.8C11.5 6.5 11.5 4 12 2z',
  ],
  history: [
    'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M16 2v4M8 2v4M3 10h18',
  ],
  packs: ['M12 2 2 7l10 5 10-5-10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  us: [
    circle(9, 8, 4),
    'M2 21v-1a6 6 0 0 1 12 0v1',
    circle(17, 9, 3),
    'M22 20v-.5a4.5 4.5 0 0 0-6-4.2',
  ],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  check: ['M20 6 9 17l-5-5'],
  heart: [
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
  ],
  smile: [circle(12, 12, 10), 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01M15 9h.01'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
  close: ['M18 6 6 18M6 6l12 12'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
  back: ['M15 18l-6-6 6-6'],
  loader: ['M21 12a9 9 0 1 1-6.2-8.6'],
  wifiOff: [
    'M2 2l20 20',
    'M8.5 16.4a5 5 0 0 1 7 0',
    'M2 8.8a15 15 0 0 1 4.2-2.7',
    'M10.7 5.1A15 15 0 0 1 22 8.8',
    'M12 20h.01',
  ],
} as const;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

type Props = {
  name: IconName;
  /** A colour from the theme (e.g. `colors.text2`). */
  color: string;
  size?: number;
  strokeWidth?: number;
  /** Fill the shape (heart, sparkle) instead of outlining it. */
  filled?: boolean;
};

export function Icon({ name, color, size = 20, strokeWidth = 2, filled = false }: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {paths[name].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? color : 'none'}
        />
      ))}
    </Svg>
  );
}
