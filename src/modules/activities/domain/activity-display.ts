export const activityTypeLabels: Readonly<Record<string, string>> = {
  CALL: "Ligação", CALL_CONNECTED: "Ligação atendida", CALL_UNANSWERED: "Ligação não atendida",
  EMAIL: "E-mail", MESSAGE: "Mensagem", MESSAGE_SENT: "Mensagem enviada", MESSAGE_RECEIVED: "Mensagem recebida",
  AUDIO: "Áudio", MEETING: "Reunião", NOTE: "Nota interna", TASK: "Tarefa", STAGE_CHANGE: "Alteração de etapa",
  RESPONSIBLE_CHANGE: "Alteração de responsável", STATUS_CHANGE: "Alteração cadastral", AUTOMATION: "Automação", AI_ACTION: "Ação da IA",
  PROPOSAL: "Proposta", WON: "Ganho", LOST: "Perda", OTHER: "Outro",
};
export const activityResultLabels: Readonly<Record<string, string>> = {
  CONNECTED: "Atendida", NOT_CONNECTED: "Sem atendimento", SENT: "Enviado", RECEIVED: "Recebido", COMPLETED: "Concluído",
  CANCELLED: "Cancelado", SCHEDULED: "Agendado", NO_SHOW: "Não compareceu", WON: "Ganho", LOST: "Perda",
  INFORMATION: "Informativo", CORRECTED: "Corrigido", OTHER: "Outro",
};
