# meetings

Agenda interna da CRM-15. O módulo concentra agendamento de 30/40 minutos,
conflitos por closer, confirmação, remarcação, cancelamento, comparecimento,
no-show, histórico append-only e briefing persistido do closer.

Todas as mutações passam por `MeetingService`, usam o fuso do workspace e
gravam tarefa, timeline e auditoria na mesma transação. Agendar um lead
qualificado usa a política da CRM-14 para mover o pré-vendas a `Reunião
agendada`; a interface nunca grava o banco diretamente. Conflitos são
rejeitados de forma explícita, sem sobreposição forçada neste MVP.
