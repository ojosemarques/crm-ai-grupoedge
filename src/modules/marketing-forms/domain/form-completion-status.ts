export const formCompletionTagNames = {
  COMPLETED: "Completo",
  PARTIAL: "Incompleto",
} as const;

export type FormCompletionStatus = keyof typeof formCompletionTagNames;
export type FormCompletionTag = (typeof formCompletionTagNames)[FormCompletionStatus];

export function tracksMarketingFormCompletion(formKey: string) {
  return formKey === "forms-mandato" || formKey === "forms-vsl";
}
