# Arquitetura e contratos

Objetivo: estender a implementação modular, sem ledger ou agregador paralelo. Observado: DashboardMetricsService compõe MetricsService, fatos integrados e projeções históricas; MetricsFilters já tem pipelineIds/stageIds/channels. CommercialMetricFact guarda contactId, origem, pipeline, team, performedBy, credited, bookedBy e responsáveis no evento.

Implementar modo `ALL | ADVERTISING | PROSPECTING` e resolução de pipelines LEAD no workspace. Rotas filhas fixam modo; IDs enviados não podem ampliar essa frente. Pipeline desconhecido/sem configuração produz população vazia, nunca remove o filtro. Todos os serviços, séries, comparações, links, formulários e drilldowns preservam o recorte. Consolidado considera as duas frentes nomeadas; outros pipelines não entram silenciosamente.

Fronteiras: Contact=pessoa canônica; Lead=participação comercial em pipeline; Submission=entrada técnica/comercial; Task=plano; Activity=ocorrência/histórico; Fact=contagem; Audit=responsabilização. Mudar owner não reescreve fatos. Fatos sem pipeline comprovado permanecem cobertura parcial; não atribuir pelo pipeline atual retroativamente.

Reusar authorization-service, leadVisibilityWhere, registry e fact-writer. Não introduzir dependências. Alternativas descartadas: duplicar dashboards/queries, nova tabela de pessoa, migrar leads em massa, polling por cartão. Erro inválido retorna o padrão ApplicationError; sem fallback que amplie consulta.

Tarefas: primeiro contrato/mode e testes; depois propagação nos serviços; depois UI/logs. Aceite: duas frentes isoladas, somas reconciliáveis para eventos aditivos, identidade por união e sem vazamento de filtros. Rollback: reverter commit de aplicação; schema permanece compatível.

## Decisão após ensaio e volume real

O banco confirma ledger append-only. Fatos antigos de tarefas/canais/reuniões frequentemente têm pipelineId nulo e fatos de venda usam pipeline de oportunidade. Novos fatos originais recebem `_commercialFrontPipelineId` em safeMetadata, derivado exclusivamente de StageHistory LEAD vigente no evento. Correções conservam sua evidência explícita. Para legado, classificador em lote usa o protocolo de correções existente: estorno e reposição com dimensão comprovada, sem UPDATE de fatos nem novo ledger/tabela. O produtor versionado `front-classification.v1` deriva fingerprint de fingerprint original imutável + frente + lado da correção.

A relação Prisma `CommercialMetricCorrections` apenas descreve a FK `commercial_metric_facts_correction_fk` já criada em 20261006043000. Não há DDL/migration nova. Consultas ignoram estornos técnicos de classificação e fontes substituídas, retornando só a contribuição efetiva. Plano read-only em produção, 54 mil fatos: Hash Anti Join, 56 ms; não foi necessário criar índice por suposição. Consulta de resumo limitada a 50 mil marcos, erro explícito pedindo recorte menor se excedido.
