import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isCoupleComplete, useUnpair } from '@/features/couple/hooks';
import { GOALS, NAME_MAX, STAGES, type Goal, type Stage } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import {
  Avatar,
  Banner,
  Button,
  OfflineBanner,
  OptionRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  Text,
  TextField,
  TopBar,
  useTheme,
  useToast,
} from '@/ui';

import { SettingsGroup, SettingsRow } from '../components/SettingsList';
import { usePairNames, useUpdateCouple, useUpdateMyName } from '../hooks';
import { shortDate } from '../model';
import { useEndedSeen } from '../partnerLeft';

type SheetKind = 'stage' | 'names' | 'topics' | 'unpair' | null;

/**
 * 42 Couple settings & unpair. Stage and topics are couple settings (either partner may change
 * them); "Our names" edits only my own name. Unpair asks again in a sheet (D08: history stays
 * readable 30 days). Unpairing from here never shows me 58: the couple is marked seen first.
 */
export default function CoupleSettingsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, radius, space } = useTheme();
  const showToast = useToast((s) => s.show);
  const { couple, profiles, me, partner } = usePairNames();
  const paired = isCoupleComplete(couple.data);
  const update = useUpdateCouple(couple.data?.id);
  const updateName = useUpdateMyName();
  const unpair = useUnpair();
  const markSeen = useEndedSeen((s) => s.markSeen);
  const unmark = useEndedSeen((s) => s.unmark);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [topics, setTopics] = useState<string[]>([]);

  const open = (kind: SheetKind) => {
    setError(null);
    if (kind === 'names') setName(profiles.me?.display_name ?? '');
    if (kind === 'topics') setTopics(couple.data?.goals ?? []);
    setSheet(kind);
  };
  const close = () => setSheet(null);
  const failed = () => setError(t('settings.couple.saveError'));

  // Unpaired elsewhere (or on 58's way out): nothing to set here.
  if (couple.data === null && !unpair.isPending) return <Redirect href="/" />;

  const stage = couple.data?.stage ?? null;
  const goals = couple.data?.goals ?? [];
  const joined = shortDate(couple.data?.paired_at, true, i18n.language);

  const doUnpair = () => {
    const id = couple.data?.id;
    if (!id || unpair.isPending) return;
    setError(null);
    markSeen(id);
    unpair.mutate(undefined, {
      onSuccess: () => {
        setSheet(null);
        showToast(t('settings.couple.unpaired'));
        router.replace('/');
      },
      onError: (e) => {
        unmark(id);
        setError(e.message || t('settings.couple.saveError'));
      },
    });
  };

  let body;
  if (couple.error && !couple.data) {
    body = (
      <View style={{ gap: space.md }} testID="42-error">
        <Banner tone="error" message={couple.error.message || t('settings.couple.loadError')} />
        <Button label={t('ui.retry')} onPress={() => void couple.refetch()} />
      </View>
    );
  } else if (!couple.data) {
    body = (
      <SkeletonGroup testID="42-loading">
        <Skeleton height={72} />
        <Skeleton height={150} />
      </SkeletonGroup>
    );
  } else {
    body = (
      <>
        <View
          testID="42-partner"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            padding: space.lg,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.card - 2,
          }}
        >
          <Avatar name={partner} isMe={false} />
          <View style={{ flex: 1 }}>
            <Text variant="label">{partner}</Text>
            <Text variant="caption" tone="text3" style={{ fontVariant: ['tabular-nums'] }}>
              {paired && joined
                ? t('settings.couple.joined', { date: joined })
                : t('settings.couple.notJoined')}
            </Text>
          </View>
        </View>

        <SettingsGroup>
          <SettingsRow
            testID="42-stage"
            label={t('settings.couple.stage')}
            value={stage ? t(`onboarding.stages.${stage}`) : t('settings.couple.notSet')}
            onPress={() => open('stage')}
          />
          <SettingsRow
            testID="42-names"
            label={t('settings.couple.names')}
            value={t('onboarding.bondCard', { me, partner })}
            onPress={() => open('names')}
          />
          <SettingsRow
            testID="42-topics"
            label={t('settings.couple.topics')}
            value={
              goals.length
                ? t('settings.couple.topicsCount', { count: goals.length })
                : t('settings.couple.notSet')
            }
            onPress={() => open('topics')}
          />
        </SettingsGroup>

        {paired ? (
          <View
            testID="42-unpair-card"
            style={{
              gap: space.sm + 2,
              padding: space.lg + 2,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card - 2,
            }}
          >
            <Text variant="h2" accessibilityRole="header">
              {t('settings.couple.unpairTitle')}
            </Text>
            <Text tone="text2">{t('settings.couple.unpairBody')}</Text>
            <Button
              testID="42-unpair"
              variant="destructiveGhost"
              label={t('settings.couple.unpairButton', { partner })}
              onPress={() => open('unpair')}
            />
          </View>
        ) : (
          <View
            testID="42-solo"
            style={{
              gap: space.sm + 2,
              padding: space.lg + 2,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card - 2,
            }}
          >
            <Text variant="h2" accessibilityRole="header">
              {t('settings.couple.soloTitle', { partner })}
            </Text>
            <Text tone="text2">{t('settings.couple.soloBody', { partner })}</Text>
            <Button
              testID="42-invite"
              variant="ghost"
              label={t('settings.couple.soloInvite')}
              onPress={() => router.push('/invite')}
            />
          </View>
        )}
      </>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="42-screen"
    >
      <OfflineBanner />
      <TopBar title={t('settings.couple.title')} onBack={() => router.back()} testID="42" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: space.sm,
          paddingBottom: space.xl,
          gap: space.md,
        }}
      >
        {error && sheet === null ? (
          <Banner tone="error" message={error} testID="42-save-error" />
        ) : null}
        {body}
      </ScrollView>

      <Sheet
        visible={sheet === 'stage'}
        onDismiss={close}
        title={t('settings.couple.stageTitle')}
        testID="42-stage-sheet"
      >
        <View style={{ gap: space.md }}>
          {STAGES.map((value: Stage) => (
            <OptionRow
              key={value}
              testID={`42-stage-${value}`}
              label={t(`onboarding.stages.${value}`)}
              selected={stage === value}
              onPress={() => update.mutate({ stage: value }, { onSuccess: close, onError: failed })}
            />
          ))}
          {error ? <Banner tone="error" message={error} testID="42-sheet-error" /> : null}
        </View>
      </Sheet>

      <Sheet
        visible={sheet === 'names'}
        onDismiss={close}
        title={t('settings.couple.namesTitle')}
        testID="42-names-sheet"
      >
        <View style={{ gap: space.md }}>
          <TextField
            testID="42-name-input"
            label={t('onboarding.yourName')}
            showLabel
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            error={error}
          />
          <Text variant="caption" tone="text3">
            {t('settings.couple.namesBody', { partner })}
          </Text>
          <Button
            testID="42-name-save"
            label={t('settings.couple.save')}
            loading={updateName.isPending}
            onPress={() => {
              const next = name.trim();
              if (!next) return setError(t('settings.couple.nameNeeded'));
              setError(null);
              updateName.mutate(next, { onSuccess: close, onError: failed });
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={sheet === 'topics'}
        onDismiss={close}
        title={t('settings.couple.topicsTitle')}
        testID="42-topics-sheet"
      >
        <View style={{ gap: space.md }}>
          <Text tone="text2">{t('settings.couple.topicsBody')}</Text>
          {GOALS.map((value: Goal) => (
            <OptionRow
              key={value}
              kind="checkbox"
              testID={`42-topic-${value}`}
              label={t(`onboarding.goals.${value}`)}
              selected={topics.includes(value)}
              onPress={() =>
                setTopics((now) =>
                  now.includes(value) ? now.filter((g) => g !== value) : [...now, value],
                )
              }
            />
          ))}
          {error ? <Banner tone="error" message={error} testID="42-sheet-error" /> : null}
          <Button
            testID="42-topics-save"
            label={t('settings.couple.save')}
            loading={update.isPending}
            onPress={() => {
              if (!topics.length) return setError(t('settings.couple.topicsNeedOne'));
              setError(null);
              update.mutate({ goals: topics }, { onSuccess: close, onError: failed });
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={sheet === 'unpair'}
        onDismiss={close}
        title={t('settings.couple.confirmTitle', { partner })}
        testID="42-unpair-sheet"
      >
        <View style={{ gap: space.md }}>
          <Text tone="text2">{t('settings.couple.confirmBody', { partner })}</Text>
          {error ? <Banner tone="error" message={error} testID="42-unpair-error" /> : null}
          <Button
            testID="42-unpair-confirm"
            variant="destructive"
            label={t('settings.couple.confirm')}
            loading={unpair.isPending}
            onPress={doUnpair}
          />
          <Button
            testID="42-unpair-cancel"
            variant="link"
            label={t('settings.couple.cancel')}
            onPress={close}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
