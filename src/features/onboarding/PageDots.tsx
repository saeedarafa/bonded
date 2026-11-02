import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { useTheme } from '@/ui';

type Props = { page: number; total: number; testID?: string };

/** Story page dots (02 to 04). One accessible element: "Page 2 of 3". The active dot is wider. */
export function PageDots({ page, total, testID }: Props) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('ui.pageDots', { n: page, total })}
      style={{ flexDirection: 'row', alignSelf: 'center', gap: space.sm }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            height: 8,
            width: i + 1 === page ? 24 : 8,
            borderRadius: 4,
            backgroundColor: i + 1 === page ? colors.you : colors.line,
          }}
        />
      ))}
    </View>
  );
}
