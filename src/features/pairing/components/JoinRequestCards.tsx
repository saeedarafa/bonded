import { useEffect, useState } from 'react';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';

import type { JoinRequest } from '@/features/pairing/api';
import { useApproveJoin, useDeclineJoin, usePendingJoinRequests } from '@/features/pairing/hooks';
import { useTranslation } from '@/i18n';
import { Avatar, Banner, Button, haptics, Text, useTheme, useToast } from '@/ui';

type Props = {
  /** Screen id for testIDs: `10-join-request`, `11-join-request`, `today-join-request`. */
  screenId: string;
  /** Only while I'm solo (the inviter); paired people never get requests. */
  enabled: boolean;
  /** Extra layout from the host screen (spacing below the list on Today). */
  style?: StyleProp<ViewStyle>;
};

/** Live requests only: the server lets them lapse lazily, so hide them at `expires_at` here too. */
function useLive(requests: JoinRequest[] | undefined): JoinRequest[] {
  const [now, setNow] = useState(() => Date.now());
  const live = (requests ?? []).filter((r) => Date.parse(r.expiresAt) > now);
  const next = Math.min(...live.map((r) => Date.parse(r.expiresAt)));
  useEffect(() => {
    if (!Number.isFinite(next)) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [next]);
  return live;
}

/**
 * BE-26 (D02), the inviter's side, no hand-off board (GAPS.md): someone typed my code and waits
 * for my yes. Shows the name THEY typed (`pending_join_requests`), worded as a question, never as a
 * verified identity; an empty name gets neutral copy. Approve pairs them (the screen then moves on
 * by itself, the couple refetches); decline blocks them for this invite.
 */
export function JoinRequestCards({ screenId, enabled, style }: Props) {
  const { space } = useTheme();
  const requests = usePendingJoinRequests(enabled);
  const live = useLive(requests.data);
  if (!enabled || live.length === 0) return null;
  return (
    <View
      style={[{ alignSelf: 'stretch', gap: space.md }, style]}
      testID={`${screenId}-join-requests`}
    >
      {live.map((r, i) => (
        <JoinRequestCard
          key={r.requestId}
          request={r}
          testID={i === 0 ? `${screenId}-join-request` : `${screenId}-join-request-${i + 1}`}
        />
      ))}
    </View>
  );
}

function JoinRequestCard({ request, testID }: { request: JoinRequest; testID: string }) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const approve = useApproveJoin();
  const decline = useDeclineJoin();
  const name = request.requesterName.trim();
  const title = name ? t('pairing.request.title', { name }) : t('pairing.request.titleNoName');
  const body = name ? t('pairing.request.body', { name }) : t('pairing.request.bodyNoName');
  const busy = approve.isPending || decline.isPending;
  const error = approve.error ?? decline.error;

  // A new request is news for screen-reader users too (the card appears without a tap).
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(title);
  }, [title]);

  function yes() {
    if (busy) return;
    haptics.success();
    approve.mutate(request.requestId, { onError: () => haptics.error() });
  }

  function no() {
    if (busy) return;
    haptics.light();
    decline.mutate(request.requestId, {
      onSuccess: () => useToast.getState().show(t('pairing.request.declined')),
      onError: () => haptics.error(),
    });
  }

  return (
    <View
      testID={testID}
      style={{
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: colors.partner,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {name ? <Avatar name={name} isMe={false} size="md" /> : null}
        <View style={{ flex: 1, gap: space.xs }} accessible>
          <Text variant="label" accessibilityRole="header" testID={`${testID}-title`}>
            {title}
          </Text>
          <Text variant="caption" tone="text2">
            {body}
          </Text>
        </View>
      </View>
      {error ? <Banner tone="error" message={error.message} testID={`${testID}-error`} /> : null}
      <Button
        testID={`${testID}-approve`}
        label={t('pairing.request.approve')}
        loading={approve.isPending}
        onPress={yes}
      />
      <Button
        testID={`${testID}-decline`}
        variant="ghost"
        label={t('pairing.request.decline')}
        loading={decline.isPending}
        onPress={no}
      />
    </View>
  );
}
