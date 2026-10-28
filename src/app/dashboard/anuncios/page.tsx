import { DashboardPageContent, type DashboardSearchParams } from "@/app/dashboard/dashboard-page-content";
export const dynamic = "force-dynamic";
export default function AdvertisingDashboard({ searchParams }: Readonly<{ searchParams: DashboardSearchParams }>) {
  return <DashboardPageContent basePath="/dashboard/anuncios" mode="ADVERTISING" searchParams={searchParams} />;
}
