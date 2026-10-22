import { PageHeader } from "@/components/layout/page-header";
import { MarketingFormsIndex } from "@/app/formularios/marketing-forms-index";
import { requireWorkspacePagePermission } from "@/modules/auth/http/authentication-guards";
import { getMarketingFormService } from "@/modules/marketing-forms/application/marketing-form-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";

export const dynamic = "force-dynamic";

export default async function MarketingFormsPage() {
  await requireWorkspacePagePermission(PermissionKeys.MARKETING_DEFINITIONS_MANAGE, {
    resourceType: "MarketingForm",
  });
  const context = await requireWorkspacePagePermission(PermissionKeys.MARKETING_JOURNEY_READ, {
    resourceType: "MarketingForm",
  });
  const forms = await getMarketingFormService().list(context);

  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader
        eyebrow="Marketing · captação"
        title="Formulários"
        description="Crie experiências conversacionais, publique versões imutáveis e envie respostas validadas ao CRM."
      />
      <MarketingFormsIndex initialForms={forms.map((form) => ({ ...form, publishedAt: form.publishedAt?.toISOString() ?? null, updatedAt: form.updatedAt.toISOString() }))} />
    </main>
  );
}
