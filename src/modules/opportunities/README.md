# opportunities

Módulo do pipeline comercial do closer. `OpportunityService` é a única fronteira
de escrita para criar oportunidades, registrar propostas, mudar etapas, ganhar,
perder e reabrir uma negociação. As regras do grafo ficam no domínio e os
contratos compartilhados não importam Prisma.

A oportunidade mantém produto ou interesse, closer, valores em centavos,
probabilidade manual, etapa e próxima ação. `StageHistory`, `Activity` e
`AuditLog` preservam o fato histórico; a projeção atual usa revisão otimista e
locks transacionais. A UI e os Route Handlers apenas validam, autenticam e
chamam o serviço.

Ganho e perda também criam `OpportunityOutcomeSnapshot` no mesmo commit da
transição. O registro congela responsável, produto, valores, moeda, motivo e
instante do fechamento, é append-only e mantém métricas históricas reproduzíveis
mesmo quando uma oportunidade é reaberta ou alterada depois.
