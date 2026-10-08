import type { CommercialMetricEventType } from "@/generated/prisma/client";

export type IntegratedMetricDefinition = Readonly<{
  id: string;
  label: string;
  description: string;
  unit: "COUNT" | "CENTS" | "BASIS_POINTS" | "SECONDS";
  eventTypes: readonly CommercialMetricEventType[];
  results?: readonly string[];
  aggregation: "COUNT" | "DISTINCT_LEAD" | "SUM_CENTS" | "RATE";
  denominatorEventTypes?: readonly CommercialMetricEventType[];
  denominatorAggregation?: "COUNT" | "DISTINCT_LEAD";
  desiredDirection: "UP" | "DOWN" | "NEUTRAL";
  limitations: readonly string[];
}>;

const metric = (definition: IntegratedMetricDefinition) => Object.freeze(definition);

export const INTEGRATED_METRIC_REGISTRY_VERSION = "indicators.2";

export const integratedMetricRegistry = Object.freeze([
  metric({ id: "work.tasks_created", label: "Tarefas criadas", description: "Tarefas persistidas no período.", unit: "COUNT", eventTypes: ["TASK_CREATED"], aggregation: "COUNT", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "work.tasks_completed", label: "Tarefas concluídas", description: "Conclusões persistidas, sem inferência manual.", unit: "COUNT", eventTypes: ["TASK_COMPLETED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "work.tasks_cancelled", label: "Tarefas canceladas", description: "Cancelamentos persistidos.", unit: "COUNT", eventTypes: ["TASK_CANCELLED"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "work.manual_activities", label: "Atividades manuais", description: "Tarefas concluídas manualmente.", unit: "COUNT", eventTypes: ["TASK_COMPLETED"], aggregation: "COUNT", desiredDirection: "UP", limitations: ["O recorte por execução manual deve ser aplicado com o filtro executionModes=MANUAL."] }),
  metric({ id: "work.politicians_touched", label: "Políticos abordados", description: "Leads distintos com tentativa ou mensagem outbound observada.", unit: "COUNT", eventTypes: ["CALL_ATTEMPTED", "INSTAGRAM_MESSAGE_SENT", "EMAIL_SENT"], aggregation: "DISTINCT_LEAD", desiredDirection: "UP", limitations: [] }),
  metric({ id: "outreach.calls_attempted", label: "Ligações realizadas", description: "Tentativas outbound iniciadas.", unit: "COUNT", eventTypes: ["CALL_ATTEMPTED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "outreach.calls_connected", label: "Ligações atendidas", description: "Conexões humanas confirmadas.", unit: "COUNT", eventTypes: ["CALL_CONNECTED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "outreach.calls_unanswered", label: "Ligações sem atendimento", description: "Busy, no-answer ou voicemail.", unit: "COUNT", eventTypes: ["CALL_UNANSWERED"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "outreach.calls_failed", label: "Ligações com falha", description: "Falhas terminais de chamada.", unit: "COUNT", eventTypes: ["CALL_FAILED"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "outreach.calls_no_answer", label: "Não atendeu", description: "Ligações concluídas com resultado não atendeu.", unit: "COUNT", eventTypes: ["CALL_UNANSWERED"], results: ["NO_ANSWER"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "outreach.calls_busy", label: "Ocupado", description: "Ligações concluídas com linha ocupada.", unit: "COUNT", eventTypes: ["CALL_UNANSWERED"], results: ["BUSY"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "outreach.calls_voicemail", label: "Caixa postal", description: "Ligações direcionadas à caixa postal.", unit: "COUNT", eventTypes: ["CALL_UNANSWERED"], results: ["VOICEMAIL"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "outreach.calls_wrong_number", label: "Número incorreto", description: "Ligações concluídas com número incorreto.", unit: "COUNT", eventTypes: ["CALL_FAILED"], results: ["WRONG_NUMBER"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "outreach.calls_channel_unavailable", label: "Canal indisponível", description: "Ligações sem canal telefônico utilizável.", unit: "COUNT", eventTypes: ["CALL_FAILED"], results: ["CHANNEL_UNAVAILABLE"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "outreach.call_connection_rate", label: "Taxa de conexão", description: "Ligações atendidas sobre tentadas.", unit: "BASIS_POINTS", eventTypes: ["CALL_CONNECTED"], denominatorEventTypes: ["CALL_ATTEMPTED"], aggregation: "RATE", desiredDirection: "UP", limitations: [] }),
  metric({ id: "outreach.instagram_messages", label: "Mensagens Instagram", description: "Mensagens efetivamente enviadas.", unit: "COUNT", eventTypes: ["INSTAGRAM_MESSAGE_SENT"], results: ["SENT"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "outreach.instagram_follows", label: "Perfis seguidos", description: "Ações de follow realmente concluídas.", unit: "COUNT", eventTypes: ["INSTAGRAM_FOLLOW_COMPLETED"], results: ["COMPLETED"], aggregation: "COUNT", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "outreach.inbound_responses", label: "Respostas humanas", description: "Primeira resposta humana confirmada por lead.", unit: "COUNT", eventTypes: ["HUMAN_RESPONSE_CONFIRMED"], aggregation: "DISTINCT_LEAD", desiredDirection: "UP", limitations: [] }),
  metric({ id: "outreach.response_rate", label: "Taxa de resposta", description: "Leads com primeira resposta humana sobre leads abordados.", unit: "BASIS_POINTS", eventTypes: ["HUMAN_RESPONSE_CONFIRMED"], denominatorEventTypes: ["CALL_ATTEMPTED", "INSTAGRAM_MESSAGE_SENT", "EMAIL_SENT"], denominatorAggregation: "DISTINCT_LEAD", aggregation: "RATE", desiredDirection: "UP", limitations: [] }),
  metric({ id: "outreach.effective_contacts", label: "Contatos efetivos", description: "Leads distintos com resposta ou ligação conectada.", unit: "COUNT", eventTypes: ["HUMAN_RESPONSE_CONFIRMED", "CALL_CONNECTED"], aggregation: "DISTINCT_LEAD", desiredDirection: "UP", limitations: [] }),
  metric({ id: "email.scheduled", label: "E-mails agendados", description: "Ordens válidas enfileiradas.", unit: "COUNT", eventTypes: ["EMAIL_SCHEDULED"], aggregation: "COUNT", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "email.sent", label: "E-mails enviados", description: "Aceite de envio confirmado.", unit: "COUNT", eventTypes: ["EMAIL_SENT"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "email.delivered", label: "E-mails entregues", description: "Entrega comprovada pelo transportador.", unit: "COUNT", eventTypes: ["EMAIL_DELIVERED"], aggregation: "COUNT", desiredDirection: "UP", limitations: ["Disponível apenas quando o provider emite evento de entrega."] }),
  metric({ id: "email.replied", label: "E-mails respondidos", description: "Resposta inbound correlacionada.", unit: "COUNT", eventTypes: ["EMAIL_REPLIED"], aggregation: "DISTINCT_LEAD", desiredDirection: "UP", limitations: [] }),
  metric({ id: "email.bounced", label: "Bounces", description: "Bounces confirmados.", unit: "COUNT", eventTypes: ["EMAIL_BOUNCED"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "email.complaints", label: "Reclamações", description: "Complaints confirmadas.", unit: "COUNT", eventTypes: ["EMAIL_COMPLAINT"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "email.unsubscribed", label: "Descadastros", description: "Opt-outs confirmados.", unit: "COUNT", eventTypes: ["EMAIL_UNSUBSCRIBED"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "email.cancelled", label: "E-mails cancelados", description: "Envios cancelados antes da entrega.", unit: "COUNT", eventTypes: ["EMAIL_CANCELLED"], aggregation: "COUNT", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "email.expired", label: "E-mails expirados", description: "Envios expirados além da janela autorizada.", unit: "COUNT", eventTypes: ["EMAIL_EXPIRED"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "email.failed", label: "E-mails com falha", description: "Falhas transitórias ou permanentes registradas.", unit: "COUNT", eventTypes: ["EMAIL_FAILED"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "email.delivery_rate", label: "Taxa de entrega", description: "Entregues sobre enviados.", unit: "BASIS_POINTS", eventTypes: ["EMAIL_DELIVERED"], denominatorEventTypes: ["EMAIL_SENT"], aggregation: "RATE", desiredDirection: "UP", limitations: ["Parcial quando o provider não cobre delivery."] }),
  metric({ id: "email.reply_rate", label: "Taxa de resposta por e-mail", description: "Leads que responderam sobre leads que receberam e-mail.", unit: "BASIS_POINTS", eventTypes: ["EMAIL_REPLIED"], denominatorEventTypes: ["EMAIL_SENT"], denominatorAggregation: "DISTINCT_LEAD", aggregation: "RATE", desiredDirection: "UP", limitations: [] }),
  metric({ id: "contacts.leads_created", label: "Leads novos", description: "Identidades de lead criadas.", unit: "COUNT", eventTypes: ["LEAD_CREATED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "contacts.contacts_created", label: "Contatos criados", description: "Pessoas canônicas criadas.", unit: "COUNT", eventTypes: ["CONTACT_CREATED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "contacts.submissions", label: "Submissões recebidas", description: "Submissões novas ou anexadas a uma identidade existente.", unit: "COUNT", eventTypes: ["LEAD_SUBMISSION_ATTACHED"], aggregation: "COUNT", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "funnel.stage_entries", label: "Entradas em etapa", description: "Eventos de entrada em etapa.", unit: "COUNT", eventTypes: ["STAGE_ENTERED"], aggregation: "COUNT", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "funnel.stage_exits", label: "Saídas de etapa", description: "Eventos de saída de etapa.", unit: "COUNT", eventTypes: ["STAGE_EXITED"], aggregation: "COUNT", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "qualification.leads", label: "Leads qualificados", description: "Leads distintos que alcançaram qualificação.", unit: "COUNT", eventTypes: ["LEAD_QUALIFIED"], aggregation: "DISTINCT_LEAD", desiredDirection: "UP", limitations: [] }),
  metric({ id: "qualification.pacto_validated", label: "PACTO validado", description: "Revisões PACTO validadas por humano.", unit: "COUNT", eventTypes: ["PACTO_VALIDATED"], aggregation: "DISTINCT_LEAD", desiredDirection: "UP", limitations: [] }),
  metric({ id: "meetings.scheduled", label: "Reuniões agendadas", description: "Reuniões inicialmente marcadas.", unit: "COUNT", eventTypes: ["MEETING_SCHEDULED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "meetings.completed", label: "Reuniões realizadas", description: "Reuniões com comparecimento registrado.", unit: "COUNT", eventTypes: ["MEETING_COMPLETED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "meetings.cancelled", label: "Reuniões canceladas", description: "Cancelamentos persistidos.", unit: "COUNT", eventTypes: ["MEETING_CANCELLED"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "meetings.no_show", label: "No-shows", description: "Ausências confirmadas.", unit: "COUNT", eventTypes: ["MEETING_NO_SHOW"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "meetings.rescheduled", label: "Reuniões remarcadas", description: "Eventos de remarcação, sem criar nova reunião.", unit: "COUNT", eventTypes: ["MEETING_RESCHEDULED"], aggregation: "COUNT", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "meetings.show_rate", label: "Show rate", description: "Realizadas sobre realizadas mais no-show.", unit: "BASIS_POINTS", eventTypes: ["MEETING_COMPLETED"], denominatorEventTypes: ["MEETING_COMPLETED", "MEETING_NO_SHOW"], aggregation: "RATE", desiredDirection: "UP", limitations: [] }),
  metric({ id: "meetings.no_show_rate", label: "Taxa de no-show", description: "No-shows sobre realizadas mais no-show.", unit: "BASIS_POINTS", eventTypes: ["MEETING_NO_SHOW"], denominatorEventTypes: ["MEETING_COMPLETED", "MEETING_NO_SHOW"], aggregation: "RATE", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "sales.opportunities_created", label: "Oportunidades criadas", description: "Oportunidades persistidas.", unit: "COUNT", eventTypes: ["OPPORTUNITY_CREATED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "sales.proposals", label: "Propostas", description: "Propostas comerciais registradas.", unit: "COUNT", eventTypes: ["PROPOSAL_REACHED"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "sales.opportunities_won", label: "Oportunidades ganhas", description: "Desfechos ganhos persistidos.", unit: "COUNT", eventTypes: ["OPPORTUNITY_WON"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "sales.opportunities_lost", label: "Oportunidades perdidas", description: "Desfechos perdidos persistidos.", unit: "COUNT", eventTypes: ["OPPORTUNITY_LOST"], aggregation: "COUNT", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "sales.win_rate", label: "Win rate", description: "Oportunidades ganhas sobre oportunidades decididas.", unit: "BASIS_POINTS", eventTypes: ["OPPORTUNITY_WON"], denominatorEventTypes: ["OPPORTUNITY_WON", "OPPORTUNITY_LOST"], aggregation: "RATE", desiredDirection: "UP", limitations: [] }),
  metric({ id: "sales.won", label: "Vendas", description: "Oportunidades ganhas.", unit: "COUNT", eventTypes: ["SALE_WON"], aggregation: "COUNT", desiredDirection: "UP", limitations: [] }),
  metric({ id: "sales.won_value", label: "Valor vendido", description: "Valor comercial congelado no ganho.", unit: "CENTS", eventTypes: ["SALE_WON"], aggregation: "SUM_CENTS", desiredDirection: "UP", limitations: [] }),
  metric({ id: "sales.bookings", label: "Receita contratada", description: "Valor de contratos aceitos.", unit: "CENTS", eventTypes: ["CONTRACT_ACCEPTED"], aggregation: "SUM_CENTS", desiredDirection: "UP", limitations: ["Bookings não é caixa recebido."] }),
  metric({ id: "revenue.mrr_movements", label: "Movimentos de MRR", description: "Soma dos deltas efetivos do ledger.", unit: "CENTS", eventTypes: ["REVENUE_MOVEMENT_POSTED"], aggregation: "SUM_CENTS", desiredDirection: "UP", limitations: ["É fluxo de MRR, não saldo no corte."] }),
  metric({ id: "revenue.subscription_activated", label: "MRR ativado", description: "MRR ativado em novas assinaturas.", unit: "CENTS", eventTypes: ["SUBSCRIPTION_ACTIVATED"], aggregation: "SUM_CENTS", desiredDirection: "UP", limitations: [] }),
  metric({ id: "revenue.churn", label: "Churn de MRR", description: "Deltas negativos de churn confirmados.", unit: "CENTS", eventTypes: ["CHURN_CONFIRMED"], aggregation: "SUM_CENTS", desiredDirection: "DOWN", limitations: [] }),
  metric({ id: "cash.invoiced", label: "Valor faturado", description: "Cobranças emitidas no período.", unit: "CENTS", eventTypes: ["INVOICE_ISSUED"], aggregation: "SUM_CENTS", desiredDirection: "NEUTRAL", limitations: [] }),
  metric({ id: "cash.received", label: "Receita recebida", description: "Pagamentos confirmados líquidos de reversões.", unit: "CENTS", eventTypes: ["PAYMENT_CONFIRMED", "PAYMENT_REVERSED"], aggregation: "SUM_CENTS", desiredDirection: "UP", limitations: [] }),
] satisfies readonly IntegratedMetricDefinition[]);
