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
  mail: [
    'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'm22 6-10 7L2 6',
  ],
  heart: [
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
  ],
  smile: [circle(12, 12, 10), 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01M15 9h.01'],
  wow: [circle(12, 12, 10), circle(12, 15, 2), 'M9 9h.01M15 9h.01'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
  close: ['M18 6 6 18M6 6l12 12'],
  cake: [
    'M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8',
    'M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1',
    'M2 21h20',
    'M7 8v3M12 8v3M17 8v3',
  ],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  compass: [circle(12, 12, 10), 'm16 8-2 6-6 2 2-6z'],
  home: ['m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
  back: ['M15 18l-6-6 6-6'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  sun: [
    circle(12, 12, 5),
    'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  ],
  share: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'M16 6l-4-4-4 4', 'M12 2v13'],
  loader: ['M21 12a9 9 0 1 1-6.2-8.6'],
  card: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M2 10h20'],
  cardError: [
    'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    'M2 10h20',
    'M15 15h3',
  ],
  wifiOff: [
    'M2 2l20 20',
    'M8.5 16.4a5 5 0 0 1 7 0',
    'M2 8.8a15 15 0 0 1 4.2-2.7',
    'M10.7 5.1A15 15 0 0 1 22 8.8',
    'M12 20h.01',
  ],
  chevron: ['m9 18 6-6-6-6'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  // Private feedback (27) tags.
  repeat: [
    'm17 2 4 4-4 4',
    'M3 11v-1a4 4 0 0 1 4-4h14',
    'm7 22-4-4 4-4',
    'M21 13v1a4 4 0 0 1-4 4H3',
  ],
  alert: [
    'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    'M12 9v4M12 17h.01',
  ],
  plus: ['M12 5v14M5 12h14'],
  // Monthly check-in (26) face scale, 1 to 5.
  face1: [circle(12, 12, 10), 'M8 17c1-2 2.5-3 4-3s3 1 4 3', 'M9 9h.01M15 9h.01'],
  face2: [circle(12, 12, 10), 'M8.5 16c1-1 2-1.5 3.5-1.5s2.5.5 3.5 1.5', 'M9 9h.01M15 9h.01'],
  face3: [circle(12, 12, 10), 'M8 15h8', 'M9 9h.01M15 9h.01'],
  face4: [circle(12, 12, 10), 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01M15 9h.01'],
  face5: [
    circle(12, 12, 10),
    'M7 13c1 3 3 4.5 5 4.5s4-1.5 5-4.5z',
    'M8 9.5l1.5-1 1.5 1M13 9.5l1.5-1 1.5 1',
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
