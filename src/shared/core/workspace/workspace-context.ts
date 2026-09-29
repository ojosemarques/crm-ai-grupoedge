export type WorkspaceContext = Readonly<{
  workspaceId: string;
  workspaceSlug: string;
}>;

export function isSameWorkspace(
  context: WorkspaceContext,
  requestedWorkspaceId: string,
): boolean {
  return context.workspaceId === requestedWorkspaceId;
}
