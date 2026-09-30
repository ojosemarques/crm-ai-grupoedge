# Origens, modelos e pipelines configuráveis

Este documento registra o contrato funcional e as evidências executáveis da
Etapa 04 do roadmap de paridade. A configuração reutilizável complementa os
pipelines operacionais existentes e mantém seus serviços como fronteira única
de movimento e fechamento de cards.

## Estado verificado

O produto possui dois funis operacionais persistidos: pré-vendas para `Lead` e
vendas para `Opportunity`. A etapa atual referencia o pipeline do mesmo
workspace e cada transição gera histórico temporal. Os serviços de domínio
aplicam RBAC, grafo, pré-requisitos, locks transacionais e versão otimista.

As superfícies `/pipeline`, `/leads` e `/oportunidades` oferecem quadro e lista,
busca, filtros, responsável, prioridade ou produto, valor, próxima ação e
fechamento com motivo. A lista de leads permite redistribuição em massa com
motivo e autorização individual dos registros selecionados.

A configuração reutilizável usa `PipelineTemplate` e versões imutáveis com
etapas, atividades e campos obrigatórios. `PipelineTemplateApplication` separa
aplicações compartilhadas de cópias locais. A troca de versão passa por prévia
persistida, mapeamento completo, fingerprint, janela de validade, migração
transacional e rollback da última migração aplicada.

`PipelineOriginGroup` organiza origens e equipes. Regras por origem/equipe
controlam consulta, redistribuição, reatribuição e movimento. As decisões são
repetidas no servidor, inclusive para ações em massa e IDs enviados diretamente.

## Matriz requisito → evidência

| Requisito da Etapa 04 | Estado | Evidência real | Evidência complementar |
|---|---|---|---|
| Origem comercial | **Concluído** | `LeadSource`, filtro de origem e `PipelineOriginAccessRule` aplicado na consulta e mutação de oportunidades. | [`opportunity-service.ts`](../src/modules/opportunities/application/opportunity-service.ts) e teste de origem/equipe. |
| Agrupador | **Concluído** | `PipelineOriginGroup` associa origens, equipe e estado ativo com isolamento por workspace. | [`schema.prisma`](../prisma/schema.prisma), migration e editor administrativo. |
| Modelo reutilizável de etapas | **Concluído** | `PipelineTemplateVersion` possui etapas ordenadas com chave estável e versão anterior. | [`pipeline-template-service.ts`](../src/modules/pipeline-templates/application/pipeline-template-service.ts). |
| Modelo reutilizável de atividades | **Concluído** | Cada etapa versionada preserva tipo, título, script, prazo relativo, posição e obrigatoriedade. | `PipelineTemplateActivityDefinition` e formulário de configuração. |
| Campos obrigatórios por oferta/etapa | **Concluído** | `PipelineRequiredField` aceita escopo geral ou `OfferTemplate`; a transição valida os campos no servidor. | [`opportunity-required-fields.ts`](../src/modules/pipeline-templates/application/opportunity-required-fields.ts). |
| Edição compartilhada versus cópia local | **Concluído** | `UPDATE_SHARED` cria nova versão e lista aplicações pendentes; `COPY_TEMPLATE` cria template próprio com aplicação `LOCAL_COPY`. | Serviço, contrato e [`pipeline-template-workspace.tsx`](../src/app/configuracoes/pipeline-template-workspace.tsx). |
| Prévia de migração | **Concluído** | A prévia exige mapa completo para etapas com cards, calcula cards afetados, snapshot e fingerprint e expira em 15 minutos. | `PREVIEW_MIGRATION` e teste de mapeamento incompleto. |
| Migração com mapa de etapas | **Concluído** | Aplicação recria as etapas publicadas, move cards no mesmo commit, incrementa revisão e registra novos intervalos em `StageHistory`. | `APPLY_MIGRATION` e teste de integração. |
| Rollback de migração | **Concluído** | A última migração ativa restaura etapas e cards pelo snapshot e registra novos fatos históricos. | `ROLLBACK_MIGRATION`, histórico na UI e teste de restauração. |
| Histórico imutável | **Concluído** | Triggers impedem update/delete de versões, etapas, atividades e campos publicados; migrações aceitam apenas transições de estado permitidas. | [migration da Etapa 04](../prisma/migrations/20260930050000_stage04_configurable_pipelines/migration.sql). |
| Kanban e lista | **Concluído** | Pré-vendas e oportunidades oferecem quadro/lista e continuam usando os serviços de domínio para toda mutação. | [`pre-sales-pipeline-workspace.tsx`](../src/app/pipeline/pre-sales-pipeline-workspace.tsx) e [`opportunity-pipeline-workspace.tsx`](../src/app/oportunidades/opportunity-pipeline-workspace.tsx). |
| Filtros, valor e dono | **Concluído** | Leads mantêm filtros amplos; oportunidades filtram closer, produto, origem, etapa e período e exibem valor/dono. | Serviços e telas dos dois pipelines. |
| Ganho, perda e motivo | **Concluído** | `OpportunityService` exige motivo, confirmação e snapshot do resultado. | [`opportunity-service.ts`](../src/modules/opportunities/application/opportunity-service.ts). |
| Visão consolidada | **Concluído** | A visão consolidada agrega contagem, valor, abertas, ganhas e perdidas por responsável no recorte autorizado. | [`opportunity-pipeline-workspace.tsx`](../src/app/oportunidades/opportunity-pipeline-workspace.tsx). |
| Ações em massa seguras | **Concluído** | Reatribuição e transição de oportunidades usam prévia persistida, motivo, fingerprint, revisão por item, expiração e execução atômica. | [`opportunity-bulk-service.ts`](../src/modules/pipeline-templates/application/opportunity-bulk-service.ts) e `/api/opportunities/bulk`. |
| Permissão por equipe | **Concluído** | Serviços combinam RBAC com equipe do lead e validam todos os itens do lote. | Teste de integração com equipes A/B. |
| Permissão por origem | **Concluído** | Regras tipadas controlam leitura, distribuição, reatribuição e transição por origem/equipe. | Serviço de oportunidades, configuração e negativa `ORIGIN_TEAM_DENIED`. |
| Distribuição e reatribuição | **Concluído** | Distribuição de leads permanece no serviço existente; oportunidades recebem reatribuição em massa governada. | Serviços de distribuição e bulk, ambos auditados. |
| Atualização simultânea | **Concluído** | Versões e revisões rejeitam template, pipeline, migração ou card obsoleto; o teste altera a revisão do card depois da prévia e recebe `OPPORTUNITY_CHANGED`. | [`pipeline-templates.integration.test.ts`](../tests/integration/pipeline-templates.integration.test.ts). |

