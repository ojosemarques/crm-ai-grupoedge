# Etapa 16 — dashboards, indicadores e forecast

## Construtor de análises

`/analises` permite salvar dashboards e configurar widgets por métrica,
período, data-base, dimensão, filtros e agregação. O catálogo deriva do registro
canônico `revenueMetricRegistry`; a configuração não aceita fórmula ou consulta
arbitrária. As visualizações disponíveis são linha, área, barras, pizza, rosca,
funil, tabela, número e KPI, conforme a compatibilidade publicada pela métrica.

Dashboards e widgets possuem revisão otimista, idempotência e isolamento por
workspace. Leitura, drilldown e exportação exigem `metrics.read`; alterações
exigem `operations.manage` e same-origin. O CSV neutraliza fórmulas de planilha e
é gerado do mesmo conjunto ordenado usado pelo drilldown.

## Data-base e reconciliação

`sales.opportunity_value` aceita `CREATED_AT` e `WON_AT`. A primeira usa
`Opportunity.createdAt`; a segunda usa somente snapshots canônicos de ganho em
`OpportunityOutcomeSnapshot.occurredAt`. A tela informa a base e o tamanho da
coorte, de modo que a mudança entre criação e ganho seja explicável. Para essa
métrica, oferta, ICP, estágio, responsável, equipe e produto são dimensões
materializadas sobre os mesmos registros exportados.

## Cadência longa e resultado

O registro `crm57.2` inclui cobertura de decisor, patrocinador, diagnóstico,
piloto, espera pactuada, compromisso e estágio; coortes de oferta e ICP;
serviço/projeto entregue; custos de mídia, outbound e IA; e qualidade da amostra
por fonte. Bookings, MRR contratado e caixa recebido continuam usando as
definições existentes, preservando a separação entre contratação, recorrência,
entrega e recebimento. Metas e forecast continuam ligados aos snapshots já
existentes.

O forecast considera elegível somente oportunidade aberta, dentro do período e
escopo, com valor, moeda, data esperada, evidência consultiva ativa e produto que
não esteja marcado como `FUTURE`. A mesma regra vale para tela, submissão e
consolidação, com motivo de exclusão persistido no snapshot.

## Operação

- API de leitura: `GET /api/analytics`.
- Mutações: `POST /api/analytics/dashboards` e
  `PATCH|DELETE /api/analytics/dashboards/{dashboardId}`.
- Evidência: `GET /api/analytics/widgets/{widgetId}/drilldown`.
- Exportação: `GET /api/analytics/widgets/{widgetId}/export`.

As tabelas `analytics_dashboards`, `analytics_widgets` e
`analytics_mutation_receipts` possuem chaves compostas de workspace, restrições
de revisão, RLS habilitada no Supabase e relações compostas com atores.
