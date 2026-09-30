import type { PermissionScope } from "@/generated/prisma/client";
import { AccessRoleKeys, PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";

export const operationalJourneyKeys = ["SDR", "CLOSER", "MANAGER", "ADMIN"] as const;
export type OperationalJourneyKey = (typeof operationalJourneyKeys)[number];

export type OperationalJourneyPolicy = Readonly<{
  roleKey: string;
  maximumScope: PermissionScope;
  requiredPermissions: readonly PermissionKey[];
  privilegedPermissions: readonly PermissionKey[];
}>;

export const operationalJourneyPolicies: Readonly<Record<OperationalJourneyKey, OperationalJourneyPolicy>> = Object.freeze({
  SDR: Object.freeze({
    roleKey: AccessRoleKeys.SDR,
    maximumScope: "OWN",
    requiredPermissions: Object.freeze([
      PermissionKeys.LEADS_READ,
      PermissionKeys.LEADS_WRITE,
      PermissionKeys.TASKS_READ,
      PermissionKeys.TASKS_WRITE,
      PermissionKeys.INBOX_READ,
      PermissionKeys.MESSAGES_COMPOSE,
      PermissionKeys.AUTOMATIONS_READ,
    ]),
    privilegedPermissions: Object.freeze([PermissionKeys.AI_USE]),
  }),
  CLOSER: Object.freeze({
    roleKey: AccessRoleKeys.CLOSER,
    maximumScope: "OWN",
    requiredPermissions: Object.freeze([
      PermissionKeys.OPPORTUNITIES_READ,
      PermissionKeys.OPPORTUNITIES_WRITE,
      PermissionKeys.MEETINGS_READ,
      PermissionKeys.MEETINGS_WRITE,
      PermissionKeys.CONTRACTS_READ,
      PermissionKeys.AUTOMATIONS_READ,
    ]),
    privilegedPermissions: Object.freeze([PermissionKeys.AI_USE]),
  }),
  MANAGER: Object.freeze({
    roleKey: AccessRoleKeys.COMMERCIAL_MANAGER,
    maximumScope: "TEAM",
    requiredPermissions: Object.freeze([
      PermissionKeys.LEADS_READ,
      PermissionKeys.OPPORTUNITIES_READ,
      PermissionKeys.METRICS_READ,
      PermissionKeys.FORECAST_READ,
    ]),
    privilegedPermissions: Object.freeze([
      PermissionKeys.BULK_ACTIONS_EXECUTE,
      PermissionKeys.EXPORTS_EXECUTE,
      PermissionKeys.AI_MANAGER_QUERY,
      PermissionKeys.OUTBOUND_CAMPAIGNS_APPROVE,
      PermissionKeys.OUTBOUND_CAMPAIGNS_EXECUTE,
    ]),
  }),
  ADMIN: Object.freeze({
    roleKey: AccessRoleKeys.ADMINISTRATOR,
    maximumScope: "WORKSPACE",
    requiredPermissions: Object.freeze([
      PermissionKeys.WORKSPACE_MANAGE,
      PermissionKeys.WORKSPACE_MEMBERS_MANAGE,
      PermissionKeys.WORKSPACE_PERMISSIONS_MANAGE,
      PermissionKeys.AUDIT_READ,
    ]),
    privilegedPermissions: Object.freeze([
      PermissionKeys.BULK_ACTIONS_EXECUTE,
      PermissionKeys.EXPORTS_EXECUTE,
      PermissionKeys.AI_GOVERNANCE_MANAGE,
      PermissionKeys.OUTBOUND_CAMPAIGNS_MANAGE,
      PermissionKeys.OUTBOUND_CAMPAIGNS_APPROVE,
      PermissionKeys.OUTBOUND_CAMPAIGNS_EXECUTE,
    ]),
  }),
});

export function journeyForRole(roleKey: string): OperationalJourneyKey | null {
  const match = operationalJourneyKeys.find((journey) => operationalJourneyPolicies[journey].roleKey === roleKey);
  return match ?? null;
}
