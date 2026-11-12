import { pathToFileURL } from "node:url";

import { PrismaClient } from "@/generated/prisma/client";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { marketingFormDefinitionSchema } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const slugs = ["forms-mandato", "forms-vsl"];
const questionKey = "pergunta-4ca04f5a";
const newOption = { stableKey: "nenhuma-anterior", label: "Nenhuma Anterior" };

function appendOption(raw: unknown) {
  const definition = marketingFormDefinitionSchema.parse(raw);
  const question = definition.questions.find((item) => item.stableKey === questionKey);
  if (question?.type !== "SINGLE_CHOICE" || question.mapping !== "jobTitle") {
    throw new Error("A pergunta de cargo mudou. Confira a definição antes de publicar.");
  }
  const { options } = question.config;
  const existing = options.findIndex((option) => option.stableKey === newOption.stableKey || option.label === newOption.label);
  if (existing === 5 && options[5]?.stableKey === newOption.stableKey && options[5].label === newOption.label) {
    return { definition, changed: false };
  }
  if (existing !== -1 || options.length !== 5) {
    throw new Error("A lista de cargos mudou. Confira as opções antes de publicar.");
  }
  question.config.options = [...options, newOption];
  return { definition: marketingFormDefinitionSchema.parse(definition), changed: true };
}

export async function publishPolitizaiFormJobTitleOption(database: PrismaClient, apply: boolean) {
  return database.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { slug: "politizai" }, select: { id: true } });
    const workspaceId = workspace.id;
    const actor = await tx.actor.findFirstOrThrow({
      where: { workspaceId, type: "SYSTEM", key: "system", userId: null },
      select: { id: true },
    });
    const forms = await tx.marketingForm.findMany({
      where: { workspaceId, publicSlug: { in: slugs }, status: "ACTIVE", archivedAt: null, deletedAt: null },
      orderBy: { publicSlug: "asc" },
    });
    if (forms.length !== slugs.length) throw new Error("Os dois formulários ativos precisam estar no workspace Politizai.");

    const results = [];
    for (const form of forms) {
      if (apply) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form:${workspaceId}:${form.id}`}, 0))`;
      if (!form.publishedVersionId) throw new Error(`O formulário ${form.publicSlug} não tem versão publicada.`);
      const published = await tx.marketingFormVersion.findFirstOrThrow({
        where: { id: form.publishedVersionId, workspaceId, marketingFormId: form.id, version: form.currentVersion },
      });
      const live = appendOption(published.definition);
      const draft = appendOption(form.draftDefinition);
      if (live.changed !== draft.changed) throw new Error(`A opção diverge entre o rascunho e a versão pública de ${form.publicSlug}.`);
      results.push({ slug: form.publicSlug, fromVersion: published.version, toVersion: published.version + Number(live.changed), changed: live.changed });
      if (!apply || !live.changed) continue;

      const publishedAt = new Date();
      const definitionHash = sha256(canonicalJson(live.definition));
      const next = await tx.marketingFormVersion.create({
        data: {
          workspaceId, marketingFormId: form.id, landingPageId: published.landingPageId,
          version: published.version + 1, schemaVersion: published.schemaVersion,
          definition: live.definition, definitionHash, publishedAt,
          publishedByActorId: actor.id, createdByActorId: actor.id,
        },
      });
      await tx.marketingForm.update({
        where: { id: form.id, revision: form.revision },
        data: {
          draftDefinition: draft.definition, publishedVersionId: next.id, currentVersion: next.version,
          publishedAt, revision: { increment: 1 }, updatedByActorId: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId, actorId: actor.id, action: "marketing.form.published", entityType: "MarketingForm",
          entityId: form.id, changes: { version: next.version, definitionHash, revision: form.revision + 1, addedOption: newOption.stableKey },
        },
      });
    }
    return results;
  }, { isolationLevel: "Serializable", timeout: 15_000 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) throw new Error("Use sem argumentos para verificar ou --apply para publicar.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória.");
  const database = new PrismaClient({ adapter: createPostgresAdapter(databaseUrl, { max: 1, connectionTimeoutMillis: 8_000 }) });
  try {
    console.log(JSON.stringify(await publishPolitizaiFormJobTitleOption(database, args[0] === "--apply")));
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Falha ao publicar a opção de cargo.";
    console.error(message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[conexão omitida]"));
    process.exitCode = 1;
  });
}
