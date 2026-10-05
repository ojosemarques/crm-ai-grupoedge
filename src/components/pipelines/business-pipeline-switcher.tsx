import Link from "next/link";

import type { BusinessPipelineOption } from "@/modules/pipelines/application/business-pipeline-navigation";

export function BusinessPipelineSwitcher({
  pipelines,
  selectedPipelineId,
}: Readonly<{
  pipelines: readonly BusinessPipelineOption[];
  selectedPipelineId: string;
}>) {
  if (pipelines.length < 2) return null;

  return (
    <nav aria-label="Selecionar pipeline" className="mb-4 flex max-w-full items-center gap-2 overflow-x-auto rounded-xl border bg-card p-2">
      <span className="shrink-0 px-2 text-xs font-semibold text-muted-foreground">Pipeline</span>
      {pipelines.map((pipeline) => {
        const selected = pipeline.id === selectedPipelineId;
        return (
          <Link
            aria-current={selected ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            href={pipeline.href}
            key={pipeline.id}
          >
            {pipeline.name}
            <span className="ml-1.5 text-[10px] opacity-70">{pipeline.entityType === "PROSPECTING" ? "Principal" : pipeline.entityType === "LEAD" ? "Pré-vendas" : "Vendas"}</span>
          </Link>
        );
      })}
    </nav>
  );
}
