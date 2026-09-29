import { PageLoading } from "@/components/ui/page-loading";

export default function AgendaLoading() {
  return <PageLoading description="Verificando período, escopo e conflitos persistidos." title="Carregando agenda interna" />;
}