## Contrato de aceite implementado

T04.1 é atendida pelos seguintes comportamentos executáveis:

1. criar um template com etapas, transições, atividades e campos obrigatórios;
2. publicar uma versão imutável e instanciar pipelines a partir dela;
3. alterar o template compartilhado ou criar uma cópia local sem propagação;
4. gerar prévia de migração com mapa completo e cards afetados;
5. executar a migração de forma transacional e auditada;
6. reverter a última migração aplicada enquanto a aplicação mantiver a revisão esperada;
7. preservar o histórico de estágio anterior à troca de modelo.

T04.2 complementa as operações existentes com:

1. uma visão consolidada respeitar múltiplos pipelines configuráveis;
2. ações em massa tiverem prévia e confirmação vinculada ao mesmo recorte;
3. autorização por origem e equipe for aplicada no servidor;
4. versões e revisões protegerem publicação e migração, com atualização
   simultânea de card coberta pelo teste de integração.

## Cenários de aceite

### A04-01 — Reuso e edição compartilhada

1. Publicar a versão 1 de um modelo com três etapas e uma atividade.
2. Criar dois pipelines vinculados ao modelo.
3. Publicar a versão 2 adicionando uma etapa e alterar somente o primeiro
   pipeline para a versão nova.

**Esperado:** a versão 1 continua imutável; o pipeline atualizado recebe a
configuração publicada; o segundo permanece na versão anterior até decisão
explícita.

### A04-02 — Cópia local

1. Criar uma cópia local da versão publicada.
2. Renomear uma etapa e alterar uma atividade na cópia.
3. Publicar outra versão do modelo compartilhado.

**Esperado:** a cópia local não recebe alterações; IDs, origem da cópia e
histórico de publicação permanecem rastreáveis.

### A04-03 — Prévia e migração

1. Criar cards em todas as etapas da versão de origem.
2. Mapear cada etapa para a versão de destino e gerar a prévia.
3. Alterar a revisão da aplicação ou do pipeline depois da prévia e confirmar a
   migração.

**Esperado:** a prévia informa contagens e bloqueia mapeamento incompleto; a
confirmação rejeita aplicação ou pipeline obsoleto; com as revisões válidas,
todos os cards são movidos somente para a etapa mapeada.

### A04-04 — Rollback governado

1. Executar uma migração válida.
2. Reverter a última migração aplicada.
3. Tentar reverter novamente a mesma migração.

**Esperado:** a primeira reversão restaura etapas e cards pelo snapshot, mantém
o histórico temporal e marca a migração como revertida; a segunda não reaplica
o snapshot nem cria uma nova reversão.

### A04-05 — Escopo por origem e equipe

1. Criar cards de duas origens em equipes distintas.
2. Autenticar um vendedor com acesso a somente uma combinação permitida.
3. Consultar, mover, redistribuir e tentar incluir os demais cards em lote.

**Esperado:** o vendedor vê e altera apenas o escopo permitido; IDs enviados
diretamente não ampliam acesso; gestor autorizado opera o conjunto esperado.

### A04-06 — Concorrência

1. Enviar duas publicações baseadas na mesma versão esperada do template.
2. Gerar duas prévias de ação em massa para a mesma revisão de um card e
   executar ambas em sequência.

**Esperado:** somente uma publicação vence; a operação obsoleta recebe conflito;
o segundo lote recebe `OPPORTUNITY_CHANGED`; o card termina em uma única etapa
com histórico temporal consistente.

## Decisão de fechamento

Na inspeção atual, **T04.1 e T04.2 estão concluídas**. A evidência inclui schema
e migration aditivos, serviço e contratos de domínio, rotas autenticadas,
configuração administrativa, operação no pipeline de oportunidades e o teste de
integração [`pipeline-templates.integration.test.ts`](../tests/integration/pipeline-templates.integration.test.ts).

Verificação executada em 30/09/2026:
`pnpm test:integration -- tests/integration/pipeline-templates.integration.test.ts`
aplicou as 63 migrations em schema efêmero e concluiu 1 arquivo e 4 testes sem
falhas.
