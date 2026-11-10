import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { useTranslation } from '@/i18n';

import {
  EMOJI_CATEGORIES,
  emojiId,
  emojiInCategory,
  normalizeReaction,
  QUICK_REACTIONS,
  searchEmoji,
  type EmojiCategory,
  type EmojiItem,
} from '../emoji';
import { haptics } from '../haptics';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { ReactionPill } from './ReactionPill';
import { Sheet } from './Sheet';
import { TextField } from './TextField';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  /** Called with the tapped emoji; the caller applies the one-per-person rule and closes. */
  onPick: (emoji: string) => void;
  /** My current reaction on the target: marked selected (tapping it again removes it). */
  current: string | null;
  /** Prefix for testIDs: `<id>`, `<id>-search`, `<id>-cat-<category>`, `<id>-<emojiId>`. */
  testID: string;
};

/**
 * D45 full emoji picker: the quick row, an offline search over emoji names, the nine Unicode
 * categories and a virtualized grid. No network, no native module (emojibase data in the bundle).
 * Cells are at least 44 × 44 and grow with Dynamic Type; every cell is labelled with its name.
 */
export function EmojiPicker({ visible, onDismiss, onPick, current, testID }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('ui.reaction.pickerTitle')}
      testID={testID}
      scroll={false}
    >
      {visible ? <PickerBody onPick={onPick} current={current} testID={testID} /> : null}
    </Sheet>
  );
}

function PickerBody({ onPick, current, testID }: Omit<Props, 'visible' | 'onDismiss'>) {
  const { t } = useTranslation();
  const { colors, radius, space, size, type } = useTheme();
  const { width, height, fontScale } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EmojiCategory>('smileys');
  const mine = current === null ? null : normalizeReaction(current);

  const searching = query.trim().length > 0;
  const items = useMemo(
    () => (searching ? searchEmoji(query) : emojiInCategory(category)),
    [searching, query, category],
  );

  // A cell fits the emoji at the current text size, never under 44 pt.
  const emojiLine = (type.h1.lineHeight ?? size.tapTarget) * Math.max(1, fontScale);
  const cell = Math.max(size.tapTarget, Math.ceil(emojiLine + space.sm));
  const columns = Math.max(4, Math.floor((width - space.lg * 2) / cell));

  const renderItem = ({ item }: { item: EmojiItem }) => {
    const selected = mine === item.emoji;
    return (
      <Pressable
        testID={`${testID}-${emojiId(item.emoji)}`}
        accessibilityRole="button"
        accessibilityLabel={
          selected
            ? t('ui.reaction.pickSelected', { name: item.label })
            : t('ui.reaction.pick', { name: item.label })
        }
        accessibilityState={{ selected }}
        onPress={() => {
          haptics.light();
          onPick(item.emoji);
        }}
        style={{
          width: cell,
          height: cell,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.input,
          borderWidth: selected ? 2 : 0,
          borderColor: colors.you,
          ...(selected ? { backgroundColor: colors.youTint } : {}),
        }}
      >
        <Text variant="h1">{item.emoji}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: space.md, flexShrink: 1 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {QUICK_REACTIONS.map((kind) => (
          <ReactionPill
            key={kind}
            testID={`${testID}-quick-${emojiId(kind)}`}
            kind={kind}
            selected={mine === kind}
            onPress={() => onPick(kind)}
          />
        ))}
      </View>
      <TextField
        testID={`${testID}-search`}
        label={t('ui.reaction.search')}
        placeholder={t('ui.reaction.search')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {searching ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm }}
          style={{ flexGrow: 0 }}
        >
          {EMOJI_CATEGORIES.map((c) => {
            const on = c === category;
            return (
              <Pressable
                key={c}
                testID={`${testID}-cat-${c}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t(`ui.reaction.categories.${c}`)}
                onPress={() => setCategory(c)}
                style={{
                  minHeight: size.tapTarget,
                  paddingHorizontal: space.md,
                  justifyContent: 'center',
                  borderRadius: radius.pill,
                  // Selected: thicker border and bold label, not colour alone.
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? colors.you : colors.line,
                  backgroundColor: on ? colors.youTint : colors.surface2,
                }}
              >
                <Text variant={on ? 'label' : 'caption'} tone={on ? 'youText' : 'text2'}>
                  {t(`ui.reaction.categories.${c}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {items.length === 0 ? (
        <Text tone="text2" testID={`${testID}-empty`} accessibilityLiveRegion="polite">
          {t('ui.reaction.noResults')}
        </Text>
      ) : (
        <FlatList
          key={columns}
          testID={`${testID}-grid`}
          data={items as EmojiItem[]}
          keyExtractor={(item) => item.emoji}
          numColumns={columns}
          renderItem={renderItem}
          initialNumToRender={columns * 6}
          keyboardShouldPersistTaps="handled"
          style={{ height: Math.round(height * 0.4) }}
          getItemLayout={(_, index) => ({
            length: cell,
            // numColumns: `index` is the row.
            offset: cell * index,
            index,
          })}
        />
      )}
    </View>
  );
}
