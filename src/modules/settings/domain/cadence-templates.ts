export type CadenceAction = "WHATSAPP" | "CALL" | "EMAIL" | "RECYCLE" | "CLOSE";

export type CadenceTemplateStep = Readonly<{ dayOffset: number; action: CadenceAction; timeOfDay: string; message: string }>;
export type CadenceTemplate = Readonly<{ key: string; name: string; description: string; stopOnReply: boolean; stopOnMeetingScheduled: boolean; stopOnStageChange: boolean; steps: readonly CadenceTemplateStep[] }>;

export const cadenceTemplates = Object.freeze([
  { key: "FIRST_CONTACT", name: "Primeiro contato", description: "Abordagem inicial curta em três canais.", stopOnReply: true, stopOnMeetingScheduled: true, stopOnStageChange: true, steps: [
    { dayOffset: 0, action: "WHATSAPP", timeOfDay: "09:00", message: "Olá, {nome}. Posso entender rapidamente o seu cenário e explicar como podemos ajudar?" },
    { dayOffset: 1, action: "CALL", timeOfDay: "10:00", message: "Ligar para entender o contexto e combinar a próxima ação." },
    { dayOffset: 3, action: "EMAIL", timeOfDay: "09:00", message: "Enviar uma apresentação breve e propor um horário para conversar." },
  ] },
  { key: "NO_REPLY", name: "Lead que não respondeu", description: "Retomadas espaçadas sem pressionar o contato.", stopOnReply: true, stopOnMeetingScheduled: true, stopOnStageChange: true, steps: [
    { dayOffset: 1, action: "WHATSAPP", timeOfDay: "09:30", message: "Olá, {nome}. Retomando nosso contato: posso ajudar com alguma informação?" },
    { dayOffset: 3, action: "CALL", timeOfDay: "11:00", message: "Fazer nova tentativa de ligação e registrar o resultado." },
    { dayOffset: 5, action: "EMAIL", timeOfDay: "09:00", message: "Enviar resumo objetivo do valor e uma chamada para resposta." },
    { dayOffset: 7, action: "RECYCLE", timeOfDay: "16:00", message: "Revisar histórico e decidir entre nutrição ou nova tentativa futura." },
  ] },
  { key: "WHATSAPP_REPLIED", name: "Respondeu pelo WhatsApp", description: "Conduz a resposta até a conversa de qualificação.", stopOnReply: false, stopOnMeetingScheduled: true, stopOnStageChange: true, steps: [
    { dayOffset: 0, action: "WHATSAPP", timeOfDay: "09:00", message: "Obrigado pela resposta, {nome}. Qual é o melhor horário para conversarmos?" },
    { dayOffset: 1, action: "CALL", timeOfDay: "10:00", message: "Ligar no horário combinado e registrar a qualificação." },
  ] },
  { key: "POST_MEETING", name: "Pós-reunião", description: "Confirma acordos e mantém o próximo passo visível.", stopOnReply: false, stopOnMeetingScheduled: false, stopOnStageChange: true, steps: [
    { dayOffset: 0, action: "EMAIL", timeOfDay: "16:00", message: "Enviar resumo da reunião, decisões e próximos passos combinados." },
    { dayOffset: 2, action: "WHATSAPP", timeOfDay: "10:00", message: "Olá, {nome}. Ficou alguma dúvida sobre o que combinamos?" },
    { dayOffset: 5, action: "CALL", timeOfDay: "11:00", message: "Confirmar avanço e ajustar o próximo compromisso." },
  ] },
  { key: "PROPOSAL_SENT", name: "Proposta enviada", description: "Acompanha a decisão depois do envio da proposta.", stopOnReply: true, stopOnMeetingScheduled: false, stopOnStageChange: true, steps: [
    { dayOffset: 1, action: "WHATSAPP", timeOfDay: "10:00", message: "Olá, {nome}. Conseguiu revisar a proposta? Posso esclarecer algum ponto." },
    { dayOffset: 3, action: "CALL", timeOfDay: "14:00", message: "Ligar para tratar dúvidas, decisores e prazo de decisão." },
    { dayOffset: 7, action: "EMAIL", timeOfDay: "09:00", message: "Enviar fechamento do acompanhamento e solicitar uma decisão objetiva." },
  ] },
  { key: "MEETING_NO_SHOW", name: "Reunião não realizada", description: "Recupera rapidamente uma reunião perdida.", stopOnReply: true, stopOnMeetingScheduled: true, stopOnStageChange: true, steps: [
    { dayOffset: 0, action: "WHATSAPP", timeOfDay: "10:00", message: "Olá, {nome}. Não conseguimos nos encontrar. Quer escolher um novo horário?" },
    { dayOffset: 1, action: "CALL", timeOfDay: "11:00", message: "Ligar para remarcar a reunião." },
    { dayOffset: 3, action: "EMAIL", timeOfDay: "09:00", message: "Enviar opções de horário para uma nova reunião." },
  ] },
  { key: "NURTURE", name: "Nutrição", description: "Mantém presença com contatos mais espaçados.", stopOnReply: true, stopOnMeetingScheduled: true, stopOnStageChange: true, steps: [
    { dayOffset: 1, action: "EMAIL", timeOfDay: "09:00", message: "Enviar conteúdo útil relacionado ao contexto do lead." },
    { dayOffset: 14, action: "WHATSAPP", timeOfDay: "10:00", message: "Olá, {nome}. O cenário mudou desde nossa última conversa?" },
    { dayOffset: 30, action: "CALL", timeOfDay: "11:00", message: "Reavaliar interesse, momento e próxima ação." },
  ] },
  { key: "REACTIVATION", name: "Reativação", description: "Retoma contatos antigos com uma proposta clara.", stopOnReply: true, stopOnMeetingScheduled: true, stopOnStageChange: true, steps: [
    { dayOffset: 0, action: "WHATSAPP", timeOfDay: "09:30", message: "Olá, {nome}. Retomando nossa conversa: este tema ainda é prioridade para você?" },
    { dayOffset: 2, action: "CALL", timeOfDay: "10:30", message: "Ligar para confirmar se existe um novo momento de compra." },
    { dayOffset: 5, action: "EMAIL", timeOfDay: "09:00", message: "Enviar atualização objetiva e convite para retomar a conversa." },
    { dayOffset: 10, action: "CLOSE", timeOfDay: "16:00", message: "Revisar encerramento ou retorno para nutrição." },
  ] },
] as const satisfies readonly CadenceTemplate[]);
