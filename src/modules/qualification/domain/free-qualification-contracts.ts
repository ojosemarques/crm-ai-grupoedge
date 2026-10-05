export type FreeQualificationEntry = Readonly<{
  id: string;
  content: string;
  createdAt: string;
  createdBy: string;
}>;

export type FreeQualificationScreen = Readonly<{
  leadId: string;
  generatedAt: string;
  timeZone: string;
  canWrite: boolean;
  entries: readonly FreeQualificationEntry[];
}>;
