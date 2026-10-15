# meetings

Agenda interna da CRM-15. O módulo concentra agendamento de 30/40 minutos,
inclusive com reuniões simultâneas para o mesmo closer, confirmação, remarcação,
cancelamento, comparecimento, no-show, histórico append-only e briefing persistido.

Todas as mutações passam por `MeetingService`, usam o fuso do workspace e
gravam tarefa, timeline e auditoria na mesma transação. Agendar um lead
qualificado usa a política da CRM-14 para mover o pré-vendas a `Reunião
agendada`; a interface nunca grava o banco diretamente. Sobreposições de horário
são permitidas na criação, edição e remarcação de reuniões.
