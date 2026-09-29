import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMetaAdsService } from "@/modules/integrations/application/meta-ads-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { MetaAdsWorkspace } from "@/app/integracoes/meta-ads/meta-ads-workspace";

export const dynamic = "force-dynamic";

export default async function MetaAdsPage() {
  const context = await requirePageAuthentication();
  let initial;
  try { initial = await getMetaAdsService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Integrações · aquisição" title="Meta Ads" description="Conector somente leitura para hierarquia e insights diários. Credenciais permanecem fora do banco, da interface e dos logs." />
    <MetaAdsWorkspace initial={initial} />
  </main>;
}
