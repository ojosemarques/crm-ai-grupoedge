# pipelines

Fronteira das etapas e transições comerciais. A CRM-14 implementa o pipeline de
pré-vendas; o pipeline de oportunidades continua reservado à CRM-16.

`domain/lead-stage-transition-policy.ts` mantém o grafo determinístico e os
pré-requisitos por etapa. `application/pre-sales-pipeline-service.ts` é a única
fronteira de leitura e mutação: aplica workspace e RBAC, lock, versão otimista,
PACTO, próxima ação, motivo, confirmação, `StageHistory`, timeline e auditoria.

A apresentação usa `/pipeline`, o painel no cartão do lead e o Route Handler
`/api/leads/[leadId]/stage`. Nenhum desses adaptadores escreve diretamente no
banco. Consulte `docs/PIPELINES.md` para regras, códigos e transições.
