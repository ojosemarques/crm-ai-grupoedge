# tasks

A CRM-06 cria a tarefa operacional inicial `Ligar agora`, vinculada de forma
única ao ciclo de SLA e atribuída ao mesmo SDR ou Fila Geral do lead. Ela vence
no instante da entrada e é concluída pela primeira tentativa humana. Para
`DO_NOT_CONTACT`, nasce cancelada e uma tarefa ativa separada exige a revisão da
restrição sem remover o opt-out.

A CRM-08 acrescenta criação e conclusão transacionais, tipo, prioridade, prazo,
resultado e próxima tarefa explícita. Uma tarefa `IMMEDIATE_CALL` não pode ser
encerrada pelo endpoint genérico: é necessário registrar a ligação para manter o
ciclo de SLA consistente.

A fonte da próxima ação é a tarefa ativa mais antiga por `dueAt`, `createdAt` e
`id`. O lead guarda uma projeção vinculada por `nextActionTaskId`. Tarefas abertas
podem ser concluídas antes ou depois do vencimento, com resultado registrado e
sem exigir uma tarefa seguinte, em qualquer pipeline. A próxima ação também é
opcional ao registrar uma atividade, inclusive a ligação que conclui `Ligar agora`.
A ausência de próxima ação em um lead aberto permanece sinalizada para acompanhamento,
sem impedir a conclusão ou desfazer o registro realizado.
