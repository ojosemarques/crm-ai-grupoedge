import { z } from "zod";

export const externalQuizConfigurationSchema = z.object({
  quizId: z.enum(["chatmandato", "quizmandato"]),
  pipelineId: z.string().uuid(),
  initialStageId: z.string().uuid(),
}).strict();

const externalQuizResponseBase = z.object({
  quiz: z.object({
    id: z.enum(["chatmandato", "quizmandato"]),
    name: z.enum(["ChatMandato", "QuizMandato"]),
    version: z.literal("1"),
    url: z.string().url().max(500),
  }).strict(),
  completionStatus: z.enum(["PARTIAL", "COMPLETED"]).optional(),
  answers: z.array(z.object({
    questionKey: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    question: z.string().min(1).max(1000),
    value: z.string().min(1).max(500),
    displayValue: z.string().min(1).max(500),
  }).strict()).min(3).max(11).refine((answers) => new Set(answers.map((a) => a.questionKey)).size === answers.length),
  result: z.object({ key: z.string().min(1).max(100), label: z.string().min(1).max(1000) }).strict().optional(),
}).strict();

export const externalQuizResponseSchema = externalQuizResponseBase.refine((response) => response.completionStatus === "PARTIAL" ? response.answers.length < 11 : response.answers.length === 11);

export const externalQuizEventSchema = externalQuizResponseBase.extend({
  contractVersion: z.literal("quiz-lead.v1"),
  eventId: z.string().regex(/^[A-Za-z0-9_.:-]{8,160}$/),
  submissionId: z.string().uuid(),
  occurredAt: z.iso.datetime(),
  fullName: z.string().trim().min(2).max(200),
  email: z.string().email().max(200).optional(),
  phone: z.string().regex(/^\+55[1-9]{2}[0-9]{8,9}$/),
  jobTitle: z.string().max(200).optional(),
  city: z.string().max(200).optional(),
  stateCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  interestSummary: z.string().min(1).max(2000),
  landingUrl: z.string().url().max(2048),
  sessionPublicId: z.string().uuid(),
  referrerUrl: z.string().max(2048).optional(),
  utmSource: z.string().max(2048).optional(),
  utmMedium: z.string().max(2048).optional(),
  utmCampaign: z.string().max(2048).optional(),
  utmContent: z.string().max(2048).optional(),
  utmTerm: z.string().max(2048).optional(),
}).strict().refine((event) => event.completionStatus !== "PARTIAL" && event.answers.length === 11);
