import { PageLoading } from "@/components/ui/page-loading";

export default function AuditLoading() {
  return <PageLoading description="Reconciliando achados determinísticos e eventos append-only." title="Carregando auditoria e saúde" />;
}
