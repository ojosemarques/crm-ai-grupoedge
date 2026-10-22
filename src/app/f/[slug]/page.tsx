import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PublicFormRuntime } from "@/app/f/[slug]/public-form-runtime";
import { getMarketingFormService } from "@/modules/marketing-forms/application/marketing-form-service";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

const resolvePublicForm = cache(async (slug: string) => {
  try {
    return await getMarketingFormService().resolvePublic(slug);
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "MARKETING_FORM_NOT_FOUND") notFound();
    throw error;
  }
});

export async function generateMetadata({ params }: PageProps<"/f/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!slug.trim()) notFound();
  const form = await resolvePublicForm(slug);
  return { robots: { follow: false, index: false }, title: form.title };
}

export default async function PublicMarketingFormPage({ params }: PageProps<"/f/[slug]">) {
  const { slug } = await params;
  const nonce = (await headers()).get("x-nonce");
  if (!slug.trim()) notFound();
  const form = await resolvePublicForm(slug);

  return <PublicFormRuntime form={form} nonce={nonce} />;
}
