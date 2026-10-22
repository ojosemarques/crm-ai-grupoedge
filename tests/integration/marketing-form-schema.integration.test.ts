import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for marketing form schema tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 8 }) });
const now = new Date("2032-06-10T12:00:00.000Z");

type TenantFixture = Readonly<{ workspaceId: string; actorId: string }>;

async function createTenant(label: string): Promise<TenantFixture> {
  const workspace = await database.workspace.create({
    data: { slug: `form-schema-${label}-${randomUUID().slice(0, 8)}`, name: `Form schema ${label}` },
  });
  const actor = await database.actor.create({
    data: { workspaceId: workspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" },
  });
  return { workspaceId: workspace.id, actorId: actor.id };
}

async function createForm(fixture: TenantFixture, slug: string) {
  return database.marketingForm.create({
    data: {
      workspaceId: fixture.workspaceId,
      key: slug,
      name: `Formulário ${slug}`,
      publicSlug: slug,
      draftDefinition: { questions: [] },
      createdByActorId: fixture.actorId,
      updatedByActorId: fixture.actorId,
    },
  });
}

async function createVersion(fixture: TenantFixture, formId: string, version = 1) {
  return database.marketingFormVersion.create({
    data: {
      workspaceId: fixture.workspaceId,
      marketingFormId: formId,
      version,
      schemaVersion: "marketing-form.v1",
      definition: { questions: [] },
      definitionHash: `hash-${fixture.workspaceId}-${version}`,
      publishedAt: now,
      publishedByActorId: fixture.actorId,
      createdByActorId: fixture.actorId,
    },
  });
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  [tenantA, tenantB] = await Promise.all([createTenant("a"), createTenant("b")]);
});

afterAll(() => database.$disconnect());

describe("schema de formulários de marketing", () => {
  it("mantém slug público global e referências compostas por workspace", async () => {
    const formA = await createForm(tenantA, "captacao-publica");
    await expect(createForm(tenantB, "captacao-publica")).rejects.toThrow();

    const formB = await createForm(tenantB, "captacao-publica-b");
    const versionB = await createVersion(tenantB, formB.id);
    await expect(database.marketingFormReceipt.create({
      data: {
        workspaceId: tenantA.workspaceId,
        marketingFormId: formA.id,
        marketingFormVersionId: versionB.id,
        idempotencyHash: randomUUID(),
        answers: {},
        startedAt: now,
        submittedAt: now,
        createdByActorId: tenantA.actorId,
      },
    })).rejects.toThrow();
  });

  it("preserva versões publicadas como append-only", async () => {
    const form = await createForm(tenantA, `imutavel-${randomUUID().slice(0, 8)}`);
    const version = await createVersion(tenantA, form.id);
    await database.marketingForm.update({
      where: { id: form.id },
      data: { status: "ACTIVE", publishedAt: now, publishedVersionId: version.id },
    });

    await expect(database.marketingFormVersion.update({
      where: { id: version.id },
      data: { definitionHash: "mutacao-proibida" },
    })).rejects.toThrow(/append-only/);
  });

  it("impede apontar a publicação para uma versão de outro formulário do mesmo workspace", async () => {
    const first = await createForm(tenantA, `primeiro-${randomUUID().slice(0, 8)}`);
    const second = await createForm(tenantA, `segundo-${randomUUID().slice(0, 8)}`);
    const secondVersion = await createVersion(tenantA, second.id);
    await expect(database.marketingForm.update({
      where: { id: first.id },
      data: { publishedVersionId: secondVersion.id },
    })).rejects.toThrow();
  });

  it("impede recibo, evento e cursor duplicados", async () => {
    const form = await createForm(tenantA, `dedupe-${randomUUID().slice(0, 8)}`);
    const version = await createVersion(tenantA, form.id);
    const idempotencyHash = randomUUID();
    const receiptData = {
      workspaceId: tenantA.workspaceId,
      marketingFormId: form.id,
      marketingFormVersionId: version.id,
      idempotencyHash,
      answers: {},
      startedAt: now,
      submittedAt: now,
      createdByActorId: tenantA.actorId,
    } as const;
    await database.marketingFormReceipt.create({ data: receiptData });
    await expect(database.marketingFormReceipt.create({ data: receiptData })).rejects.toThrow();

    const eventData = {
      workspaceId: tenantA.workspaceId,
      marketingFormId: form.id,
      marketingFormVersionId: version.id,
      kind: "FORM_VIEW" as const,
      occurredAt: now,
      idempotencyKey: randomUUID(),
      createdByActorId: tenantA.actorId,
    };
    await database.marketingFormEvent.create({ data: eventData });
    await expect(database.marketingFormEvent.create({ data: eventData })).rejects.toThrow();

    const rotationData = {
      workspaceId: tenantA.workspaceId,
      marketingFormId: form.id,
      marketingFormVersionId: version.id,
    };
    await database.marketingFormRotationState.create({ data: rotationData });
    await expect(database.marketingFormRotationState.create({ data: rotationData })).rejects.toThrow();
  });
});
