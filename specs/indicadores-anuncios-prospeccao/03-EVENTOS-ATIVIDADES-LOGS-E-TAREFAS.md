# Eventos, atividades, logs e tarefas

Objetivo: histórico navegável nas duas frentes usando Activity e fatos já existentes. Produtores observados: intake (entrada/atribuição), operational-history (tarefa/contato/nota/correção), unified-activity (bulk), pre-sales pipeline (StageHistory), meeting-service (MeetingHistory), provedores phone/email/WhatsApp e serviços de venda/financeiro. Enum CommercialMetricEventType já cobre marcos comerciais, mensagens e finanças. Não criar eventos de renderização.

Contrato canônico existente: workspace/eventKey únicos, sourceEntity/id/revision, occurredAt/recordedAt, pipeline/stage, origem/campanha, actor/executor/creditado/equipe quando evidenciados, canal/result, correção/reversão e versão. Fingerprint divergente na mesma chave gera conflito, não sobrescrita. Persistir junto à mutação; atualização de tela só após commit.

Timeline operacional consulta Activity paginada por occurredAt/id, com tipo, resultado, autoria, responsável atual explicitamente rotulado, lead e pipeline. Audit não é exposta como timeline irrestrita. Bulk REASSIGN/POSTPONE deve criar Activity com valores anteriores/novos na mesma transação, além de Audit. Tarefa editada/cancelada/reaberta conserva histórico existente. Notas/edições não geram KPI de contato.

Fatos e logs têm propósitos diferentes: tarefa concluída não prova chamada atendida; mensagens tentadas não são entregues. Task completion reutiliza task-completion-metric-facts, sem segundo insert da ocorrência. Agenda e etapa não podem criar dois bookings; remarcação é marco distinto da reunião única. Correções mantêm saldo e evidência.

Tarefas: expor timeline universal nas abas; filtros/paginação; completar bulk; validar tarefa manual em Anúncios por serviço comum. Aceite: histórico visível com autor/data/resultado, filtrado por permissão, e bulk produz registro; cenário de conclusão não duplica ação. Não configurar tarefas padrão/cadências futuras. Rollback de código, mantendo histórico aditivo.
