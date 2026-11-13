import MilestoneScreen from '@/features/badges/screens/MilestoneScreen';
import { ReplayMask } from '@/features/analytics/replay';

/** D63 (MOB-87): a native modal sits outside the root replay boundary, so it masks itself. */
export default function MilestoneRoute() {
  return (
    <ReplayMask>
      <MilestoneScreen />
    </ReplayMask>
  );
}
