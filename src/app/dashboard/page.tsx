import {
  DashboardPageContent,
  type DashboardSearchParams,
} from "@/app/dashboard/dashboard-page-content";

export const dynamic = "force-dynamic";

export default function DashboardPage({ searchParams }: Readonly<{ searchParams: DashboardSearchParams }>) {
  return <DashboardPageContent basePath="/dashboard" searchParams={searchParams} />;
}
