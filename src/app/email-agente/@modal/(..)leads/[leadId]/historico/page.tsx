import { LeadHistoryContent } from "@/app/leads/[leadId]/historico/lead-history-content";
import { LeadHistoryModal } from "@/app/pipeline/lead-history-modal";

export const dynamic = "force-dynamic";

export default async function ActiveProspectingLeadHistoryModalPage({
  params,
}: Readonly<{ params: Promise<{ leadId: string }> }>) {
  const { leadId } = await params;
  return (
    <LeadHistoryModal>
      <LeadHistoryContent embedded leadId={leadId} />
    </LeadHistoryModal>
  );
}
