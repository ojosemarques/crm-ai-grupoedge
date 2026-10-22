import type { Metadata } from "next";

import { RealtimeDashboard } from "@/app/tempo-real/realtime-dashboard";

export const metadata: Metadata = {
  title: "Placar comercial",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function PublicTvDashboardPage() {
  return <RealtimeDashboard mode="tv" />;
}
