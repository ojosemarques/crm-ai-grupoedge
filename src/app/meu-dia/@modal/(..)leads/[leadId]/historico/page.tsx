import { LeadHistoryContent } from "@/app/leads/[leadId]/historico/lead-history-content";
import { LeadHistoryModal } from "@/app/pipeline/lead-history-modal";

export const dynamic = "force-dynamic";

export default async function MyDayLeadHistoryModalPage({
  params,
}: Readonly<{ params: Promise<{ leadId: string }> }>) {
  const { leadId } = await params;
  return (
    <LeadHistoryModal closeLabel="Fechar ficha e voltar ao Meu Dia" refreshOnClose>
      <LeadHistoryContent embedded leadId={leadId} />
    </LeadHistoryModal>
  );
}
