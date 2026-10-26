import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";

export const WORKSPACE_MEETING_SCHEDULER_EMAIL = "carloshenrique@politizai.com";

export function isWorkspaceMeetingScheduler(context: AuthenticatedContext): boolean {
  return context.workspaceSlug === "politizai"
    && context.email?.trim().toLowerCase() === WORKSPACE_MEETING_SCHEDULER_EMAIL;
}
