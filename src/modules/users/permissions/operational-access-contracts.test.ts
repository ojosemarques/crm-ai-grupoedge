import { describe, expect, it } from "vitest";

import { operationalJourneyPolicies, journeyForRole } from "./operational-access-contracts";
import { PermissionKeys, permissionCatalog } from "./permission-keys";

describe("contrato operacional de acesso da etapa 17", () => {
  it("mantém jornadas com menor escopo e privilégios explícitos", () => {
    expect(operationalJourneyPolicies.SDR.maximumScope).toBe("OWN");
    expect(operationalJourneyPolicies.CLOSER.maximumScope).toBe("OWN");
    expect(operationalJourneyPolicies.MANAGER.maximumScope).toBe("TEAM");
    expect(operationalJourneyPolicies.ADMIN.maximumScope).toBe("WORKSPACE");
    expect(operationalJourneyPolicies.SDR.privilegedPermissions).not.toContain(PermissionKeys.BULK_ACTIONS_EXECUTE);
    expect(operationalJourneyPolicies.CLOSER.privilegedPermissions).not.toContain(PermissionKeys.EXPORTS_EXECUTE);
    expect(operationalJourneyPolicies.MANAGER.privilegedPermissions).toEqual(expect.arrayContaining([
      PermissionKeys.BULK_ACTIONS_EXECUTE,
      PermissionKeys.EXPORTS_EXECUTE,
      PermissionKeys.AI_MANAGER_QUERY,
      PermissionKeys.OUTBOUND_CAMPAIGNS_EXECUTE,
    ]));
  });

  it("mapeia somente papéis operacionais conhecidos", () => {
    expect(journeyForRole("sdr")).toBe("SDR");
    expect(journeyForRole("closer")).toBe("CLOSER");
    expect(journeyForRole("commercial_manager")).toBe("MANAGER");
    expect(journeyForRole("administrator")).toBe("ADMIN");
    expect(journeyForRole("viewer")).toBeNull();
  });

  it("cataloga permissões distintas para bulk, exportação, IA e campanhas", () => {
    const keys = permissionCatalog.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([
      PermissionKeys.BULK_ACTIONS_EXECUTE,
      PermissionKeys.EXPORTS_EXECUTE,
      PermissionKeys.AI_USE,
      PermissionKeys.OUTBOUND_CAMPAIGNS_MANAGE,
      PermissionKeys.OUTBOUND_CAMPAIGNS_APPROVE,
      PermissionKeys.OUTBOUND_CAMPAIGNS_EXECUTE,
    ]));
  });
});
