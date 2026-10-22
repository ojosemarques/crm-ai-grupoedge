import type { Metadata } from "next";

import { RealtimeDashboard } from "@/app/tempo-real/realtime-dashboard";
import {
  requirePageAuthentication,
  requirePagePermission,
} from "@/modules/auth/http/authentication-guards";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";

export const metadata: Metadata = {
  title: "Tempo Real | CRM",
};

export default async function RealtimeDashboardPage() {
  const context = await requirePageAuthentication();
  await requirePagePermission(PermissionKeys.REALTIME_READ, {
    workspaceId: context.workspaceId,
    resourceType: "RealtimeDashboard",
  });
  return <RealtimeDashboard mode="private" />;
}
