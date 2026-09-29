import { redirect } from "next/navigation";

export default async function LeadRedirectPage({
  params,
}: Readonly<{ params: Promise<{ leadId: string }> }>) {
  const { leadId } = await params;
  redirect(`/leads/${leadId}/historico`);
}
