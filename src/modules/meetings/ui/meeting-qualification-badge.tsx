import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { meetingQualificationLabels, type MeetingQualification } from "@/modules/meetings/domain/meeting-contracts";

const tones = { TIER_A: "success", TIER_B: "warning", TIER_C: "danger" } as const satisfies Record<MeetingQualification, StatusTone>;

export function MeetingQualificationBadge({ qualification }: Readonly<{ qualification: MeetingQualification }>) {
  return <StatusBadge tone={tones[qualification]}>{meetingQualificationLabels[qualification]}</StatusBadge>;
}
