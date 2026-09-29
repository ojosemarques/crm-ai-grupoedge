# Assinaturas e ledger de receita

O módulo local separa proposta, contrato aceito, assinatura, ativação, movimento de receita e pagamento. Ele não é contabilidade, faturamento, cobrança nem integração com provedor. Um contrato aceito apenas torna a criação explícita de assinatura elegível; nunca ativa receita automaticamente.

Assinaturas usam `DRAFT`, `ACTIVE`, `CANCELLATION_SCHEDULED`, `CHURNED` e `ENDED`. Não existe pausa implícita. O MRR normalizado é quantidade × preço recorrente, dividido por 1, 3 ou 12 conforme a cadência, com arredondamento inteiro em centavos. Valores são BRL.

O ledger registra `NEW`, `EXPANSION`, `CONTRACTION`, `RENEWAL`, `CHURN`, `REACTIVATION` e `REVERSAL`. `effectiveAt` determina a competência; `recordedAt` registra quando o fato entrou no CRM. O MRR histórico em um corte é exclusivamente a soma dos deltas com `effectiveAt <= corte`, ordenada por `effectiveAt`, sequência e ID. ARR = MRR × 12.

Cancelamento agendado não reduz MRR antes da vigência. Renovação registra delta zero. Churn zera o MRR vigente. Reativação cria novo movimento positivo. Correções criam estorno que referencia o fato original e, opcionalmente, um movimento substituto; o original nunca é editado. Triggers do banco bloqueiam `UPDATE` e `DELETE` em movimentos e histórico.

As permissões são `revenue.read`, `revenue.manage`, `revenue.events.record` e `revenue.correct`, com escopos `OWN`, `TEAM` e `WORKSPACE`. Consultas filtram o workspace e aplicam o escopo do responsável. Chaves idempotentes são únicas no workspace e uma restrição parcial impede estorno duplo.

`pnpm db:revenue:backfill` executa dry-run; acrescente `-- --execute` para registrar a execução. O processo nunca inventa quantidade, cadência, competência ou ativação: contratos aceitos sem assinatura ficam `REVIEW_REQUIRED`. Repetir a mesma chave devolve o run anterior.

API: `GET/POST /api/revenue/subscriptions`, `GET/POST /api/revenue/subscriptions/:id`, `GET /api/revenue/summary?from=&to=` (intervalo semiaberto `[from,to)`) e `POST /api/revenue/backfill`. Interface: `/receita` e `/receita/:id`.
