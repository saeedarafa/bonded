import { Image, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/i18n';

import { Text } from '../Text';
import { personColors } from '../theme';
import { useTheme } from '../ThemeProvider';

export type AvatarSize = 'sm' | 'md' | 'lg';

type Props = {
  name: string;
  /** `row.user_id === session.user.id`: orange for me, sky for the partner, on both phones. */
  isMe: boolean;
  size?: AvatarSize;
  imageUri?: string | null;
  /** Ring in the surface colour, for overlapping avatars. */
  ring?: boolean;
  testID?: string;
};

export function Avatar({ name, isMe, size = 'md', imageUri, ring = false, testID }: Props) {
  const { colors, size: sizes, type } = useTheme();
  const pc = personColors(colors, isMe);
  const dimension = { sm: sizes.avatarSm, md: sizes.avatar, lg: sizes.avatarLg }[size];
  const letterStyle = { sm: type.caption, md: type.label, lg: type.button }[size];
  const initial = name.trim().slice(0, 1).toUpperCase();

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        styles.base,
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          backgroundColor: pc.fill,
          borderWidth: ring ? 2 : 0,
          borderColor: colors.surface,
        },
      ]}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={{ width: dimension, height: dimension, borderRadius: dimension / 2 }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        // Decorative initial: fixed size so it stays inside the circle at 200% text.
        <Text allowFontScaling={false} style={[letterStyle, { color: pc.on }]}>
          {initial}
        </Text>
      )}
    </View>
  );
}

type PairProps = { meName: string; partnerName: string; size?: AvatarSize; testID?: string };

/** Me first, partner overlapping. One accessibility element: "Maya and Sam". */
export function AvatarPair({ meName, partnerName, size = 'md', testID }: PairProps) {
  const { t } = useTranslation();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('ui.avatarPair', { me: meName, partner: partnerName })}
      style={styles.pair}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Avatar name={meName} isMe size={size} />
      </View>
      <View
        style={styles.overlap}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Avatar name={partnerName} isMe={false} size={size} ring />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pair: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginLeft: -8 },
});
