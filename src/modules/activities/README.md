# activities

O módulo implementa o histórico operacional da CRM-08. O
`OperationalHistoryService` registra atividades, efeitos de contato no SLA,
sinal de resposta recebida, snapshots da próxima ação, eventos corretivos,
timeline paginada e auditoria dentro de transações.

Atividades são fatos append-only. O banco rejeita update, delete e truncate;
uma correção acrescenta um evento com `correctsActivityId`. A timeline ordena
por `occurredAt` e `id` em ordem decrescente e identifica atores Pessoa,
Sistema, Automação e Agente de IA.

O adaptador HTTP está em `/api/leads/[leadId]/operations` e a interface do
cartão 360 em `/leads/[leadId]/historico`. Autenticação, workspace e permissões
de leitura ou escrita são avaliados no servidor antes da consulta ou mutação.
O mesmo serviço fornece cabeçalho, resumo persistido, respostas da submissão,
alertas, campos faltantes, tarefas e timeline paginada. Edições do resumo usam
lock por lead e versão otimista; conflitos retornam `409` sem sobrescrever o
dado mais recente.
