import { PageLoading } from "@/components/ui/page-loading";

export default function ForecastLoading() {
  return (
    <PageLoading
      description="Consultando ciclos, submissões e cortes persistidos."
      title="forecast"
    />
  );
}
