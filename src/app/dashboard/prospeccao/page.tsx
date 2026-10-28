import { DashboardPageContent, type DashboardSearchParams } from "@/app/dashboard/dashboard-page-content";
export const dynamic = "force-dynamic";
export default function ProspectingDashboard({ searchParams }: Readonly<{ searchParams: DashboardSearchParams }>) {
  return <DashboardPageContent basePath="/dashboard/prospeccao" mode="PROSPECTING" searchParams={searchParams} />;
}
