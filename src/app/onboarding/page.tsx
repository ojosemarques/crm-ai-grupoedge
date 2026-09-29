import { redirect } from "next/navigation";

import { OnboardingWorkspace, type OnboardingScreenView } from "@/app/onboarding/onboarding-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const context = await requirePageAuthentication();
  let screen;
  try {
    screen = await getOnboardingService().screen(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  const serialized = JSON.parse(JSON.stringify(screen)) as OnboardingScreenView;
  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader
        eyebrow="Pós-venda"
        title="Handoff e onboarding"
        description="Passagem comercial explícita, aceite responsável e marcos verificáveis até a ativação."
        meta={`${context.displayName} · ${screen.timeZone}`}
      />
      <OnboardingWorkspace screen={serialized} />
    </main>
  );
}
