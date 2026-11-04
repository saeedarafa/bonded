import { useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import type { TextInput } from 'react-native';
import { View } from 'react-native';

import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { NAME_MAX, useOnboarding } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { AvatarPair, Button, Mascot, Text, TextField, useTheme } from '@/ui';

/** 07 Quiz: your names (step 3 of 4), then 47 key dates. The partner's name pre-fills the invite copy. */
export default function OnboardingQuizNamesRoute() {
  const router = useRouter();
  const partnerInput = useRef<ComponentRef<typeof TextInput>>(null);
  const { t } = useTranslation();
  const { space, colors } = useTheme();
  const displayName = useOnboarding((s) => s.displayName);
  const partnerName = useOnboarding((s) => s.partnerName);
  const setNames = useOnboarding((s) => s.setNames);
  const [missing, setMissing] = useState(false);

  const me = displayName.trim();
  const partner = partnerName.trim();
  const ready = me.length > 0 && partner.length > 0;

  function next() {
    if (!ready) {
      setMissing(true);
      return;
    }
    router.push('/quiz/dates');
  }

  return (
    <OnboardingFrame
      screenId="07"
      step={{ n: 3, total: 4 }}
      onBack={() => router.back()}
      footer={
        <>
          {missing && !ready ? (
            <Text
              testID="07-missing"
              variant="caption"
              style={{ color: colors.blushText, textAlign: 'center' }}
              accessibilityLiveRegion="polite"
            >
              {t('onboarding.needNames')}
            </Text>
          ) : null}
          <Button testID="07-next" label={t('onboarding.continue')} onPress={next} />
        </>
      }
    >
      <View style={{ alignItems: 'center', gap: space.md }}>
        {ready ? (
          <>
            <AvatarPair testID="07-pair" meName={me} partnerName={partner} size="lg" />
            <Text variant="label" tone="text2">
              {t('onboarding.bondCard', { me, partner })}
            </Text>
            <Text variant="caption" tone="text3" testID="07-bond-starts">
              {t('onboarding.bondStarts')}
            </Text>
          </>
        ) : (
          <Mascot mood="together" size={96} />
        )}
        <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('onboarding.namesTitle')}
        </Text>
      </View>
      <View style={{ gap: space.md }}>
        <TextField
          testID="07-me"
          label={t('onboarding.yourName')}
          showLabel
          value={displayName}
          onChangeText={(value) => setNames({ displayName: value })}
          maxLength={NAME_MAX}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          // #66: "next" moves on to the partner's name instead of closing the keyboard.
          submitBehavior="submit"
          onSubmitEditing={() => partnerInput.current?.focus()}
        />
        <TextField
          testID="07-partner"
          inputRef={partnerInput}
          label={t('onboarding.partnerName')}
          showLabel
          value={partnerName}
          onChangeText={(value) => setNames({ partnerName: value })}
          maxLength={NAME_MAX}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={next}
        />
      </View>
    </OnboardingFrame>
  );
}
