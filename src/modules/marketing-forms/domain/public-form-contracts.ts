import { z } from "zod";

const optionalTrackingText = (maximum: number) =>
  z.string().trim().max(maximum).optional();

export const publicFormAnswerValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().trim().min(1).max(80)).max(100),
]);

export const publicFormTrackingSchema = z.object({
  landingUrl: optionalTrackingText(2_048),
  referrerUrl: optionalTrackingText(2_048),
  utmSource: optionalTrackingText(200),
  utmMedium: optionalTrackingText(200),
  utmCampaign: optionalTrackingText(300),
  utmContent: optionalTrackingText(300),
  utmTerm: optionalTrackingText(300),
  clickIds: z.partialRecord(
    z.enum(["gclid", "fbclid", "msclkid", "ttclid"]),
    z.string().trim().min(1).max(1_000),
  ).optional(),
}).strict().default({});

export const publicFormSubmitSchema = z.object({
  versionPublicId: z.string().uuid(),
  sessionPublicId: z.string().uuid(),
  idempotencyToken: z.string().uuid(),
  answers: z.array(z.object({
    questionKey: z.string().trim().toLowerCase().min(3).max(80),
    value: publicFormAnswerValueSchema,
  }).strict()).max(200),
  honeypot: z.string().max(200).default(""),
  startedAt: z.iso.datetime({ offset: true }),
  tracking: publicFormTrackingSchema,
}).strict();

export const publicFormEventSchema = z.object({
  versionPublicId: z.string().uuid(),
  sessionPublicId: z.string().uuid(),
  tracking: publicFormTrackingSchema,
  events: z.array(z.object({
    eventId: z.string().uuid(),
    kind: z.enum([
      "FORM_VIEW", "FORM_START", "QUESTION_VIEWED", "QUESTION_ANSWERED", "REDIRECT_OPENED",
    ]),
    questionKey: z.string().trim().toLowerCase().min(3).max(80).optional(),
    optionKey: z.string().trim().toLowerCase().min(3).max(80).optional(),
    answer: publicFormAnswerValueSchema.optional(),
    occurredAt: z.iso.datetime({ offset: true }),
  }).strict().superRefine((event, context) => {
    if (event.kind === "QUESTION_ANSWERED") {
      if (!event.questionKey) context.addIssue({ code: "custom", message: "Pergunta obrigatória para resposta.", path: ["questionKey"] });
      if (event.answer === undefined) context.addIssue({ code: "custom", message: "Valor obrigatório para resposta.", path: ["answer"] });
      return;
    }
    if (event.answer !== undefined) context.addIssue({ code: "custom", message: "Valor permitido somente em resposta de pergunta.", path: ["answer"] });
  })).min(1).max(25),
}).strict();

export type PublicFormSubmitInput = z.infer<typeof publicFormSubmitSchema>;
export type PublicFormTracking = z.infer<typeof publicFormTrackingSchema>;
