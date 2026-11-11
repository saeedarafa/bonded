import { useEffect } from 'react';
import { View } from 'react-native';

import { VOICE_ANSWER_MAX_MS } from '../encoding';
import { useVoiceRecorder, type VoiceTake } from '../useVoiceRecorder';
import { VoiceAnswerCard } from './VoiceAnswerCard';

/**
 * 19c (D46, MOB-55): owns the recorder while the Write | Voice switch is on screen, so a take
 * survives switching tabs; it is mounted only for a Premium couple in a build with voice.
 */
export function VoicePane({
  coupleId,
  userId,
  visible,
  onTake,
}: {
  coupleId: string | undefined;
  userId: string | null;
  visible: boolean;
  onTake: (take: VoiceTake | null) => void;
}) {
  const recorder = useVoiceRecorder({ coupleId, userId, maxMs: VOICE_ANSWER_MAX_MS });
  const take = recorder.phase === 'recorded' ? recorder.take : null;
  useEffect(() => onTake(take), [take, onTake]);
  return (
    <View style={visible ? null : { display: 'none' }}>
      <VoiceAnswerCard recorder={recorder} />
    </View>
  );
}
