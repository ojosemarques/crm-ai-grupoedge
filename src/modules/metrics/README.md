# metrics

`MetricsService` é a única camada de definição e cálculo dos indicadores do
CRM. O serviço valida um período semiaberto e filtros compartilhados, resolve
`metrics.read` no servidor e aplica `WORKSPACE`, `TEAM` ou `OWN` antes de ler os
eventos persistidos.

Conversões usam a coorte de `LeadFormSubmission` criada no período; SLA usa
`LeadSlaCycle`; reuniões usam `MeetingHistory`; tempo e aging usam
`StageHistory`; receita, MRR, TCV e ticket usam snapshots imutáveis de
fechamento. Todo retorno inclui período, timezone, filtros, numerador e
denominador. A documentação normativa está em `docs/METRICS.md`.

A CRM-20 adiciona `DashboardMetricsService` sobre essa fronteira. Ele resolve os
períodos civis Hoje, Ontem, Semana, Mês e Personalizado no timezone do workspace,
compõe KPIs e análises e mantém uma referência tipada para cada registro usado.
`/dashboard/registros` recompõe o mesmo recorte e pagina somente essas referências;
portanto a interface não aproxima um drilldown com filtros visuais diferentes da
fórmula. `GET /api/metrics/dashboard` oferece o mesmo contrato protegido e sem
cache para consumidores locais.

A CRM-27 acrescenta `ManagerAnalyticsService`, ainda dentro da fronteira de
métricas. Ele oferece somente oito perguntas predefinidas e retorna resposta,
período, filtros, fórmula, numerador/denominador, comparação, evidências,
limitações, confiança e grupos exatos de registros. `/copilot` exige
`ai.manager.query`, não aceita pergunta livre e não executa mutação comercial.

A CRM-57 adiciona o catálogo canônico `crm57.1` e
`RevenueMetricsService`, compondo aquisição, contratos, ledger, pagamentos,
renovação, coortes e snapshots de forecast. Zero, ausência de denominador,
indisponibilidade, não aplicabilidade, parcial e supressão são estados distintos.
A especificação normativa está em `docs/REVENUE_METRICS.md`.
