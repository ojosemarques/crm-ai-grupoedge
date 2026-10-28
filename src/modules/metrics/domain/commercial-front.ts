import { ACTIVE_PROSPECTING_PIPELINE_NAME, ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";

export const commercialFrontModes = ["ALL", "ADVERTISING", "PROSPECTING"] as const;
export type CommercialFrontMode = (typeof commercialFrontModes)[number];
export const EMPTY_PIPELINE_ID = "00000000-0000-0000-0000-000000000000";
export const commercialFrontLabels: Record<CommercialFrontMode, string> = {
  ALL: "Visão Geral",
  ADVERTISING: "Visão Geral — Anúncios",
  PROSPECTING: "Visão Geral — Prospecção Ativa",
};
export const commercialFrontPaths: Record<CommercialFrontMode, string> = {
  ALL: "/dashboard", ADVERTISING: "/dashboard/anuncios", PROSPECTING: "/dashboard/prospeccao",
};

export function commercialFrontPipelineIds(
  mode: CommercialFrontMode,
  pipelines: readonly Readonly<{ id: string; name: string }>[],
  selected: readonly string[] = [],
): string[] {
  const names = mode === "ADVERTISING" ? [ADVERTISING_PIPELINE_NAME]
    : mode === "PROSPECTING" ? [ACTIVE_PROSPECTING_PIPELINE_NAME]
      : [ADVERTISING_PIPELINE_NAME, ACTIVE_PROSPECTING_PIPELINE_NAME];
  const ids = pipelines.filter((pipeline) => names.includes(pipeline.name) && (!selected.length || selected.includes(pipeline.id))).map((pipeline) => pipeline.id);
  return ids.length ? ids : [EMPTY_PIPELINE_ID];
}
