import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeAccountName } from "@/modules/accounts/application/account-service";
import { DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

function id(key: string) {
  const hash = createHash("sha256").update(`politizai-crm-account-demo-v1:${key}`).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`;
}

const definitions = [
  { key: "instituto-horizonte", name: "Instituto Horizonte Cívico", segment: "NONPROFIT" as const, size: "MEDIUM" as const },
  { key: "gestao-publica", name: "Gestão Pública do Vale", segment: "PUBLIC_SECTOR" as const, size: "LARGE" as const },
  { key: "estrategia-cidada", name: "Estratégia Cidadã", segment: "PRIVATE_SECTOR" as const, size: "SMALL" as const },
] as const;

export async function seedAccountDemoData(database: PrismaClient) {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('politizai_crm_account_demo_seed_v1'))`;
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE_SLUG } });
    const actor = await tx.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, type: "SYSTEM" }, orderBy: { id: "asc" } });
    const accounts = [];
    for (const definition of definitions) {
      accounts.push(await tx.account.upsert({
        where: { id: id(`account:${definition.key}`) },
        create: { id: id(`account:${definition.key}`), workspaceId: workspace.id, name: definition.name, normalizedName: normalizeAccountName(definition.name), segment: definition.segment, size: definition.size, origin: "SEED", quality: "CONFIRMED", createdByActorId: actor.id, updatedByActorId: actor.id },
        update: {},
      }));
    }
    const leads = await tx.lead.findMany({
      where: { workspaceId: workspace.id, deletedAt: null },
      orderBy: { id: "asc" },
      take: 6,
      select: { id: true, contactId: true, fullName: true, jobTitle: true },
    });
    let roles = 0;
    for (const [index, lead] of leads.entries()) {
      const account = accounts[index % accounts.length]!;
      const contactId = lead.contactId ?? id(`contact:${lead.id}`);
      if (!lead.contactId) await tx.contact.upsert({ where: { id: contactId }, create: { id: contactId, workspaceId: workspace.id, preferredName: lead.fullName, jobTitle: lead.jobTitle, origin: "LEAD_BACKFILL", quality: "CONFIRMED", createdByActorId: actor.id, updatedByActorId: actor.id }, update: {} });
      await tx.lead.update({ where: { id: lead.id }, data: { accountId: account.id, contactId, updatedByActorId: actor.id } });
      const roleId = id(`role:${lead.id}`);
      await tx.accountContactRole.upsert({
        where: { id: roleId },
        create: { id: roleId, workspaceId: workspace.id, accountId: account.id, contactId, roleType: index % 3 === 0 ? "DECISION_MAKER" : index % 3 === 1 ? "CHAMPION" : "INFLUENCER", roleTitle: index % 3 === 0 ? "Decisão final" : "Contato comercial", influence: index % 3 === 2 ? "MEDIUM" : "HIGH", authority: index % 3 === 0 ? "FINAL_DECISION" : "INFLUENCER", source: "SDR", evidence: "Cenário fictício e local do seed demonstrativo.", validFrom: new Date("2026-01-01T12:00:00.000Z"), createdByActorId: actor.id },
        update: {},
      });
      roles += 1;
    }
    const opportunity = await tx.opportunity.findFirst({
      where: { workspaceId: workspace.id, deletedAt: null },
      orderBy: { id: "asc" },
      select: { id: true, leadId: true, lead: { select: { accountId: true, contactId: true } } },
    });
    let committees = 0;
    if (opportunity) {
      const accountId = opportunity.lead.accountId ?? accounts[0]!.id;
      const contactId = opportunity.lead.contactId ?? id(`contact:${opportunity.leadId}`);
      if (!opportunity.lead.contactId) {
        const sourceLead = await tx.lead.findUniqueOrThrow({ where: { id: opportunity.leadId }, select: { fullName: true, jobTitle: true } });
        await tx.contact.upsert({ where: { id: contactId }, create: { id: contactId, workspaceId: workspace.id, preferredName: sourceLead.fullName, jobTitle: sourceLead.jobTitle, origin: "LEAD_BACKFILL", quality: "CONFIRMED", createdByActorId: actor.id, updatedByActorId: actor.id }, update: {} });
      }
      await tx.lead.update({ where: { id: opportunity.leadId }, data: { accountId, contactId, updatedByActorId: actor.id } });
      await tx.opportunity.update({ where: { id: opportunity.id }, data: { accountId, updatedByActorId: actor.id } });
      const role = await tx.accountContactRole.upsert({ where: { id: id(`role:opportunity:${opportunity.id}`) }, create: { id: id(`role:opportunity:${opportunity.id}`), workspaceId: workspace.id, accountId, contactId, roleType: "CHAMPION", roleTitle: "Patrocinador da oportunidade", influence: "HIGH", authority: "INFLUENCER", source: "CLOSER", evidence: "Cenário fictício e local do seed demonstrativo.", validFrom: new Date("2026-01-01T12:00:00.000Z"), createdByActorId: actor.id }, update: {} });
      if (role) {
        const committeeId = id(`committee:${opportunity.id}`);
        await tx.buyingCommittee.upsert({ where: { id: committeeId }, create: { id: committeeId, workspaceId: workspace.id, opportunityId: opportunity.id, accountId, name: "Comitê de compra", status: "ACTIVE", createdByActorId: actor.id, updatedByActorId: actor.id }, update: {} });
        await tx.buyingCommitteeMember.upsert({ where: { id: id(`committee-member:${opportunity.id}:${role.id}`) }, create: { id: id(`committee-member:${opportunity.id}:${role.id}`), workspaceId: workspace.id, buyingCommitteeId: committeeId, accountContactRoleId: role.id, stance: "SUPPORTER", influence: role.influence, authority: role.authority, evidence: "Cenário fictício e local do seed demonstrativo.", validFrom: new Date("2026-01-01T12:00:00.000Z"), createdByActorId: actor.id }, update: {} });
        committees = 1;
      }
    }
    await tx.auditLog.upsert({ where: { id: id("audit:account-demo") }, create: { id: id("audit:account-demo"), workspaceId: workspace.id, actorId: actor.id, action: "account.demo_seed.completed", entityType: "Workspace", entityId: workspace.id, changes: { accounts: accounts.length, roles, committees } }, update: {} });
    return { accounts: accounts.length, roles, committees };
  });
}
