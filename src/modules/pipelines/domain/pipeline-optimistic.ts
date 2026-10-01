import type { LeadPipelineCard, LeadPipelineStageColumn } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";

export function movePipelineCard(
  stages: readonly LeadPipelineStageColumn[],
  lead: LeadPipelineCard,
  sourceStageId: string,
  targetStageId: string,
  targetStageName: string,
): readonly LeadPipelineStageColumn[] {
  if (sourceStageId === targetStageId) return stages;
  const sourceContainsLead = stages.some((stage) => stage.id === sourceStageId && stage.leads.some((item) => item.id === lead.id));
  if (!sourceContainsLead || !stages.some((stage) => stage.id === targetStageId)) return stages;
  const movedLead = { ...lead, currentStageName: targetStageName };
  return stages.map((stage) => {
    if (stage.id === sourceStageId) {
      const leads = stage.leads.filter((item) => item.id !== lead.id);
      return { ...stage, leads, count: Math.max(0, stage.count - 1), displayedCount: leads.length };
    }
    if (stage.id === targetStageId) {
      const leads = [movedLead, ...stage.leads.filter((item) => item.id !== lead.id)];
      return { ...stage, leads, count: stage.count + 1, displayedCount: leads.length };
    }
    return stage;
  });
}
