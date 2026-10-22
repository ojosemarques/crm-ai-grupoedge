export type SdrQueueTaskCompletionOption = Readonly<{
  value: string;
  label: string;
}>;

const resultOptions: Readonly<Record<string, readonly SdrQueueTaskCompletionOption[]>> = Object.freeze({
  CALL: [
    { value: "CONNECTED", label: "Conectou" },
    { value: "CALLBACK_REQUESTED", label: "Pediu retorno" },
    { value: "WHATSAPP_SHARED", label: "Passou contato/WhatsApp" },
    { value: "MEETING_SCHEDULED", label: "Reunião agendada" },
    { value: "NO_ANSWER", label: "Não atendeu" },
    { value: "BUSY", label: "Ocupado" },
    { value: "VOICEMAIL", label: "Caixa postal" },
    { value: "WRONG_NUMBER", label: "Número incorreto" },
    { value: "CHANNEL_UNAVAILABLE", label: "Canal indisponível" },
  ],
  WHATSAPP: [
    { value: "SENT", label: "Mensagem enviada" },
    { value: "NO_WHATSAPP", label: "Não tem WhatsApp" },
    { value: "OTHER", label: "Outro" },
  ],
  INSTAGRAM_MESSAGE: [
    { value: "SENT", label: "Feito" },
    { value: "FAILED", label: "Falhou" },
    { value: "PROFILE_NOT_FOUND", label: "Não achou Instagram" },
    { value: "CHANNEL_UNAVAILABLE", label: "Canal indisponível" },
  ],
  INSTAGRAM_FOLLOW: [
    { value: "COMPLETED", label: "Feito" },
    { value: "ALREADY_FOLLOWING", label: "Já seguia" },
    { value: "FAILED", label: "Falhou" },
    { value: "PROFILE_NOT_FOUND", label: "Não achou Instagram" },
    { value: "CHANNEL_UNAVAILABLE", label: "Canal indisponível" },
  ],
});

export function sdrQueueTaskCompletion(input: Readonly<{
  taskId: string | null;
  kind: string | null;
  sourceKey: string | null;
}>) {
  const options = resultOptions[input.kind ?? ""] ?? [];
  const cadence = input.sourceKey?.startsWith("active-prospecting:") ?? false;
  const directKind = input.kind === "CALL" || input.kind === "WHATSAPP";
  return Object.freeze({
    available: Boolean(input.taskId && options.length > 0 && (directKind || cadence)),
    cadence,
    options,
  });
}
