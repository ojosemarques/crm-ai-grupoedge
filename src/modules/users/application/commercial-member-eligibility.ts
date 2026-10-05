import type { Prisma, TeamFunction } from "@/generated/prisma/client";
import { AccessRoleKeys } from "@/modules/users/permissions/permission-keys";

export type CommercialFunction = Extract<TeamFunction, "SDR" | "CLOSER">;

const roleByFunction: Readonly<Record<CommercialFunction, string>> = Object.freeze({
  SDR: AccessRoleKeys.SDR,
  CLOSER: AccessRoleKeys.CLOSER,
});

export function commercialFunctionForRole(roleKey: string): CommercialFunction | null {
  if (roleKey === AccessRoleKeys.SDR) return "SDR";
  if (roleKey === AccessRoleKeys.CLOSER) return "CLOSER";
  return null;
}

export function commercialMemberWhere(input: Readonly<{
  workspaceId: string;
  functions: readonly CommercialFunction[];
  memberId?: string;
  teamIds?: readonly string[];
  requireLeadAvailability?: boolean;
}>): Prisma.WorkspaceMemberWhereInput {
  const teamMembership: Prisma.TeamMemberWhereInput = {
    function: { in: [...input.functions] },
    deletedAt: null,
    team: { deletedAt: null },
    ...(input.teamIds ? { teamId: { in: [...input.teamIds] } } : {}),
  };
  const roleKeys = input.functions.map((value) => roleByFunction[value]);
  const eligibility: Prisma.WorkspaceMemberWhereInput[] = [
    { teamMemberships: { some: teamMembership } },
  ];

  // O papel comercial também caracteriza o vendedor no workspace. A função da
  // equipe continua sendo a única origem válida quando há recorte por equipe.
  if (!input.teamIds) {
    eligibility.push({
      role: { key: { in: roleKeys }, deletedAt: null },
    });
  }

  return {
    workspaceId: input.workspaceId,
    status: "ACTIVE",
    deletedAt: null,
    user: { status: "ACTIVE", deletedAt: null },
    ...(input.memberId ? { id: input.memberId } : {}),
    ...(input.requireLeadAvailability ? { leadReceivingPausedAt: null } : {}),
    OR: eligibility,
  };
}
