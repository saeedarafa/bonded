import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useSession } from '@/features/auth/session';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { useOnboarding } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { Button, DateField, Icon, Text, Toggle, personColors, useTheme, type IconName } from '@/ui';

import {
  checkDate,
  formatKeyDate,
  localIsoDate,
  ONBOARDING_KEY_DATES,
  partsFromIso,
  type DateCheck,
  type DateParts,
  type KeyDateValues,
  type OnboardingKeyDate,
} from '../model';

type Errors = Partial<Record<OnboardingKeyDate, string>>;

/**
 * 47 Key dates (onboarding step 4 of 4, after 07; optional). Together since, anniversary and **my**
 * birthday; the partner's birthday row only says they add it themselves (RLS lets each member write
 * only their own). Kept in the onboarding store and written after sign-in by `useSetupBond`.
 */
export function KeyDatesScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, space, size } = useTheme();
  const { status } = useSession();
  const saved = useOnboarding((s) => s.keyDates);
  const savedRemind = useOnboarding((s) => s.remindWeekBefore);
  const me = useOnboarding((s) => s.displayName).trim();
  const partner = useOnboarding((s) => s.partnerName).trim();
  const setKeyDates = useOnboarding((s) => s.setKeyDates);
  const clearKeyDates = useOnboarding((s) => s.clearKeyDates);

  const [parts, setParts] = useState<Record<OnboardingKeyDate, DateParts>>(() => ({
    together_since: partsFromIso(saved.together_since),
    anniversary: partsFromIso(saved.anniversary),
    birthday: partsFromIso(saved.birthday),
  }));
  const [open, setOpen] = useState<Partial<Record<OnboardingKeyDate, boolean>>>({});
  const [remind, setRemind] = useState(savedRemind);
  const [submitted, setSubmitted] = useState(false);

  const today = localIsoDate(new Date());
  const checks = Object.fromEntries(
    ONBOARDING_KEY_DATES.map((kind) => [kind, checkDate(parts[kind], today)]),
  ) as Record<OnboardingKeyDate, DateCheck>;
  const errors: Errors = submitted
    ? Object.fromEntries(
        ONBOARDING_KEY_DATES.flatMap((kind) => {
          const s = checks[kind].status;
          return s === 'incomplete' || s === 'invalid' || s === 'future'
            ? [[kind, t(`keyDates.${s}`)]]
            : [];
        }),
      )
    : {};

  // Signed in already (came back from the invite step): `/` runs the setup and moves on.
  const leave = () => router.push(status === 'signedIn' ? '/' : '/sign-in');

  function next() {
    const values: KeyDateValues = {};
    let ok = true;
    for (const kind of ONBOARDING_KEY_DATES) {
      const check = checks[kind];
      if (check.status === 'ok') values[kind] = check.iso;
      else if (check.status !== 'empty') ok = false;
    }
    if (!ok) {
      setSubmitted(true);
      return;
    }
    setKeyDates(values, remind);
    leave();
  }

  function skip() {
    clearKeyDates();
    leave();
  }

  const setKind = (kind: OnboardingKeyDate) => (value: DateParts) =>
    setParts((p) => ({ ...p, [kind]: value }));

  const valueFor = (kind: OnboardingKeyDate) => {
    const check = checks[kind];
    return check.status === 'ok' ? formatKeyDate(check.iso, i18n.language) : t('keyDates.addDate');
  };

  const mine = personColors(colors, true);
  const theirs = personColors(colors, false);
  const myLabel = me ? t('keyDates.myBirthday', { name: me }) : t('keyDates.myBirthdayFallback');
  const partnerLabel = partner
    ? t('keyDates.partnerBirthday', { name: partner })
    : t('keyDates.partnerBirthdayFallback');
  const partnerValue = partner
    ? t('keyDates.partnerAdds', { name: partner })
    : t('keyDates.partnerAddsFallback');

  const editable = (
    kind: 'anniversary' | 'birthday',
    label: string,
    icon: IconName,
    tile: { bg: string; fg: string },
  ) => {
    const expanded = !!open[kind] || !!errors[kind];
    const value = valueFor(kind);
    return (
      <View style={{ gap: space.sm }}>
        <Pressable
          testID={`47-${kind}`}
          accessibilityRole="button"
          accessibilityLabel={t('keyDates.rowA11y', { label, value })}
          accessibilityState={{ expanded }}
          style={{ minHeight: size.tapTarget }}
          onPress={() => setOpen((o) => ({ ...o, [kind]: !expanded }))}
        >
          {({ pressed }) => (
            <DateRow label={label} value={value} icon={icon} tile={tile} pressed={pressed} />
          )}
        </Pressable>
        {expanded ? (
          <DateField
            testID={`47-${kind}-field`}
            label={label}
            showLabel={false}
            value={parts[kind]}
            onChange={setKind(kind)}
            error={errors[kind]}
          />
        ) : null}
      </View>
    );
  };

  return (
    <OnboardingFrame
      screenId="47"
      step={{ n: 4, total: 4 }}
      onBack={() => router.back()}
      footer={
        <View style={{ gap: space.xs }}>
          <Button testID="47-next" label={t('onboarding.continue')} onPress={next} />
          <Button testID="47-skip" variant="link" label={t('keyDates.skip')} onPress={skip} />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <Text variant="h1" accessibilityRole="header">
          {t('keyDates.title')}
        </Text>
        <Text tone="text2">{t('keyDates.body')}</Text>
      </View>
      <DateField
        testID="47-together"
        label={t('keyDates.togetherSince')}
        value={parts.together_since}
        onChange={setKind('together_since')}
        error={errors.together_since}
      />
      <View style={{ gap: space.sm }}>
        {editable('anniversary', t('keyDates.anniversary'), 'heart', {
          bg: colors.blushTint,
          fg: colors.blushText,
        })}
        {editable('birthday', myLabel, 'cake', { bg: mine.tint, fg: mine.text })}
        <View
          testID="47-partner-birthday"
          accessible
          accessibilityLabel={t('keyDates.rowA11y', { label: partnerLabel, value: partnerValue })}
          accessibilityHint={t('keyDates.partnerAddsHint')}
        >
          <DateRow
            label={partnerLabel}
            value={partnerValue}
            icon="cake"
            tile={{ bg: theirs.tint, fg: theirs.text }}
          />
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
          paddingHorizontal: 2,
        }}
      >
        <View style={{ flex: 1, gap: 2 }} importantForAccessibility="no-hide-descendants">
          <Text variant="label">{t('keyDates.remind')}</Text>
          <Text variant="caption" tone="text2">
            {t('keyDates.remindBody')}
          </Text>
        </View>
        <Toggle
          testID="47-remind"
          label={`${t('keyDates.remind')}. ${t('keyDates.remindBody')}`}
          value={remind}
          onValueChange={setRemind}
        />
      </View>
    </OnboardingFrame>
  );
}

/** Board 47 date row: coloured icon tile, label, value on the right (wraps at large text). */
function DateRow({
  label,
  value,
  icon,
  tile,
  pressed = false,
}: {
  label: string;
  value: string;
  icon: IconName;
  tile: { bg: string; fg: string };
  pressed?: boolean;
}) {
  const { colors, radius, size, space } = useTheme();
  return (
    <View
      style={{
        minHeight: Math.max(56, size.tapTarget),
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.9 : 1,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.tile,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tile.bg,
        }}
      >
        <Icon name={icon} size={18} color={tile.fg} />
      </View>
      <Text variant="label" style={{ flexGrow: 1, flexShrink: 1 }}>
        {label}
      </Text>
      <Text tone="text3" style={{ fontVariant: ['tabular-nums'], marginLeft: 'auto' }}>
        {value}
      </Text>
    </View>
  );
}
