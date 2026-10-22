export const ACTIVE_PROSPECTING_PIPELINE_NAME = "Prospecção Ativa";
export const ADVERTISING_PIPELINE_NAME = "Anúncios";

export const prospectingOperationPipelineNames = Object.freeze([
  ACTIVE_PROSPECTING_PIPELINE_NAME,
  ADVERTISING_PIPELINE_NAME,
] as const);

export function isProspectingOperationPipelineName(name: string) {
  return prospectingOperationPipelineNames.some((candidate) => candidate === name);
}
