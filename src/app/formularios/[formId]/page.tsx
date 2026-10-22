import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { requireWorkspacePagePermission } from "@/modules/auth/http/authentication-guards";
import { getMarketingFormService } from "@/modules/marketing-forms/application/marketing-form-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { MarketingFormBuilder } from "@/app/formularios/[formId]/marketing-form-builder";

export const dynamic = "force-dynamic";

export default async function MarketingFormEditorPage({
  params,
}: PageProps<"/formularios/[formId]">) {
  const { formId } = await params;
  const nonce = (await headers()).get("x-nonce");
  if (!formId.trim()) notFound();

  await requireWorkspacePagePermission(PermissionKeys.MARKETING_DEFINITIONS_MANAGE, {
    resourceId: formId,
    resourceType: "MarketingForm",
  });
  const context = await requireWorkspacePagePermission(PermissionKeys.MARKETING_JOURNEY_READ, { resourceId: formId, resourceType: "MarketingForm" });
  const service = getMarketingFormService();
  const [form, catalog] = await Promise.all([service.detail(context, formId), service.catalog(context)]);
  if (!form.definition) notFound();

  return <MarketingFormBuilder catalog={catalog} initialForm={{ id: form.id, name: form.name, publicSlug: form.publicSlug, status: form.status, revision: form.revision, currentVersion: form.currentVersion, definition: form.definition }} nonce={nonce} />;
}
