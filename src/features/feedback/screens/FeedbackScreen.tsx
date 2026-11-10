import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import {
  AnswerField,
  Banner,
  Button,
  FeedbackPill,
  haptics,
  OfflineBanner,
  Text,
  TopBar,
  useTheme,
  useToast,
} from '@/ui';

import { useSendFeedback } from '../hooks';
import {
  canSendFeedback,
  FEEDBACK_BODY_MAX,
  FEEDBACK_TAGS,
  toggleTag,
  type FeedbackTag,
} from '../model';

/**
 * 27 Private feedback (MOB-23, D22), from "Help & feedback" on 40. Tags plus an optional note go
 * to the `feedback` table (kind `feedback`), read only by a person on the team who replies by
 * email. Never routes to the store. The note is never logged or sent to analytics.
 */
export default function FeedbackScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const showToast = useToast((s) => s.show);
  const send = useSendFeedback();
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [body, setBody] = useState('');
  const [empty, setEmpty] = useState<string | null>(null);

  const submit = () => {
    if (send.isPending) return;
    if (!canSendFeedback(tags, body)) {
      setEmpty(t('feedback.empty'));
      return;
    }
    setEmpty(null);
    send.mutate(
      { kind: 'feedback', score: null, tags, body: body.trim() },
      {
        onSuccess: () => {
          haptics.success();
          showToast(t('feedback.sent'));
          router.back();
        },
        onError: () => haptics.error(),
      },
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="27-screen">
      <OfflineBanner />
      <TopBar onBack={() => router.back()} testID="27" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            paddingHorizontal: space.gutter,
            paddingTop: space.xs,
            paddingBottom: space.xl,
            gap: space.xl,
          }}
        >
          <View style={{ gap: space.lg + 2 }}>
            <View style={{ gap: space.xs + 2 }}>
              <Text variant="h1" accessibilityRole="header" testID="27-title">
                {t('feedback.title')}
              </Text>
              <Text tone="text2">{t('feedback.subtitle')}</Text>
            </View>
            <View style={{ gap: space.sm + 2 }}>
              <View
                testID="27-tags"
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}
              >
                {FEEDBACK_TAGS.map((tag) => (
                  <FeedbackPill
                    key={tag.id}
                    testID={`27-tag-${tag.id}`}
                    label={t(`feedback.tags.${tag.id}`)}
                    icon={tag.icon}
                    selected={tags.includes(tag.id)}
                    onPress={() => {
                      setTags((prev) => toggleTag(prev, tag.id));
                      setEmpty(null);
                    }}
                  />
                ))}
              </View>
              {tags.length > 0 ? (
                <Text
                  variant="caption"
                  tone="text2"
                  testID="27-count"
                  accessibilityLiveRegion="polite"
                >
                  {t('feedback.selected', { count: tags.length })}
                </Text>
              ) : null}
            </View>
            <View style={{ gap: space.sm }}>
              <Text variant="label" tone="text2" importantForAccessibility="no">
                {t('feedback.moreLabel')}
              </Text>
              <AnswerField
                testID="27-body"
                label={t('feedback.moreLabel')}
                value={body}
                onChangeText={(v) => {
                  setBody(v);
                  if (empty) setEmpty(null);
                }}
                maxLength={FEEDBACK_BODY_MAX}
                error={empty}
              />
            </View>
            {send.error ? (
              <Banner tone="error" message={send.error.message} testID="27-error" />
            ) : null}
          </View>
          <View style={{ gap: space.sm }}>
            <Button
              testID="27-send"
              label={t('feedback.send')}
              loading={send.isPending}
              onPress={submit}
            />
            <Text variant="caption" tone="text2" style={{ textAlign: 'center' }} testID="27-note">
              {t('feedback.note')}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
