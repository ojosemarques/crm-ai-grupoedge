import { z } from "zod";

export const realtimeDashboardFrontSchema = z.enum(["PROSPECTING", "ADVERTISING"]).default("PROSPECTING");
export type RealtimeDashboardFront = z.infer<typeof realtimeDashboardFrontSchema>;

type FrontFact = Readonly<{ pipelineId: string | null; safeMetadata: unknown }>;

export function realtimeFactPipelineId(fact: FrontFact & Readonly<{ correctionSource?: FrontFact | null }>): string | null {
  // Corrections belong to the original event's front, even when older writers
  // omitted the snapshot. A classification replacement carries its own snapshot.
  for (const metadata of [fact.safeMetadata, fact.correctionSource?.safeMetadata]) {
    if (metadata && typeof metadata === "object" && "_commercialFrontPipelineId" in metadata
      && typeof metadata._commercialFrontPipelineId === "string") return metadata._commercialFrontPipelineId;
  }
  return fact.correctionSource?.pipelineId ?? fact.pipelineId;
}
