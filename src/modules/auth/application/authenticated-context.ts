import type { WorkspaceContext } from "@/shared/core/workspace/workspace-context";

export type AuthenticatedContext = WorkspaceContext &
  Readonly<{
    sessionId: string;
    userId: string;
    memberId: string;
    actorId: string;
    roleId: string;
    roleKey: string;
    roleName: string;
    displayName: string;
    email?: string;
    workspaceCount?: number;
    workspaceName?: string;
  }>;

export type RequestMetadata = Readonly<{
  ipAddress: string | null;
  userAgent: string | null;
}>;
