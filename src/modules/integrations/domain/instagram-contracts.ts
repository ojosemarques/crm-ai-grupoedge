import { z } from "zod";

export const INSTAGRAM_CONTRACT_VERSION = "instagram-local/1.0";
export const INSTAGRAM_LOCAL_PROVIDER_KEY = "INSTAGRAM_LOCAL_SIMULATOR";
export const instagramEventTypes = ["DIRECT", "COMMENT", "MENTION", "STORY_REPLY"] as const;

export const instagramLocalInboundSchema = z.object({
  externalEventId: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,160}$/),
  eventType: z.enum(instagramEventTypes),
  username: z.string().trim().regex(/^@?[A-Za-z0-9._]{1,30}$/),
  body: z.string().trim().min(1).max(10_000),
  publicationReference: z.string().trim().min(3).max(500).nullable().default(null),
  occurredAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.eventType !== "DIRECT" && !value.publicationReference) {
    context.addIssue({ code: "custom", path: ["publicationReference"], message: "Comentário, menção e resposta a story exigem referência opaca da publicação." });
  }
});

export type InstagramEventType = (typeof instagramEventTypes)[number];
