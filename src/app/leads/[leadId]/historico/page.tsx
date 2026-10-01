import { LeadHistoryContent } from "@/app/leads/[leadId]/historico/lead-history-content";

export const dynamic = "force-dynamic";

export default async function LeadHistoryPage({
  params,
}: Readonly<{ params: Promise<{ leadId: string }> }>) {
  const { leadId } = await params;
  return <LeadHistoryContent leadId={leadId} />;
}
