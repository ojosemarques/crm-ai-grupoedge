import { z } from "zod";

export const companyHubCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_COMPANY"), name: z.string().trim().min(2).max(120),
    slug: z.string().trim().toLowerCase().min(2).max(63).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    idempotencyKey: z.string().uuid(), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("GRANT_ACCESS"), sourceWorkspaceId: z.string().uuid(),
    targetWorkspaceId: z.string().uuid(), memberId: z.string().uuid(), roleId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
]);

export type CompanyHubScreen = {
  displayName: string;
  currentWorkspaceId: string;
  canCreate: boolean;
  companies: Array<{ id: string; name: string; slug: string; roleName: string; canManage: boolean;
    roles: Array<{ id: string; name: string }>;
    members: Array<{ id: string; name: string; email: string }> }>;
};
