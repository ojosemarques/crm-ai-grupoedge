import { redirect } from "next/navigation";

import { AccountReviewWorkspace } from "@/app/contas/revisoes/review-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { getAccountService } from "@/modules/accounts/application/account-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function AccountReviewsPage() {
  const context = await requirePageAuthentication();
  let reviews: Awaited<ReturnType<ReturnType<typeof getAccountService>["listReviews"]>>;
  try {
    reviews = await getAccountService().listReviews(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas"><PageHeader eyebrow="Governança de identidade" title="Revisão de contas" description="Nomes legados são candidatos; nenhum vínculo é criado sem decisão humana." /><AccountReviewWorkspace initialReviews={reviews} /></main>;
}
