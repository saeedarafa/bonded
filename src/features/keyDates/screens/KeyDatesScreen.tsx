import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { useSession } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { useOnboarding } from '@/features/onboarding/store';
import { requestWidgetReload } from '@/features/widgets/reload';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { toAppError } from '@/lib/errors';
import {
  Banner,
  Button,
  DateField,
  Icon,
  Text,
  Toggle,
  personColors,
  useTheme,
  type IconName,
} from '@/ui';

import { upsertKeyDates } from '../api';

import {
  checkDate,
  formatKeyDate,
  keyDateRows,
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
 * 47 Key dates (optional; no quiz progress). Not part of onboarding any more (PO 2026-11-11,
 * MOB-69): 06 goes straight to T1, key dates come from the Us tab (48–51); the route stays for
 * direct links until Us has its key-dates screens. Together since, anniversary and **my** birthday; the partner's birthday row only says they add it themselves (RLS lets each member write
 * only their own). Kept in the onboarding store and written after sign-in by `useSetupBond`.
 */
export function KeyDatesScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, space, size } = useTheme();
  const { status, userId } = useSession();
  // #497 (MOB-78f): the Days together widget's "Add dates" opens 47 for a paired couple, since Us
  // has no key-dates screen yet (D50 (7)). Then Continue writes the dates straight away
  // (`upsertKeyDates`, only the kinds filled in; nothing is deleted) instead of keeping them on
  // the phone for SetupBond, which a paired couple never runs again.
  const couple = useActiveCouple({ enabled: status === 'signedIn' });
  const pairedCoupleId =
    status === 'signedIn' && userId && couple.data && isCoupleComplete(couple.data)
      ? couple.data.id
      : null;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  // Signed in already: `/` runs the setup and moves on. Signed out, 47 is no longer an onboarding
  // step (MOB-69, PO 2026-11-11): back to where it was opened from, or the front door.
  const leave = () => {
    if (status !== 'signedIn' && router.canGoBack()) router.back();
    else router.push('/');
  };

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
    if (pairedCoupleId && userId) {
      void saveForCouple(pairedCoupleId, userId, values);
      return;
    }
    setKeyDates(values, remind);
    leave();
  }

  async function saveForCouple(coupleId: string, me: string, values: KeyDateValues) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const rows = keyDateRows({ coupleId, userId: me, dates: values, remindWeekBefore: remind });
    try {
      await upsertKeyDates(rows);
      // #501: the Days together widget shows these dates; a state reload skips the 60 s
      // foreground throttle so it redraws now, not on the next foreground a minute later.
      requestWidgetReload('state');
      // Analytics (§3.7): only which kinds were saved; never the date.
      for (const row of rows) track('key_date_added', { type: row.kind });
      if (router.canGoBack()) router.back();
      else router.replace('/us');
    } catch (error) {
      setSaveError(toAppError(error).message);
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    if (pairedCoupleId) {
      if (router.canGoBack()) router.back();
      else router.replace('/us');
      return;
    }
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
            <DateRow
              id={`47-${kind}`}
              label={label}
              value={value}
              icon={icon}
              tile={tile}
              pressed={pressed}
            />
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
      onBack={() => router.back()}
      footer={
        <View style={{ gap: space.xs }}>
          {saveError ? <Banner testID="47-save-error" tone="error" message={saveError} /> : null}
          <Button
            testID="47-next"
            label={t('onboarding.continue')}
            onPress={next}
            loading={saving}
          />
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
            id="47-partner-birthday"
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

/** At this OS text scale the 47 row value moves under its label (#106; as SettingsRow). */
export const DATE_ROW_STACK_SCALE = 1.5;

/**
 * Board 47 date row: coloured icon tile, label, value on the right. #106: at accessibility text
 * sizes the value moves under the label, so the label wraps between words instead of letter by
 * letter; at default sizes both shrink and wrap.
 */
function DateRow({
  id,
  label,
  value,
  icon,
  tile,
  pressed = false,
}: {
  /** Test id stem: `<id>-row` (with `-stacked` at large text) and `<id>-value`. */
  id: string;
  label: string;
  value: string;
  icon: IconName;
  tile: { bg: string; fg: string };
  pressed?: boolean;
}) {
  const { colors, radius, size, space } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= DATE_ROW_STACK_SCALE;
  const TILE = 32;
  const valueText = (
    <Text
      testID={`${id}-value`}
      tone="text3"
      style={{
        flexShrink: 1,
        fontVariant: ['tabular-nums'],
        textAlign: stacked ? 'left' : 'right',
      }}
    >
      {value}
    </Text>
  );
  return (
    <View
      testID={stacked ? `${id}-row-stacked` : `${id}-row`}
      style={{
        minHeight: Math.max(56, size.tapTarget),
        justifyContent: 'center',
        gap: space.xs,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.9 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View
          style={{
            width: TILE,
            height: TILE,
            borderRadius: radius.tile,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tile.bg,
          }}
        >
          <Icon name={icon} size={18} color={tile.fg} />
        </View>
        <Text variant="label" style={{ flex: 1, minWidth: 0 }}>
          {label}
        </Text>
        {stacked ? null : <View style={{ flexShrink: 1, maxWidth: '50%' }}>{valueText}</View>}
      </View>
      {stacked ? <View style={{ paddingLeft: TILE + space.md }}>{valueText}</View> : null}
    </View>
  );
}
