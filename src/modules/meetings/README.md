# meetings

Agenda interna da CRM-15. O módulo concentra agendamento de 30/40 minutos,
inclusive com reuniões simultâneas para o mesmo closer, confirmação, remarcação,
cancelamento, comparecimento, no-show, histórico append-only e briefing persistido.

Todas as mutações passam por `MeetingService`, usam o fuso do workspace e
gravam tarefa, timeline e auditoria na mesma transação. Agendar um lead
qualificado usa a política da CRM-14 para mover o pré-vendas a `Reunião
agendada`; a interface nunca grava o banco diretamente. Sobreposições de horário
são permitidas na criação, edição e remarcação de reuniões, inclusive em períodos
anteriores e ao reabrir um registro encerrado.

No workspace `politizai`, cada novo agendamento de vendedor ou pré-vendedor
enfileira, na mesma transação, um aviso individual para `ejosemarquess@gmail.com`,
`mattheusmendon@gmail.com` e `oswaldomuller701@gmail.com`. O assunto identifica
quem agendou (Carlos é identificado como pré-vendedor); o corpo guarda cliente,
data, horário, fuso e vendedor responsável no momento do agendamento.
O worker de e-mails de reuniões envia pelo MillionSend usando remetente com
SPF/DKIM/DMARC validados, supressões, chave idempotente por reunião/destinatário e
até cinco tentativas. Edições, confirmações e remarcações não duplicam esse aviso.
A classificação na caixa principal é controlada pelo Gmail do destinatário.

No pipeline `Prospecção Ativa`, o resultado persistido na agenda também atualiza
o card na mesma transação: reuniões realizadas seguem para `Reunião feita`;
no-show e cancelamento seguem para `Noshow`; reabertura ou remarcação retorna o
lead para `Reunião marcada`.

Em `Anúncios`, ao registrar comparecimento ou corrigir uma reunião realizada,
o vendedor informa o resumo e escolhe `Reunião feita` ou `Proposta`. A agenda,
a tarefa vinculada e a etapa são atualizadas na mesma transação. Tarefas de
reuniões vinculadas direcionam para esse fluxo de resultado na ficha do lead.

Mover manualmente um card de Anúncios para `Reunião feita` ou `Noshow` reutiliza
o resultado da reunião vinculada: agenda, tarefa, fatos analíticos e etapa mudam
na mesma transação. Sem reunião na agenda, o histórico da etapa registra o
resultado do ciclo de agendamento, sem duplicá-lo ao retornar à mesma etapa.
`Proposta` isolada não presume reunião realizada nem venda. Revisar o resumo de
uma reunião realizada preserva sua data; registros da Agenda posteriores ao
fechamento não retiram o lead de `Cliente`.
