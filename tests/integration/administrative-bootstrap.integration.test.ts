import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createAdministrativeBootstrapService } from "@/modules/auth/application/administrative-bootstrap-service";
import { permissionCatalog } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória.");
const database = new PrismaClient({ adapter: createPostgresAdapter(databaseUrl, { max: 3 }) });
const service = createAdministrativeBootstrapService(database);
const input = {
  workspaceSlug: "politizai-staging",
  workspaceName: "Politizai",
  adminEmail: "admin.initial@example.test",
  adminDisplayName: "Administrador inicial",
  adminPassword: "SenhaInicial#2026Segura",
  idempotencyKey: "bootstrap-integration-idempotency-001",
};

afterAll(async () => database.$disconnect());

describe("bootstrap administrativo transacional", () => {
  it("cria uma vez, audita sem segredo e repete sem duplicar", async () => {
    const created = await service.execute(input);
    expect(created.status).toBe("CREATED");
    await expect(service.execute(input)).resolves.toMatchObject({ status: "ALREADY_COMPLETED", workspaceId: created.workspaceId });
    await expect(service.execute({ ...input, idempotencyKey: "bootstrap-integration-idempotency-002" })).rejects.toMatchObject({ code: "ADMIN_BOOTSTRAP_ALREADY_CONSUMED" });

    await expect(database.workspace.count()).resolves.toBe(1);
    await expect(database.user.count()).resolves.toBe(1);
    await expect(database.workspaceMember.count()).resolves.toBe(1);
    await expect(database.rolePermission.count()).resolves.toBe(permissionCatalog.length);
    const audit = await database.auditLog.findFirstOrThrow({ where: { action: "system.admin_bootstrap.completed" } });
    expect(JSON.stringify(audit)).not.toContain(input.adminPassword);
    expect(JSON.stringify(audit)).not.toContain(input.adminEmail);
  });
});
