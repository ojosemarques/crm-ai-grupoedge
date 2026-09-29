# Estado de execução

Checkpoint atualizado em 16 de setembro de 2026. O estado abaixo é baseado em
arquivos, migrations e testes presentes no repositório; o envio de um prompt não
é usado como evidência de implementação.

| ID | Status | Evidência | Dependências | Observações |
|---|---|---|---|---|
| CRM-00 | CONCLUÍDA E VALIDADA | `docs/PRD.md`, `docs/ARCHITECTURE.md` e `docs/BACKLOG.md`; as entregas dependentes materializam o plano | Prompt Base | A resposta original não está no Git, que ainda não possui commits; a aprovação é evidenciada pela execução subsequente da CRM-01 |
| CRM-01 | CONCLUÍDA E VALIDADA | Next App Router, TypeScript estrito, Compose/PostgreSQL, Prisma, Vitest, Playwright, health check, configuração, logging e documentação | CRM-00 aprovada | Suíte, lint, tipos e build revalidados no checkpoint da CRM-06 |
| CRM-02 | CONCLUÍDA E VALIDADA | `prisma/schema.prisma`, migrations relacionais, constraints, índices e `relational-model.integration.test.ts` | CRM-01 | Cadeia completa aplicada em banco vazio e revalidada por integração |
| CRM-03 | CONCLUÍDA E VALIDADA | `src/modules/auth`, autorização server-side, proteção HTTP, matriz RBAC e `auth-rbac.integration.test.ts` | CRM-02 | Isolamento e negativas revalidados |
| CRM-04 | CONCLUÍDA E VALIDADA | seed local idempotente, estrutura, usuários, atores, catálogo e `demo-seed.integration.test.ts` | CRM-03 | Não cria leads e preserva registros manuais |
| CRM-05 | CONCLUÍDA E VALIDADA | serviço único de entrada, normalização, deduplicação, locks, opt-out e testes de integração | CRM-04 | Regressão revalidada junto da CRM-06 |
| CRM-06 | CONCLUÍDA E VALIDADA | round-robin, pausa, inatividade, Fila Geral, atribuição manual/redistribuição, tarefa, ciclos de SLA, timeline, auditoria e testes direcionados | CRM-05 | Política `SLA imediato — 0 minutos`; migration aplicada localmente |
| CRM-07 | CONCLUÍDA E VALIDADA | `/leads/entrada`, quatro adaptadores sobre `LeadIntakeService`, `ImportJob` com preview/relatório, `WebhookEvent` idempotente e testes unitários, integração e E2E | CRM-05 e CRM-06 | Manual, CSV, webhook local e simulador preservam deduplicação, distribuição, SLA e auditoria; nenhuma integração externa foi criada |
| CRM-08 | CONCLUÍDA E VALIDADA | serviço transacional de histórico operacional, projeção única de próxima ação, atividades, tarefas, timeline paginada, rota e tela `/leads/[leadId]/historico`, migration append-only e testes unitários, integração e E2E | CRM-07 | Fatos históricos são imutáveis; correções geram novo evento; permissões são verificadas no servidor |
| CRM-09 | CONCLUÍDA E VALIDADA | serviço SQL paginado de lista, filtros e ordenação operacionais, tabela `/leads`, colunas configuráveis, seleção e redistribuição em massa, visualizações salvas, rotas protegidas, migration de índices e testes de integração/E2E | CRM-08 | Dados persistidos, escopo RBAC no servidor, ações em massa confirmadas e auditadas; migration aplicada localmente |
| CRM-10 | CONCLUÍDA E VALIDADA | `/meu-dia`, `SdrQueueService`, nove seções persistidas, recomendação determinística explicada, relógio de SLA, filtro por SDR, drilldowns reconciliáveis e testes unitários, integração e E2E | CRM-09 | Escopo RBAC reutilizado da lista; atualização única a cada 30s; nenhuma migration necessária |
| CRM-11 | CONCLUÍDA E VALIDADA | cartão 360 em `/leads/[leadId]/historico`, cabeçalho e resumo persistidos, ações suportadas, edição com concorrência otimista, timeline paginada, capacidades RBAC e testes de integração/E2E | CRM-10 | Abas futuras permanecem estados vazios honestos; nenhuma migration necessária |
| CRM-12 | CONCLUÍDA E VALIDADA | PACTO relacional por dimensão, rascunho e validação humana, sinais separados de formulário/IA, revisões append-only, aba no cartão, RBAC, timeline, auditoria e testes de integração/E2E | CRM-11 | Migration aplicada no banco local; nenhuma transição de pipeline foi antecipada |
| CRM-13 | CONCLUÍDA E VALIDADA | regra versionada, cálculo determinístico, fontes separadas, projeção vigente, componentes explicáveis, histórico append-only, override/recálculo/IA, integração com entrada/PACTO/listas/cartão e testes unitários, integração e E2E | CRM-12 | Migration aplicada no banco local; nenhuma transição de pipeline foi antecipada |
| CRM-14 | CONCLUÍDA E VALIDADA | oito etapas semânticas, serviço transacional de transição, `StageHistory` imutável, quadro/lista/cartão, RBAC, correção gerencial e testes unitários, integração e E2E | CRM-12 e CRM-13 | Migration aplicada localmente; nenhuma funcionalidade da CRM-15 foi iniciada |
| CRM-15 | CONCLUÍDA E VALIDADA | agenda diária/semanal, reuniões de 30/40 minutos, conflito concorrente, ciclo completo, histórico append-only, briefing do closer, cartão, RBAC e testes unitários, integração e E2E | CRM-14 | Migration aplicada localmente; nenhuma integração externa ou funcionalidade da CRM-16 foi iniciada |
| CRM-16 | CONCLUÍDA E VALIDADA | pipeline de vendas em sete etapas, oportunidades e propostas persistidas, ganho/perda/reabertura controlados, integração com reunião, próxima ação, RBAC, timeline, auditoria e testes unitários, integração e E2E | CRM-15 | Dependência confirmada antes da execução da CRM-17 |
| CRM-17 | CONCLUÍDA E VALIDADA | configurações comerciais relacionais e versionadas, API e tela protegidas, impacto prévio, inativação segura, runtime consumindo regras persistidas, migration, seed e testes unitários, integração e E2E | CRM-16 | 76 testes unitários, 112 de integração e 23 E2E; lint, tipos e build aprovados; migration aplicada localmente |
| CRM-18 | CONCLUÍDA E VALIDADA | `/administracao`, serviço central de administração, lifecycle de memberships, equipes/funções, disponibilidade, carga persistida, redistribuição transacional, RBAC, auditoria e testes de integração/E2E | CRM-03 e CRM-17 | 76 unitários, 9 testes direcionados próprios e 26 E2E aprovados; lint, tipos e build aprovados; nenhuma migration necessária |
| CRM-19 | CONCLUÍDA E VALIDADA | `MetricsService`, contrato compartilhado, `docs/METRICS.md`, snapshots financeiros append-only, `metrics.read`, migration e testes unitários/integração | CRM-08, CRM-14, CRM-15 e CRM-16 | 79 testes unitários, 127 de integração, lint, tipos e build aprovados; migration aplicada localmente |
| CRM-20 | CONCLUÍDA E VALIDADA | `/dashboard`, `DashboardMetricsService`, evidências tipadas, filtros globais, análises e drilldowns reconciliáveis, API protegida e testes unitários/integração/E2E | CRM-19 | 81 unitários, 131 de integração e 28 E2E; lint, tipos e build aprovados; nenhuma migration necessária |
| CRM-21 | CONCLUÍDA E VALIDADA | publicação interna, jobs PostgreSQL, worker recuperável, retry/backoff, lock concorrente, tentativas, recibos idempotentes, execução manual, gestão, observabilidade, RBAC, migration e testes | CRM-20 | 83 unitários, 139 de integração, lint, tipos e build aprovados; migration aplicada localmente |
| CRM-22 | CONCLUÍDA E VALIDADA | cinco regras predefinidas, publicação transacional, adaptador de efeitos, notificação, mensagem simulada, P1, SLA 61/181, resposta, timeline, auditoria, migration, seed e testes | CRM-21 | 83 unitários, 148 de integração (9 próprios), lint, tipos e build aprovados; migration aplicada localmente |
| CRM-23 | CONCLUÍDA E VALIDADA | sete regras de ciclo de vida, cadência, lembretes, no-show, saúde do processo, encerramento, central individual, tela de regras/runs, migration, seed e testes | CRM-22 | 84 unitários, 156 de integração, 8 direcionados e 3 E2E próprios; lint, tipos e build aprovados; migration aplicada localmente |
| CRM-24 | CONCLUÍDA E VALIDADA | `/auditoria`, trilha append-only pesquisável, `ProcessViolation`, dez verificações determinísticas, RBAC, evidência imutável, reconciliação e testes unitários/integração/E2E | CRM-23 | 87 unitários, 162 de integração, 6 direcionados e 2 E2E próprios; lint, tipos, schema e build aprovados; migration aplicada localmente |
| CRM-25 | CONCLUÍDA E VALIDADA | contratos Zod por agente, seis prompts versionados, `MockAIProvider`, `OpenAICompatibleProvider`, fallback, `AIExecutionService`, `AIInsight` rastreável, `ai.use`, auditoria, migration e testes | CRM-24 | 101 unitários, 173 de integração e 11 direcionados próprios; lint, tipos, schema e build aprovados; migration aplicada localmente |
| CRM-26 | CONCLUÍDA E VALIDADA | aba Inteligência no cartão, quatro casos de uso, revisão humana total/parcial, PACTO/score/tarefa via serviços de domínio, opt-out, RBAC, timeline, auditoria e testes unitários, integração e E2E | CRM-25 | 104 unitários, 181 de integração, 8 direcionados próprios e 3 E2E do cartão; lint, tipos, schema e build aprovados; nenhuma migration necessária |
| CRM-27 | CONCLUÍDA E VALIDADA | `/copilot`, `ManagerAnalyticsService`, `ManagerCopilotService`, oito consultas fechadas, drilldowns rastreáveis, confirmação humana sem mutação, `ai.manager.query`, auditoria e testes unitários/integração/E2E | CRM-26 e CRM-19 | 107 unitários, 195 de integração, 14 direcionados próprios e 2 E2E próprios; lint, tipos, schema e build aprovados; migration aplicada localmente |
| CRM-28 | CONCLUÍDA E VALIDADA | shell responsivo, tokens, componentes de feedback, tabelas e formulários densos, foco/teclado, estados de rota, refinamento das oito telas prioritárias, documentação e E2E visual | CRM-27 | 107 unitários, 195 de integração e 3 E2E próprios; lint, tipos, schema e build aprovados; nenhuma migration ou regra comercial alterada |
| CRM-29 | CONCLUÍDA E VALIDADA | seed operacional determinístico de 320 leads, 32 reconversões, histórico comercial coerente, reset protegido, documentação e testes unitários/integração/E2E | CRM-28 | 113 unitários, 195 de integração, 10 testes próprios e 2 E2E do dashboard; lint, tipos, schema e build aprovados; nenhuma migration necessária |
| CRM-30 | CONCLUÍDA E VALIDADA | cobertura crítica consolidada, executores isolados, hardening HTTP/CSV/logs/headers, auditoria de dependências, `docs/TEST_PLAN.md` e suítes unitária, integração e E2E completas | CRM-29 | 124 unitários, 195 de integração, 4 do seed, 39 E2E de produção e 1 E2E local-only; lint, tipos, build e audit aprovados; nenhuma migration necessária |
| CRM-31 | CONCLUÍDA E VALIDADA | documentação obrigatória reconciliada, `docs/DEPLOYMENT_FUTURE.md`, `docs/MVP_READINESS.md`, inspeção visual, reinício persistente e gate completo local | CRM-30 | 124 unitários, 195 de integração, 4 do seed, 39 E2E de produção e 1 local-only; lint, tipos, audit e build aprovados; nenhum deploy |
| DESIGN-01 | CONCLUÍDA E VALIDADA | marca oficial, shell responsivo, ícones semânticos, login e dashboard executivo orientado a receita, vendas, oportunidades, funil e pendências persistidas | CRM-31 | 124 testes unitários e 11 E2E direcionados aprovados; lint, tipos e build aprovados; inspeção desktop/mobile sem overflow horizontal; nenhum deploy |
| DESIGN-02 | CONCLUÍDA E VALIDADA | Plus Jakarta Sans auto-hospedada, tokens Politizai, superfícies e raios globais, sidebar/topbar/componentes compartilhados e validação visual das sete telas prioritárias | DESIGN-01 | 124 testes unitários e 6 E2E direcionados aprovados; lint, tipos e build aprovados; 28 combinações tela/resolução sem overflow; nenhuma regra comercial ou migration alterada |
| DESIGN-03 | CONCLUÍDA E VALIDADA | Meu Dia com foco único “Atenda agora”, resumo reconciliável, nove tabs acessíveis, lista compacta e painel lateral responsivo sobre o `SdrQueueService` existente | DESIGN-02 | 124 unitários, 7 integrações direcionadas, 3 E2E funcionais e 1 E2E visual em quatro resoluções; lint, tipos e build aprovados; nenhuma regra comercial ou migration alterada |
| DESIGN-04 | CONCLUÍDA E VALIDADA | barra compacta, multisseleção acessível, chips removíveis, drawer avançado agrupado, ordenação/colunas separadas, visualizações compactas e ação em massa sticky sobre o `LeadListService` existente | DESIGN-03 | 124 unitários, 7 integrações direcionadas, 5 E2E próprios e 3 E2E de acessibilidade aprovados; lint, tipos e build aprovados; quatro resoluções sem overflow; nenhuma regra comercial ou migration alterada |
| DESIGN-05 | CONCLUÍDA E VALIDADA | comparações civis atual/anterior, evidências temporais tipadas, séries horária/diária/semanal, interpretação semântica, drilldowns dos dois períodos e funil completo ramificado | DESIGN-04 | 127 unitários, 198 integrações e 25 integrações direcionadas aprovados; lint, tipos e build aprovados; nenhuma migration, redesign visual ou regra comercial alterada |
| DESIGN-06 | CONCLUÍDA E VALIDADA | Dashboard executivo comparativo, gráficos temporais reais, funil ramificado, SLA, atenção, aquisição e performance sobre a camada única de métricas | DESIGN-05 | 127 unitários, 198 integrações, 49 E2E de produção e 1 E2E local-only aprovados; lint, tipos e build aprovados; quatro resoluções sem overflow; nenhuma migration, regra comercial ou deploy |
| DESIGN-07 | CONCLUÍDA E VALIDADA | revisão transversal das telas, componentes compartilhados de superfície/estado/tabela, estados públicos consistentes e QA visual automatizado com capturas | DESIGN-06 | 127 unitários, 198 integrações, 53 E2E de produção e 1 E2E local-only aprovados; 15 rotas em cinco resoluções e zoom equivalente a 200% sem overflow; lint, tipos e build aprovados; nenhuma migration, regra comercial ou deploy |
| PROD-01 | CONCLUÍDA E VALIDADA | repositório privado `Menddon/crm-politizai`, backup local restaurado em ensaio, 140 schemas legados comprovados removidos no histórico, zero schema não sistêmico fora de `public` e executores com descarte em `finally` | autorização explícita PROD-01; `main` funcional até CRM-41 preservada; CRM-42 parcial isolada em branch privada de segurança | Revalidada após CRM-41: 177 unitários, 233 integrações, 4 CRM-29, 67 E2E de produção e 1 local; lint, tipos, audit, build, 35 migrations, smoke e limpeza aprovados; zero schema removido nesta rodada; `.next` removido ao final; nenhum deploy ou banco remoto |
| PROD-02 | CONCLUÍDA E VALIDADA | `docs/CLOUD_ARCHITECTURE_DECISION.md`, `docs/CLOUD_COSTS_AND_LIMITS.md` e `docs/PROD_EXECUTION_PLAN.md`; inspeção read-only do repositório, prontidão, Opadillis/Vercel e documentação oficial | CRM-64 concluída localmente; commit inicial `bcc41c8c32ce19194755f848f822183ba4d45ccd`; autorização explícita PROD-02 | Vercel Pro `gru1`, Neon Launch `sa-east-1` e worker persistente Fly.io `gru` decididos; staging/produção isolados; nenhum recurso, domínio, banco remoto, secret, cobrança ou deploy criado |
| PROD-03 | CONCLUÍDA E VALIDADA | contrato tipado de quatro ambientes, preflight `prod03.1`, inventários de variáveis sem valores, bootstrap administrativo CLI-only, liveness/readiness separados, CSP/headers, configuração Vercel e testes direcionados | PROD-02 concluída no commit `767d0aca12ddc85efd4bf1a4b532690e3b567951`; autorização explícita PROD-03 | 43 unitários direcionados, integração do bootstrap e 6 E2E em schemas efêmeros, lint sem avisos, tipos, audit, build Webpack, preflight local, smoke e limpeza de schemas aprovados; nenhuma migration, conta, usuário real, recurso externo, banco remoto, provider, worker remoto ou deploy |
| PROD-04 | CONCLUÍDA E VALIDADA | workflows `CI` e `Release Gate`, PostgreSQL efêmero, scanner versionável, SBOM SPDX, relatório, Dependabot e execução remota [34855726325](https://github.com/Menddon/crm-politizai/actions/runs/34855726325) | PROD-03 concluída e `main` sincronizada no commit `4871b15d33d5ed85dc7bf97134fca479260721e0`; autorização explícita PROD-04 | 329 unitários, 51 integrações críticas, 59 migrations desde zero, lint, tipos, audit, build e smoke aprovados localmente e no CI; ruleset/proteção de `main` bloqueados pelo plano privado, sem alteração de visibilidade; nenhum deploy ou banco remoto |
| PROD-05 | CONCLUÍDA E VALIDADA — STAGING GRATUITO | projeto Neon `crm-politizai-staging-db`, banco `politizai_staging/public`, região AWS São Paulo, Free, TLS, pooled/direct, owner/migrator/runtime separados, limites e timeouts persistidos, restore de 6 horas e inventário seguro | PROD-04 concluída; autorização explícita para continuar PROD-05; sobreposição gratuita previamente autorizada | runtime com DML nas 297 tabelas e sem DDL; 59 migrations e identidade sintética já existiam antes da retomada e foram preservadas; nenhum migration, seed, restore, dado real, upgrade ou recurso de produção criado nesta task |
| PROD-06 | CONCLUÍDA E VALIDADA — STAGING SINTÉTICO | `docs/STAGING_DATABASE_REPORT.md`; preflight `READY_FOR_STAGING`, 59 migrations sem pendência, dataset mínimo idempotente, RBAC/invariantes e restore em branch isolado reconciliado | PROD-05 concluída no perfil gratuito; autorização explícita PROD-06 | estado previamente inicializado foi preservado; branch temporário removido; runtime sem DDL; nenhum dado real, deploy, worker ou produção |
| PROD-07 | CONCLUÍDA E VALIDADA — WEB STAGING PROTEGIDA | projeto Vercel `crm-politizai-staging`, deployment `READY` em `gru1`, Vercel Authentication, liveness/readiness, login, RBAC, páginas, lead sintético e persistência após redeploy; `docs/STAGING_DEPLOYMENT.md` | PROD-06 concluída e autorização explícita PROD-07 | plano Hobby sem cobrança; Render legado preservado com auto-deploy desligado; sem domínio, produção, worker ou provider externo |
| PROD-08 | CONCLUÍDA E VALIDADA — HOMOLOGAÇÃO TRANSITÓRIA GRATUITA | `docs/STAGING_WORKER_REPORT.md`; entrypoint real e endpoint serverless protegido contra Neon staging, idempotência, backlog zero, shutdown e testes do motor | PROD-07 concluída; autorização explícita PROD-08 e autorização posterior para modo gratuito temporário | endpoint remoto manual homologado; nenhum runtime automático 24×7; zero custo, provider comercial do CRM ou egress de canal |
| PROD-09 | CONCLUÍDA E VALIDADA — STAGING | correlation ID, logs redigidos, console operacional, alertas/runbooks, rate limit PostgreSQL, CSP sem `unsafe-inline`, WAF Log, migration 60, CI `34909533050` e deployment `dpl_BQmT2vZkcQd1to6YRJAt3ErQWUyU`; `docs/STAGING_OBSERVABILITY_AND_EDGE_SECURITY.md` | PROD-08 concluída no modo transitório autorizado | web, banco e worker manual de staging aprovados; retenção central, substituto/on-call, DAST/pentest e enforcement do WAF continuam gates futuros |
| PROD-10 | HOMOLOGADA PARA STAGING GRATUITO — PROD-11 NO-GO | worker serverless manual protegido, kill switch, regressão do Pipeline, VoiceOver/zoom 200%, fault lab Neon isolado e owners nominais; commits `476b3e2`/`c5ad0b5`, CIs `35034243590`/`35035561582` | PROD-09 concluída e autorização explícita da correção dirigida | falta worker automático 24×7 equivalente à produção; endpoint fica desabilitado fora das janelas; nenhum recurso de produção, provider, upgrade ou cobrança criado |
| PROD-11 | CONCLUÍDA E VALIDADA — INFRAESTRUTURA GRATUITA FECHADA | snapshot ao encerramento: Vercel `crm-politizai-production` protegido e sem deployment; Neon `steep-credit-26086628` vazio, isolado, TLS, pooled/direct e roles separados | PROD-10 homologada para staging gratuito; autorização explícita para seguir sem worker 24×7 | naquele checkpoint: custo R$ 0 e zero migration, tabela, dado, usuário, Git link, domínio ou deployment; o estado atual está na linha PROD-12 |
| PROD-12 | CONCLUÍDA E VALIDADA — RELEASE FECHADO | preflight `READY_FOR_PRODUCTION`; branch pré-migration; 60 migrations; deployment protegido `dpl_C18kCxoBVxc4pUgcvAcMLWgaTu6n` no SHA `bf15b079`; relatórios consolidado, migrations, deployment, rollback e aceite | PROD-11 concluída; autorização explícita PROD-12; CI `35138250850` verde | zero workspace/usuário/lead; workers, adapters e bootstrap desligados; sem domínio, DNS, go-live, cobrança ou dado real; PROD-13 não iniciada |
| PROD-13 | CONCLUÍDA E VALIDADA — NO-GO PARA PROD-14 | `docs/PROD13_FINAL_GO_NO_GO.md`; projeto/deployment/SHA, CI, proteção, health/readiness, headers, banco e rollback auditados com evidência atual ou recente explicitamente identificada | PROD-12 concluída e validada; autorização explícita PROD-13 | release fechado saudável, mas identidade/RBAC produtivos, jurídico/DPO, segundo operador, backup/PITR, domínio, MFA/recovery, DAST/pentest e observabilidade produtiva continuam bloqueados; nenhuma mutação remota |
| PROD-13.1 | CONCLUÍDA E VALIDADA — PRÉVIA PRIVADA EM STAGING | `docs/PROD13_PRIVATE_PREVIEW.md`; identidade `Matheus` criada pelo serviço administrativo auditado, senha somente no Keychain, login/RBAC e cinco superfícies autenticadas, health/readiness e isolamento verificados | PROD-13 concluída em NO-GO; autorização dirigida para prévia privada gratuita | somente staging sintético; Vercel Authentication preservada; zero integração, worker automático, dado real, upgrade ou cobrança; produção continua NO-GO e PROD-14 não foi iniciada |
| CRM-32 | CONCLUÍDA E VALIDADA | documentos de PRD, arquitetura, dados, migração, UX, métricas, integrações, segurança, backlog e protocolo criados sem mudança funcional | PROD-01 concluída e validada | validação documental, links, ordem CRM-33→CRM-64, lint, typecheck e `db:status` aprovados; nenhum teste funcional necessário, migration, integração ou deploy |
| CRM-33 | CONCLUÍDA E VALIDADA | Contact/ContactPoint canônicos, reviews de colisão, dual write, backfill persistido idempotente, aba Identidade, RBAC, migration e reconciliação real | CRM-32 | 132 unitários, 203 integrações, 4 CRM-29, 53 E2E de produção e 1 local; lint, tipos, audit, build e 24 migrations aprovados; 472 Leads operacionais ligados sem alterar IDs históricos |
| CRM-34 | CONCLUÍDA E VALIDADA | Account canônica, hierarquia, papéis temporais de contato, comitê de compra, revisões humanas, backfill idempotente, Conta 360, RBAC, migration e reconciliação real | CRM-33 | 134 unitários, 206 integrações, 4 CRM-29, 55 E2E de produção e 1 local; lint, tipos, audit, build e 25 migrations aprovados; 341 candidatos legados revisáveis sem merge automático |
| CRM-35 | CONCLUÍDA E VALIDADA | lifecycle de receita e ownership funcional temporais, regras versionadas, transferências, dual write, backfill conservador, RBAC, APIs, UI e testes | CRM-34 | 137 unitários, 209 integrações, 4 CRM-29, 55 E2E de produção e 1 local; lint, tipos, audit e build aprovados; migration aplicada localmente; nenhum deploy |
| CRM-36 | CONCLUÍDA E VALIDADA | políticas/finalidades/bases versionadas, consentimento append-only e por canal, decisão central `ALLOW`/`DENY`/`REVIEW_REQUIRED`, DSR, retenção segura, legal hold, backfill conservador, RBAC, API/UI e testes | CRM-33 e CRM-35 | 148 unitários, 217 integrações, 4 CRM-29, 58 E2E de produção e 1 local-only; lint, tipos, audit, build e 27 migrations aprovados; políticas jurídicas permanecem `PENDING_LEGAL`; nenhum deploy |
| CRM-37 | CONCLUÍDA E VALIDADA | conexões/configurações versionadas, referências de segredo sem valor, inbox/outbox, sync/cursor, mappings/conflitos, adaptador determinístico local, RBAC, API/UI, migrations e testes | CRM-36 | 151 unitários, 222 integrações, 4 CRM-29, 60 E2E de produção e 1 local-only; lint, tipos, audit e build aprovados; nenhum provider, credencial, egress ou ambiente externo conectado |
| CRM-38 | CONCLUÍDA E VALIDADA | landing pages/formulários versionados, sessão minimizada, touchpoints/conversões append-only, modelos e créditos exatos, cobertura/revisão, dual write na entrada, backfill conservador, RBAC, API/UI, migration e testes | CRM-33 e CRM-37 | 157 unitários, 226 integrações, 4 CRM-29, 62 E2E de produção e 1 local-only; lint, tipos, audit, build, backup/restore e 31 migrations aprovados; finalidade `PENDING_LEGAL`, outbox local-only e nenhum provider/egress |
| CRM-39 | CONCLUÍDA E VALIDADA LOCALMENTE | hierarquia tipada de mídia, fatos append-only, importação local com prévia/confirmação/rollback, métricas observadas, funil ramificado, reconciliação, RBAC, API/UI, migrations e testes | CRM-37 e CRM-38 | 160 unitários, 230 integrações, 4 CRM-29, 63 E2E de produção e 1 local-only; lint, tipos, audit, build, backup/restore e 33 migrations aprovados; nenhum provider, credencial, egress, banco remoto ou deploy |
| CRM-40 | CONCLUÍDA E VALIDADA LOCALMENTE — VALIDAÇÃO EXTERNA ADIADA | adaptador Meta Ads read-only, configuração versionada, referências server-side, descoberta/seleção de contas, hierarquia, insights diários, revisão tardia, ações conhecidas/desconhecidas, RBAC, API/UI, migration e fixtures | CRM-37, CRM-38 e CRM-39 | implementação local validada; por decisão explícita, token/conta real, egress e reconciliação externa permanecem em `docs/EXTERNAL_VALIDATIONS.md` |
| CRM-41 | CONCLUÍDA E VALIDADA LOCALMENTE — VALIDAÇÃO EXTERNA ADIADA | adaptador Google Ads estritamente read-only, OAuth/service account por referência, hierarquia manager/customer, templates GAQL, métricas provider, assets múltiplos, revisão/cursor commit-safe, RBAC, API/UI, migration e fixtures | CRM-37, CRM-38, CRM-39 e padrão da CRM-40 | validação externa deliberadamente adiada: nenhuma credencial solicitada, egress, customer real, projeto Cloud ou reconciliação externa; gates locais e contagens finais registrados abaixo |
| CRM-42 | CONCLUÍDA E VALIDADA LOCALMENTE — GEOCODING EXTERNO ADIADO | dimensões e observações geográficas tipadas, perfil revisável, territórios/memberships versionados, backfill conservador, métricas suprimidas, mapa offline, tabela acessível, RBAC, API, migration e testes | CRM-34 e CRM-38 | 183 unitários, 239 integrações, 4 CRM-29, 69 E2E de produção, 1 local-only e 2 E2E geográficos finais; lint, tipos, audit, build, backup/restore, 36 migrations e quatro viewports aprovados; nenhum provider, coordenada inventada, egress, banco remoto ou deploy |
| CRM-43 | CONCLUÍDA E VALIDADA LOCALMENTE | Inbox unificado, contratos multicanal, `Conversation`/`Message` canônicos, identidade revisável, owner/fila explícitos, privacidade pré-envio, eventos de status, delivery local, templates, backfill e testes | CRM-36 e CRM-37 | 188 unitários, 247 integrações, 4 CRM-29, 71 E2E de produção e 1 local-only; lint, tipos, audit, build, backup/restore e 37 migrations aplicadas desde zero aprovados; somente simulador interno, sem provider, credencial, egress ou deploy |
| CRM-44 | CONCLUÍDA E VALIDADA LOCALMENTE — ATIVAÇÃO EXTERNA BLOQUEADA | profile WhatsApp, contratos oficiais normalizados, webhook autenticado, receipt/job, worker, retry/dead-letter/replay, janela de 24 horas, template, opt-out, identidade, UI, migrations e backfill | CRM-43 | 195 unitários, 254 integrações, 4 CRM-29, 73 E2E de produção e 1 local-only; lint, tipos, audit, build, backup/restore e 39 migrations desde zero aprovados; política, credenciais, sandbox, provider e egress externos não validados |
| CRM-45 | CONCLUÍDA E VALIDADA LOCALMENTE — DOMÍNIO/PROVIDER EXTERNOS ADIADOS | profile de e-mail, headers/threading, sink local, outbox/job/worker, retry/dead-letter, status, bounce/complaint/unsubscribe, suppression, RBAC, UI, migrations e backfill | CRM-43 e CRM-44 preservada | 204 unitários, 263 integrações, 4 CRM-29, 75 E2E de produção e 1 local-only; lint, tipos, audit, build, backup/restore e 41 migrations desde zero aprovados; nenhum SMTP, DNS, mailbox, credencial, provider ou egress externo |
| CRM-46 | CONCLUÍDA E VALIDADA LOCALMENTE — PROVIDER/PSTN/GRAVAÇÃO EXTERNOS ADIADOS | profile de telefonia, chamadas/legs/eventos, callback local assinado, outbox/job/worker, retry/dead-letter/replay, disposição humana, SLA, Activity, RBAC, UI, migrations e backfill | CRM-43; CRM-45 preservada | 218 unitários, 274 integrações, 4 CRM-29, 77 E2E de produção e 1 local-only; lint, tipos, audit, build, backup/restore e 43 migrations desde zero aprovados; nenhum provider, número, PSTN, áudio, gravação, transcrição, credencial ou egress externo |
| CRM-47 | CONCLUÍDA E VALIDADA LOCALMENTE — PROVIDER/OAUTH/WEBHOOK EXTERNOS ADIADOS | profile de calendário, `Meeting` canônica, links/eventos/conflitos, inbox/outbox, runs/cursors, callback local assinado, worker com retry/dead-letter/replay e recuperação, resolução humana, RBAC, UI, migration e backfill | CRM-37 e CRM-43; CRM-46 preservada | 226 unitários, 283 integrações, 4 CRM-29, 79 E2E de produção e 2 local-only; lint, tipos, audit, build, backup/restore e 44 migrations desde zero aprovados; nenhum provider, OAuth, conta, credencial, webhook público, egress ou banco remoto |
| CRM-48 | CONCLUÍDA E VALIDADA LOCALMENTE — ASSINATURA/REVISÃO JURÍDICA EXTERNAS ADIADAS | contratos e templates versionados, snapshots imutáveis, numeração por workspace, ciclo de revisão/emissão/aceite local, impressão HTML com hash, RBAC, auditoria, métricas e backfill conservador | CRM-34 e CRM-35; CRM-47 preservada | 229 unitários, 287 integrações, 4 CRM-29, 81 E2E de produção e 2 local-only; lint, tipos, audit, build, backup/restore e 45 migrations desde zero aprovados; nenhum provider, assinatura externa, credencial, egress, banco remoto ou deploy |
| CRM-49 | CONCLUÍDA E VALIDADA LOCALMENTE — PAGAMENTO/CONTABILIDADE EXTERNOS ADIADOS | assinaturas explícitas, snapshots, estados finitos, mudanças agendadas, ledger e histórico append-only, competência por `effectiveAt`, MRR/ARR e movimentos do período, RBAC, auditoria e backfill conservador | CRM-48 concluída e validada | 231 unitários, 288 integrações, 4 CRM-29, 81 E2E de produção e 2 local-only (um retry isolado de login); lint, tipos, audit, build, backup/restore, 46 migrations desde zero, seed duplo, backfill dry/execute/replay e QA 1440×900/390×844 aprovados; zero provider, pagamento, egress, banco remoto ou deploy. |
| CRM-50 | CONCLUÍDA E VALIDADA LOCALMENTE — PROVIDER/ERP/CONTABILIDADE/FISCAL EXTERNOS ADIADOS | cobranças com snapshots imutáveis, tentativas, sandbox determinístico, callback local HMAC, pagamentos e eventos append-only, reconciliação humana, retry/dead-letter/replay, RBAC, UI, worker e backfill conservador | CRM-49 concluída e validada | 235 unitários, 293 integrações, 4 CRM-29, 83 E2E de produção e 3 local-only; lint, tipos, audit, build, backup/restore e 49 migrations desde zero aprovados; zero provider, credencial, meio de pagamento, egress, banco remoto ou deploy. |
| CRM-51 | CONCLUÍDA E VALIDADA LOCALMENTE | handoff e onboarding locais com estados separados, templates/marcos, owner, próxima ação, evidência, RBAC, auditoria, UI, métricas, concorrência e backfill conservador | CRM-35 e CRM-48 concluídas e validadas; CRM-50 preservada | 237 unitários, 297 integrações, 4 CRM-29, 85 E2E de produção e 3 local-only; lint, tipos, audit, build, backup/restore e 50 migrations desde zero aprovados; nenhum provider, egress, banco remoto ou deploy |
| CRM-52 | CONCLUÍDA E VALIDADA LOCALMENTE | carteira acionável, planos versionados, health score determinístico com evidência/ausência separadas, RBAC, auditoria, backfill conservador, API, UI e testes | CRM-51 concluída e validada | 241 unitários, 12 integrações direcionadas e 2 E2E próprios; lint, tipos, audit, build, backup/restore e 51 migrations desde zero aprovados; nenhum provider, egress, banco remoto ou deploy |
| CRM-53 | CONCLUÍDA E VALIDADA LOCALMENTE | solicitações do cliente com owner/fila e próxima ação explícitos, SLA versionado e congelado, timeline append-only, CSAT/NPS versionados, RBAC, auditoria, métricas/drilldowns, API, UI, seed e backfill conservador | CRM-52 concluída e validada localmente | 245 unitários, 309 integrações, 4 CRM-29, 89 E2E de produção e 3 local-only; lint, tipos, audit, build, backup/restore e 52 migrations desde zero aprovados; nenhum canal/provider externo, egress, banco remoto ou deploy |
| CRM-54 | CONCLUÍDA E VALIDADA LOCALMENTE | Farmer, renovação, expansão, contração e churn confirmados por humanos, com histórico e ledger append-only | CRM-49, CRM-52 e CRM-53 concluídas e validadas localmente | 249 unitários, 309 integrações legadas + 7 Farmer, 4 CRM-29 e E2E Farmer/pagamentos aprovados; migration, seed, backup/restore, backfill e build validados; CRM-55+ não iniciadas |
| CRM-55 | CONCLUÍDA E VALIDADA LOCALMENTE | planos e quotas versionados por pessoa/equipe/função, período civil/timezone, catálogo canônico, atingimento por corte, precedência, RBAC, auditoria, UI, seed e backfill conservador | CRM-35 e CRM-49 concluídas e validadas localmente; CRM-54 preservada | 252 unitários, 314 integrações gerais + 7 Farmer, 4 CRM-29, 93 E2E de produção e 3 local-only; lint, tipos, audit, build, backup/restore e 54 migrations desde zero aprovados; nenhum forecast, provider, egress, banco remoto ou deploy |
| CRM-56 | CONCLUÍDA E VALIDADA LOCALMENTE | ciclos de forecast, submissões individuais versionadas, categorias cumulativas sem dupla contagem, pipeline ponderado condicionado à cobertura manual, override gerencial separado, snapshots imutáveis, comparação entre cortes, RBAC, auditoria, UI, seed e backfill conservador | CRM-35, CRM-49 e CRM-55 concluídas e validadas localmente; CRM-54 preservada | 255 unitários, 314 integrações gerais + 7 Farmer + 5 Forecast, 4 CRM-29, 96 E2E de produção e 3 local-only; lint, tipos, audit, build, backup/restore, seed duplo, backfill e 55 migrations aprovados; nenhum modelo preditivo, provider, egress, banco remoto ou deploy |
| CRM-57 | CONCLUÍDA E VALIDADA LOCALMENTE | catálogo versionado, métricas transversais, ponte de MRR, retenção/coortes, forecast, comparações, séries, qualidade, RBAC, APIs, UI e drilldowns sobre fatos canônicos | CRM-39, CRM-49, CRM-54 e CRM-56 concluídas e validadas localmente | 259 unitários, 329 integrações, 4 CRM-29, 98 E2E de produção e 3 local-only; lint, tipos, audit, build, 55 migrations e limpeza de schemas aprovados; nenhuma migration/backfill, provider, egress, banco remoto ou deploy |
| CRM-58 | CONCLUÍDA E VALIDADA LOCALMENTE | Home operacional por função, ação determinística, busca global server-side, Account 360 e Contact 360 com fatos canônicos, paginação, mascaramento e RBAC | CRM-42, CRM-43, CRM-52 e CRM-57 concluídas e validadas localmente | 263 unitários, 332 integrações, 4 CRM-29, 101 E2E de produção e 3 local-only; lint, tipos, audit, build, 55 migrations e zero schema residual aprovados; nenhuma migration/backfill, provider, egress, banco remoto ou deploy |
| CRM-59 | CONCLUÍDA E VALIDADA LOCALMENTE | registro canônico versionado, políticas de adapter, minimização/redação, proveniência, confirmação humana append-only, avaliações locais, observabilidade, RBAC, API/UI, migration e seed | CRM-36, CRM-37 e CRM-57 concluídas e validadas localmente | 269 unitários, 336 integrações, 4 CRM-29, 104 E2E de produção e 3 local-only; nove avaliações, lint, tipos, audit, build, backup/restore, 56 migrations e zero schema residual aprovados; nenhum provider externo, egress, banco remoto ou deploy |
| CRM-60 | CONCLUÍDA E VALIDADA LOCALMENTE | contratos OpenAPI/Zod v1, outbox allowlisted, identidade e RBAC de máquina, receitas versionadas, recibos/propostas, HMAC, idempotência, kill switch, API/UI local e migration | CRM-37, CRM-43 e CRM-59 concluídas e validadas localmente | 275 unitários, 341 integrações, 4 CRM-29, 108 E2E de produção e 3 local-only; lint, tipos, audit, build, backup/restore, 57 migrations e zero schema residual aprovados; n8n real, credencial externa, egress, banco remoto e deploy não executados |
| CRM-61 | CONCLUÍDA E VALIDADA LOCALMENTE | regras determinísticas versionadas, issues com owner/fila/SLA, reconciliação, candidatos de duplicidade, merge humano campo a campo e rollback por ledger/fingerprint, RBAC, API/UI, migration e testes | CRM-38, CRM-49 e CRM-60 concluídas e validadas localmente | 278 unitários, 345 integrações, 4 CRM-29, 111 E2E de produção e 3 local-only; lint, tipos, audit, build, backup/restore, 58 migrations e zero schema residual aprovados; limite síncrono de 2.000 registros declarado; nenhum provider, egress, banco remoto ou deploy |
| CRM-62 | CONCLUÍDA E VALIDADA LOCALMENTE | telemetria minimizada, SLI/SLO versionado, alertas/incident timeline, DSR e retenção segura, console `/operacoes`, readiness, migration aditiva, redaction central, runtime guards, RBAC e testes | CRM-50, CRM-58 e CRM-61 concluídas e validadas localmente | 285 unitários, integrações 336+7+5+3, 4 CRM-29, 114 E2E de produção e 3 local-only; lint, tipos, audit, build, backup/restore, 59 migrations e zero schema residual aprovados; nenhum provider, egress, banco remoto ou deploy |
| CRM-63 | CONCLUÍDA E VALIDADA LOCALMENTE | catálogo `resilience.v1`, RPO/RTO e runbooks; restore isolado com manifesto/checksum; matriz rollback/retry/forward-fix; fault injection protegido; concorrência; runner smoke/baseline; backpressure/degradação; aba Resiliência no console | CRM-62 concluída e validada localmente | 290 unitários, 4 integrações próprias, 27 regressões críticas e 3 E2E; lint, tipos, audit e build aprovados; restore reconciliado, smoke/baseline dentro do budget, apenas `public` e zero schema residual; nenhum provider, egress, banco remoto ou deploy |
| CRM-64 | CONCLUÍDA E VALIDADA LOCALMENTE — PRODUÇÃO NO-GO | preflight `crm64.1`, matriz de rastreabilidade, checklist de go-live, relatório de aceite e smoke final de navegação/RBAC/readiness/mobile | CRM-63 concluída e validada localmente | 11 unitários próprios, 14 integrações críticas e 3 E2E; lint, tipos, audit e build aprovados; 59 migrations, `public` íntegro e zero schema residual; nenhum deploy, egress, credencial ou banco remoto |

## Próxima task autorizada

Nenhuma task posterior está autorizada. A PROD-13.1 disponibilizou somente uma
prévia privada do staging sintético, documentada em
[`PROD13_PRIVATE_PREVIEW.md`](./PROD13_PRIVATE_PREVIEW.md). A decisão da PROD-13
permanece **NO-GO para a PROD-14**; produção real, leads reais e integrações
externas continuam bloqueados.

## PROD-13.1 — prévia privada de staging

Em 16 de setembro de 2026, a identidade autorizada `Matheus` foi criada pelo
serviço administrativo oficial somente no workspace `politizai-staging`, com
papel Administrador e AuditLog. A senha forte permanece exclusivamente no
Keychain local, na entrada documentada sem valor em
[`PROD13_PRIVATE_PREVIEW.md`](./PROD13_PRIVATE_PREVIEW.md).

O smoke remoto autenticado aprovou login, Dashboard, Meu Dia, Leads, Pipeline e
Administração, além de liveness/readiness e RBAC. A Vercel Authentication segue
ativa, a conta Vercel atual corresponde ao e-mail autorizado, as integrações
habilitadas e jobs ativos permanecem em zero e o worker automático continua
desligado. Não houve deploy, migration, seed, dado real, domínio, provider,
upgrade ou cobrança; a produção fechada não foi alterada.

## PROD-12 — release candidate fechado

O estado atual está consolidado em
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md), com
recortes especializados em
[`PROD12_MIGRATION_REPORT.md`](./PROD12_MIGRATION_REPORT.md),
[`PROD12_DEPLOYMENT_REPORT.md`](./PROD12_DEPLOYMENT_REPORT.md),
[`PROD12_ROLLBACK_REPORT.md`](./PROD12_ROLLBACK_REPORT.md) e
[`PROD12_ACCEPTANCE_REPORT.md`](./PROD12_ACCEPTANCE_REPORT.md). O deployment
permanece protegido, com 60 migrations, 298 tabelas, zero dado operacional e
workers desligados. Esta correção é somente documental.

## Snapshot histórico da PROD-11 — infraestrutura gratuita fechada

> Este bloco registra o encerramento da PROD-11, antes das migrations e do
> deployment fechado da PROD-12. Não representa o estado atual.

Em 16 de setembro de 2026 foram criados, com custo R$ 0, o projeto Vercel
`crm-politizai-production` (`prj_BJ4G7j1vgbL3tRMerhJ3MJ8f6lBS`) e o projeto
Neon `crm-politizai-production-db` (`steep-credit-26086628`) em São Paulo. O
Vercel possui Vercel Authentication, região `gru1`, zero deployments, nenhum
Git link e nenhum domínio customizado. O Neon possui banco
`politizai_production/public`, zero tabelas/migrations e owner, migrator e
runtime separados; o runtime conecta pelo pool sem DDL e a URL direta fica
somente no Keychain.

O plano Neon Free informou histórico de 6 horas e recusou proteção da branch
por limite do plano. Os workers, adapters, demo, seed e bootstrap permanecem
desligados. Não houve migration, usuário do CRM, dado real, importação de
staging, deployment, domínio, provider externo, upgrade ou cobrança. Evidência
em `PRODUCTION_INFRASTRUCTURE_REPORT.md` e `PROD11_ACCEPTANCE_REPORT.md`.

## PROD-10 — homologação completa do staging

Em 14 de setembro de 2026, a homologação congelou primeiro o checkpoint
`51bbbe0ede6ebee3b2d8121c4b6ad913e38d0c4b`. O teste WebKit encontrou uma
incompatibilidade do cookie local em build de produção; a correção preserva
`Secure` obrigatório em staging/produção e gerou o novo candidato técnico
`a642fd5a998e8a9ebdfac426613c6260dfbac35e`.

O CI 34916132608 aprovou instalação determinística, scanner, Prisma, 60
migrations desde zero, lint, typecheck, 348 testes unitários, 51 integrações
críticas, audit, build Webpack, smoke, SBOM e limpeza. O deployment protegido
`dpl_Hysue6xdQ9rZueirmjxrijERKZxw`, em `gru1`, ficou `READY`. Health,
readiness, login/logout, páginas obrigatórias, headers, métricas e drilldown
foram validados. O rollback remoto para o deployment anterior preservou os dois
leads sintéticos, e a promoção do candidato foi concluída em seguida.

O E2E cross-browser passou 9/9 cenários em Chromium, Firefox e WebKit. Os
baselines locais de carga e soak executaram 83.942 e 61.363 operações,
respectivamente, sem erros. Fault injection, restore local isolado, worker
transitório contra Neon, replay idempotente, backlog zero e shutdown gracioso
passaram. Nenhum schema temporário permaneceu.

A correção posterior `0233cb0` criou uma identidade sintética de closer por
bootstrap idempotente/auditado, validou login e escopo remotamente, executou
burst e soak somente leitura com 140/140 respostas 200 e repetiu o restore Neon
após a migration 60. A branch temporária reconciliou 298 tabelas, contagens e o
fingerprint `f519eaca4fa123f9b56730051db8bab1`, sendo removida em seguida.

A correção dirigida preservou o diff do commit `5eaa7a9`, concluiu o kill
switch em `476b3e2` e corrigiu a fixture incompleta do Pipeline em `c5ad0b5`.
Os CIs 35034243590 e 35035561582 passaram. O endpoint serverless no mesmo SHA da
web rejeitou ausência/erro de autenticação, query e kill switch; habilitado em
janela controlada processou um job sob duas chamadas concorrentes sem duplicar
efeito, e o replay ficou ocioso. Ao final voltou a `false`.

O erro do Pipeline era determinístico: o homologador criava somente `NEW`; o
serviço recusava as outras sete etapas ausentes. A fixture agora garante as
oito etapas, 23 transições e motivo sintético sem alterar regras comerciais. A
regressão e o smoke remoto de Quadro/Lista/filtros/transições/RBAC passaram.

O fault lab Neon `prod10-fault-*` provou health 200/readiness 503 durante a
falha e 200 após a recuperação; o job permaneceu pendente e retomou uma única
vez. Branch, papel, proxy, certificado e referências temporárias foram
removidos. VoiceOver real e zoom real de 200% passaram nas jornadas centrais.
Matheus Mendonça foi designado para as seis funções operacionais de staging,
com concentração aceita somente neste ambiente.

A decisão é **HOMOLOGADA PARA STAGING GRATUITO / NO-GO PARA PROD-11**. Falta
worker automático 24×7 equivalente à produção. Nenhum recurso de produção,
domínio, dado real, integração externa, upgrade ou cobrança foi criado.

## PROD-08 — worker de staging em modo transitório

Em 14 de setembro de 2026, o alvo foi confirmado como Neon STAGING,
`politizai_staging/public`, TLS e endpoint pooled, fingerprint não sensível
`04711a1fdab8d279`. O inventário anterior tinha backlog zero. O novo homologador
recusa produção, host/banco/schema inesperado, `DIRECT_URL`, adapter habilitado,
worker desligado ou confirmação ausente.

Um único job sintético de chave estável foi preparado e processado pelo
entrypoint `pnpm worker`, com ID operacional
`prod08-staging-transient-job`. O processo iniciou, executou o job e encerrou
por `SIGTERM` com código zero. A verificação persistida encontrou Job e Run
`SUCCEEDED`, uma tentativa, um recibo de efeito, uma execução para a chave,
backlog zero, regra sintética pausada e `externalEgress=false`. O fingerprint do
ensaio foi `fc98791f77366be7f105`.

Os 8 testes dirigidos do motor aprovaram job normal, retry/backoff, falha
terminal, replay autorizado, dois workers com `SKIP LOCKED`, lock expirado,
duplicidade, agendamento/cancelamento, regra inativa e RBAC. O contrato do
homologador teve 6 testes aprovados. A implantação persistente Fly.io definida
na PROD-02 foi deliberadamente diferida por custo; não houve troca silenciosa
para Cron, nem criação de serviço remoto. Auto-restart, health externo e
operação contínua continuam obrigatórios antes de produção. Evidências e
procedimento estão em [`STAGING_WORKER_REPORT.md`](./STAGING_WORKER_REPORT.md).

## PROD-07 — web de staging na Vercel

Em 14 de setembro de 2026, o projeto isolado `crm-politizai-staging` foi criado
no mesmo team Hobby onde o Opadillis foi inspecionado somente como referência.
O repositório privado `Menddon/crm-politizai` foi conectado sem copiar `.vercel`,
IDs, tokens, variáveis ou segredos do outro produto. Node 22, pnpm 11, Webpack e
funções `gru1` foram confirmados.

As variáveis foram limitadas ao ambiente estável deste projeto de staging;
`DATABASE_URL` pooled ficou como Secret e `DIRECT_URL` não foi configurada. As
flags de worker, adapters externos, demo, seed e bootstrap permanecem
desabilitadas. Vercel Authentication protege todos os deployments, protected
sourcemaps e fork protection estão ativos, não há exceção pública nem custom
domain, e o bypass temporário usado pelos testes foi revogado.

O deployment do commit técnico `afee0bdc9887e9b8d9cff7ab9d46d09f3982c3e1`
ficou `READY` sob o identificador `dpl_EYqj4PBVS9jNPpvEfCFgPCJGcxay`. Liveness,
readiness/PostgreSQL, TLS, headers, login sintético, cookie seguro, sessão, RBAC,
Dashboard, Leads, Meu Dia e API administrativa foram aprovados. O acesso sem
autenticação foi redirecionado à Vercel Authentication. O readiness teve uma
falha transitória na retomada do Neon Free e retornou `ok` na repetição.

A entrada web revelou que o dataset homologado não possuía ator `AUTOMATION`.
O homologador passou a preparar esse ator de forma idempotente e auditada; as
tentativas falhas não deixaram lead parcial. Depois da correção, a criação
sintética retornou HTTP 201 e a busca após novo deployment retornou exatamente
um registro, comprovando persistência. Os logs finais somaram 25 entradas, zero
5xx e nenhuma URL PostgreSQL, senha, token ou chave detectada.

O serviço Render gratuito anterior foi preservado com auto-deploy desligado.
Não houve projeto de produção, domínio público, worker, provider externo ou
egress comercial. Evidências e limites completos estão em
[`STAGING_DEPLOYMENT.md`](./STAGING_DEPLOYMENT.md).

## PROD-06 — migrations, dataset sintético e restore de staging

Em 14 de setembro de 2026, o preflight retornou `READY_FOR_STAGING` para o
projeto Neon `crm-politizai-staging-db`, banco `politizai_staging/public`, AWS
São Paulo, PostgreSQL 18.6, com fingerprint não sensível
`bcee0b8b790c27ab`. O banco já possuía 59 migrations e o bootstrap sintético da
sobreposição gratuita; esse estado foi preservado e documentado, sem reset para
simular um vazio que não existia no início formal da task.

`pnpm db:migrate:deploy` e `pnpm db:status` confirmaram zero migration pendente
e nenhuma reaplicação. O histórico registra 84,415 s somados e a migration mais
lenta, `20260910005226_relational_foundation`, em 9,732 s. A validação final
teve zero erro e zero lock aguardando.

Foi adicionado um homologador de staging com trava de ambiente e confirmação
explícita. Ele criou somente duas identidades sintéticas sem credenciais, a
estrutura operacional mínima e um lead sintético pelo serviço real de entrada.
Duas execuções mantiveram 1 lead, 3 membros e 1 equipe; RBAC, bloqueio
cross-workspace, responsável explícito, próxima ação, tarefa imediata, SLA,
timeline, auditoria e idempotência foram aprovados diretamente no banco remoto.
O runtime possui DML, mas não CREATE/DDL/TRUNCATE/TRIGGER nem membership de
owner.

O branch efêmero `prod06-restore-20260914-1640` reproduziu 59 migrations, 1
workspace, 3 membros, 1 lead, 3 atividades, 1 tarefa, 8 audit logs e o mesmo
checksum MD5 dos IDs de lead (`1aff67a9841daaf93a3c51b5f2e6382b`). O branch
foi excluído após o ensaio e o principal permaneceu íntegro. O relatório e os
runbooks de rollback/recuperação estão em
[`STAGING_DATABASE_REPORT.md`](./STAGING_DATABASE_REPORT.md). Não houve deploy,
worker, dado real, egress, produção ou task posterior.

Antes do push, o auto-deploy do serviço Render preexistente foi desativado para
impedir publicação fora do escopo; a PROD-07 deverá autorizar explicitamente o
próximo deployment. O aviso não bloqueante de depreciação do `pg` permaneceu
registrado para saneamento antes da versão 9.

Os gates finais aprovaram lint, tipos, 337 unitários, 51 integrações críticas,
o bootstrap isolado, 4 testes de resiliência, build, auditoria de dependências,
scanner de 968 arquivos e descarte dos schemas efêmeros. O agregador amplo de
integração misturou bootstrap e resiliência no schema geral e retornou status 1;
os dois passaram em seus runners isolados, e a limitação do agregador ficou
registrada no relatório sem ser ocultada. O CI remoto do commit técnico foi
aprovado na execução
[34890542908](https://github.com/Menddon/crm-politizai/actions/runs/34890542908).

## PROD-05 — PostgreSQL gerenciado de staging

Em 14 de setembro de 2026, a continuação explicitamente autorizada confirmou o
projeto Neon Free `crm-politizai-staging-db` no projeto isolado
`hidden-mode-30035631`, organização `CRM Politizai Free`, região AWS São Paulo.
O banco-alvo é `politizai_staging`, schema `public`, PostgreSQL 18. Owner,
migrator e runtime usam credenciais separadas armazenadas fora do Git. O item
local do owner foi corrigido para apontar para o banco-alvo, sem alterar senha.

As três conexões negociaram TLS e usam `sslmode=verify-full` com channel binding.
O runtime usa endpoint pooled, possui DML efetivo nas 297 tabelas e não possui
DDL, `TRUNCATE`, `TRIGGER`, superuser, criação de banco/papel, replicação ou
bypass de RLS. O migrator usa endpoint direto e possui apenas o DDL necessário
no schema. Foram persistidos: runtime com limite 20, statement timeout 15s,
lock timeout 5s e transação ociosa 30s; migrator com limite 5, lock timeout 10s
e transação ociosa 2min. A aplicação permaneceu pronta após reciclagem de uma
conexão pooled ociosa.

O console confirmou plano Free, compute 0,25–2 CU, 100 CU-horas/mês por projeto,
0,5 GB, 5 GB de transferência e restore contínuo por 6 horas. Snapshots manuais
estão disponíveis; agendamento requer upgrade e não foi contratado. O painel de
consumo substitui alertas pagos nesta fase. Não há autorização para cobrança.

Inventário final: 297 tabelas, 59 migrations, 1 workspace, 1 usuário sintético,
0 equipes, 0 leads, 0 atividades, 0 oportunidades e 2 logs de auditoria. O
ambiente já estava inicializado pela sobreposição gratuita anterior; por isso o
estado vazio não foi recriado destrutivamente. Nenhuma migration, seed,
backfill, restore, cópia de dados, banco de produção ou task posterior foi
executada na retomada.

## Auditoria preliminar histórica anterior à PROD-13 atual

> O conteúdo abaixo registra um gate preliminar executado antes da
> infraestrutura e do release candidate atuais. Ele permanece como histórico,
> mas não constitui a execução atual da PROD-13, agora registrada no relatório
> `PROD13_FINAL_GO_NO_GO.md`.

Em 14 de setembro de 2026, a auditoria congelou como release candidate técnico
o commit `53e1e1252282bdedd35bffbd9087026743e72132`. O CI `34856733334` e o gate
manual `34856766713` estavam verdes, mas a API do GitHub retornou zero
deployments e não existem recursos Vercel, Neon ou Fly.io do CRM.

O preflight local retornou `READY_FOR_LOCAL`, o scanner aprovou 963 arquivos,
31 testes direcionados de preflight/repositório/headers/request/privacy passaram
e o smoke local aprovou liveness, readiness, banco, login e headers. Evidências
anteriores do mesmo SHA foram reutilizadas; nenhuma suíte histórica completa
foi repetida.

A decisão é **NO-GO**: staging e produção inexistem; backup/PITR/restore,
rollback remoto, web/worker, SLOs, alertas, WAF/rate limit distribuído,
multibrowser, carga/soak, identidade administrativa, MFA/SSO, jurídico/DPO e
owners operacionais não possuem evidência de aprovação. Nenhum risco produtivo
foi aceito. Nenhum deploy, migration, seed, DNS, egress ou provider foi
executado.

## PROD-04 — CI/CD, supply chain e gates de release

Em 14 de setembro de 2026, a task partiu de `main` limpo no commit
`4871b15d33d5ed85dc7bf97134fca479260721e0`, igual a `origin/main`, com a
PROD-03 concluída e validada. O CI instala com lockfile, migra um PostgreSQL
efêmero desde zero, executa scanner, lint, `next typegen`, TypeScript, 329
unitários, 51 integrações críticas, audit, build Webpack e smoke. Schemas de
integração usam o lifecycle controlado existente; a limpeza final encontrou zero
schema residual.

A execução `34855240497` bloqueou corretamente no primeiro typecheck porque o
heap padrão de aproximadamente 2 GiB do Node foi esgotado (`exit 134`). O gate
publicou relatório `BLOCKED`, executou limpeza e não prosseguiu com testes ou
build. O heap foi limitado a 4 GiB e as actions com aviso de runtime Node 20
foram atualizadas para versões correntes fixadas por SHA. A execução seguinte,
[34855726325](https://github.com/Menddon/crm-politizai/actions/runs/34855726325),
passou integralmente em 6m41s no commit
`5cb770303b6ccad408cc9445a10d8a81dd5e95db`.

O artefato privado `10353311278` contém relatório `APPROVED` e SBOM SPDX 2.3
com 751 pacotes. A cópia baixada foi validada contra o SHA e as garantias
negativas de deploy/migration remota. Dependabot alerts, automated security
fixes e atualização semanal de npm/actions estão ativos. O usuário autenticado
possui `ADMIN`, mas GitHub respondeu `403` para ruleset e branch protection em
repositório privado no plano atual; a configuração manual pós-upgrade está em
`docs/CI_CD.md`. O repositório permaneceu privado.

Nenhuma migration foi criada nesta task. Nenhuma task posterior, migration
remota, banco remoto, secret de nuvem, publicação ou deploy foi iniciado.

## PROD-03 — hardening e compatibilidade com nuvem

Em 14 de setembro de 2026, a task partiu do commit
`767d0aca12ddc85efd4bf1a4b532690e3b567951`, limpo em `main` e igual a
`origin/main`, com a PROD-02 concluída. As evidências anteriores foram
reutilizadas; nenhuma suíte histórica completa foi repetida.

O contrato `prod03.1` diferencia `local`, `test`, `staging` e `production`, além
dos papéis `web`, `worker`, `migration` e `bootstrap`. Local/test recusam banco
remoto. Staging/produção não recebem defaults silenciosos: exigem HTTPS,
allowlists, timezone, cookies, logs, modo de adapters, flags de demonstração e
expectativas de host/banco/schema/TLS. Web, worker e bootstrap aceitam somente
`DATABASE_URL` pooled; apenas o papel isolado de migration exige uma
`DIRECT_URL` distinta. O preflight devolve `READY_FOR_LOCAL`,
`READY_FOR_STAGING`, `READY_FOR_PRODUCTION` ou `BLOCKED` sem serializar valores.

O seed demonstrativo passou a bloquear explicitamente staging/produção. O
bootstrap inicial é uma CLI sem rota HTTP, com confirmação literal, segredo
efêmero, senha forte, chave de idempotência, lock PostgreSQL e transação
serializável; ele só aceita uma base sem workspaces/usuários e grava marcador
append-only com fingerprints, não credenciais. O teste relacional o executou em
schema efêmero; nenhum usuário foi criado no schema `public`.

`/api/health` agora é liveness sem dependências e `/api/ready` consulta somente
o PostgreSQL necessário. As páginas recebem CSP com nonce, proteção contra
framing/MIME sniffing, política de referrer e permissions policy; HSTS é
condicional a staging/produção com URL HTTPS. `style-src 'unsafe-inline'`
permanece como dívida explícita porque componentes existentes ainda usam
estilos inline.

Passaram: 43/43 testes unitários direcionados; 1/1 integração do bootstrap e
6/6 E2E de fundação, ambos com as 59 migrations e descarte dos schemas em
`finally`; `pnpm lint` sem avisos;
`pnpm typecheck`; `pnpm audit` sem vulnerabilidades conhecidas;
`pnpm readiness:preflight` com `READY_FOR_LOCAL`; `pnpm db:test:cleanup` com
zero candidato; e `pnpm build` via Webpack. O smoke em porta local isolada
retornou HTTP 200 em health/readiness, banco `ok` e os headers esperados no
login. Nenhuma migration foi criada ou aplicada ao `public`.

Durante os gates, arquivos de dependências e cliente Prisma marcados como
`dataless` pelo iCloud faziam os processos de lint/tipo travarem sem CPU. As
mesmas versões foram reidratadas exclusivamente do store local com
`pnpm install --offline --frozen-lockfile --config.package-import-method=copy`,
o cliente foi regenerado e os artefatos antigos foram removidos de `.tmp` após
os gates. O lockfile não mudou.

`vercel.json` fixa Next.js, `gru1` e duração de funções; `package.json` já fixa
Node 22, pnpm 11 e build Webpack. Não foi criado cron, processo remoto, provider,
projeto Vercel, banco, secret ou deployment. Produção continua em NO-GO até os
gates humanos e técnicos documentados e uma autorização explícita posterior.

## PROD-02 — arquitetura definitiva de nuvem e plano de publicação

Em 14 de setembro de 2026, o baseline
`bcc41c8c32ce19194755f848f822183ba4d45ccd` estava limpo, no branch `main` e
sincronizado com `origin/main`. A task reutilizou as evidências de CRM-64 e
inspecionou código, worker, conexão Prisma, migrations, runtime guards,
readiness e documentos de produção, sem repetir suítes históricas.

A estrutura do Opadillis foi consultada somente em modo read-only. Identificou-se
conta pessoal no plano Hobby, projeto `opadilis`, GitHub `Menddon/opadilis`,
Functions em `iad1`, Fluid Compute e proteções Vercel. Nenhum project/org ID,
token, variável, segredo ou conteúdo de `.vercel` foi copiado.

A decisão registrada usa Vercel Pro em `gru1` para web/APIs, dois projetos Neon
Launch independentes em `sa-east-1` para PostgreSQL e dois apps Fly.io em `gru`
para worker persistente. Vercel Cron foi rejeitado como runtime principal porque
o worker validado usa polling de um segundo, processa várias filas e precisa de
latência mais previsível; o Cron Pro tem precisão por minuto e requer runner
HTTP bounded. PostgreSQL permanece fila/lock, sem Redis ou novo broker.

Os documentos definem `DATABASE_URL` pooled, `DIRECT_URL` restrito a migrations
e backup, promoção expand/contract, secrets separados, PITR/snapshots/cópia
off-provider, restore isolado, rollback, observabilidade, custos e gates humanos.
A execução exata PROD-03→PROD-10 está planejada, mas nenhuma task posterior foi
iniciada. A produção permanece NO-GO.

## CRM-64 — homologação e aceite de prontidão

Em 13 de setembro de 2026, o baseline
`8fe89aee199bbffc982709ed112ab83aa147181d` estava limpo, sincronizado com
`origin/main` e continha a CRM-63 concluída e validada localmente. A CRM-64 foi
executada como gate final, sem migration, backfill, seed no `public`, provider,
credencial, egress, banco remoto ou deploy.

O contrato `crm64.1` e a CLI `pnpm readiness:preflight` bloqueiam produção,
banco remoto, override remoto, banco/schema inesperado, timezone divergente,
credencial externa conhecida, adapter externo e nome sensível exposto ao
cliente. O gate local terminou com dez checks `PASS`. Seus 11 cenários unitários
passaram e confirmaram que nenhum valor de segredo é serializado.

A integração dirigida aplicou as 59 migrations desde zero em schema efêmero e
passou 14/14 testes de autenticação, RBAC, workspace, redaction, SLO, rate limit
e runtime guard. O smoke E2E passou 3/3 após tornar explícita a espera pelo fim
do shell de loading; percorreu Home, Dashboard, Meu Dia, Leads, Pipeline,
Agenda, Oportunidades e Operações, confirmou `/api/ready`, negativa por URL ao
Visualizador e quatro fluxos em 390×844 sem overflow. O build Webpack incluído
no runner passou.

Também passaram lint, typecheck, audit, `db:status` e limpeza dry-run. A primeira
execução do typecheck revelou somente uma indexação imprecisa no parser novo da
versão Node, corrigida e revalidada. `public` permaneceu como único schema não
sistêmico, com 59 migrations, 297 tabelas, 99 workspaces, 146 usuários, 146
memberships, 533 leads, 1.195 atividades, 62 oportunidades e 3.327 AuditLogs. O
fingerprint dos IDs de lead permaneceu
`2c829e462f608b815ec33f26c783bcfb`.

A decisão final é **READY_FOR_LOCAL_STAGING** para homologação local/isolada e
**NO-GO para produção**. Jurídico/DPO, infraestrutura equivalente, secret
manager, banco gerenciado/TLS/PITR, rate limit e observabilidade distribuídos,
SAST/DAST/pentest, multibrowser, carga/soak/failover, operação/on-call e
homologações de providers permanecem blockers explícitos. A evidência detalhada
está em `docs/PRODUCTION_READINESS.md`, `docs/GO_LIVE_CHECKLIST.md` e
`docs/ACCEPTANCE_REPORT.md`.

## CRM-63 — recuperação, concorrência e testes de carga isolados

Em 13 de setembro de 2026, a CRM-63 partiu do commit
`ea82a2544be4ec66741d73354bcc864bd3534b85`, igual à `origin/main`, com a CRM-62
concluída e validada localmente. Não houve migration: o catálogo e os contratos
são versionados no código, e o Console de Operações reutiliza a telemetria já
persistida, mantendo “Sem ensaio” quando não há evidência do workspace.

O catálogo `resilience.v1` registra criticidade, RPO/RTO propostos, dono e sete
runbooks. A matriz distingue rollback anterior ao commit, retry idempotente após
resultado ambíguo, forward-fix e revisão humana quando há violação de
invariantes. Fault injection exige simultaneamente `NODE_ENV=test`, flag
explícita e schema `politizai_test_resilience_*`; não existe caminho de falha no
runtime normal. Backpressure mantém escritas críticas e reduz ou rejeita apenas
trabalho não crítico de acordo com espera de pool, backlog e taxa de erro.

O primeiro restore controlado revelou `schema "public" already exists` no banco
descartável recém-criado pelo PostgreSQL 17. O `finally` removeu o alvo e a causa
foi corrigida com `pg_restore --clean --if-exists` restrito ao banco temporário.
Na repetição, `.cache/resilience/backups/public-crm63.dump` ficou com 4.410.793
bytes e SHA-256
`72dba41307d4a6ff807d259d1891eb81046dbccfa96a82ea1f07673ba07d0742`.
PostgreSQL 17.10 restaurou e reconciliou 64 linhas de migrations, 99 workspaces,
146 usuários, 146 memberships, 533 leads, 1.195 atividades, 62 oportunidades e
3.327 logs de auditoria; o banco temporário foi removido. O dump e o manifesto
ficam em `.cache`, ignorados pelo Git.

O smoke local (2 s, concorrência 2, seed 63001) executou 4.763 operações, 2.381,5
ops/s, p95 1,68 ms, zero erro/timeout e backlog 0→0. A baseline (10 s,
concorrência 8, mesma seed) executou 42.676 operações, 4.267,17 ops/s, p95 3,10
ms, zero erro/timeout, pool sem espera e backlog 0→0. Ambos ficaram dentro dos
budgets locais. Eles medem SQL/fundação em hardware local e não certificam HTTP,
rede, provedor ou capacidade de produção.

Passaram `pnpm test:resilience` (5/5), `pnpm test:resilience:integration` (4/4),
as regressões críticas de intake/worker/pagamentos/operações (27/27), a suíte
unitária atual (290/290), o E2E do Console de Operações (3/3), `pnpm lint`,
`pnpm typecheck`, `pnpm audit`, `pnpm build` via executor E2E, `pnpm db:status` e
o dry-run de limpeza. Ao final, existe somente `public`, zero schema de teste é
removível e as contagens do banco principal permanecem iguais ao fingerprint do
restore. Avisos conhecidos do loader futuro do Vite, do `pg`, do stream do Next
e de `NO_COLOR` não causaram falha.

Não houve migration, provider, credencial, egress, banco remoto, deploy,
execução destrutiva contra `public` ou início da CRM-64.

## CRM-60 — extensibilidade segura via n8n

Em 13 de setembro de 2026, a CRM-60 partiu do commit
`0115640e7be4636b0fc32ad80cac1bf8508018d4`, igual à `origin/main`, com CRM-37,
CRM-43 e CRM-59 concluídas e validadas localmente. A implementação ficou
restrita a APIs/outbox, identidade de máquina, contratos versionados e simulador
local; CRM-61 e posteriores não foram iniciadas.

O painel `/integracoes/n8n` usa o rótulo “Sandbox local — n8n não conectado” e
expõe identidade com owner humano, escopos mínimos, expiração, rotação, kill
switch, catálogo curto de receitas e propostas para decisão humana. Eventos
saem somente do outbox allowlisted e minimizado. Comandos locais exigem HMAC,
timestamp, nonce, idempotência, correlação e profundidade de causação; resultado
técnico gera recibo, enquanto rascunho ou ação consequencial para em proposta.
Nenhuma aprovação executa mutação ou contorna o serviço de domínio.

A migration `20260913420000_n8n_governed_sandbox` foi aplicada desde zero nos
executores efêmeros e no `public` local. Antes do deploy local foi criado o dump
ignorado `.backups/crm60/public-before-crm60-20260913T1925.dump`, com 4.277.405
bytes e SHA-256
`6fb9ffe96b9d62a7f5e4280fa861516df9da23d1a524c0d82b630f317a7f6209`.
A restauração isolada reconciliou `99/146/533/3324/61` para workspaces, usuários,
leads, auditorias e linhas de migration, além de 273 tabelas; o banco temporário
foi removido. O seed executado duas vezes manteve as mesmas contagens e não criou
identidade ou receita sem ação administrativa explícita.

Passaram 275/275 testes unitários, 341/341 de integração, 4/4 CRM-29, 108/108
E2E de produção e 3/3 local-only, além de lint, typecheck, audit, build e status
das 57 migrations. O primeiro teste direcionado revelou ordem incorreta no
cenário de escopo ainda em `DRAFT`; o cenário foi corrigido. A primeira regressão
integral revelou a expectativa antiga de 424 concessões; as três permissões da
CRM-60 adicionam cinco grants válidos, e a expectativa foi atualizada para 429.
Não houve n8n/provider real, segredo externo, egress, banco remoto, deploy,
execução da PROD-01 ou início da CRM-61.

## CRM-59 — IA governada e avaliações locais

Em 13 de setembro de 2026, a CRM-59 partiu do commit
`530383a3c16a494da5b96c9c7ea9dfe75fe2bddd`, igual à `origin/main`, com CRM-36,
CRM-37 e CRM-57 concluídas e validadas localmente. O escopo ficou restrito à
fundação governada; CRM-60 e tarefas posteriores não foram iniciadas.

`AIUseCaseVersion` registra configuração, responsável, risco, provider/modelo
lógicos, prompt, contratos, allowlist, confiança, fallback e limites. Conteúdo
publicado é protegido contra reescrita; avaliação, aprovação, desativação e
rollback deixam eventos e auditoria. O runtime só seleciona versão `APPROVED` e
o adapter padrão permanece o `MockAIProvider`, local e determinístico.

Antes do adapter, a política remove campos proibidos, redige PII/segredos,
neutraliza prompt injection e persiste somente fingerprints e metadados seguros.
`AIExecutionTrace` separa execução, falha e fallback. Decisões humanas aceitas,
editadas ou rejeitadas são idempotentes e append-only; fingerprint divergente
marca a sugestão como obsoleta e nenhuma mutação comercial é realizada pelo
ledger de governança.

O dataset `politizai-ai-governance@1` cobre contrato estrito, grounding,
isolamento, PII, segredo, injection, recusa de mutação, baixa confiança e
orçamento. A página `/governanca-ia` expõe versões, avaliações, sucesso/falha,
fallback, latência e alertas sem serializar payloads. Gestor lê e avalia;
Administrador também publica, desabilita e faz rollback; demais papéis não
contornam o RBAC por URL.

A migration `20260913400000_ai_governance_evaluations` foi aplicada por
`prisma migrate deploy` e validada desde zero pelos executores efêmeros. O
`prisma migrate dev` não foi usado para corrigir o drift preexistente da FK de
`marketing_campaigns`; nenhum reset foi autorizado ou executado. Como a
tentativa inicial já havia aplicado a migration antes do checkpoint de backup,
foi criado o dump pós-migration ignorado
`.backups/crm59/public-after-crm59-20260913.dump`, SHA-256
`dbc872ac4fdd7c78702b49f9cd9b8005f706d61b51ce02f2b93b8b0b26886b7e`, com
4,1 MiB. A restauração em `crm59_restore_validation` reconciliou migrations,
workspaces, leads, casos de uso, traces e avaliações (`61/99/533/4/0/4`); o
banco temporário foi removido.

Passaram 269/269 testes unitários, 336/336 de integração, 4/4 CRM-29, 104/104
E2E de produção, 3/3 local-only e 3/3 E2E direcionados finais. Também passaram
`pnpm test:ai:evals` com 9/9 casos, lint, typecheck, audit, build, validação do
schema, status das 56 migrations e dry-run de limpeza com zero schema residual.
O primeiro lint detectou JSX dentro de `try/catch` na nova página; o carregamento
protegido foi isolado e todos os gates posteriores passaram. Não houve provider
externo, credencial, egress, banco remoto, deploy, execução da PROD-01 ou início
da CRM-60.

## CRM-58 — experiência operacional por função e entidades 360

Em 13 de setembro de 2026, a CRM-58 partiu do commit
`b6ba83322c901c61f432f62de25bea8fb7338de4`, igual à `origin/main`, com CRM-42,
CRM-43, CRM-52 e CRM-57 concluídas e validadas localmente. A CRM-59 e tarefas
posteriores não foram iniciadas.

A raiz autenticada agora entrega uma Home orientada à função ativa para SDR,
Closer, Farmer, Customer Success, Gestão e Administração. Cada visão apresenta
uma ação principal e uma fila curta ordenadas deterministicamente por risco,
prazo e ID. Usuários multifunção alternam somente entre visões autorizadas;
escopo, horário, cobertura parcial e ausência de dado são explícitos.

A busca global `Ctrl/Cmd+K` consulta conta, contato, lead e oportunidade no
servidor, aplica workspace e `OWN`/`TEAM`/`WORKSPACE` na própria query, limita e
pagina resultados e mascara telefone/e-mail antes da serialização. O diálogo
possui debounce, cancelamento, foco contido, Escape e retorno do foco. Account
360 e o novo Contact 360 agregam identidade, ownership, jornada, negócios,
receita, atendimento e timelines paginadas a partir das fontes canônicas, sem
duplicar fatos nem inferir relações ausentes.

Passaram `pnpm lint`, `pnpm typecheck`, 263/263 testes unitários, 332/332 de
integração, 4/4 CRM-29, `pnpm audit`, `pnpm build`, `pnpm db:status` e o dry-run
de limpeza com zero schema residual. O primeiro E2E integral encontrou três
incompatibilidades de apresentação: duas asserções antigas ainda esperavam o
Dashboard na raiz e a Conta 360 repetia a mesma mensagem de ownership. Após a
correção restrita, 8/8 testes direcionados e a repetição integral passaram com
101/101 E2E de produção e 3/3 local-only.

Nenhuma migration ou backfill foi necessária. Não houve provider, credencial,
egress, banco remoto, deploy nem execução da CRM-59.

## CRM-57 — camada completa de métricas de receita

Em 13 de setembro de 2026, a CRM-57 partiu do commit
`54943088ab96fb326892cc0584c8d8f9e03c8164`, igual à `origin/main`, com CRM-39,
CRM-49, CRM-54 e CRM-56 concluídas e validadas localmente. O escopo permaneceu
restrito à camada de métricas; a CRM-58 e posteriores não foram iniciadas.

O catálogo executável `crm57.1` centraliza definição, fonte, numerador,
denominador, fórmula, timestamp, período, timezone, corte, coorte, filtros,
cancelamento, reversão, deduplicação, cobertura, limitação, comparação,
drilldown, permissão e direção desejável. `RevenueMetricsService` compõe fatos
persistidos de aquisição, funil, contratos, ledger de MRR, pagamentos,
renovações, churn, metas e snapshots de forecast. A ponte de MRR é reconciliada;
GRR/NRR usam coorte inicial; dinheiro permanece em centavos; zero, denominador
ausente, indisponível, não aplicável, parcial e suprimido não são confundidos.

A página `/metricas-receita` e seis endpoints protegidos entregam resumo,
comparativos, séries civis, coortes, forecast, qualidade, catálogo e drilldowns
paginados. Período e filtros são preservados na navegação. Custo agregado de
mídia é suprimido fora de `WORKSPACE`; combinações sem atribuição segura ficam
`NOT_APPLICABLE`. Não existe cálculo em componente, exportação, modelo
preditivo nem causa inferida por correlação.

Passaram `pnpm lint`, `pnpm typecheck`, 259/259 testes unitários, 329/329 de
integração, 4/4 CRM-29, 98/98 E2E de produção, 3/3 local-only, `pnpm audit`,
`pnpm build`, `pnpm db:status` e o dry-run de limpeza com zero schema residual.
Um primeiro E2E apresentou falha transitória no cenário legado de auditoria;
sem alteração nesse módulo, o arquivo isolado passou 2/2 e a repetição integral
passou 98/98. A tela foi inspecionada autenticada em desktop e o E2E próprio
validou desktop/mobile sem overflow e com supressão por escopo.

Nenhuma migration, backfill, backup ou restauração foi necessária: a task só
consulta fatos canônicos já persistidos. Não houve provider, credencial, egress,
banco remoto, deploy ou execução/revalidação da PROD-01.

## CRM-56 — forecast e snapshots reproduzíveis validados localmente

Em 13 de setembro de 2026, a CRM-56 partiu do commit
`f9ca34be0efc572deffdc64ea813b1d6b6f9bea7`, igual à `origin/main`, com CRM-35,
CRM-49 e CRM-55 concluídas no checkpoint. O escopo permaneceu restrito ao
forecast reproduzível: tarefas CRM-57+, modelo preditivo, provider, credencial,
egress, banco remoto e deploy não foram iniciados.

Foram adicionados ciclos com período civil e timezone, submissões individuais
versionadas, itens por oportunidade e categorias exclusivas (`PIPELINE`,
`BEST_CASE`, `COMMIT`). Os totais são cumulativos por definição: pipeline inclui
todas as categorias, best case inclui best case e commit, e commit inclui apenas
commit. Cada oportunidade aparece uma única vez por snapshot. O pipeline
ponderado só é calculado quando todas as oportunidades do corte possuem
probabilidade manual, ator e timestamp; cobertura parcial continua explícita e
não é convertida em zero. O override do gestor é persistido separadamente do
bottom-up e nunca o reescreve.

Submissão, revisão e consolidação usam transação serializável, advisory lock,
retry limitado, revisão otimista e chave idempotente. O closer opera somente o
próprio recorte; gestor/admin consolidam; visualizador permanece somente leitura.
Snapshots e itens são append-only por trigger, guardam valores BRL em centavos,
versão da regra, cobertura, fingerprint SHA-256 e fatos do corte. Comparações
informam valores, deltas, movimentos e ausência de denominador sem criar
percentual falso.

Antes da migration, o backup ignorado
`.backups/crm56/public-before-crm56-20260913.dump` foi criado com SHA-256
`6e4026fd8ebaa8a6965d2a5a754932b64227ef3d174bd4f38a6e609a9d39dd42`, tamanho
aproximado de 4 MiB e 3.385 entradas validadas por `pg_restore --list`. A
restauração estrita em banco isolado reconciliou 260 tabelas, 54 migrations, 533
leads, 146 usuários, 18 equipes, 1.195 atividades, 62 oportunidades e 3.320 logs
de auditoria. Os fingerprints de IDs de Lead e Opportunity foram,
respectivamente, `2c829e462f608b815ec33f26c783bcfb` e
`fdeee1cebbcc1d0507cd395b5ed1f3b9`; o banco temporário foi removido.

A migration aditiva elevou `public` para 267 tabelas e 55 migrations. O seed
executado duas vezes manteve exatamente um ciclo, três submissões, seis itens de
submissão, dois snapshots e cinco itens de snapshot. O corte 1 consolidou
pipeline de R$ 11.150,00 e best case de R$ 7.750,00; o corte 2 consolidou
pipeline de R$ 19.000,00, best case de R$ 11.250,00, commit bottom-up de
R$ 3.500,00 e override gerencial de R$ 4.000,00. O número de oportunidades
distintas coincide com o número de itens em ambos os cortes.

O backfill público foi conservador: dry-run e execução encontraram zero fato
legado seguro para materializar; a repetição da mesma chave retornou replay sem
novo efeito. O estado final manteve 533 leads, 146 usuários, 18 equipes, 1.195
atividades e 62 oportunidades, com os mesmos fingerprints; apenas dois logs
append-only do ciclo de backfill elevaram a auditoria a 3.322. Não restou schema
temporário fora de `public`.

A validação final aprovou `pnpm lint`, `pnpm typecheck`, 255 testes unitários,
314 integrações gerais, sete integrações Farmer, cinco integrações Forecast,
quatro testes CRM-29, `pnpm audit` sem vulnerabilidades conhecidas, build Next,
96 E2E de produção, três E2E locais, `pnpm db:status` e o dry-run de limpeza de
schemas. Os três E2E próprios cobrem publicação gerencial, leitura/RBAC responsiva
e submissão do próprio recorte pelo closer. A tela foi inspecionada em 1440×900 e
390×844, sem overflow horizontal. Os avisos conhecidos de stream do Next,
`NO_COLOR` e depreciação do `pg` foram não fatais e não alteraram os resultados.

## CRM-55 — metas e quotas versionadas validadas localmente

Em 13 de setembro de 2026, a CRM-55 partiu do commit
`559a9d841ac13a8a46c2f3b6b15b12a94baf547f`, igual à `origin/main`, com CRM-35,
CRM-49 e CRM-54 concluídas no checkpoint. O escopo permaneceu restrito a metas e
quotas: forecast, snapshots e tarefas CRM-56+ não foram iniciados.

Foram adicionados planos em rascunho/publicado/retirado, quotas tipadas por
pessoa, equipe ou função, catálogo de nove métricas, precedência
`pessoa > equipe > função`, cálculo por `asOf`, drilldowns, timeline append-only,
auditoria e quatro permissões server-side. Valores monetários são centavos BRL;
taxas são basis points. Zero, ausência de denominador, cobertura parcial e não
aplicabilidade continuam distintos. Publicação congela período e quotas por
trigger; mudanças posteriores exigem nova versão.

A criação, edição, publicação, substituição e retirada usam transações
serializáveis, advisory lock, retry limitado, idempotência e revisão otimista.
O teste concorrente inicialmente reproduziu `P2034`; o retry serializável foi
incorporado e a suíte direcionada passou. A integração completa revelou que o
teste novo carregava o seed CRM-29 no schema compartilhado, poluindo a fila e o
worker de testes anteriores; a fixture foi isolada ao seed estrutural, sem mudar
regra comercial. A expectativa de grants foi atualizada de 391 para 402 em razão
das novas permissões.

Antes da migration, o backup ignorado
`.backups/crm55/public-before-crm55-20260913.dump` foi criado com SHA-256
`2d648d4358c7322839d1482730b0490a1be5a3108539d1595649397353d0f0a7`, tamanho
aproximado de 4 MiB e 3.325 entradas. O ensaio isolado restaurou 255 tabelas,
533 leads, 146 usuários, 18 equipes, 1.195 atividades, 62 oportunidades, 3.318
logs e 53 migrations, mantendo o fingerprint de leads
`2c829e462f608b815ec33f26c783bcfb`; o banco temporário foi removido.

A migration aditiva elevou o `public` para 260 tabelas e 54 migrations. As
contagens e o fingerprint comerciais permaneceram iguais; somente dois logs de
backfill foram acrescentados. O seed executado duas vezes manteve exatamente um
plano e quatro quotas. O backfill dry-run teve zero candidato; a execução
posterior registrou um sinal de auditoria como `REVIEW_REQUIRED`, criou zero
plano e o replay devolveu o mesmo run. Ao final existem um plano, quatro quotas,
um evento, dois runs e um item de revisão; zero schema `politizai_test_*` ficou
residual.

Passaram `pnpm lint`, `pnpm typecheck`, 252/252 testes unitários,
314/314 integrações gerais mais 7/7 Farmer, 4/4 CRM-29, 93/93 E2E de produção e
3/3 local-only, `pnpm audit`, `pnpm build`, `pnpm db:status` e o dry-run de
limpeza. A tela `/metas` foi inspecionada em 1440×900 e 390×844, sem overflow,
com estado vazio honesto e mutações ausentes para o papel sem escopo. Avisos já
conhecidos do `pg`, stream encerrado do Next e `NO_COLOR`/`FORCE_COLOR` não
causaram falha.

Não houve provider, credencial, egress, banco remoto, forecast, remuneração,
deploy ou execução/revalidação da PROD-01. A CRM-56 não foi iniciada.

## CRM-54 — Farmer, renovação, expansão, contração e churn validados localmente

Em 13 de setembro de 2026, a CRM-54 partiu do commit
`551cdb5b439d544a2e72793337255cfeb26d0812`, correspondente ao estado validado da
CRM-53 em `origin/main`. A execução permaneceu restrita ao Farmer local; CRM-55 e
posteriores, provider, credencial, egress, banco remoto e deploy não foram
iniciados.

O domínio adiciona renovações com snapshot financeiro, owner, risco, data-alvo e
próxima ação; eventos append-only; sinais de expansão revisáveis; decisões
humanas de contração/churn; motivos versionados; logo churn separado de revenue
churn; e correção somente por movimento reversor. Sinal confirmado cria
`Opportunity`, tarefa e `StageHistory` na mesma transação. RBAC, workspace,
revisão otimista, idempotência e advisory lock protegem toda mutação. A tela
`/farmer`, APIs e backfill usam os serviços de domínio e não acessam provider.

Antes da migration foi preservado o backup ignorado
`.backups/crm54/public-before-crm54-20260913.dump`, com 4.080.461 bytes, SHA-256
`c814614cfe08af617c7ff75dffa5a188568d6831a72aea58aa607c44eae9689e` e 3.210
entradas. O ensaio estrito restaurou 247 tabelas, 57 registros históricos de
migration, 533 leads, quatro contas e os fingerprints esperados; o banco
temporário foi removido. A migration CRM-54 tem 292 linhas, é aditiva e não
contém `DROP`, `TRUNCATE` ou `RENAME`. A cadeia completa de 53 migrations passou
desde zero.

O seed executado duas vezes manteve exatamente três renovações, dois sinais,
duas decisões e seis motivos. O backfill público teve dry-run, execução e replay
idempotente: duas assinaturas verificáveis geraram somente renovações
`IN_REVIEW`, sem churn ou decisão financeira fabricados. Ao final, `public`
contém 255 tabelas, 53 migrations do código, 533 leads, quatro contas, 146
usuários, 18 equipes, 1.195 atividades, 62 oportunidades, três assinaturas,
cinco movimentos de receita, cinco renovações, cinco eventos, dois sinais, duas
decisões, um evento de churn, seis motivos e 3.318 logs de auditoria. Os
fingerprints de leads (`2c829e462f608b815ec33f26c783bcfb`) e contas
(`f7897b5d9956da436ef74a0bb587f011`) permaneceram estáveis.

Passaram `pnpm lint`, `pnpm typecheck`, `pnpm test` com 249/249 em 58 arquivos,
`pnpm test:integration` com 309/309 integrações legadas mais 7/7 Farmer em schema
isolado, `pnpm test:crm29` com 4/4, `pnpm audit`, `pnpm build`, `pnpm db:status`
e `pnpm db:test:cleanup` com zero schema residual. A primeira execução E2E teve
90/91: o teste de pagamentos ainda esperava ausência de assinatura e, após
ajustado para os dados persistidos, revelou overflow mobile de 590 px no
`select`. O controle foi limitado ao painel e o arquivo afetado passou 2/2 em
desktop/mobile. Os dois E2E Farmer também passaram. O executor E2E agora respeita
o arquivo solicitado; a integração Farmer roda isolada para não contaminar
fixtures legadas.

Não houve reexecução da PROD-01, provider, credencial, egress, banco remoto ou
deploy. A CRM-55 não foi iniciada.

## CRM-53 — solicitações, SLA e satisfação validados localmente

Em 13 de setembro de 2026, a CRM-53 partiu do commit
`8f998891d7273cd0ca91e3b6ee4aee0873bcddf0`, correspondente à CRM-52 em
`origin/main`. A execução ficou restrita a solicitações relacionadas ao cliente,
SLA de atendimento e satisfação; CRM-54+, Farmer, renovação, expansão,
contração, churn, help desk/ITSM genérico, provider, credencial, egress, banco
remoto e deploy não foram iniciados.

O domínio adiciona solicitação com exatamente um responsável ativo ou fila
explícita, próxima ação obrigatória, versão de SLA congelada, primeira resposta
registrada uma única vez, resolução motivada, revisão otimista e timeline
append-only. Políticas SLA, perguntas e escalas de CSAT/NPS são versionadas.
Convite e resposta permanecem fatos distintos; correções referenciam a resposta
anterior. O serviço centraliza workspace/RBAC, locks, idempotência, eventos e
auditoria. A superfície `/customer-service` e as APIs não acessam o banco fora
do serviço e não chamam canal externo; todo convite é marcado como simulado.

Antes da migration foi preservado o backup ignorado
`.backups/crm53/public-before-crm53-20260913.dump`, com 4.012.815 bytes,
SHA-256 `61e9a6a95fa70111deb3ad7c9df97811dc26d82586b549f39c85f284654ae511`
e 3.090 entradas no inventário. O ensaio estrito restaurou em banco isolado 237
tabelas, 51 migrations, 533 leads, quatro contas e o fingerprint de IDs
`2c829e462f608b815ec33f26c783bcfb`; o banco temporário foi removido. A migration
de 294 linhas é aditiva, sem `DROP`, `TRUNCATE` ou `RENAME`, e a cadeia completa
de 52 migrations foi aplicada desde zero pela integração.

O seed executado duas vezes manteve exatamente quatro solicitações, quatro
convites, três respostas, uma versão de SLA e duas versões de pesquisa. No
`public`, dry-run, execute e replay do backfill terminaram com zero candidato e
mantiveram quatro solicitações; o teste isolado cobriu um candidato ambíguo como
`REVIEW_REQUIRED`, sem fabricar solicitação. Ao final, `public` contém 247
tabelas, 52 migrations, 533 leads, quatro contas, 146 usuários, 18 equipes,
1.195 atividades, 59 oportunidades, 3.312 logs de auditoria e quatro
solicitações. O fingerprint dos leads permaneceu idêntico.

Passaram `pnpm lint`; `pnpm typecheck`; `pnpm test` com 245/245 em 57 arquivos;
testes direcionados com 4/4 unitários e 12/12 integrações; `pnpm
test:integration` com 309/309 em 45 arquivos; `pnpm test:crm29` com 4/4; `pnpm
test:e2e` com 89/89 em produção local e 3/3 local-only; `pnpm audit` sem
vulnerabilidades conhecidas; `pnpm build` em Webpack; e `pnpm db:status` com o
schema atualizado. Os dois E2E próprios comprovaram conteúdo persistido, RBAC e
ausência de overflow; a página foi ainda aberta e inspecionada em 1440×900 e
390×844. Todos os schemas efêmeros foram removidos.

Na primeira passagem, uma expectativa do seed ainda previa 360 grants, embora a
matriz nova produza 368. Depois, o reforço de escopo da pesquisa exigiu que a
fixture tivesse carteira real com próxima ação. As duas causas foram corrigidas
sem mudar regra anterior. Avisos conhecidos do `pg`, do Next sobre stream
encerrado e de `NO_COLOR`/`FORCE_COLOR` não causaram falha final.

Não houve canal real, provider, credencial, egress, banco remoto, deploy ou
execução/revalidação da PROD-01. A CRM-54 não foi iniciada.

## CRM-52 — carteira, plano e saúde validados localmente

Em 13 de setembro de 2026, a CRM-52 partiu da `main` no commit
`bd46c21798d8e4fd6a1e4dd11db3a087ca0fdf4a`, correspondente à CRM-51. A
dependência estava concluída e validada. A execução permaneceu restrita à
CRM-52; CRM-53 e posteriores, provider externo, ERP, contabilidade, fiscal,
CSAT/NPS, Farmer, renovação, churn, credenciais, egress, banco remoto e deploy
não foram iniciados.

O domínio acrescenta carteira com owner ou fila explícitos, histórico temporal
de atribuição, templates e versões publicadas de plano de sucesso, marcos com
dependências e evidências, regras de saúde versionadas e avaliações append-only.
A saúde é calculada deterministicamente a partir de sinais persistidos;
evidência, inferência, dado ausente e dado vencido ficam separados. Sinal
obrigatório ausente ou vencido produz `INSUFFICIENT` e pontuação nula, sem
inventar uma nota. A tela `/customer-success`, as APIs e todas as mutações usam
RBAC e escopo por workspace no servidor, concorrência serializável, chave de
replay, timeline e auditoria.

Antes da migration foi preservado o backup ignorado
`.backups/crm52/public-before-crm52-20260913.dump`, com 3.937.900 bytes e
SHA-256 `21031403766a464e7f3ca7912c4da64474d6ca1732228769ddef6f55e1f473b7`.
O ensaio isolado restaurou 224 tabelas, 50 migrations, 533 leads, quatro contas
e o fingerprint `2c829e462f608b815ec33f26c783bcfb`; o ambiente temporário foi removido. A
migration CRM-52 é aditiva e a inspeção não encontrou operações destrutivas. A
primeira validação transacional local com `psql -1` aplicou a migration no
`public`; em seguida ela foi registrada no histórico pelo fluxo
`prisma migrate resolve --applied`. A mesma cadeia completa de 51 migrations
passou desde zero em schemas efêmeros isolados, que foram removidos.

O seed executado duas vezes permaneceu estável com quatro atribuições, um
template, uma versão de regra e quatro avaliações demonstrativas explicitamente
marcadas: `HEALTHY`, `ATTENTION`, `RISK` e `INSUFFICIENT`. O backfill encontrou
zero onboarding elegível no estado atual; dry-run, execução e replay com a mesma
chave terminaram `COMPLETED`, sem criar carteira, owner, fila, plano ou ação
fictícia. Ao final, o `public` contém 237 tabelas, 51 migrations, 533 leads, 146
usuários, 18 equipes, 1.195 atividades, 59 oportunidades, 3.310 logs de
auditoria, quatro contas, quatro atribuições, zero plano materializado e quatro
avaliações. O fingerprint dos IDs de Leads permaneceu
`2c829e462f608b815ec33f26c783bcfb` e não restou schema efêmero.

Passaram `pnpm lint`, `pnpm typecheck`, 241/241 testes unitários, 12/12
integrações direcionadas (`customer-success` e `demo-seed`), 2/2 E2E próprios,
`pnpm audit`, `pnpm build` e `pnpm db:status`. A suíte integral herdada de
integração e E2E não foi repetida nesta task; os testes direcionados cobriram
atribuição concorrente e replay, escopo e negativa por papel, versões do plano,
dependências e evidências, dados insuficientes, supersessão append-only,
isolamento por workspace e backfill. A inspeção real das capturas autenticadas
em 1440×900 e 390×844 confirmou leitura consistente e ausência de overflow
horizontal. Avisos conhecidos do `pg` e do runner não causaram falha.

## CRM-51 — handoff e onboarding validados localmente

Em 13 de setembro de 2026, a CRM-51 partiu da `main` no commit
`49761130f932ec733812ea87b26a5576fe866756`, correspondente à CRM-50. As
dependências CRM-35 e CRM-48 estavam concluídas; CRM-46 e CRM-50 foram
preservadas sem revalidação. A execução permaneceu local e restrita à CRM-51.

O domínio separa oportunidade ganha, contrato aceito, handoff preparado,
handoff enviado, aceite responsável, onboarding iniciado, ativação e conclusão.
Templates e quatro marcos versionados são copiados para o caso, com owner ou
fila explícitos, próxima ação, prazo, dependências e evidência humana. Eventos e
itens de backfill são append-only; RBAC, workspace, revisão otimista, chave
idempotente e auditoria são aplicados no servidor. Ganho não cria ativação,
assinatura ou receita e nenhuma mutação atravessa um serviço externo.

O teste concorrente inicialmente reproduziu `P2034: Transaction failed due to a
write conflict or a deadlock`. O advisory lock já serializava por oportunidade,
mas duas transações `Serializable` podiam manter snapshots concorrentes. O
serviço passou a repetir, no máximo quatro vezes, somente conflitos `P2034`, e
a verificar o handoff ativo sob o lock. Duas criações simultâneas agora retornam
o mesmo registro; demais erros não são repetidos silenciosamente.

Antes da migration foi preservado o backup ignorado
`.backups/crm51/public-before-crm51-20260913.dump`, com 3.883.448 bytes,
SHA-256 `cf3e5f893bae5bc977b2c51f89cba7a82e09f516060d5449129a1ead76178065`
e 2.859 entradas. O ensaio isolado restaurou 216 tabelas, 533 leads e o mesmo
fingerprint; o banco temporário foi removido. A cadeia completa de 50 migrations
passou desde zero e o `public` ficou atualizado.

O seed repetido manteve um template, uma versão publicada e quatro definições de
marco. O backfill público avaliou dez oportunidades ganhas tanto em dry-run
quanto em execução: todas ficaram `REVIEW_REQUIRED` por não possuírem conta e
contrato aceito completos, zero handoff foi fabricado, e o replay retornou a
mesma execução. O banco terminou com 224 tabelas, 50 migrations, 533 leads, 146
usuários, 18 equipes, 1.195 atividades, 59 oportunidades, 3.306 auditorias, zero
handoff e zero caso de onboarding. O fingerprint dos IDs de Leads permaneceu
`2c829e462f608b815ec33f26c783bcfb` e não restou schema efêmero.

Passaram `pnpm lint`, `pnpm typecheck`, 237/237 testes unitários, 297/297 de
integração, 4/4 CRM-29, 85/85 E2E de produção, 3/3 local-only, `pnpm audit`,
`pnpm build`, `pnpm db:status` e o dry-run de limpeza. A inspeção real das
capturas autenticadas em 1440×900 e 390×844 confirmou estados vazios honestos,
leitura do visualizador e ausência de overflow. Avisos conhecidos do `pg`, Vite,
cor do runner e fechamento antecipado de stream não causaram falha. Nenhum
provider, ERP, contabilidade, help desk, credencial, egress, banco remoto ou
deploy foi usado.

## CRM-47 — calendário validado localmente

Em 13 de setembro de 2026, a retomada encontrou a implementação da CRM-47 no
working tree, ainda sem commit e sem checkpoint final. A `main` estava no commit
`9983c5230048ae73f8f47402cc8b383435e355ff`, correspondente ao estado validado
da CRM-46. Foram preservadas todas as alterações e inspecionados `AGENTS.md`, a
documentação do Next.js 16.3.4, schema, migrations, agenda, reuniões,
plataforma de integrações, worker, RBAC, testes e documentação. A execução
permaneceu restrita à CRM-47; provider externo, OAuth, credenciais, egress,
banco remoto, deploy e CRM-48 não foram iniciados.

A implementação mantém `Meeting` e `MeetingHistory` como fonte oficial. O
sandbox local acrescenta profile por workspace, link de evento, inbox/outbox,
eventos append-only, conflitos explícitos, runs e cursors de sincronização,
worker PostgreSQL com lock, retry/backoff, dead-letter, replay e recuperação
após interrupção. A resolução `KEEP_CRM` reprojeta o estado canônico por outbox
e job; nenhuma resolução altera a reunião fora do serviço de domínio. O
callback local valida corpo bruto, limite, timestamp, nonce e assinatura HMAC,
e a exceção no proxy cobre somente `/api/local/calendar/callback`.

O primeiro teste de integração da retomada revelou tentativa de atualizar um
registro append-only de execução. O fluxo foi ajustado para criar a tentativa
final uma única vez, preservando a imutabilidade. A suíte direcionada passou
9/9. No primeiro E2E, a Agenda abriu uma data sem reunião e o seletor não tinha
alvo; o cenário passou a consultar uma reunião persistida e navegar para a data
correta. Na execução seguinte, os 79 E2E de produção passaram, mas o callback
local recebeu `200` porque o proxy redirecionava a requisição sem sessão para o
login antes de alcançar a rota que retorna `202`. A exceção exata foi incluída
no matcher e o gate integral repetido aprovou 79/79 cenários de produção e 2/2
local-only, incluindo assinatura e replay idempotente sem egress.

Antes da migration foi salvo o backup ignorado
`.backups/crm-47/public-before-crm47.dump`, com 3.658.586 bytes, SHA-256
`446889f64a395e677f5d89ad97ece98f7d3d41da5d5ccbbd0329e4b9d63a391d` e
2.473 entradas. O ensaio restaurou 182 tabelas, 80 reuniões, 157 registros de
histórico e 43 migrations; o banco temporário foi removido. A cadeia completa
de 44 migrations passou desde zero e o `public` ficou atualizado.

O backfill local encontrou 80 reuniões elegíveis e criou 80 itens
`REVIEW_REQUIRED`, sem inventar link externo; dry-run, execução e repetição
idempotente foram validados. Ao final, `public` contém 188 tabelas, 531 leads,
146 usuários, 18 equipes, 1.183 atividades, 59 oportunidades, 3.277 logs de
auditoria, um profile local de calendário, zero links externos e zero referência
de segredo. O dry-run de limpeza encontrou zero schema efêmero residual.

Passaram `pnpm lint`, `pnpm typecheck`, 226/226 testes unitários, 283/283 de
integração, 4/4 CRM-29, 79/79 E2E de produção, 2/2 local-only, `pnpm audit`,
`pnpm build`, `pnpm db:status` e o dry-run de limpeza. Avisos conhecidos do
`pg`, Vite, cor do runner e fechamento antecipado de stream no servidor E2E não
causaram falha. Nenhum provider, OAuth, credencial, webhook público, egress,
banco remoto ou deploy foi usado.

## CRM-46 — telefonia validada localmente

Em 13 de setembro de 2026, a CRM-46 partiu da `main` no commit
`43858b7515dd69d792596f4e0a49afa68e377aac`, correspondente à CRM-45. A
dependência CRM-43 e o checkpoint da CRM-45 estavam concluídos. Foram lidos o
`AGENTS.md`, a documentação do Next.js 16.3.4 em `node_modules/next/dist/docs/`,
o schema, migrations, serviços de comunicação/privacidade, worker, testes e
documentação. A execução ficou restrita à telefonia; a CRM-47 não foi iniciada.

A implementação criou profile local por workspace, contratos tipados,
normalização E.164 conservadora, janela de contato, `PhoneCall`, legs,
tentativas, eventos append-only, reviews, suppressions, backfill e referências
de gravação/transcrição obrigatoriamente nulas no modo local. A chamada cria
`Conversation`, `Message`, outbox, job e auditoria na mesma transação. O worker
PostgreSQL usa lock, retry/backoff e dead-letter. Callback local exige HMAC do
corpo bruto. Resultado humano, próxima tarefa, Activity e timestamps de SLA
passam por serviços de domínio e não movem pipeline silenciosamente.

O primeiro teste sobre a migration revelou que a expressão regular de E.164
estava escapada incorretamente para PostgreSQL. A migration corretiva falhou na
primeira aplicação por dois nomes de constraints divergentes; ela foi marcada
como rolled back pelo fluxo Prisma, corrigida e aplicada normalmente. A cadeia
completa de 43 migrations passou depois disso. O primeiro E2E parou no build
com `UnhandledSchemeError: node:crypto`, pois o Client Component importava o
módulo que assina callbacks; os cenários compartilháveis foram separados em
arquivo sem dependência Node e o E2E passou.

A primeira regressão integral de integração teve 272 aprovações e duas falhas:
a contagem estrutural ainda esperava 217 grants em vez de 240, e um teste legado
tratava escopo `OWN` como acesso a qualquer item da fila da equipe. O catálogo
foi atualizado para as novas permissões e a matriz agora comprova que `OWN`
aceita o owner próprio e nega o item apenas da fila; `TEAM` continua sendo o
escopo que usa equipe/fila. A repetição direcionada passou 25/25 e a suíte
integral passou 274/274.

Antes das migrations foi salvo o backup ignorado
`.backups/crm-46/public-before-crm46.dump`, com 3.580.231 bytes, SHA-256
`eb337eee4f8836d38047f71f1ef2bedddd4ad7279b1264a083d0f323abf7deef` e
2.335 entradas. O primeiro ensaio encontrou o `public` vazio criado por
`createdb`; somente esse schema do banco temporário foi removido e a repetição
restaurou 173 tabelas, 41 migrations, 531 leads, 146 usuários, 18 equipes,
1.183 atividades, 59 oportunidades, 3.273 auditorias e fingerprint
`f080bce4c8aeb25f23cdd24d9f741e60`. O banco temporário foi removido.

O backfill real teve zero candidato em dry-run e execução; o replay retornou o
mesmo run. O seed executado duas vezes manteve o mesmo resumo estrutural. O
`public` terminou com 182 tabelas, 43 migrations, 531 leads, 146 usuários, 18
equipes, 1.183 atividades, 59 oportunidades, 3.275 auditorias e o mesmo
fingerprint de Leads. Há um profile e uma conexão local de telefonia, zero
referência de segredo presente e zero schema efêmero residual.

Passaram `pnpm lint`, `pnpm typecheck`, 218/218 unitários, 274/274 integrações,
4/4 CRM-29, 77/77 E2E de produção, 1/1 local-only, `pnpm audit`, `pnpm build`,
`pnpm db:status` e o dry-run de limpeza. Avisos conhecidos do `pg`, Vite e cor
do runner não causaram falha. Não houve provider, PSTN, gravação, transcrição,
credencial, egress, banco remoto ou deploy.

## Revalidação da PROD-01 após a CRM-41

Em 12 de setembro de 2026, a nova autorização encontrou a PROD-01 já
implementada e a `main` local/remota no commit
`1079fce6a241282852717c398ca6e11dc50fe133`. O GitHub CLI confirmou a conta
`Menddon`, o repositório `Menddon/crm-politizai` como `PRIVATE` e a branch
principal `main`. O checkout continha alterações parciais não relacionadas da
CRM-42; elas foram preservadas sem tocar no índice por um snapshot privado no
commit `2ef45e56b2f9f04635f46e7a0f82a5d854550053` da branch de segurança. Nenhum
arquivo ignorado, segredo, dump ou `.env` entrou nessa branch; `.env.example`
permanece o único arquivo de ambiente versionado.

O primeiro typecheck em uma cópia limpa reproduziu
`TS2307: Cannot find module '../../../public/brand/politizai-mark.png'`. O asset
estava corretamente versionado; faltava gerar `next-env.d.ts`, que o Next.js
16.3.4 recomenda manter ignorado. O script `typecheck` passou a executar
`next typegen && tsc --noEmit`. A correção foi publicada na `main` no commit
`e85930a84268b59284d7c66557254b902931c374`, confirmado como idêntico no remoto.

O banco local `politizai_crm`, PostgreSQL 17.10, iniciou e terminou com
381.531.827 bytes. O schema `public` possui 36.823.040 bytes, 147 tabelas e 35
migrations concluídas. Leads, usuários, equipes, atividades e oportunidades
mantiveram, respectivamente, 531, 146, 18, 1.183 e 59 registros com fingerprints
idênticos. O smoke de login criou apenas o `AuditLog` append-only esperado,
elevando essa contagem de 3.231 para 3.232.

O backup exclusivo de `public` ficou em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T184711Z.dump`, com
3.166.788 bytes, SHA-256
`21a931be75eead64e298ff84113ec24e67c2b3d5cbf9b7633efb2f826acf485b` e
1.987 entradas no inventário. A restauração no banco temporário isolado
`politizai_prod01_restore_check_20260912t184711` reconciliou tabelas, migrations,
contagens e fingerprints; o banco temporário foi removido. O dry-run e a
execução confirmada da manutenção encontraram zero candidato e removeram zero
schema. Somente `public` permaneceu como schema não sistêmico.

Na cópia limpa da `main`, passaram `pnpm lint`, `pnpm typecheck`, 177/177
unitários, 233/233 integrações, 4/4 CRM-29, 67/67 E2E de produção, 1/1 E2E local,
`pnpm audit`, `pnpm build` e `pnpm db:status`. Health, login, Dashboard e
Auditoria responderam HTTP 200. O runtime do host era Node 24.18.0 e emitiu o
aviso de engine porque o projeto exige Node 22; os gates passaram, mas o host
deve voltar à linha documentada antes de uma futura validação de release.

Ao final foram removidos somente 859.480 KiB de `.next`, a cópia temporária de
validação de 1.875.404 KiB e relatórios regeneráveis. `node_modules` permaneceu
com 1.209.780 KiB. O checkout caiu de 2.431.616 para 1.572.556 KiB; o espaço
livre do APFS subiu de 11.780.328 para 13.316.280 KiB, ganho observável de
1.535.952 KiB. O volume `politizai-crm_postgres_data` permaneceu montado e foi
reportado de 523,1 para 522,8 MB. Nenhum container, volume ou imagem de outro
projeto foi removido. A imagem Alpine efêmera baixada apenas para uma medição
foi removida imediatamente ao terminar essa medição.

Não houve deploy, Vercel, Neon, banco remoto, remoção de `public`, remoção de
`node_modules`, `docker system prune`, PROD-02 ou execução da CRM-42.

## CRM-40 — implementação local e validação externa adiada

Em 12 de setembro de 2026, a CRM-40 partiu do `main` limpo em
`4429a294ff0362ba8f27b4ac4faee2c66767dcd8`, igual a `origin/main`, após
confirmar CRM-37, CRM-38 e CRM-39 no checkpoint. A inspeção segura do ambiente
confirmou ausência de `META_ADS_ACCESS_TOKEN`, `META_ADS_APP_SECRET`, versão e
lista de contas. Nenhum valor secreto foi procurado em outros locais, exibido ou
capturado.

O código implementa somente `GET` contra a origem fixa da Graph API, versões
allowlisted, paginação reconstruída por cursor, limite de resposta, timeout,
retry com backoff/`Retry-After` e classificação segura de falhas. Configuração e
referências de segredo são versionadas por workspace. Teste bem-sucedido
descobre contas acessíveis; somente contas explicitamente selecionadas entram
na coleta. Hierarquia usa IDs exatos, insight diário gera fatos revisionáveis e
ações desconhecidas permanecem relacionais e revisáveis. O cursor avança apenas
no commit do conjunto; nenhuma atribuição, mutação comercial ou escrita na Meta
foi adicionada.

Antes da migration foi criado o backup ignorado
`.backups/crm-40/politizai_crm_public_pre_crm40_20260912T153617Z.dump`, com
3.154.162 bytes, SHA-256
`ed0aa749817b162783c67ba8671e4eeb297461efbf101710ed1ac58b73683582` e
1.966 entradas. A primeira leitura do inventário falhou porque `docker exec`
não recebeu stdin; o dump permaneceu intacto e a repetição com `-i` validou o
inventário. A migration `20260912180000_meta_ads_read_connector` foi aplicada
ao banco principal e desde zero em schema efêmero.

A validação final aprovou 168 testes unitários, 231 de integração, 4 do seed
CRM-29, 65 E2E de produção e 1 E2E local-only, além de lint, typecheck, audit e
build. O E2E identificou um seletor preexistente ambíguo em “Meu Dia”; o seletor
foi tornado exato, a suíte integral foi repetida e passou. O teardown da fixture
Meta desativa triggers append-only somente dentro de schema efêmero
`politizai_test_*`, restaura-as em `finally` e deixou zero schema temporário.
O `public` terminou com 146 tabelas, 34 migrations, 531 leads, 146 usuários,
1.183 atividades, 59 oportunidades e 3.231 logs, sem conexão ou fato Meta.

A validação real de handshake, escopo, conta, paginação, rate limit e
reconciliação com Ads Manager não foi executada e permanece pendente. O status
não deve avançar para `CONCLUÍDA E VALIDADA`, `SANDBOX` ou `CONNECTED` sem essa
evidência.

## CRM-41 — Google Ads validado localmente

Em 12 de setembro de 2026, a CRM-41 partiu do `main` limpo em
`4256196805717a4e1b20a561bfa77acf9a048f7a`, igual a `origin/main`. A
dependência CRM-39 estava concluída; CRM-40 foi usada como padrão técnico e,
por decisão explícita, reclassificada como concluída localmente com validação
externa adiada. Foram consultadas a documentação local do Next.js 16.3.4 e as
referências oficiais do Google Ads sobre versões, autenticação, estrutura de
chamadas, hierarquia, Search e falhas.

O conector implementa OAuth refresh token e service account somente por
referências server-side, sem campo secreto na UI. O transporte aceita apenas
os hosts Google previstos, `ListAccessibleCustomers` e `GoogleAdsService.Search`
em versões allowlisted, com templates GAQL internos. Não existe rota Mutate.
Hierarquia manager/customer, campanha, grupo, anúncio e ativos usam IDs exatos.
Custo original em micros e conversões do provider ficam separados de leads,
compras e receita do CRM. Revisão, correlação, cursor e tentativa são
commit-safe; falha não avança cursor nem deixa fatos parciais.

Antes da migration foi criado o backup ignorado
`.backups/crm-41/public-before-crm41.dump`, com 3.160.930 bytes, SHA-256
`c734679d5dca75205819c55b008a50971123dabd9c46ed3c78d6f9504410a96b` e
1.963 entradas. O ensaio restaurou 146 tabelas, 531 leads, 146 usuários, 3.231
logs e o histórico de migrations em um banco isolado, removido em seguida. A
migration `20260912190000_google_ads_read_connector` foi aplicada ao `public` e
desde zero nos schemas efêmeros.

O gate final aprovou 177 testes unitários em 41 arquivos, 233 integrações em 34
arquivos, 4 testes CRM-29, 67 E2E de produção e 1 local-only, além de lint,
typecheck, audit sem vulnerabilidades conhecidas, build e `db:status`. A primeira
execução E2E falhou por dois seletores de teste após o novo link e foi corrigida;
a repetição passou integralmente. Uma repetição da integração detectou que a
fixture Google não limpava seus fatos antes do teste amplo da CRM-39 (4 em vez
de 2); o teardown foi restringido ao namespace Google no schema efêmero, e a
repetição aprovou 233/233. O dry-run final encontrou zero schema temporário.

O `public` terminou com 147 tabelas, 35 migrations ativas, 531 leads, 146
usuários, 18 equipes, 1.183 atividades, 59 oportunidades e 3.231 logs. Não há
conexão nem fato Google no banco principal. Nenhuma credencial foi solicitada,
nenhum egress, customer real, banco remoto ou deploy foi usado. Projeto Google
Cloud, conta de teste, handshake, paginação/quota reais e reconciliação externa
permanecem em `docs/EXTERNAL_VALIDATIONS.md`. CRM-42 não foi iniciada.

## Revalidação da PROD-01 após a CRM-39

Em 12 de setembro de 2026, a autorização explícita encontrou `main` limpo no
commit `ae2ee10e15a0dac4357f651f596e75d7eb09930a`, igual a `origin/main`. O
GitHub CLI confirmou a conta `Menddon` e o repositório
`Menddon/crm-politizai` como `PRIVATE`. `.gitignore` continuou cobrindo
ambientes, `.next`, `node_modules`, cliente Prisma gerado, relatórios, dumps,
backups, logs, credenciais e caches. A varredura do conjunto versionável não
encontrou token, chave privada ou credencial externa; URLs detectadas são
exemplos locais e fixtures.

O banco iniciou com 381.433.523 bytes, 145 tabelas em `public`, 35 registros de
migration, 531 leads, 146 usuários, 18 equipes, 1.183 atividades, 59
oportunidades e 3.230 logs. Não havia schema não sistêmico fora de `public`, e
o dry-run/execução confirmada de `pnpm db:test:cleanup` removeu zero schemas.
O backup exclusivo de `public` ficou em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T144619Z.dump`,
ignorado pelo Git, com 3.154.009 bytes, SHA-256
`b3eccd4f2e9307130fcef0d07fdbd2dfe8a6c86b4ec9d56b349ca338b2a59b97`
e 1.966 entradas no inventário. A restauração de ensaio reconciliou tabelas,
contagens e fingerprints e o banco temporário foi removido. A primeira
tentativa de ensaio falhou com `schema "public" already exists`; somente o
banco temporário foi descartado, e a repetição correta removeu seu `public`
vazio antes do `pg_restore`.

Passaram `pnpm lint`, `pnpm typecheck`, 160/160 unitários, 230/230 integrações,
4/4 CRM-29, 63/63 E2E de produção, 1/1 E2E local-only, `pnpm audit`, `pnpm
build` e `pnpm db:status`. Health, login, Dashboard e Auditoria responderam
HTTP 200 no banco principal. O login acrescentou apenas um `AuditLog`
append-only, elevando a contagem para 3.231; fingerprints de Leads, Users,
Teams, Activities e Opportunities permaneceram iguais.

Os runners descartaram todos os schemas `politizai_test_*`. Ao final, foram
removidos somente 641.808 KiB de `.next` e 4 KiB de resultados Playwright
regeneráveis, por caminhos absolutos validados, sem executar outro build.
`node_modules` permaneceu com 1.209.780 KiB; `public`, o banco, o volume Docker,
o código-fonte e os backups foram preservados. Nenhum Vercel, Neon, deploy,
banco remoto, `docker system prune`, remoção de volume, PROD-02, CRM-32 ou
tarefa posterior foi executado nesta revalidação.

## CRM-39 — conclusão local

Em 12 de setembro de 2026, a CRM-39 foi iniciada somente após a correção de
fila que congelou a execução antecipada da PROD-01 no baseline `84f3329`. O
checkpoint pré-migração confirmou `public` com 132 tabelas, 31 migrations e
zero schema de teste residual. O backup
`.backups/crm-39/politizai_crm_public_pre_crm39_20260912T131514Z.dump` tem
3.081.253 bytes, SHA-256
`35d2c82efc2e0a9dcfbebaacf74289b395ebdd0ca8cfd1aca507677a14bb7934` e
1.830 entradas; restauração isolada reconciliou 132 tabelas, 31 migrations e
531 leads.

A migration `20260912134000_marketing_media_performance` e a migration de
integridade `20260912135000_marketing_media_integrity` foram aplicadas e
reaplicadas desde zero nas suítes. O `public` terminou com 145 tabelas e 33
migrations. IDs e contagens de Leads (531), Users (146), Teams (18), Activities
(1.183) e Opportunities (59) reconciliaram por hash com o backup. O backfill
real fez dry-run de 6 candidatos, vinculou 6 registros por UUID exato e o
replay não criou efeitos. O health check retornou aplicação e banco `ok`;
nenhum schema `politizai_test_%` restou.

Na primeira aplicação da migration de integridade, o Prisma registrou `P3018`
porque o índice `marketing_ad_accounts_workspace_channel_id` já existia após
uma tentativa parcial. Nenhum dado comercial foi alterado. A migration foi
marcada como revertida pelo fluxo oficial, tornou a criação do índice e da
constraint de alcance condicionais, reaplicou com sucesso e depois foi validada
desde zero pelas suítes de integração, CRM-29 e E2E.

Antes do commit, a conferência de checksum identificou drift entre os dois
arquivos finais e os registros ativos criados durante essa recuperação. Em uma
transação restrita às estruturas da CRM-39, constraints equivalentes duplicadas
foram removidas, os índices relacionais faltantes foram criados e somente os
checksums ativos dessas duas migrations foram alinhados aos arquivos finais. A
comparação posterior confirmou checksums idênticos, nenhuma constraint
duplicada e os mesmos hashes dos registros comerciais protegidos.

O resultado foi: `pnpm lint` aprovado; `pnpm typecheck` aprovado; `pnpm test`
com 160/160; `pnpm test:integration` com 230/230; `pnpm test:crm29` com 4/4;
`pnpm test:e2e` com 63/63 cenários de produção e 1/1 local-only; `pnpm audit`
sem vulnerabilidades conhecidas; `pnpm build` aprovado; `pnpm db:status`
atualizado. Avisos conhecidos de `pg` e de stream encerrado pelo Next durante
navegação abortada não falharam as suítes.

Após o último build e sem executar novo build, foram removidos somente 661.348
KiB de `.next`; `node_modules` permaneceu preservado com 1.209.780 KiB. Os
relatórios regeneráveis já estavam ausentes e o projeto terminou com 1.545.736
KiB no disco.

Não houve provider, credencial, egress, conta de mídia, banco remoto, Vercel,
Neon ou deploy. Dados de performance só entram por CSV local confirmado.

## Revalidação da PROD-01 após a CRM-38

Em 12 de setembro de 2026, o checkpoint partiu de `main` limpo em
`2b8f389a2e72e8c54d662be58652728197d5dbae`, igual a `origin/main`. O GitHub
CLI confirmou a conta `Menddon` e o repositório privado
`Menddon/crm-politizai`. A varredura do conjunto versionável não encontrou
token, chave privada, credencial GitHub/Vercel ou URL de banco real.

O backup exclusivo de `public` ficou em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T124811Z.dump`,
ignorado pelo Git, com 3.083.798 bytes, SHA-256
`65459e2a5e06fd9326583ddb5726ab1974fb8482efd5ac6e7bd5f6b1972ace28` e
1.830 entradas em `pg_restore --list`. A restauração limpa em banco local
temporário reconciliou 132 tabelas, 31 migrations, 531 leads, 146 usuários, 18
equipes, 1.183 atividades, 59 oportunidades, 3.227 logs e os fingerprints de
Lead, Activity, Opportunity e User; o banco temporário foi removido.

O inventário encontrou 82 schemas legados adicionais. Cada candidato foi
individualmente incluído na allowlist somente após confirmar proprietário
`politizai`, `_prisma_migrations`, conjunto de tabelas contido em `public`,
cronologia de migrations compatível com a task indicada no nome e ausência de
conexões cliente. O dry-run estimou 602.415.104 bytes; a confirmação removeu
somente esses nomes. O banco caiu de 1.034.237.619 para 380.630.707 bytes e
terminou sem schema não sistêmico fora de `public`. As 132 tabelas, 31
migrations, contagens e fingerprints comerciais permaneceram iguais. O login
de smoke acrescentou apenas um `AuditLog` append-only, elevando a contagem para
3.228.

O lifecycle foi endurecido para recusar a manutenção quando existir qualquer
outra conexão cliente no banco, inclusive ociosa. O teste de integração cobre
essa negativa. `test:integration`, `test:crm29` e `test:e2e` criaram nomes
`politizai_test_*` e os descartaram no `finally`; o dry-run final encontrou zero
candidatos.

Passaram `pnpm lint`, `pnpm typecheck`, 158/158 unitários, 227/227 integrações,
4/4 CRM-29, 62/62 E2E de produção, 1/1 E2E local-only, `pnpm audit`, `pnpm
build` e `pnpm db:status`. Health, login, Dashboard e Auditoria responderam HTTP
200 no banco principal. Permanecem avisos conhecidos do `pg` sobre consultas
concorrentes e do Next.js sobre streams de navegação encerrados, sem falha nos
gates.

Ao final foram removidos exclusivamente 633.228 KiB de `.next` e 4 KiB de
`.cache/playwright-results`. O checkout passou de 1.598.876 para 1.542.076 KiB
na medição posterior ao primeiro push;
`node_modules` permaneceu em 1.209.780 KiB e os backups locais totalizaram
31.592 KiB. O volume `politizai-crm_postgres_data` caiu de 1,226 GB para 773,7
MB e permaneceu montado. O espaço livre do APFS passou de 12.824.908 para
12.359.076 KiB; portanto, não se atribui ganho líquido global à execução, pois
testes, builds e armazenamento do Docker/APFS consumiram espaço fora dos
artefatos medidos, apesar das reduções lógicas comprovadas.

Não houve deploy, Vercel, Neon, banco remoto, exclusão de `public`, remoção de
`node_modules`, remoção de volume, `docker system prune`, PROD-02 ou CRM-32.

## Execução da CRM-38

O checkpoint partiu de `main` limpo e sincronizado com `origin/main` no commit
`e6870f8bab56f9577c5e7880003cc09a7c6f1a12`, com CRM-33 e CRM-37 validadas.
Antes da migration foi criado o backup ignorado pelo Git
`.backups/crm-38/politizai_crm_public_pre_crm38_20260912T120000Z.dump`, com
2.720.318 bytes, SHA-256
`6a76aba5ae2bd0181b31df36ba0e479720a55aaa860e44dd3969fdd01b56386c`,
1.651 entradas no catálogo e restauração de ensaio reconciliada.

A migration `20260912113656_marketing_attribution_foundation` adiciona 14
tabelas e vínculos opcionais à submissão, FKs compostas por workspace, índices,
constraints de crédito e triggers append-only. Landing pages, formulários e
modelos possuem versões imutáveis. Sessões usam ID público opaco; referrer é
reduzido, click ID é hasheado e UTM é normalizada. A entrada grava conversão,
touchpoint quando informado, links e outbox local na mesma transação.

First-touch, last-touch e linear são determinísticos e distribuem exatamente
10.000 bps por conversão; ausência usa bucket desconhecido e evidência inelegível
produz cobertura parcial. O resultado declara correlação, cobertura, versão e
lacunas, sem linguagem causal. A finalidade
`marketing-attribution-analytics` permanece `PENDING_LEGAL`, logo fatos locais
ficam `REVIEW_REQUIRED` e não autorizam provider, pixel, contato ou egress.

O backfill público teve 521 candidatos no dry-run e criou 521 conversões e 521
touchpoints derivados em execução controlada; todos ficaram
`LEGACY_REVIEW_REQUIRED` e inelegíveis. O replay retornou a mesma execução com
zero efeito novo. Depois da migration, Lead/User/Team/Activity/Opportunity
permanecem em 531/146/18/1.183/59, e os fingerprints de IDs de Lead, Activity e
Opportunity coincidem com o checkpoint anterior. O banco possui 132 tabelas,
31 migrations e zero schema `politizai_test_*`; AuditLog cresceu de 3.224 para
3.227 pelos dois runs persistidos e pelo login humano usado na inspeção visual.

Validação final: `pnpm lint`, `pnpm typecheck`, `pnpm test` (157),
`pnpm test:integration` (226), `pnpm test:crm29` (4), `pnpm test:e2e` (62 de
produção + 1 local-only), `pnpm audit`, `pnpm build` e `pnpm db:status`
passaram. O E2E inicialmente expôs texto insuficientemente explícito sobre
ausência de mídia externa; a cópia foi corrigida e o rerun completo passou.
A inspeção renderizada confirmou a tela `/aquisicao`, navegação, modelos,
contagens persistidas e ausência de overflow no build local. Persistem apenas
avisos não bloqueantes já conhecidos do driver `pg`, stream encerrado pelo
navegador e configuração futura do loader do Vite. Nenhum deploy, provider,
credencial, banco remoto, custo de mídia ou funcionalidade da CRM-39 foi criado.
Após o último build/E2E, `.next` (649 MiB) e o relatório Playwright regenerável
foram movidos para a Lixeira; `node_modules` e o banco local foram preservados e
nenhum novo build foi executado depois da limpeza.

## Execução da CRM-37

O checkpoint confirmou CRM-36 e PROD-01 validadas antes da implementação. O
backup pré-migration ignorado pelo Git permanece em
`.backups/crm-37/politizai_crm_public_pre_crm37_20260912T090000Z.dump`, com
2.641.918 bytes, SHA-256
`72b2e7f75738580a6f36211e1c27ea8d0fce97e0cec9253b59530296be2d50c9`
e 1.511 entradas validadas por `pg_restore --list`.

As migrations `20260912050000_integration_platform_foundation`,
`20260912051000_integration_actor_integrity` e
`20260912052000_integration_attempt_uniqueness` foram aplicadas de forma
aditiva. O banco local final contém 118 tabelas e 30 migrations aplicadas; o
seed mantém uma conexão mock estável, uma versão de configuração, quatro
capacidades e zero referência de segredo. As relações compostas de ator e
workspace, os triggers append-only e os índices únicos parciais protegem
integridade, histórico e tentativas concorrentes.

A plataforma centraliza contratos Zod, registro de adapters, referência de
segredo resolvida somente no servidor, webhook local assinado sobre corpo
bruto, inbox idempotente, outbox transacional, worker com lease/`SKIP LOCKED`,
retry/backoff/dead-letter, sync com cursor commit-safe e mapeamentos com
precedência humana. Falhas transitórias, permanentes, rate limit, timeout e
queda antes/depois do commit são simuladas deterministicamente. A decisão de
privacidade bloqueia entrega, replay e sync sem evidência suficiente.

As APIs e `/integracoes` expõem somente operações locais autorizadas. O teto é
`VALIDATED_LOCALLY`; não existe `fetch` externo, URL arbitrária, credencial real,
sandbox, homologação ou produção. Administrador configura e inspeciona;
Gestor lê e executa localmente; SDR, Closer e Visualizador permanecem negados.

Validação final: `pnpm lint`, `pnpm typecheck`, `pnpm test` (151),
`pnpm test:integration` (222), `pnpm test:crm29` (4), `pnpm test:e2e`
(60 produção + 1 local-only), `pnpm audit`, `pnpm build`,
`pnpm db:status`, migrations em schema vazio e reconciliação do `public`
passaram. Os schemas efêmeros foram removidos (`politizai_test_* = 0`). O
scanner do Tailwind foi limitado a `src` e o workspace pnpm ao monólito raiz,
evitando que artefatos de teste entrem na descoberta de fontes/classes. O
diretório padrão de resultados E2E passou a `.cache/playwright-results`.
Persistem apenas avisos não bloqueantes conhecidos do driver `pg` e mensagens
de stream encerrado pelo navegador; nenhuma suíte falhou por esses avisos.

## Execução da CRM-36

O checkpoint partiu de `main` limpo em
`55b01bf7cf55311cfff48b2c81b8dcbf076d31ba`, sincronizado com `origin/main`.
A implementação parcial encontrada foi preservada na branch privada
`safety/crm36-pre-prod01-20260912` antes da continuação. Foram lidos o
`AGENTS.md`, os documentos de arquitetura, dados, permissões, testes e prontidão,
os serviços de Contact, Lead, atividades, automações e IA, além dos guias locais
do Next.js 16.3.4 sobre Route Handlers e layouts.

A migration aditiva `20260912040000_privacy_consent_retention` criou categorias
de dados, bases legais, finalidades e versões, consentimentos por finalidade,
canal e ContactPoint, projeção vigente, decisões, políticas de retenção, DSR,
legal hold, ações de retenção e runs/itens do backfill. Triggers mantêm eventos
de consentimento append-only e versões publicadas imutáveis; constraints e
chaves compostas impedem associação entre workspaces. Nenhuma tabela, ID,
evento comercial ou schema legado foi removido.

O serviço central retorna `ALLOW`, `DENY` ou `REVIEW_REQUIRED`, sempre com
motivo, evidência e modo de aplicação. `DENIED`, `REVOKED` e `OPTED_OUT`
bloqueiam contato; ausência de prova nunca vira permissão. Atividades humanas,
mensagens simuladas das automações e preparação da IA consultam a mesma decisão.
O fluxo de entrada faz dual write do sinal legado na mesma transação. Um Lead
histórico sem Contact permanece consultável como `REVIEW_REQUIRED`, mas nenhuma
mutação sensível é autorizada sem identidade canônica.

A política inicial é propositalmente `PENDING_LEGAL`: o sistema não afirma base
legal brasileira, finalidade ou prazo definitivo sem validação humana/jurídica.
A prévia de retenção é somente revisável, respeita legal hold e exige aprovação
humana; nenhuma anonimização ou exclusão destrutiva foi executada. Solicitações
do titular têm responsável, prazo, verificação de identidade e exportação
autorizada. A área `/privacidade` e o cartão Lead 360 expõem estados, evidências,
DSR, retenção, holds e bloqueios de forma segura.

Antes da migration foi gerado o backup ignorado pelo Git
`.backups/crm-36/politizai_crm_public_pre_crm36_20260912T081500Z.dump`, com
2.348.788 bytes e SHA-256
`c0237020cf547ce84ce885de7aed3ff11b7d2d34b331d9740189787d1d581b51`.
`pg_restore --list` validou 1.324 entradas; uma restauração limpa em banco
temporário confirmou 89 tabelas, 26 migrations e as contagens do baseline, e o
banco temporário foi removido.

No workspace `politizai`, o dry-run inicial encontrou 475 leads elegíveis. A
execução criou 446 eventos e 475 projeções, preservando 29 casos sem sinal; o
replay criou zero evento. Uma correção no cálculo do dry-run passou a distinguir
preferência negativa de divergência real; o dry-run final encontrou 475 itens
já reconciliados e zero divergência. O estado final contém 10 categorias, uma
finalidade e uma base pendentes de validação jurídica, 446 eventos e 475 estados:
29 `UNKNOWN`, 112 `DENIED`, oito `OPTED_OUT` e 326 `REVIEW_REQUIRED`.

A primeira compilação reproduziu o erro da tentativa parcial: `TS2375` em
`privacy-service.ts`, causado por propriedades opcionais incompatíveis com
`exactOptionalPropertyTypes`. Depois da correção, a primeira integração revelou
uso do relógio real no `capturedAt` e contagem antiga de permissões do seed; ambos
foram alinhados ao relógio controlável e à matriz atual. A validação E2E expôs
que o formulário manual convertia checkbox não marcado em negativa explícita;
o campo passou a ter três estados — não informado, consentido e recusado — sem
alterar a política central.

O gate final aprovou `pnpm lint`, `pnpm typecheck`, `pnpm test` com 148 testes em
33 arquivos, `pnpm test:integration` com 217 testes em 29 arquivos, quatro testes
CRM-29, `pnpm audit` sem vulnerabilidades conhecidas, 58 E2E de produção mais um
local-only e o build otimizado do Next.js 16.3.4. `pnpm db:status` confirmou
27/27 migrations. O comando inexistente `pnpm db:validate` falhou apenas por não
estar definido; a validação equivalente `pnpm exec prisma validate --config
prisma.config.ts` passou.

A reconciliação final confirmou 106 tabelas, 531 Leads, 146 usuários, 18 equipes,
1.183 atividades, 59 oportunidades, 3.223 logs de auditoria, 31.096.832 bytes no
schema `public`, 475/475 Leads ativos do workspace vinculados a Contact, zero
sessão ativa concorrente e zero schema `politizai_test_*`. Os 82 schemas legados
permaneceram preservados. Nenhum deploy, provider externo, banco remoto,
integração real, decisão jurídica ou CRM-37 foi executado.

## Execução da CRM-35

O checkpoint partiu de `main` limpo em
`02c2e3f7a75d39068811d34bfa8740699cb905ba`, sincronizado com `origin/main`.
A migration aditiva `20260912030000_revenue_lifecycle_ownership` criou as
projeções `RevenueLifecycle`, `LifecycleHistory`, regras versionadas,
responsabilidades funcionais, transferências e runs/itens do backfill. Nenhuma
tabela, ID ou evento comercial legado foi removido; `Lead.status`, etapas de
pipeline, `Opportunity.status` e `Account.status` continuam conceitos
independentes.

O lifecycle canônico distingue `UNKNOWN`, `PROSPECT`, `LEAD`, `QUALIFIED`,
`OPPORTUNITY`, `CUSTOMER`, `ONBOARDING`, `ACTIVE`, `RENEWAL`, `CHURN` e
`INACTIVE`. O histórico temporal é protegido por trigger append-only, permitindo
somente o fechamento único do intervalo. Regras persistidas e versionadas
controlam transições; correções fora da matriz exigem permissão, motivo e
confirmação. O backfill nunca infere ativação, renovação ou churn sem fato.

`OwnershipAssignment` registra owner ou fila — exatamente um dos dois — para
Contact, Account, Lead e Opportunity, por função Marketing, SDR, Closer,
Customer Success, Farmer, Financeiro ou RevOps. Constraints impedem dois owners
ativos para o mesmo agregado/função. `OwnershipTransfer` mantém o owner vigente
até aceite explícito e registra pedido, aceite, rejeição, cancelamento e
conclusão. Entrada/redistribuição de Lead e criação de Opportunity fazem dual
write na mesma transação, preservando `LeadAssignment` e `CustomerHandoff`.

O backfill local foi executado primeiro em dry-run: 475 candidatos elegíveis e
zero mutação de domínio. A execução criou 475 projeções; o replay criou zero.
Após a suíte de interface criar três Leads/Contacts e uma Account fictícios no
banco local de demonstração, novo replay reconciliou um agregado adicional; o
replay final encontrou 479 existentes e criou zero. O estado final possui 479
projeções, 479 intervalos históricos, 1.013 responsabilidades ativas, zero
owner obrigatório ausente, zero estágio futuro inferido, zero vínculo entre
workspaces e uma transferência seedada pendente. Os 82 schemas legados foram
preservados e não restou schema efêmero de teste.

Antes da migration foi gerado o backup ignorado pelo Git
`.backups/crm-35/politizai_crm_public_pre_crm35_20260912T060000Z.dump`, com
1.974.375 bytes, SHA-256
`c36a8ab652a898d0dffb84703fbe85862630f89baa151cfc7aa2eb87b51fe595`;
`pg_restore --list` validou 1.204 entradas. O banco local final contém 475
Contacts, quatro Accounts, 531 Leads, 59 Opportunities, 1.183 Activities,
3.216 AuditLogs e 26 migrations. As três identidades de Lead e a Account
adicionais são dados explicitamente fictícios criados pelos E2E direcionados,
não dados externos nem reclassificação silenciosa.

O primeiro ciclo de integração expôs que o helper do histórico repassava alvos
de Lead/Opportunity para `LifecycleHistory`, que aceita apenas Contact/Account;
o writer foi restringido ao alvo canônico. O gate final aprovou `pnpm lint`,
`pnpm typecheck`, 137 testes unitários em 32 arquivos, 209 integrações em 28
arquivos, quatro testes CRM-29, `pnpm audit` sem vulnerabilidades conhecidas,
55 E2E de produção mais um local-only e o build otimizado do Next.js 16.3.4.
Os avisos conhecidos do loader nativo do Vite, da API concorrente do `pg` e de
stream encerrado pelo Playwright permanecem não bloqueantes. Nenhum deploy,
banco remoto, provider externo, contrato comercial ou CRM-36 foi executado.

## Execução da CRM-34

O checkpoint partiu de `main` limpo em
`eb9ac8071e4879ae362ac967274a0264296708fa`, sincronizado com `origin/main`.
A migration aditiva `20260912020000_canonical_accounts` criou Account,
AccountContactRole, BuyingCommittee, BuyingCommitteeMember, revisões de
identidade e registros persistidos de backfill, acrescentando somente vínculos
opcionais a Lead e Opportunity. O schema `public`, os IDs históricos e os 82
schemas legados preservados não foram apagados nem reescritos.

Account possui identidade normalizada, status, qualidade, origem, segmento,
porte e hierarquia protegida contra autorreferência, ciclo e vínculo entre
workspaces. Papéis de contato têm validade temporal e origem rastreável. O
comitê é associado à oportunidade, registra influência, autoridade e posição,
e respeita a autoria do contato. Conta 360, lista, fila de revisões e APIs usam
RBAC no servidor; SDR e closer recebem somente o universo próprio permitido,
gestor permanece limitado à equipe e visualizador não pode mutar.

O backfill foi executado primeiro em dry-run: 341 candidatos elegíveis e zero
mutação. A execução `0e0f7151-782b-4900-bcd8-207192793a4b` persistiu 341 itens
de revisão sem realizar merge ou associação ambígua; o replay criou zero item
adicional. O seed repetido permaneceu idempotente com três contas fictícias,
seis papéis de contato e um comitê. Foi necessário corrigir uma incompatibilidade
preexistente do replay CRM-29: AIInsight é evidência append-only e não pode ser
atualizada; o replay agora apenas reconhece a evidência existente.

Antes da migration foi gerado o backup ignorado pelo Git
`.backups/crm-34/politizai_crm_public_pre_crm34_20260912T050000Z.dump`, com
SHA-256 `781cede088606a96d725cfe50ccd741984d8607ad0993ee83ceaf8bb02d3d21b`;
`pg_restore --list` validou 1.092 entradas. A reconciliação de `public` após a
execução confirmou 528 Leads, 146 usuários, 18 equipes, 1.162 atividades, 59
oportunidades, 25 migrations, três contas seedadas, sete papéis ativos, um
comitê ativo, um membro ativo, 341 revisões abertas e zero vínculo de conta
entre workspaces.

O gate final aprovou `pnpm lint`, `pnpm typecheck`, `pnpm test` com 134 testes
em 31 arquivos, `pnpm test:integration` com 206 testes em 27 arquivos,
`pnpm test:crm29` com quatro testes, `pnpm audit` sem vulnerabilidades conhecidas,
`pnpm test:e2e` com 55 testes de produção e um local-only, e o build otimizado
do Next.js 16.3.4. Os schemas efêmeros foram descartados pelos executores. Os
avisos conhecidos do `pg` e de stream encerrado do Next.js permaneceram não
bloqueantes. Nenhum deploy, banco remoto, provedor externo ou CRM-35 foi
executado.

## Execução da CRM-33

O checkpoint partiu de `main` em `0657dd71c8ab2260779a5f4922bacb71c7aca83c`,
com a implementação parcial preservada também na branch privada de segurança
`safety/crm33-pre-prod01-20260912`. A migration aditiva
`20260912010000_canonical_contacts` criou Contact, ContactPoint,
ContactIdentityReview e as tabelas de run/item do backfill, acrescentou vínculos
opcionais em Lead/submissão e manteve todos os campos e IDs legados. Constraints
compostas impedem vínculo cruzado; unicidades parciais impedem ponto repetido e
mais de um primário ativo dentro do Contact sem proibir valores compartilhados
entre pessoas.

O fluxo único de entrada passou a fazer dual write na mesma transação. Colisões
abrem revisão com evidência e fingerprint, sem merge; opt-out é monotônico. A
aba Identidade do Lead 360 e três Route Handlers finos usam autorização no
servidor. `contacts.read` respeita o escopo do Lead, `contacts.review` permite a
decisão humana auditada e `contacts.backfill` é administrativo. O backfill tem
dry-run, cursor, lote, pausa/retomada, lock por workspace, falha atômica e replay
idempotente. Um teste concorrente expôs `P2034` sob `Serializable`; a transação
do lote passou a `ReadCommitted`, pois o advisory lock já serializa a execução e
o segundo consumidor precisa observar o cursor confirmado pelo primeiro.

No workspace `politizai`, o dry-run `c13fed37-b852-4aef-8463-14c3e768698c`
processou 472 candidatos sem mutação. A execução
`d1cfd514-e18a-4379-96cb-478567590a29` criou 472 Contacts e 832 ContactPoints,
ligou 472 Leads e todas as 518 submissões correspondentes, abriu 157 reviews e
terminou com zero ignorado ou falho. A repetição executou zero lote adicional.
Os 48 Leads ativos pertencentes a workspaces históricos de teste ficaram fora
do workspace autenticado e sem vínculo; não houve backfill global.

A reconciliação final obteve 74 tabelas, 24 migrations, 528 Leads totais, 520
ativos, 472/472 Leads operacionais ligados, zero vínculo cross-workspace, zero
opt-out sem proteção e zero `politizai_test_*`. Os fingerprints de Lead,
submissão, atividade, oportunidade, reunião e StageHistory permaneceram,
respectivamente, `9e7410daf0dd092a08ba79d1fdb4d8e8`,
`6a98562845fe1e6d4f13fd8603c66177`,
`e71789dcd2e558763785c43e7ec2937e`,
`914bee852a76d6fb5060bebec46cee56`,
`774a811dd3932bcf5bcc4e1e5e1c948d` e
`7d1383852800686dc5fb0b75967765be`. Os 82 schemas legados protegidos não foram
alterados.

Os gates passaram com 132 testes unitários, 203 integrações, 4 CRM-29, 53 E2E
de produção e 1 E2E local-only. Prisma format/validate/generate, lint, typecheck,
audit, build, `db:status` e `git diff --check` também passaram. A suíte E2E
validou novamente login, dashboard, auditoria, Lead 360 e os três cenários que
haviam bloqueado a revalidação anterior. Nenhum deploy, provider, banco remoto,
Account, merge ou contract foi executado.

## Revalidação da PROD-01 — bloqueio resolvido pela CRM-33

Em 12 de setembro de 2026, uma nova autorização para executar a PROD-01 encontrou
o resultado histórico da tarefa já versionado no commit `0fd861e` e publicado em
`Menddon/crm-politizai`. A autenticação ativa continua sendo `Menddon`, o
repositório permanece privado e `main` local/remota apontavam para
`0657dd71c8ab2260779a5f4922bacb71c7aca83c` no início da revalidação.

O worktree já continha alterações não commitadas de uma tarefa posterior de
identidade canônica. Elas não foram editadas pela PROD-01 e foram preservadas na
branch privada `safety/crm33-pre-prod01-20260912`, mantendo `main` inalterada.
Também foi criado um backup atualizado somente de `public` em
`.backups/prod-01/politizai_crm_public_revalidation_20260912.dump`, com 1.539.822
bytes, SHA-256
`9e1bfe16206d273165127e9411ad11e18d52a749c666802adb7fe96fb161d75f` e 1.092
entradas. A restauração de ensaio local reconciliou 74 tabelas, 25 registros em
`_prisma_migrations`, 528 leads, 1.162 atividades, 59 oportunidades e 1.854 logs
de auditoria; o banco temporário foi removido.

O dry-run de `pnpm db:test:cleanup` encontrou zero candidatos e preservou os 82
schemas legados sem evidência suficiente. Lint, typecheck, 132 testes unitários,
203 integrações e 4 testes CRM-29 passaram, sempre com descarte dos schemas
`politizai_test_*`. Naquele momento, a suíte E2E terminou com 50 cenários
aprovados e três falhas: duas expectativas antigas assumiam que `ArrowRight` salta de Resumo
diretamente para PACTO, embora a alteração posterior tenha inserido Identidade
entre as abas; a terceira encontra dois headings iguais depois dessa nova aba.
Essas expectativas e o seletor foram corrigidos dentro da CRM-33, que é a task
proprietária da nova aba; a suíte completa agora passa com 53 + 1 cenários.

O bloqueio funcional deixou de existir na CRM-33. `pnpm audit`, build,
`db:status` e descarte dos schemas efêmeros foram repetidos com sucesso;
`public` permanece com 74 tabelas e as contagens comerciais foram preservadas.
Nenhum schema legado, volume, código-fonte, `node_modules`, banco remoto ou
deploy foi removido ou alterado por essa revalidação.

### Revalidação integral após a CRM-33

Uma nova autorização explícita da PROD-01 partiu de `main` limpo em
`c221caf96b768e0625e6d0aba181957291c462c1`, já igual a `origin/main`. O GitHub
CLI confirmou a conta `Menddon` e o repositório `Menddon/crm-politizai` como
`PRIVATE`. O `.gitignore` vigente cobre ambientes, `.next`, `node_modules`,
clientes gerados, backups/dumps, relatórios, logs, caches e credenciais; a
varredura do conjunto versionável não encontrou segredo real.

O novo dump exclusivo de `public` ficou em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T044424Z.dump`, com
1.834.456 bytes, SHA-256
`d878babbb85236b55f682f58a7937de536c7631cbd7252ee436e2d09b4862d75` e
1.092 linhas no inventário. A restauração local de ensaio reconciliou 74
tabelas, 25 registros em `_prisma_migrations`, 528 leads, 146 usuários, 18
equipes, 1.162 atividades, 59 oportunidades e 3.170 logs de auditoria. Os
fingerprints de Lead, Activity e Opportunity permaneceram, respectivamente,
`9e7410daf0dd092a08ba79d1fdb4d8e8`,
`e71789dcd2e558763785c43e7ec2937e` e
`914bee852a76d6fb5060bebec46cee56`; o banco temporário foi removido.

O dry-run `pnpm db:test:cleanup` encontrou zero candidatos e manteve os 82
schemas legados sem segunda evidência. Os gates passaram com 132 testes
unitários, 203 integrações, 4 CRM-29, 53 E2E de produção e 1 local, além de lint,
typecheck, audit sem vulnerabilidades, build, health e `db:status`. Cada executor
eliminou o próprio schema efêmero; o resultado final foi zero
`politizai_test_*`, nenhuma conexão ativa e `public` íntegro. Permanecem como
avisos não bloqueantes a depreciação do `pg` para consulta concorrente no mesmo
client, o aviso do loader nativo do Vite e as mensagens de stream encerrada pelo
Playwright.

Depois dos gates, foram removidos somente 519.948 KiB de `.next` e 4 KiB de
`test-results`. `node_modules` permaneceu com 1.209.744 KiB, o volume
`politizai-crm_postgres_data` permaneceu montado e nenhum schema legado foi
apagado nesta revalidação. Nenhum deploy, Vercel, Neon, banco remoto, CRM-32 ou
tarefa posterior foi executado por esta autorização.

### Revalidação após a CRM-35

Uma nova autorização explícita da PROD-01 encontrou a implementação da tarefa
já versionada, `main` local/remota em
`03563db2231bf2343c4eeced1d3d9b732dec461f` e o repositório
`Menddon/crm-politizai` privado. A varredura do conjunto versionável não
encontrou token, chave privada ou credencial de Vercel/GitHub. As alterações
incompletas de CRM-36 foram preservadas sem execução na branch privada
`safety/crm36-pre-prod01-20260912`.

O dump atualizado de `public` ficou em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T072357Z.dump`, com
2.348.631 bytes, SHA-256
`9300e0fb23c3bd201ace730a0052207253b17d1ff85d28cb235a20efc76eb001` e 1.324
entradas. A restauração local de ensaio reconciliou 89 tabelas, 26 migrations
concluídas, 531 leads, 146 usuários, 18 equipes, 1.183 atividades, 59
oportunidades e 3.216 logs de auditoria. Os fingerprints de Lead, Activity e
Opportunity coincidiram; o banco temporário foi removido.

Em checkout limpo e isolado do mesmo commit, passaram lint, typecheck, 137
testes unitários, 209 testes de integração, quatro testes CRM-29, audit sem
vulnerabilidades conhecidas, build, 55 E2E de produção e um E2E local. Health,
login, dashboard e auditoria responderam HTTP 200. O login acrescentou um
registro append-only ao `audit_logs`; nenhuma identidade comercial mudou. Os
executores removeram seus schemas no `finally`: o estado final tem zero
`politizai_test_*`, nenhuma operação ativa e os mesmos 82 schemas legados
protegidos. `.next` e relatórios já estavam ausentes no checkout principal;
`node_modules`, `public` e o volume foram preservados. Nenhum deploy, Vercel,
Neon, banco remoto, PROD-02 ou CRM-37 foi executado.

O checkout principal terminou com 1.273.112 KiB, `node_modules` com 1.209.744
KiB e `.next` ausente. O banco ficou com 1.026.274.995 bytes, `public` com
28.524.544 bytes e o volume Docker reportou 1,185 GB sem ser removido. O disco
passou de 16.277.016 para 17.021.060 KiB livres após o descarte do checkout
temporário de validação. Nenhum espaço foi atribuído a remoção de schemas,
pois o dry-run encontrou zero candidatos.

### Revalidação após a CRM-36

Uma nova autorização explícita da PROD-01 encontrou `main` local e remota em
`b10f8865cbe7638e1ec0d6f9645ae6919f75deb3` e o repositório
`Menddon/crm-politizai` privado. O código parcial não relacionado de CRM-37 foi
preservado em stash de segurança durante a validação e não foi editado nem
incluído no commit da PROD-01.

O backup exclusivo de `public` ficou em
`.backups/prod-01/politizai_crm_public_revalidation_20260912T091636Z.dump`, com
2.641.918 bytes, SHA-256
`40b59535564f9f051a116db488ebb9d9cc5395bb6967b31af83d7aedc2f4fbb7` e
1.511 entradas. A restauração de ensaio confirmou 106 tabelas, 27 migrations,
531 leads, 146 usuários, 18 equipes, 1.183 atividades, 59 oportunidades e 3.223
logs de auditoria, além dos fingerprints idênticos de Lead, Activity e
Opportunity. O banco temporário foi removido.

O dry-run e a confirmação de `pnpm db:test:cleanup` removeram zero schemas: os
82 nomes legados continuam protegidos por ausência de segunda evidência. Os
gates passaram com lint, typecheck, 148 testes unitários, 217 de integração,
quatro CRM-29, 58 E2E de produção, um E2E local, audit sem vulnerabilidades
conhecidas, build e `db:status`. Health, login, dashboard e auditoria retornaram
HTTP 200; o login acrescentou apenas um AuditLog append-only. Todos os schemas
`politizai_test_*` foram descartados em `finally`.

Depois dos gates, foram removidos somente `.next` e relatórios regeneráveis do
CRM. `node_modules`, `public`, o banco e o volume foram preservados. Nenhum
deploy, Vercel, Neon, banco remoto, PROD-02 ou CRM-32 foi executado pela PROD-01.

## Execução da CRM-32

O checkpoint inicial confirmou `main` limpo em `0fd861e`, igual a `origin/main`,
repositório `Menddon/crm-politizai` privado, backup da PROD-01 ignorado, `.next`
ausente, banco local `politizai_crm` atualizado e zero mudança nos 82 schemas
legados preservados. Foram inspecionados AGENTS/CLAUDE, guias locais do Next.js
16.3.4, 23 migrations, 68 models e 69 tabelas atuais, módulos, rotas, suítes e a
documentação de produto, dados, métricas, permissões, automações, IA, operação e
deployment futuro.

A arquitetura mantém o monólito modular e planeja expansão aditiva por
`expand → migrate → reconcile → switch → contract`. CRM-33 a CRM-64 foram
registradas apenas como backlog `NÃO INICIADO`, com dependências, P0/P1,
credenciais externas, critérios de aceite e gates de status. Nenhum schema,
migration, rota, serviço, componente, provider ou recurso externo foi criado.

A validação automatizada confirmou os 12 documentos requeridos, 32 tarefas em
ordem exata de CRM-33 a CRM-64, links locais existentes e presença dos conceitos
obrigatórios. `pnpm lint` e `pnpm typecheck` terminaram com exit code 0;
`pnpm db:status` confirmou 23 migrations e `public` atualizado. Testes unitários,
integração, E2E e build não foram repetidos porque o diff contém somente Markdown
e regenerar o build contrariaria a limpeza final de `.next` sem acrescentar
cobertura ao escopo documental. O Git final deve conter somente estes documentos
e manter SHA local/remoto coincidente em repositório privado.

## Execução da PROD-01

O checkout não possuía commits ou remote. A autenticação do GitHub CLI foi
confirmada como `Menddon`; o snapshot inicial virou o commit `59a4004` e foi
enviado para `main` do repositório privado `Menddon/crm-politizai`. `.gitignore`
passou a excluir ambiente, builds, clientes gerados, dumps, backups, logs,
relatórios, caches e credenciais. A varredura do conjunto versionável não
encontrou segredo real.

O dump custom exclusivo de `public` foi criado em `.backups/prod-01`, ignorado
pelo Git, com 1.495.503 bytes e SHA-256
`325b4451d40238121b1e5c00fd5c02f4d8f1bedd5329ab55dc3e096807b16fe9`.
`pg_restore --list` leu 1.014 entradas. A restauração de ensaio em banco local
temporário reconciliou 69 tabelas, 24 migrations, 528 leads, 146 usuários, 18
equipes, 1.162 atividades, 59 oportunidades e 1.853 logs; o banco temporário foi
removido depois.

O dry-run encontrou 140 schemas não permanentes. Somente os 58 nomes com
evidência literal nos executores/checkpoint entraram na allowlist; 82 sem prova
suficiente foram preservados. A primeira remoção em lote falhou e foi totalmente
revertida com `ERROR 53200: out of shared memory`, porque uma transação única
excedeu `max_locks_per_transaction`. A manutenção passou a usar uma transação
por schema allowlisted e removeu 58/58 sem tocar em `public`. O banco caiu de
1.527 MB para 971 MB. Health, login, dashboard e auditoria responderam HTTP 200.

Os executores agora geram `politizai_test_<tipo>_<timestamp>_<sufixo>`, recusam
host remoto, outro banco, produção e `public`, encerram processos/conexões e
removem em `finally`. O dry-run é o padrão de `pnpm db:test:cleanup`; a execução
exige confirmação literal. `KEEP_TEST_SCHEMA=1` é a única preservação aceita.

Na validação final, lint, tipos, 132/132 unitários, 199/199 integrações,
4/4 CRM-29, 53/53 E2E de produção, 1/1 E2E local, audit sem vulnerabilidades e
status de migrations passaram. Um seletor E2E ambíguo foi restringido ao menu
principal. O primeiro login frio sob `next dev` respondeu em 8,5 s e excedeu a
janela total antiga; somente o timeout local passou a 30 s. O gate final e as
medições foram concluídos antes da remoção final de `.next`; nenhum build foi
executado depois dessa remoção.

Ao final, `public` manteve 69 tabelas, 24 migrations, 528 leads, 146 usuários,
18 equipes, 1.162 atividades e 59 oportunidades. A auditoria passou de 1.853
para 1.854 registros pela validação real de login, preservando seu desenho
append-only. Não havia conexão ativa nem schema `politizai_test_*`; os 82
schemas sem prova suficiente continuaram preservados. O banco terminou com
1.018.025.651 bytes (`971 MB` pelo PostgreSQL) e o volume com 1.331.544 KiB.

O checkout caiu de 1.920.524 KiB para 1.243.888 KiB ao remover somente os
676.632 KiB de `.next` e relatórios regeneráveis. O espaço livre medido nessa
etapa passou de 15.747.024 KiB para 16.406.200 KiB. `node_modules` permaneceu
com 1.209.744 KiB. O backup local permaneceu ignorado, com 1.495.503 bytes,
checksum confirmado e inventário legível. O commit final da PROD-01 e o SHA
remoto são registrados pela evidência do push no relatório de execução.

## Validação da DESIGN-07

Em 11 de setembro de 2026, a DESIGN-07 foi validada sem mudança de schema ou de
regra comercial. Foram aprovados 127 testes unitários, 198 testes de integração
em schema PostgreSQL recriado pelas 23 migrations, 53 E2E no build de produção
e 1 E2E exclusivo do ambiente local. Lint, TypeScript estrito e o build do
Next.js 16.3.4 passaram.

O QA percorreu 15 rotas em 1440×900, 1280×800, 1024×768, 768×1024 e 390×844,
além de PACTO, Inteligência, Login, Acesso negado, Sessão expirada e refluxo
equivalente a zoom de 200%. A primeira execução integral expôs duas fragilidades
nos testes: a agenda procurava reunião no dia atual, embora o seed garanta as
reuniões ativas no dia seguinte, e um teste antigo dependia da pontuação literal
do estado vazio. Os seletores foram tornados determinísticos e semânticos; a
repetição direcionada passou 2/2 e o gate integral seguinte passou 53/53 + 1/1.

As mensagens `The destination stream closed early` continuam aparecendo no
servidor quando o Playwright abandona navegações, sem falhar os cenários. O
driver `pg` mantém o aviso de depreciação já documentado para consultas
concorrentes no mesmo client. Nenhum deploy foi executado.

## Observação do checkpoint anterior à PROD-01

Antes da PROD-01, o branch `main` não possuía commits e todos os arquivos
apareciam como não rastreados. Esse estado foi preservado integralmente no
primeiro commit `59a4004` e enviado ao repositório privado. O arquivo
`prisma/schema 2.prisma` e cópias semelhantes dentro do cliente Prisma gerado
foram encontrados como artefatos preexistentes e não foram alterados nem usados
como fonte do schema.

Parte de `node_modules` estava marcada pelo File Provider do macOS como
`compressed,dataless`, fazendo comandos locais aguardarem indefinidamente. Para
não alterar dependências do projeto, as validações foram executadas em uma cópia
byte a byte do snapshot final em `/tmp`, usando exclusivamente o lockfile e o
store offline. A validação inicial no mirror resolveu Node.js 24.18.0; os gates
finais foram repetidos com `/Users/matheusmendonca/.local/bin/node` 22.23.1,
dentro da versão declarada pelo projeto.

## Validação da CRM-07

Em 10 de setembro de 2026, a CRM-07 foi validada em um schema PostgreSQL vazio
e isolado (`crm07_final`): as oito migrations anteriores foram aplicadas, 46
testes de integração passaram, 58 testes unitários passaram e 11 cenários E2E
passaram com um worker. Lint, TypeScript estrito e build otimizado do Next.js
16.3.4 também passaram.

Durante a validação, foram reproduzidos e corrigidos dois defeitos do escopo: a
referência React ao formulário manual era usada depois de um `await`, e
`ImportJob.startedAt` podia anteceder por milissegundos o `createdAt` gerado no
banco, violando `import_jobs_time_order_check`. A suíte E2E foi serializada
porque compilação concorrente de rotas no único `next dev` causava Fast Refresh
e apagava estado do navegador, embora os endpoints tivessem respondido com
sucesso.

## Validação da CRM-08

Em 10 de setembro de 2026, a CRM-08 foi validada em um schema PostgreSQL vazio
e isolado (`crm08_final2`). As nove migrations foram aplicadas; 54 testes de
integração, 58 testes unitários e 13 cenários E2E passaram. Lint, TypeScript
estrito e o build otimizado do Next.js 16.3.4 também passaram.

Os testes direcionados cobrem criação e conclusão de tarefas, projeção da
próxima ação, tarefas vencidas, atividades principais, atores humanos e de
serviço, ordenação e paginação da timeline, primeira tentativa idempotente,
primeira conexão, resposta recebida, correção sem apagar fatos, imutabilidade no
banco, auditoria, negação de permissão, rollback transacional e exibição no fuso
`America/Sao_Paulo`. A suíte E2E confirmou criação e leitura persistida, estados
de inexistência e bloqueio server-side de mutação para o visualizador.

## Validação da CRM-09

Em 10 de setembro de 2026, a CRM-09 foi validada em um schema PostgreSQL vazio
e isolado (`crm09_final2`). As dez migrations foram aplicadas; 61 testes de
integração, 58 testes unitários e 15 cenários E2E passaram. Lint, TypeScript
estrito e o build otimizado do Next.js 16.3.4 também passaram. O schema `public`
do banco local está atualizado com as dez migrations.

Os testes direcionados cobrem todos os grupos de filtros e suas combinações,
busca, score e SLA vigentes, ordenação operacional, paginação com 305 leads,
visualização salva privada e isolada por workspace, soft delete, redistribuição
em massa, confirmação, timeline, auditoria, negação ao visualizador, escopos
OWN/TEAM/WORKSPACE e tentativa de acesso cruzado. Os cenários E2E confirmam o
estado na URL, colunas configuráveis, semântica acessível da tabela, estado sem
resultados, abertura do histórico e autorização server-side da ação em massa.

Durante a validação, o primeiro E2E revelou uma importação indevida do serviço
Prisma por um Client Component; os contratos serializáveis da lista foram
separados em um módulo de domínio sem dependências de servidor. A suíte completa
também revelou que o teste do seed pressupunha uma base global sem leads; ele
passou a verificar corretamente que executar o seed não altera as contagens
operacionais, tornando o teste independente dos dados criados por outras
suítes. Naquele checkpoint, nenhuma funcionalidade da CRM-10 havia sido
iniciada.

## Validação da CRM-10

Em 10 de setembro de 2026, a CRM-10 foi validada em um schema PostgreSQL vazio
e isolado (`crm10_final2`). As dez migrations existentes foram aplicadas; 66
testes de integração, 62 testes unitários e 16 cenários E2E passaram. Lint,
TypeScript estrito e o build otimizado do Next.js 16.3.4 também passaram. A
task não alterou o schema, e o schema `public` permanece atualizado com as dez
migrations.

Os testes direcionados cobrem a ordem resposta → novos P1/P2/P3 → vencido →
demais, limites de SLA de 60 e 180 segundos, recomendações e motivos,
respondidos, atualização após atividade persistida, reunião no dia de
`America/Sao_Paulo`, escopo próprio do SDR, filtro do Gestor por SDR, negação de
acesso a outro responsável e reconciliação da contagem com o recorte da lista.
O E2E percorre entrada P1, fila Meu Dia, nove seções, SLA, drilldown, ação
recomendada, registro da primeira tentativa com próxima ação e retorno à fila
com dados atualizados.

Durante a validação, o primeiro E2E passou funcionalmente, mas o navegador
registrou divergência de hidratação porque o relógio iniciava com `Date.now()`.
O estado inicial passou a usar o `generatedAt` serializado pelo servidor; o E2E
foi repetido sem a divergência. Uma execução de gates também encontrou um
import não usado e ampliação indevida do tipo da prioridade; ambos foram
corrigidos e todos os gates foram reiniciados. Nenhuma funcionalidade da
CRM-11 foi iniciada.

## Validação da CRM-11

Em 10 de setembro de 2026, a CRM-11 foi validada em um schema PostgreSQL vazio
e isolado (`crm11_final`). As dez migrations existentes foram aplicadas; 70
testes de integração, 62 testes unitários e 17 cenários E2E passaram. Lint,
TypeScript estrito e o build otimizado do Next.js 16.3.4 também passaram. A
task não alterou o schema.

Os testes direcionados cobrem carregamento do cabeçalho e resumo a partir de
dados persistidos, respostas da submissão, campos ausentes, permissões
efetivas, dados de contato sob o escopo do lead, edição e limpeza explícita de
campos opcionais, timeline e auditoria, conflito otimista sem sobrescrita,
inexistência e soft delete. O E2E confirma ações rápidas sem sair do cartão,
registro de atividade e tarefa, redistribuição pelo serviço da CRM-06, negação
server-side ao Visualizador, aba Auditoria exclusiva para papel autorizado,
paginação já preservada e estados honestos de PACTO e Inteligência.

A suíte completa revelou duas regressões apenas nos testes antigos: a lista
ainda procurava o título anterior `Histórico operacional`, e o deep link do Meu
Dia chegava ao painel Timeline oculto. O título esperado foi atualizado e o
cartão passou a selecionar a aba correta quando recebe os hashes persistentes
`#registrar-atividade`, `#criar-tarefa` ou `#tarefas`. Dois seletores novos
também estavam estritos demais para textos compostos; foram corrigidos após a
inspeção da árvore acessível. Todos os testes foram repetidos com sucesso.

Naquele checkpoint, PACTO, transições de pipeline, agenda, oportunidades, IA e
auditoria pesquisável ainda não tinham sido implementados. A CRM-12 substituiu
somente o estado vazio do PACTO; as demais abas continuam reservadas às tasks
futuras.

## Validação da CRM-12

Em 10 de setembro de 2026, a CRM-12 foi validada em schemas PostgreSQL vazios e
isolados (`crm12_final2` para integração e `crm12_e2e` para E2E). As onze
migrations foram aplicadas desde o zero; 75 testes de integração, 62 testes
unitários e 17 cenários E2E passaram. Lint, TypeScript estrito e o build
otimizado do Next.js 16.3.4 também passaram. A migration PACTO foi aplicada ao
schema `public`, cujo status ficou atualizado.

Os testes direcionados cobrem Não investigado, Favorável, Parcial,
Desfavorável e Desqualificante; preenchimento parcial; mínimo configurado;
rascunho; validação; histórico append-only; evidências/origens; sinais separados
de formulário e IA; negação ao Visualizador; revisão otimista; concorrência e
rollback transacional. O E2E confirma edição das cinco dimensões, rascunho,
validação, prontidão, histórico e interface de somente leitura.

Uma repetição da suíte de integração no mesmo schema falhou em testes legados
porque CRM-08/09/10 recriam telefones determinísticos e pressupõem dados
descartáveis. A execução completa em schema novo passou. A primeira tentativa
de E2E no `public`, já acumulando mais de cem leads de execuções anteriores,
também excedeu o limite de cards do teste do Meu Dia; a execução integral no
schema isolado passou. Os dados locais existentes não foram apagados nem
resetados. O host de validação usa Node.js 24.18.0 e emitiu o aviso de engine,
pois o projeto declara Node.js 22; também permanece o aviso de depreciação do
`pg` já observado nas tasks anteriores.

Naquele checkpoint, a CRM-13 e todas as tasks posteriores permaneciam não
iniciadas. Nenhum deploy, integração externa, scoring configurável ou transição
de pipeline havia sido realizado.

## Validação da CRM-13

Em 10 de setembro de 2026, a CRM-13 foi validada em schemas PostgreSQL vazios e
isolados (`crm13_final4` para integração e `crm13_e2e2` para E2E). As doze
migrations foram aplicadas desde o zero; 81 testes de integração, 67 testes
unitários e 17 cenários E2E passaram. Lint, TypeScript estrito e o build
otimizado do Next.js 16.3.4 também passaram. A migration foi aplicada ao schema
`public`, o seed foi executado duas vezes sem duplicar sua única regra ativa e o
status final confirmou as doze migrations aplicadas.

Os testes direcionados cobrem limites 0/39/40/69/70/100, P1/P2/P3, campos
ausentes separados de sinais negativos, pesos e penalidades, cálculo provisório
do formulário, score de PACTO validado, sugestão de IA não vigente, override
humano com motivo e auditoria, recálculo, versões reproduzíveis, histórico
append-only, concorrência otimista, rollback, RBAC e isolamento por workspace.
Lista de leads, Meu Dia e cartão 360 leem `LeadCurrentScore`; cada ciclo de SLA
preserva a faixa calculada no momento de sua entrada.

Durante os gates, o lint detectou estado duplicado sincronizado por `useEffect`;
o painel passou a ser controlado pela projeção do cartão. O E2E então mostrou
que a remontagem do painel descartava a mensagem de sucesso após um override;
remover a remontagem corrigiu o feedback. Uma primeira repetição da integração
foi enviada por engano ao schema legado `crm02_integration`, pois as variáveis
não chegaram ao processo; seus cinco erros refletiam dados residuais e essa
execução não foi considerada. A repetição com as variáveis explícitas no comando
usou `crm13_final4` vazio e passou integralmente.

O host de validação usa Node.js 24.18.0, enquanto o projeto declara Node.js 22,
e emitiu o aviso de engine. Também permanece o aviso de depreciação de consultas
concorrentes do `pg` já observado em tasks anteriores; nenhum dos avisos causou
falha. Não houve deploy, integração externa nem implementação da CRM-14.

## Validação da CRM-14

Em 10 de setembro de 2026, a CRM-14 foi validada em schemas PostgreSQL vazios e
isolados (`crm14_full1` para integração e `crm14_e2e1` para E2E). As treze
migrations foram aplicadas desde o zero; 70 testes unitários, 88 testes de
integração e 19 cenários E2E passaram. Lint, TypeScript estrito e o build
otimizado do Next.js 16.3.4 também passaram.

Os testes direcionados cobrem o grafo completo, transições válidas e inválidas,
PACTO incompleto, falta de próxima ação, desqualificação com motivo e
confirmação, correção gerencial, negação ao SDR e Visualizador, concorrência
serializada, versão otimista, rollback integral, intervalos calculáveis e
imutabilidade de `StageHistory`. O E2E percorre quadro, drag and drop, lista,
cartão, mensagem explicativa de bloqueio e somente leitura.

A migration foi aplicada ao schema `public` que continha as doze migrations
anteriores e converteu, pelo fingerprint estrutural, somente o pipeline de seis
etapas da Politizai. O resultado possui os oito códigos semânticos esperados,
sem divergência entre a etapa atual e o histórico aberto. O seed foi repetido
duas vezes sem duplicar etapas, e `prisma migrate status` confirmou o banco
atualizado.

O primeiro typecheck encontrou apenas uma perda de estreitamento de tipo após
um callback; o código foi ajustado sem alterar a regra. O primeiro E2E confirmou
o bloqueio correto no servidor, mas o seletor também capturava o anunciador do
Next.js; o teste foi tornado específico e repetido com sucesso. Permanece o
aviso de engine porque o host usa Node.js 24.18.0 e o projeto declara Node.js 22,
além do aviso futuro do `pg` 9 observado nas tasks anteriores. Nenhum deploy,
integração externa ou implementação da CRM-15 foi realizado.

## Validação da CRM-15

Em 10 de setembro de 2026, a CRM-15 foi validada em schemas PostgreSQL vazios e
isolados (`crm15_final` para integração e `crm15_e2e_final` para E2E). As
quatorze migrations foram aplicadas desde o zero e a reaplicação pelo fluxo
normal confirmou ausência de pendências; 73 testes unitários, 96 testes de
integração e 20 cenários E2E passaram. Lint, TypeScript estrito e o build
otimizado do Next.js 16.3.4 também passaram.

Os oito testes direcionados de agenda cobrem agendamento atômico com tarefa,
timeline, auditoria e transição de pipeline; conflito concorrente; confirmação;
remarcação e histórico imutável; comparecimento; no-show; cancelamento sem
contabilização indevida; escopos de Closer, Gestor, SDR e Visualizador; pendência
de horário passado; briefing persistido; timezone e rollback. O E2E percorre
qualificação do lead, agendamento no cartão, confirmação na agenda e leitura do
briefing pelo closer.

A primeira aplicação experimental da migration reproduziu a restrição do
PostgreSQL que impede usar um novo valor de enum antes do commit. Os `ALTER TYPE`
foram separados da transação que cria constraints e a cadeia completa passou em
banco vazio. A migration foi então aplicada ao schema `public`, o seed foi
repetido duas vezes para materializar as permissões de reunião sem duplicação e
`prisma migrate status` confirmou as quatorze migrations aplicadas.

O host continua em Node.js 24.18.0, enquanto o projeto declara Node.js 22, e
emitiu o aviso de engine. Também permanece o aviso de depreciação de consultas
concorrentes do `pg` para sua futura versão 9; ambos são pendências técnicas já
conhecidas e não causaram falhas. Não houve deploy, calendário externo,
implementação de oportunidades ou execução da CRM-16.

## Validação da CRM-16

Em 10 de setembro de 2026, a CRM-16 foi validada em schemas PostgreSQL vazios e
isolados (`crm16_final`, `crm16_migration_retry` e `crm16_e2e_final`). As quinze
migrations foram aplicadas desde o zero e a reaplicação pelo fluxo normal não
encontrou pendências. Passaram 76 testes unitários, 104 testes de integração e
21 cenários E2E, além de lint, TypeScript estrito e build otimizado do Next.js
16.3.4.

Os oito testes direcionados do fluxo comercial cobrem criação atômica vinculada
a lead/reunião/closer; produto ou interesse; centavos, MRR, TCV e probabilidade
manual; rollback e constraints; comparecimento da reunião; proposta; negociação;
ganho; perda; motivo; reabertura gerencial; escopos RBAC; filtros; concorrência;
revisão otimista; intervalo único aberto; timeline e auditoria. O E2E percorre
login, entrada e qualificação do lead, reunião, comparecimento, criação da
oportunidade, proposta pela interface, negociação, ganho e conferência do estado
persistido.

A primeira tentativa de aplicar a migration no schema local existente falhou.
O comando `pnpm db:migrate:deploy` mostrou `current transaction is aborted`, e a
reprodução isolada revelou a causa primária exata: `duplicate key value violates
unique constraint "pipeline_stages_position_active_key"`, ao mover diretamente
a etapa da posição 2 para a 3 enquanto a posição 3 ainda existia. A migration
passou a deslocar temporariamente as posições para fora da faixa e a tolerar o
enum já criado pela tentativa anterior. Após marcar somente essa execução como
rolled back, a migration foi reaplicada com sucesso.

No schema `public`, o seed foi executado duas vezes com a mesma contagem
estrutural. `prisma migrate status` confirmou as quinze migrations aplicadas. O
pipeline Vendas da Politizai ficou com sete posições e os sete códigos tipados;
os oito registros legados de oportunidade e as oito ofertas foram preservados,
sem dinheiro negativo nem violação da nova política de produto/interesse e
valor/justificativa.

O host continua em Node.js 24.18.0, enquanto o projeto declara Node.js 22, e
emitiu o aviso de engine. Também permanece o aviso de depreciação de consultas
concorrentes do `pg` para sua futura versão 9; ambos são pendências técnicas já
conhecidas e não causaram falhas. Não houve deploy, pagamento, previsão por IA,
integração externa nem execução da CRM-17.

## Validação da CRM-17

Em 10 de setembro de 2026, a CRM-17 foi validada em schemas PostgreSQL
isolados. As dezesseis migrations foram aplicadas desde um banco vazio e a
reaplicação pelo fluxo normal não encontrou inconsistências. A migration da
CRM-17 também foi aplicada no schema local `public`; `prisma migrate status`
confirmou o banco atualizado. O seed executado duas vezes manteve o mesmo
estado estrutural: uma versão inicial das configurações, sete passos de
cadência e 33 transições permitidas.

As configurações de produtos, ofertas, preços em centavos, pipelines,
transições, motivos, SLA, faixas e pesos de score, mínimo PACTO, cadência,
duração de reuniões, distribuição e limites de estagnação pertencem ao
workspace. Mudanças com efeito histórico criam versões; scores e ciclos de SLA
anteriores não são reescritos. Itens em uso são inativados em vez de excluídos,
alterações sensíveis exibem impacto antes da confirmação e todas as mutações
passam por autorização no servidor e auditoria transacional.

Passaram 76 testes unitários, 112 testes de integração e 23 cenários E2E. A
integração cobre autorização, isolamento, validações, versionamento, catálogos,
item em uso, auditoria, transições, reordenação sem colisão, rollback e limite
de distribuição. Os E2E validam a criação confirmada de produto pela interface
e a negativa de acesso direto ao SDR. Lint, TypeScript estrito e build otimizado
do Next.js 16.3.4 também passaram.

Uma primeira tentativa de E2E foi interrompida porque a variável apontava para
a porta 3117 enquanto o servidor do Playwright está configurado na porta 3100;
ela encerrou com código 130 antes dos testes. O comando corrigido na porta 3100
passou os 23 cenários. O servidor de desenvolvimento registrou uma mensagem
transitória `The destination stream closed early` depois de um cenário aprovado,
sem falha da suíte.

O host continua em Node.js 24.18.0, enquanto o projeto declara Node.js 22, e
emitiu o aviso de engine. O driver `pg` também avisou sobre a futura remoção de
consultas concorrentes no mesmo cliente na versão 9. Nenhum dos avisos causou
falha. Não houve deploy, integração externa, alteração de dados externos,
builder visual de automações nem execução da CRM-18.

## Validação da CRM-18

Em 10 de setembro de 2026, a CRM-18 foi validada em schemas PostgreSQL vazios e
isolados (`crm18_target`, `crm18_queue_isolated`, `crm18_e2e` e
`crm18_e2e_full`). As dezesseis migrations anteriores foram aplicadas desde o
zero e o fluxo normal confirmou ausência de pendências. A task não alterou o
schema; `prisma migrate status` confirmou que o schema local `public` permanece
atualizado.

A área `/administracao` permite ao Administrador criar e editar usuários
locais, alterar papéis, equipes e funções comerciais, pausar recebimento,
inativar memberships e redistribuir carga após revisar o impacto. O Gestor vê
indicadores, permissões efetivas e membros apenas de suas equipes e pode pausar
ou redistribuir dentro desse escopo. SDR, Closer e Visualizador não atravessam a
proteção por URL ou chamada direta.

Inativação revoga sessões, preserva autoria e redistribui leads e todas as
tarefas abertas no mesmo commit para um SDR elegível ou a Fila Geral explícita.
Pausa reutiliza a política do round-robin, que continua excluindo usuários
pausados, memberships inativas e identidades desabilitadas. Criação não retorna
senha ou hash; autoelevação, autoinativação, remoção do último Administrador,
workspace cruzado, destino fora da equipe e confirmação obsoleta são rejeitados
no servidor. Todas as mudanças relevantes geram auditoria.

Passaram 76 testes unitários, os nove testes de integração próprios da CRM-18,
os 16 testes direcionados de RBAC/distribuição e 26 cenários E2E. A cobertura
direcionada verifica criação, edição, papel, equipe, pausa, round-robin,
inativação, revogação de sessão, redistribuição, Fila Geral, tarefas, preservação
histórica, autoelevação, escopo do Gestor, isolamento por workspace e rollback
atômico. Lint, TypeScript estrito e o build otimizado do Next.js 16.3.4 passaram.

O comando agregado de integração executou 120 de 121 testes com sucesso. O único
teste legado que falhou foi a ordenação do Meu Dia: as suítes anteriores usam o
mesmo workspace de demonstração e deixaram 28 leads no SDR 3; o limite
operacional de 20 itens ocultou um dos seis IDs esperados pelo teste. O mesmo
arquivo, executado isoladamente em schema vazio, passou seus cinco testes. Não
foi alterado código nem teste da CRM-10 para mascarar essa limitação de
isolamento da suíte.

O host continua em Node.js 24.18.0, enquanto o projeto declara Node.js 22, e
emitiu o aviso de engine. O driver `pg` manteve o aviso de depreciação para sua
futura versão 9. Nenhum deploy, integração externa, exclusão física, dashboard,
métrica da CRM-19 ou task posterior foi executado.

## Validação da CRM-19

Em 10 de setembro de 2026, a CRM-19 foi validada em schemas PostgreSQL vazios e
isolados (`crm19_target2` para o lote direcionado e `crm19_full1` para a suíte
completa). As 17 migrations foram aplicadas desde o zero; a reaplicação pelo
fluxo normal informou que não havia migration pendente. Passaram 79 testes
unitários, 127 testes de integração e os 20 testes direcionados de métricas,
oportunidades e seed. ESLint, TypeScript estrito e o build otimizado do Next.js
16.3.4 também passaram.

Os testes conhecidos reconciliam três leads recebidos, tentativa, contato,
qualificação, agendamento, show, no-show, reunião cancelada, venda, receita,
MRR, TCV, ticket, SLA automático/humano, tempo por etapa, aging, backlog, leads
parados, sem atividade e sem próxima ação. Também cobrem período sem dados,
denominadores explícitos, prioridade, timezone, escopos `OWN`, `TEAM` e
`WORKSPACE`, negativa de permissão, snapshot financeiro estável após mudança da
projeção e bloqueio de update/delete no banco.

A migration criou `OpportunityOutcomeSnapshot` para congelar os valores de
ganho/perda e os índices de consulta. Ela foi aplicada ao schema local `public`;
o seed foi executado duas vezes, manteve oito usuários e atualizou a matriz para
14 permissões e 41 concessões sem duplicar dados. `prisma migrate status`
confirmou as 17 migrations aplicadas.

Na primeira execução direcionada, o fixture de negativa tentou criar o ator
humano antes da membership e foi rejeitado pela constraint existente. A ordem
foi corrigida e o fixture passou a usar workspace próprio. O lote seguinte
revelou duas expectativas incorretas: a etapa semântica Qualificado do seed
legado possui tipo físico `WON`, e o resolvedor `OWN` havia recebido membros da
equipe. A consulta passou a identificar backlog pelos códigos semânticos de
pré-vendas e a manter `OWN` estritamente no próprio membro. Todas as suítes
foram então repetidas em schema novo e passaram.

O host continuou emitindo o aviso de engine por usar Node.js 24.18.0 quando o
projeto declara Node.js 22, além do aviso já conhecido de depreciação do `pg`
para consulta concorrente. Nenhum aviso causou falha. Nenhum dashboard, rota de
métricas, gráfico, deploy, integração externa ou funcionalidade da CRM-20 foi
implementado.

## Validação da CRM-20

Em 10 de setembro de 2026, a CRM-20 foi validada em schemas PostgreSQL vazios e
isolados (`crm20_full1` para integração e `crm20_e2efull1` para E2E). As 17
migrations existentes foram aplicadas desde o zero; 81 testes unitários, 131
testes de integração e 28 cenários E2E passaram. Lint, TypeScript estrito e o
build otimizado do Next.js 16.3.4 também passaram. A task não alterou o schema.

Os testes direcionados cobrem reconciliação de KPIs, numeradores e denominadores,
drilldown pelo mesmo conjunto de evidências, filtros globais, períodos civis e
timezone, escopos `OWN`, `TEAM` e `WORKSPACE`, negação de permissão, estado sem
dados e um recorte persistido com 300 leads abaixo do limite de cinco segundos.
O E2E cria uma entrada, abre o dashboard, reconcilia o KPI com o registro do
lead, preserva filtros na navegação e valida o estado vazio honesto.

Durante a validação, o primeiro E2E revelou que a fixture presumia P1 mesmo após
o scoring determinístico da CRM-13; o teste passou a selecionar a prioridade
efetivamente persistida. A primeira fixture de 300 leads também tentou gravar
uma projeção parcial de próxima ação e foi corretamente rejeitada pela constraint
`leads_next_action_projection_check`; a fixture passou a criar tarefa e projeção
completas na mesma transação. Nenhuma regra de produção foi relaxada.

O dashboard usa a camada de métricas da CRM-19, executa conjuntos relacionais
fixos, não faz consultas por card e não apresenta séries decorativas. O desenho
prioriza indicadores que abrem ação e evidência, seguindo a hierarquia operacional
adotada nesta task. O host ainda usa Node.js 24.18.0 em vez do Node.js 22 declarado
e mantém o aviso de depreciação do `pg`; ambos são pendências ambientais já
conhecidas. A CRM-21 não foi iniciada e nenhum deploy foi realizado.

## Validação da CRM-21

Em 10 de setembro de 2026, a CRM-21 foi validada no schema PostgreSQL vazio e
isolado `crm21_final2`. As 18 migrations foram aplicadas desde o zero; 83 testes
unitários e 139 testes de integração passaram. Os oito testes direcionados do
motor cobrem publicação e chave repetida, recibo de efeito após retomada,
sucesso, falha, retry/backoff com relógio controlado, falha terminal,
reprocessamento, concorrência com `SKIP LOCKED`, reinício após expiração do lock,
regra inativa, agendamento, cancelamento, auditoria, permissões e observabilidade.
ESLint sem avisos, TypeScript estrito e o build otimizado do Next.js 16.3.4
também passaram.

A migration foi aplicada ao schema local `public`; o seed foi executado duas
vezes e manteve zero regras, runs e jobs de automação, adicionando somente as
três permissões previstas. `prisma migrate status` confirmou as 18 migrations.
O entrypoint do worker carregou `.env`, iniciou ocioso e encerrou com código zero
ao receber `SIGINT` diretamente.

Durante a validação, a primeira DDL tentou recriar a constraint legada
`jobs_attempts_check`; ela passou a substituir a constraint preservando
`attempts <= maxAttempts`. O cancelamento anterior ao primeiro claim exigiu
compatibilizar a ordenação temporal histórica com `cancelledAt`. O smoke do
worker revelou que `tsx` não carregava `.env`, corrigido no entrypoint. A
contagem legada do seed foi atualizada de 41 para 46 concessões após os três
novos direitos do Administrador e os dois do Gestor. Todos os gates foram
repetidos depois dessas correções.

O host continuou em Node.js 24.18.0 apesar do Node.js 22 declarado, e o driver
`pg` emitiu o aviso de depreciação já conhecido em consultas concorrentes. As
validações usaram o mirror temporário porque partes de `node_modules` no
workspace estavam `dataless`; o código-fonte e a migration permanecem no
repositório original. Nenhuma regra comercial, central de notificações, Redis,
integração externa, CRM-22 ou task posterior foi implementada. Nenhum deploy foi
realizado.

## Validação da CRM-22

Em 10 de setembro de 2026, a CRM-22 foi validada no schema PostgreSQL vazio e
isolado `crm22_final4`. As 19 migrations foram aplicadas desde o zero. Os nove
testes próprios cobrem as cinco regras, seed e pausa idempotentes, negação por
permissão, publicação atômica, concorrência, repetição da mesma entrada, efeito
único, duplicidade sem merge, score preservado, P1 explicável, escalonamento ao
gestor, fronteiras de SLA em 60/61 e 180/181 segundos, primeira tentativa única,
resposta, reaproveitamento de `Ligar agora`, cancelamento de cadência, opt-out,
Fila Geral, rollback do efeito e retry. A regressão encerrou com 83 testes
unitários e 148 de integração aprovados. ESLint sem avisos, TypeScript estrito e
o build otimizado do Next.js 16.3.4 também passaram.

A migration `20260910220000_entry_automations` foi aplicada ao schema local
`public`. O seed executado duas vezes manteve exatamente cinco regras CRM-22,
todas predefinidas, ativas e na versão 1. `prisma migrate status` confirmou as
19 migrations. O worker carregou os adaptadores novos e iniciou localmente sem
exigir Redis ou integração externa.

O primeiro teste direcionado revelou que a fixture pausava SDRs sem preencher
o trio obrigatório de motivo/ator/data; a fixture passou a respeitar a mesma
constraint da aplicação. A primeira regressão completa revelou poluição do
workspace demo pelos leads do teste CRM-22; o teardown agora usa soft delete e
preserva o histórico. Uma execução posterior usou por engano o cliente Prisma
gerado anterior após sincronizar o mirror; o cliente foi regenerado e a suíte
completa foi repetida do zero com aprovação.

O comando `prisma generate` no workspace original continua sujeito ao
`ERR_INVALID_PACKAGE_CONFIG` causado pelos pacotes `dataless` do File Provider.
Por isso, os gates foram executados no mirror byte a byte existente em `/tmp`,
e o cliente gerado final foi sincronizado ao workspace. O host de validação
continua em Node.js 24.18.0 em vez do Node.js 22 declarado; o driver `pg` mantém
o aviso de depreciação já conhecido. Nenhuma API do Next.js foi modificada.
Nenhuma automação 6 a 12, interface da CRM-23, integração real ou deploy foi
realizado.

## Validação da CRM-23

Em 10 de setembro de 2026, a CRM-23 foi validada no schema PostgreSQL vazio e
isolado `crm23_final`. As 20 migrations foram aplicadas desde o zero. Os oito
testes direcionados cobrem as sete novas regras, seed das 12 regras sem
sobrescrever pausa, cadência D0/D1/D3/D7/D14/D21/D30, idempotência, opt-out,
PACTO/responsável/próxima ação, briefing, lembretes 24h/2h/15min, remarcação,
cancelamento, no-show, lead parado, ausência de próxima ação, ganho/perda,
handoff futuro, retry/falha terminal, timezone, notificações e RBAC. O resultado
final foi 84 testes unitários e 156 testes de integração aprovados.

Os três E2E próprios passaram e validaram a lista das 12 regras, inspeção de
gatilhos/condições/ações, ativação e pausa confirmadas, histórico filtrado,
acesso gerencial sem mutação, bloqueio do Visualizador e estado vazio da central
individual. Na regressão E2E completa, 30 de 31 cenários passaram na primeira
execução; um teste legado de visualização salva expirou durante o Fast Refresh e
passou quando repetido isoladamente sem mudança de código. Esse evento não é
registrado como aprovação integral de uma única execução E2E. ESLint,
TypeScript estrito e o build otimizado do Next.js 16.3.4 passaram.

A migration `20260910230000_lifecycle_automations` foi aplicada ao schema local
`public`. O seed executado duas vezes manteve exatamente 12 regras distintas —
cinco CRM-22 e sete CRM-23 — todas predefinidas, ativas e na versão 1.
`prisma migrate status` confirmou as 20 migrations aplicadas. Nenhum lead do
schema local foi processado pelo worker durante a validação, evitando alterações
operacionais não solicitadas.

Os defeitos encontrados e corrigidos no escopo foram: consulta ao campo
inexistente `Queue.active` no handoff de ganho; filtros vazios tratados como
UUID/data inválidos na tela de runs; e fixtures que compartilhavam telefone e
fila global entre suítes. As fixtures passaram a usar identidades únicas e
limpeza explícita, sem relaxar constraints ou regras de negócio.

O `node_modules` original continua `dataless` em partes e produz
`ERR_INVALID_PACKAGE_CONFIG`; por isso, os gates foram executados no mirror
byte a byte em `/tmp`, e o cliente Prisma final foi sincronizado ao workspace.
O host usa Node.js 24.18.0, enquanto o projeto declara Node.js 22, e o driver
`pg` mantém o aviso de depreciação já conhecido. Não houve Redis, mensagem real,
integração externa, onboarding, nutrição automática, CRM-24 ou deploy.

## Validação da CRM-24

Em 10 de setembro de 2026, a dependência CRM-23 foi confirmada como
`CONCLUÍDA E VALIDADA` antes do início. A CRM-24 foi validada nos schemas
PostgreSQL isolados `crm24_directed_final` e `crm24_full_final`; a cadeia com 21
migrations foi aplicada desde o zero e `prisma validate` confirmou o schema.
Os seis testes direcionados e os 162 testes de integração passaram. A suíte
unitária encerrou com 87 testes aprovados em 23 arquivos.

Os testes direcionados cobrem as dez verificações determinísticas: lead sem
responsável operacional, SLA imediato violado, lead sem tentativa, PACTO
incompleto, reunião sem briefing mínimo, oportunidade sem próxima ação, lead sem
próxima ação, lead parado, divergência de etapa e oportunidade perdida sem
motivo consultável. Também cobrem idempotência da varredura, evidência concreta,
reconciliação, filtros e período, isolamento por workspace, mascaramento de
dados sensíveis, `AuditLog` append-only, imutabilidade do achado, reconhecimento,
resolução e bloqueio de falsa resolução.

Os dois cenários E2E próprios passaram no schema `crm24_e2e_b`: o Gestor criou
um lead, executou a detecção, filtrou, inspecionou a política SLA zero,
reconheceu e resolveu uma violação histórica e encontrou o novo log; o
Visualizador foi bloqueado pela página e pela API. ESLint, TypeScript estrito e
o build otimizado do Next.js 16.3.4 passaram. O build confirmou `/auditoria`,
`/api/audit`, `/api/audit/process-health` e sua rota dinâmica como rotas
server-side.

A migration `20260910240000_audit_process_health` foi aplicada ao schema local
`public`. O seed foi executado duas vezes e retornou as mesmas contagens
estruturais; `prisma migrate status` confirmou as 21 migrations aplicadas. A
varredura não foi executada no `public`, evitando criar ou alterar achados sobre
dados operacionais locais sem ação humana na interface.

Durante a validação, foram encontrados e corrigidos: uso de `$queryRaw` para um
advisory lock PostgreSQL que retorna `void`; fixture que tentava contornar o
índice de um único intervalo aberto de etapa; expectativas antigas do seed e do
Gestor após a concessão das permissões de auditoria; e seletores E2E ambíguos.
As execuções finais foram repetidas após as correções. O host continua em Node.js
24.18.0, fora da linha 22 declarada, e o `pg` mantém o aviso de depreciação já
conhecido; nenhum aviso causou falha.

Exportação de auditoria foi explicitamente mantida fora do MVP até revisão de
minimização e autorização. Não houve integração externa, IA, CRM-25 ou deploy.

## Validação da CRM-25

Em 10 de setembro de 2026, a dependência CRM-24 foi confirmada como
`CONCLUÍDA E VALIDADA` antes do início. A CRM-25 foi validada nos schemas
PostgreSQL vazios `crm25_final1`, `crm25_full1` e `crm25_full2`; as 22 migrations
foram aplicadas desde o zero. O schema Prisma foi formatado, gerado e validado.

Os 14 testes unitários próprios cobrem os seis contratos de saída, registro dos
seis prompts, saída inválida, agente divergente, provider padrão sem chave,
determinismo, ausência separada de sinal negativo, texto livre não confiável,
opt-out, troca de provider, ausência de token, HTTP inválido, JSON inválido e
timeout. A suíte unitária completa encerrou com 101 testes em 24 arquivos.

Os 11 testes de integração próprios cobrem escopos `OWN` e `TEAM`, negativa ao
Visualizador, ID de outro workspace, DTO sem IDs de tenant/registro/ator,
payload estrito, persistência de prompt/provider/modo/resultado, ator técnico,
auditoria correlacionada, minimização do log, fallback para saída inválida,
indisponibilidade e timeout, imutabilidade de evidência, ciclo de confirmação e
ausência de gravação parcial. A regressão completa passou com 173 testes em 22
arquivos no schema `crm25_full2`.

ESLint passou sem avisos, TypeScript estrito passou, `prisma validate` passou e
o build otimizado do Next.js 16.3.4 passou. Não foi criado fluxo de interface ou
rota nesta task, portanto nenhum E2E novo foi executado; a compilação confirmou
que as rotas existentes permaneceram válidas.

A primeira execução direcionada encontrou duas falhas apenas na fixture, que
tentava consultar/criar a coluna inexistente `Team.key`. A fixture passou a usar
o nome persistido da equipe e os 11 testes foram repetidos com sucesso. Duas
tentativas de comando no workspace original também foram interrompidas porque
o `node_modules` parcialmente `dataless` voltou a aguardar indefinidamente; os
gates válidos foram executados no mirror byte a byte em `/tmp`, sem alterar
dependências.

A migration `20260910250000_ai_providers_contracts` foi aplicada ao schema local
`public`. O seed executou duas vezes com as mesmas contagens e manteve quatro
concessões `ai.use` no workspace Politizai: Administrador `WORKSPACE`, Gestor
`TEAM`, SDR `OWN` e Closer `OWN`. `prisma migrate status` confirmou as 22
migrations aplicadas. Não havia `AIInsight` no workspace local e nenhuma
análise foi executada nele.

O runtime padrão continua exclusivamente no `MockAIProvider`; não foi adicionada
variável de chave, chamada de rede real ou integração externa. O adaptador
compatível exige construção explícita por código e não é instanciado pela
aplicação. O host de validação usa Node.js 24.18.0, enquanto o projeto declara a
linha 22, e o driver `pg` manteve o aviso de depreciação conhecido nos testes de
integração. Nenhum aviso causou falha. Não houve implementação da CRM-26 nem
deploy.

## Validação da CRM-26

Em 10 de setembro de 2026, a dependência CRM-25 foi confirmada como
`CONCLUÍDA E VALIDADA` antes do início. A CRM-26 foi validada nos schemas
PostgreSQL isolados `crm26_final` e `crm26_e2e`; as 22 migrations existentes
foram aplicadas desde o zero e reaplicadas pelo fluxo normal sem pendências.
Nenhuma migration nova era necessária para esta task.

Os quatro casos de uso estão integrados à aba Inteligência do cartão do lead:
análise, preparação de ligação, extração de nota/transcrição e próxima melhor
ação. O modo padrão permanece local e determinístico. Fatos, inferências,
ausências, evidências, riscos, confiança, prompt e provider aparecem separados;
texto livre só produz fatos por marcadores explícitos e campos não reconhecidos
continuam ausentes. Opt-out impede mensagem sugerida.

As propostas exibem valor vigente e sugerido. PACTO, score e tarefa só mudam
depois de seleção e confirmação humana; aceite parcial, edição motivada e
rejeição são suportados. A aplicação ocorre pelos serviços de domínio já
existentes, com nova verificação de permissão, workspace, concorrência,
timeline e auditoria. Uma reserva otimista do `AIInsight` impede duas decisões
simultâneas sobre a mesma recomendação.

Os dois testes unitários próprios cobrem os marcadores determinísticos e a
rejeição de prompt injection contida no texto. Os oito testes de integração
próprios cobrem os quatro casos de uso, ausência de dados, aceite parcial com
edição, mutação apenas dos itens selecionados, rejeição, opt-out, Visualizador,
SDR fora do próprio escopo e falha controlada sem insight parcial. A suíte
completa passou com 104 testes unitários em 25 arquivos e 181 testes de
integração em 23 arquivos.

O arquivo E2E do cartão passou com três cenários no Chromium; o cenário da
CRM-26 autentica, abre o cartão, executa análise local e valida modo, sucesso,
fatos e ausência de inferência inventada. A primeira execução encontrou uma
ambiguidade no seletor de `role=status`, pois havia dois avisos de sucesso
corretos na tela; a asserção foi restringida à mensagem da Inteligência e o
arquivo completo foi repetido com 3/3 aprovações.

ESLint, TypeScript estrito, `prisma validate` e o build otimizado do Next.js
16.3.4 passaram. O build confirmou a rota dinâmica
`/api/leads/[leadId]/intelligence`. As validações foram executadas no mirror
byte a byte em `/tmp/politizai-crm-validation.n2JRFA`, preservando o
`node_modules` original parcialmente `dataless`. O host continua em Node.js
24.18.0, fora da linha 22 declarada, e o driver `pg` manteve o aviso de
depreciação conhecido; nenhum aviso causou falha.

Naquele checkpoint, não havia chave, rede externa, LLM real ou chatbot. O
Copilot gerencial e as consultas assistidas às métricas estavam reservados à
CRM-27, então ainda não iniciada. Nenhum deploy foi realizado.

## Validação da CRM-27

Em 10 de setembro de 2026, as dependências CRM-26 e CRM-19 foram confirmadas
como `CONCLUÍDA E VALIDADA` antes do início. A CRM-27 foi revalidada no schema
PostgreSQL vazio e isolado `crm27_checkpoint`: as 23 migrations foram aplicadas
desde o zero, e a suíte completa encerrou com 195 testes de integração em 24
arquivos. Os 14 testes próprios cobrem as oito perguntas obrigatórias, período
sem dados, filtros, fórmula, numerador, denominador, comparações, drilldowns,
RBAC, prompt injection contido em dado de lead, confirmação humana, auditoria e
falha controlada do provedor.

A suíte unitária completa passou com 107 testes em 26 arquivos. Os testes
próprios validam o catálogo exato das oito perguntas, as instruções de segurança
do prompt versionado e a saída determinística do Copilot local. Os dois cenários
E2E próprios passaram no Chromium: o Gestor criou um lead, consultou o recorte
de ações do dia, abriu o conjunto exato de registros e confirmou somente o
plano; o Visualizador foi bloqueado tanto pela URL quanto pela API.

ESLint, TypeScript estrito, `prisma validate` e o build otimizado do Next.js
16.3.4 passaram. O build confirmou `/copilot` e
`/api/ai/manager-copilot` como rotas dinâmicas server-side. A migration
`20260910270000_manager_copilot_permission` foi aplicada ao schema local
`public`; uma segunda execução do fluxo normal não encontrou pendências. O seed
foi executado sem criar leads ou sobrescrever dados manuais, e concedeu
`ai.manager.query` ao Administrador em `WORKSPACE` e ao Gestor em `TEAM`.

O Copilot consulta a camada única de métricas e serviços internos, limita todas
as consultas ao universo já autorizado e envia ao provedor somente agregados,
sem IDs, nomes ou textos livres. Cada valor estruturado aponta para o grupo de
registros que o compõe; período, timezone, filtros, fórmula, denominadores,
possíveis causas correlacionais, evidências, limitações e confiança ficam
visíveis. A decisão humana apenas aceita ou rejeita o plano e é auditada com a
indicação explícita de que nenhuma mutação de domínio foi executada.

Durante a validação, dois E2E inicialmente falharam por expectativas incorretas:
o score vigente podia recalcular a prioridade manual do lead, retirando-o do
recorte P1, e o título acessível da página de bloqueio é “Você não tem permissão
para esta ação”. O cenário passou a validar a tarefa atômica no recorte “ação
hoje” e o título real da página; ambos foram repetidos com sucesso. Testes
legados também foram estabilizados para selecionar apenas seus próprios dados,
sem alteração das regras de negócio.

As validações foram executadas no mirror byte a byte em
`/tmp/politizai-crm-validation.n2JRFA`, preservando o `node_modules` original
parcialmente `dataless`. O host usa Node.js 24.18.0, enquanto o projeto declara
Node.js 22, e o driver `pg` manteve o aviso de depreciação conhecido; nenhum
aviso causou falha. Não houve chave externa, chamada a LLM real, mutação
automática, integração externa, CRM-28 ou deploy.

## Validação da CRM-28

Em 11 de setembro de 2026, a dependência CRM-27 foi confirmada como
`CONCLUÍDA E VALIDADA` antes da implementação. A CRM-28 consolidou um shell
autenticado responsivo, navegação lateral e cabeçalho compacto; tokens de cor,
tipografia, espaçamento e foco; tabelas e formulários densos; feedback comum de
loading e erro; dialog com gerenciamento de foco; distinção textual e visual
entre prioridade, etapa e saúde; e redução de movimento. Meu Dia, lista, cartão
360, PACTO, pipelines, agenda, dashboard e Copilot foram refinados sem mover
consultas ou regras de domínio para componentes.

Os testes finais foram executados no mirror byte a byte
`/tmp/politizai-crm-validation.n2JRFA`, preservando o `node_modules` original
parcialmente `dataless`, com Node.js 22.23.1. ESLint, TypeScript estrito e
`prisma validate` passaram. A suíte unitária passou com 107 testes em 26
arquivos. Em um schema
PostgreSQL vazio e isolado (`crm28_integration_final2`), as 23 migrations foram
aplicadas desde zero e os 195 testes de integração passaram em 24 arquivos. O
build otimizado do Next.js 16.3.4 compilou e gerou todas as rotas com sucesso.
Nenhuma migration foi criada pela CRM-28.

Os três E2E próprios passaram contra o build otimizado no schema isolado
`crm28_prod_final`: verificam landmarks, um único `h1`, IDs, nomes acessíveis,
rótulos, ausência de overflow, drawer mobile, `Escape`, preferência de movimento
reduzido, tabs por setas/Home/End, barra de progresso PACTO e foco/fechamento do
dialog. O dashboard foi validado separadamente com 2 de 2 cenários verdes no
schema limpo `crm28_prod_regression`. Dos outros 36 cenários existentes, 34
passaram no build otimizado; o CSV encontrou uma hidratação tardia isolada e o
webhook foi corretamente rejeitado porque seu contrato o limita ao ambiente de
desenvolvimento. Esses cinco cenários de entrada já haviam passado na execução
completa em `next dev`.

A execução única da suíte completa em `next dev` terminou com 33 de 38 cenários
verdes. Uma falha do dashboard decorreu do compartilhamento de estado entre
arquivos (o teste pressupõe exatamente um lead); quatro navegações foram
interrompidas por `The destination stream closed early` durante compilação sob
demanda. O driver `pg` também mantém o aviso conhecido sobre consultas
concorrentes. A verificação no build otimizado demonstrou que as telas e fluxos
afetados funcionam; tornar toda a suíte independente de ordem e eliminar essa
instabilidade do servidor de teste permanecem itens explícitos do hardening da
CRM-30, não foram ocultados nem tratados como aprovados nesta execução.

A inspeção visual em 1280 × 720 confirmou a densidade e a hierarquia de Meu
Dia, lista, dashboard e cartão 360. O breakpoint móvel, foco e diálogos foram
verificados no Chromium em 390 × 844. A especificação está em
`docs/VISUAL_SYSTEM.md`. Não houve deploy, integração externa, dado decorativo,
alteração de regra comercial, CRM-29 ou qualquer task posterior.

## Validação da CRM-29

Em 11 de setembro de 2026, a dependência CRM-28 foi confirmada como
`CONCLUÍDA E VALIDADA` antes da implementação. A CRM-29 adicionou ao seed local
uma camada operacional separada da estrutura: 320 identidades fictícias
distribuídas nos 30 dias anteriores à execução, 32 novas submissões duplicadas,
565 tarefas, 578 atividades, 136 qualificações PACTO, 1.022 intervalos de
etapa, 80 reuniões, 51 oportunidades, 64 execuções das 12 automações, 48
insights locais e 692 registros de auditoria. Há exemplos P1/P2/P3 em todas as
etapas de pré-vendas, cinco origens, duas campanhas, quatro criativos, seis
atuações, dez localidades, três produtos e dois closers.

As narrativas preservam a ordem temporal. As dez oportunidades ganhas percorrem
as seis etapas comerciais até ganho, têm produto, oferta, valores positivos e
data de fechamento. Reuniões canceladas não possuem show/no-show; no-shows não
possuem cancelamento. A base contém opt-out, Fila Geral, ausência de tentativa,
SLA saudável/atenção/crítico, lead parado, ausência de próxima ação,
desqualificação e perda. O timestamp âncora é relativo ao momento da primeira
execução e fica estável nas repetições da mesma versão.

O seed usa IDs e fingerprints determinísticos, advisory lock e transação
serializável. Uma segunda execução enumera e confere o grafo esperado sem
reescrever datas nem duplicar registros. Um registro manual criado fora do
namespace foi preservado no teste. O reset demonstrativo exige um schema local
com prefixo `politizai_demo` e a confirmação literal `RESET <schema>`; schemas
`public`, remotos ou com ambiente de produção são rejeitados. Essa proteção e
os seletores de cenários estão documentados em `docs/SEED.md` e no `README.md`.
O comando foi exercitado no schema descartável
`politizai_demo_reset_validation`: recriou apenas esse alvo, aplicou as 23
migrations e gerou novamente as contagens esperadas.

Os seis testes unitários próprios cobrem as proteções do reset. Os quatro testes
de integração próprios recriaram o schema isolado `politizai_demo_crm29_test`,
aplicaram as 23 migrations desde zero e validaram contagens, idempotência,
preservação manual, integridade temporal, desfechos e reconciliação com a camada
de métricas. A suíte unitária completa passou com 113 testes em 27 arquivos.
Após recriar exclusivamente o schema de testes `crm02_integration`, a suíte de
integração completa passou com 195 testes em 24 arquivos. O teste estrutural foi
restrito aos 11 atores pertencentes ao próprio seed para não depender de atores
adicionais criados por outras suítes no mesmo workspace.

Os dois cenários E2E do dashboard passaram no Chromium contra a base seedada:
reconciliaram o KPI de leads com o drilldown, abriram o registro criado,
mantiveram o filtro de prioridade e validaram o estado vazio sem números
inventados. O timeout do cenário foi ajustado para acomodar a compilação fria do
Next em desenvolvimento, sem mudar comportamento da aplicação. ESLint,
TypeScript estrito, `prisma validate` e o build otimizado do Next.js 16.3.4
passaram.

No schema local `public`, o seed foi executado repetidamente com a mesma âncora
e contagens. Antes da primeira execução havia 192 leads; depois havia 512,
sendo exatamente 320 do namespace CRM-29, demonstrando preservação dos 192
registros anteriores. Execuções E2E posteriores criaram registros manuais fora
do namespace, que o seed também não removeu. O driver `pg` manteve o aviso de
depreciação já conhecido sobre consultas concorrentes; ele não causou falha.
As validações foram executadas no mirror byte a byte
`/tmp/politizai-crm-validation.n2JRFA`, com Node.js 22.23.1, porque parte do
`node_modules` original continua `dataless` e faz o typecheck aguardar.

Não houve deploy, dados pessoais reais, integração externa, reset do schema
`public`, implementação da CRM-30 ou qualquer task posterior.

## Validação da CRM-30

Em 11 de setembro de 2026, a dependência CRM-29 foi confirmada como
`CONCLUÍDA E VALIDADA` antes da implementação. A inspeção inicial encontrou 113
testes unitários em 27 arquivos, 195 testes de integração em 24 arquivos e 38
cenários E2E. A execução E2E de referência em `next dev` terminou com 28
aprovações e 10 falhas: compilações frias e Fast Refresh fechavam documentos em
transição, enquanto alguns cenários compartilhavam premissas frágeis sobre a
ordem ou quantidade do dataset. A auditoria inicial também encontrou duas
vulnerabilidades transitivas altas, em `deepmerge-ts` e `mysql2`.

O endurecimento passou a limitar e validar o corpo antes do parse nos endpoints
sensíveis de login, entrada manual, CSV, webhook/simulador local, IA e execução
manual de automação. O rate limit local usa janela fixa por chave opaca e não
registra IP ou payload. Erros 4xx/5xx são logados sem serializar exceções ou
dados recebidos; os caminhos conhecidos de senha, sessão, token, chave e URL do
banco são mascarados. Respostas globais ganharam `nosniff`, bloqueio de frame,
política de referrer e Permissions Policy mínima. Relatórios CSV neutralizam
prefixos de fórmula antes do escape.

Os executores relacionais recusam banco não local, recriam somente os schemas
fixos `politizai_crm30_integration_test` e `politizai_demo_crm30_e2e` e aplicam
as migrations desde zero. O E2E principal usa `next start`, um worker e dados
seedados; apenas webhook e simulador, corretamente limitados ao ambiente local,
rodam em uma suíte `@local-only` separada no `next dev`. O fluxo principal foi
ampliado para percorrer login, entrada, normalização, score, distribuição, SLA,
tentativa, IA local, PACTO, qualificação, reunião, briefing, comparecimento,
oportunidade, proposta, negociação, ganho, dashboard e auditoria. Os cenários
alternativos cobrem no-show, duplicidade, desqualificação, bloqueios de
permissão, ausência de próxima ação, falha de automação, override, opt-out e
ausência de SDR com fallback para a Fila Geral.

A base CRM-29 continha 48 `AIInsight` fictícios no formato anterior ao contrato
estruturado vigente. Abrir um lead desse recorte fazia a validação Zod falhar e
também podia transformar uma mutação PACTO já concluída em falso erro de
interface durante o recarregamento. O seed agora gera a saída pelo mesmo motor
mock determinístico da aplicação e corrige idempotentemente apenas os IDs
estáveis do namespace CRM-29, sem mudar a âncora ou registros manuais. O teste
do seed valida todos os 48 contratos.

Com Node.js 22.23.1, o resultado final foi: `pnpm lint` sem erros; `pnpm
typecheck` sem erros; `pnpm test` com 124/124 testes em 29 arquivos; `pnpm
test:integration` com as 23 migrations e 195/195 testes em 24 arquivos; `pnpm
test:crm29` com 4/4 testes; `pnpm test:e2e` com 39/39 cenários no build de
produção e 1/1 local-only; e build otimizado do Next.js 16.3.4 concluído. Os
overrides finais são `deepmerge-ts` 8.0.0 e `mysql2` 3.23.1; `pnpm audit`
terminou com `No known vulnerabilities found`.

A validação de performance local inclui lista paginada com 305 leads, dashboard
com 300 leads e limite de 5 segundos, timeline paginada e dois workers
concorrentes disputando o mesmo job com `SKIP LOCKED`; a base E2E contém 320
leads. Essas verificações detectam regressões básicas e N+1 no volume do MVP,
mas não substituem um ensaio de carga.

Esta é validação local, não certificação de segurança ou capacidade de
produção. O rate limit em memória precisa de armazenamento compartilhado fora
do monólito local; CSP/HSTS, gestão e rotação de segredos, backup, recuperação,
pentest, SAST/DAST, resposta a incidentes, teste de carga e análise de planos SQL
com volume real continuam obrigatórios antes de dados reais. O driver `pg`
mantém o aviso de que consultas concorrentes no mesmo client serão descontinuadas
no pg 9; os testes passam, mas a migração futura deve eliminá-lo.

As validações foram executadas no mirror byte a byte
`/tmp/politizai-crm-validation.n2JRFA`, pois 37.396 arquivos do `node_modules`
original permanecem `dataless`. O branch `main` continua sem commits e todos os
arquivos do projeto permanecem não rastreados; nenhum estado foi descartado.
Não houve deploy, banco remoto, integração externa, migration nova ou execução
da CRM-31.

## Validação da CRM-31

Em 11 de setembro de 2026, a dependência CRM-30 foi confirmada como `CONCLUÍDA
E VALIDADA` antes da execução. Os onze documentos obrigatórios foram
reconciliados com o código atual; `docs/DEPLOYMENT_FUTURE.md` passou a registrar
os gates ainda necessários para dados reais e publicação, enquanto
`docs/MVP_READINESS.md` separa implementado, testado e não validado. O README
agora cobre fluxo reproduzível com migrations existentes, worker, solução de
problemas e limitações locais. Vinte e três arquivos Markdown foram verificados
sem links locais quebrados, e uma busca por padrões comuns de segredo não
encontrou material versionável.

A primeira execução de `pnpm test:e2e` terminou com 38/39 cenários de produção:
a varredura de saúde exibiu `Não foi possível concluir a solicitação.`. A
inspeção mostrou quatro consultas em `Promise.all` dentro da mesma transação e o
driver registrou `Calling client.query() when the client is already executing a
query is deprecated`. As leituras da varredura foram serializadas sem mudar a
regra determinística.

A segunda execução terminou novamente com 38/39: o servidor registrou
`Connection terminated due to connection timeout` e Meu Dia apresentou seu
estado de erro seguro. A causa era o ciclo de vida do Prisma no build de
produção: `getDatabaseClient()` guardava o cliente global apenas fora de
`NODE_ENV=production`, criando pools de cinco conexões a cada lookup de serviço.
O cliente agora é singleton por processo em todos os ambientes. Depois dessas
duas correções mínimas, a execução integral passou com 39/39 cenários em
`next start` e 1/1 cenário local em `next dev`.

O resultado final com Node.js 22.23.1 foi: `pnpm lint` sem erros; `pnpm
typecheck` sem erros; `pnpm test` com 124/124 testes em 29 arquivos; `pnpm
test:integration` com 23 migrations e 195/195 testes em 24 arquivos; `pnpm
test:crm29` com 4/4 testes; `pnpm test:e2e` com 39/39 + 1/1; `pnpm audit` com
`No known vulnerabilities found`; `pnpm db:status` com schema atualizado; e
build otimizado do Next.js 16.3.4 concluído. A tentativa de executar typecheck
diretamente no checkout foi interrompida depois de permanecer sem saída por 60
segundos devido aos arquivos `dataless`; o mesmo snapshot foi aprovado no
mirror. O worker iniciou, publicou eventos e encerrou graciosamente por `Ctrl-C`;
o exit 130 foi intencional e não é apresentado como conclusão autônoma.

A inspeção visual local cobriu login, visão geral, dashboard, lista, cartão 360,
PACTO e Inteligência. Confirmou rótulos de ambiente local/simulado, ausência
distinta de negativa, numeradores/denominadores, dados persistidos e confirmação
humana. O E2E visual cobriu navegação desktop/teclado, responsividade, diálogo e
movimento reduzido. Após parar e reiniciar `next start`, health e login voltaram
HTTP 200; as contagens permaneceram em 338 leads e 52 oportunidades. O aumento
de 1649 para 1650 logs foi a auditoria esperada do login entre as duas leituras.

O aviso do `pg` sobre consultas concorrentes ainda aparece em outros caminhos e
permanece risco explícito para uma futura atualização ao pg 9. Os testes passam,
mas produção ainda exige teste de carga, revisão das ocorrências restantes,
gestão de segredos, backup/restauração, pentest, SAST/DAST, observabilidade,
resposta a incidente e avaliação LGPD. Nenhuma migration foi criada. O branch
`main` continua sem commits e todos os arquivos seguem não rastreados; nada foi
descartado.

Não houve deploy, publicação, banco remoto, integração externa ou início de uma
nova fase.

## Validação da DESIGN-01

Em 11 de setembro de 2026, o redesenho foi dividido para preservar o gate entre
entregas. A DESIGN-01 aplicou a marca oficial da Politizai ao login e ao shell,
substituiu siglas por ícones semânticos e transformou a página inicial no
dashboard executivo real. Receita ocupa a posição de maior atenção; vendas,
oportunidades, leads, funil e violações operacionais permanecem derivados da
camada de métricas e preservam os drilldowns reconciliáveis. Filtros e análises
secundárias foram recolhidos sem mudar sua execução server-side.

As skills solicitadas foram instaladas e usadas. O `ghost-memory` ingeriu 11
sessões locais e encontrou 19 padrões candidatos; o achado relevante confirmou
o erro conhecido de `next lint` no Next.js 16, portanto o projeto manteve seu
script compatível `eslint .`. A `revenue-centric-design` orientou a hierarquia
de atenção, o KPI principal no topo esquerdo e a ligação explícita entre cada
número e uma ação ou drilldown. A documentação local do Next.js 16.3.4 sobre
CSS, imagens e fontes foi lida antes das alterações.

O snapshot final foi validado no mirror
`/tmp/politizai-crm-validation.n2JRFA`: `pnpm lint` e `pnpm typecheck` passaram;
`pnpm test` aprovou 124/124 testes em 29 arquivos; o build otimizado passou; e
11/11 E2E direcionados aprovaram login, todos os papéis, sessão, health check,
reconciliação e drilldown do dashboard, estado sem dados, navegação desktop,
teclado, responsividade, diálogo e movimento reduzido. A inspeção visual em
1440 px e 390 px confirmou a marca carregada e ausência de overflow horizontal.

A primeira preparação manual do schema E2E usou a senha padrão equivocada e
falhou com `password authentication failed for user "politizai"`. A repetição
usou a `DATABASE_URL` já configurada, sem expor o segredo, e aplicou as 23
migrations no schema isolado. Dois seletores legados do E2E foram atualizados
para a nova hierarquia recolhida; nenhuma regra de negócio foi alterada. O aviso
preexistente do driver `pg` sobre consultas concorrentes ainda aparece, mas não
causou falhas. Naquele checkpoint, a DESIGN-02 e todas as etapas seguintes
permaneciam não iniciadas.

## Validação da DESIGN-02

Em 11 de setembro de 2026, a dependência DESIGN-01 foi confirmada como
`CONCLUÍDA E VALIDADA` antes da alteração. A documentação local do Next.js
16.3.4 sobre layouts, CSS, assets e `next/font` foi lida; Plus Jakarta Sans e
Manrope foram comparadas localmente em títulos, navegação, formulários, KPI,
moeda, SLA e tabela. Plus Jakarta Sans foi escolhida por manter boa densidade
com desenho mais amigável e geométrico. A família variável com licença SIL OFL
1.1 foi integrada por `next/font/google`, fica auto-hospedada pelo build e não
gera requisição externa durante o uso.

A paleta Politizai foi centralizada nos tokens `#0A1931`, `#B3CFE5`, `#4A7FA7`,
`#1A3D63` e `#F6FAFD`, com cores distintas para sucesso, atenção, perigo e
inatividade. O azul médio `#4A7FA7` não foi usado como fundo de texto pequeno
branco porque sua relação de contraste é 4,30:1; ações primárias usam
`#1A3D63`, com 11,10:1. Controles usam raio de 11 px, painéis 16 px e modais
20 px. Pesos 800 ou superiores foram removidos, e números tabulares permanecem
globais.

O primeiro E2E direcionado distinguiu duas expectativas incorretas do próprio
teste e um defeito real: em 1024×768, Meu Dia excedia a viewport em 26 px porque
a sidebar fixa comprimia a fila. O breakpoint estrutural passou a 1100 px, de
modo que 1024 px usa o drawer; a repetição aprovou todas as 28 combinações entre
Dashboard, Meu Dia, Leads, Lead 360, Agenda, Pipeline e Login e as resoluções
1440×900, 1280×800, 1024×768 e 390×844. Não houve redesenho estrutural dessas
telas nesta task.

No snapshot final validado em `/tmp/politizai-crm-validation.n2JRFA`, com Node.js
22.23.1, `pnpm lint` e `pnpm typecheck` passaram; `pnpm test` aprovou 124/124
testes em 29 arquivos; o build otimizado do Next.js 16.3.4 passou; 3/3 E2E da
DESIGN-02 e 3/3 E2E de acessibilidade existentes passaram. O teste confirmou
tokens computados, fonte carregada, ausência de Inter, ausência de chamadas a
Google Fonts em runtime, contrastes AA e inexistência de overflow da página.

O aviso preexistente do driver `pg` sobre consultas concorrentes e as mensagens
do Next.js sobre streams encerrados durante navegações abortadas continuaram
visíveis, sem falhar os cenários. O checkout segue sem commits e com arquivos
não rastreados; nada foi descartado. As 23 migrations e o seed foram aplicados
somente no schema local isolado `politizai_design02_e2e`; o schema `public` não
foi alterado. Não houve regra de negócio, permissão, rota, integração,
publicação ou deploy. Naquele checkpoint, DESIGN-03 permanecia `NÃO INICIADA`.

## Validação da DESIGN-03

Em 11 de setembro de 2026, a dependência DESIGN-02 foi confirmada como
`CONCLUÍDA E VALIDADA` antes da alteração. A documentação local do Next.js
16.3.4 sobre páginas e layouts, CSS Modules, `useSearchParams`, `useRouter` e
integração da History API com o App Router foi lida. O `SdrQueueService`, seus
contratos e a consulta SQL permaneceram inalterados: a ordem respondido → novo
P1/P2/P3 → retorno vencido → demais, o escopo RBAC, as contagens, os drilldowns,
o SLA e as recomendações continuam na camada já validada.

O Meu Dia passou a apresentar somente o primeiro registro de `NOW` em “Atenda
agora”, seguido por cinco contagens clicáveis e um navegador com as nove filas.
Somente o painel ativo é renderizado; a seleção usa `?queue=` e setas, Home e
End. A lista exclui visualmente o lead já destacado sem retirá-lo da contagem.
O painel lateral desduplica os previews de reuniões, retornos vencidos, SLA
crítico e ausência de próxima ação; abaixo de 1280 px ele segue a fila. No
mobile, nome, SLA e ação precedem a explicação extensa para preservar a decisão
no primeiro recorte.

No schema PostgreSQL local isolado `politizai_design03_integration`, as 23
migrations foram aplicadas desde zero e 7/7 integrações direcionadas passaram,
incluindo fila vazia, ordem, resposta, reunião no timezone, falta de próxima
ação, escopo próprio/gerencial e reconciliação. No schema isolado
`politizai_design03_e2e`, o seed gerou 320 leads e 3/3 E2E da fila passaram:
foco P1 respondido com SLA crítico, ação e drilldown; atualização após atividade;
tabs e teclado; escopo SDR e Gestor; quatro resoluções; e atualização automática
de 30 segundos. O E2E visual adicional aprovou Meu Dia em 1440×900, 1280×800,
1024×768 e 390×844 sem overflow horizontal.

O resultado final com Node.js 22 foi: `pnpm lint` sem erros; `pnpm typecheck`
sem erros; `pnpm test` com 124/124 testes em 29 arquivos; teste unitário
direcionado com 4/4; integração direcionada com 7/7; E2E funcional com 3/3;
E2E visual com 1/1; e build otimizado do Next.js 16.3.4 concluído. A primeira
execução do novo E2E teve duas expectativas de interface imprecisas — o nome
acessível do contador inclui seu valor e uma tentativa não atendida preserva o
estado “aguardando resposta”. Os seletores foram alinhados ao comportamento de
domínio existente e a repetição passou integralmente.

O aviso já conhecido do `pg` sobre consultas concorrentes e as mensagens do
Next.js sobre stream encerrado em navegações abortadas apareceram sem causar
falha. O checkout continua sem commits e com arquivos não rastreados; nada foi
descartado. Não houve alteração do schema `public`, migration, regra comercial,
integração externa, publicação, deploy ou execução da DESIGN-04.

## Validação da DESIGN-04

Em 11 de setembro de 2026, a dependência DESIGN-03 foi confirmada como
`CONCLUÍDA E VALIDADA` antes da alteração. Foram lidos o `AGENTS.md`, o sistema
visual, o roadmap, este checkpoint e a documentação local do Next.js 16.3.4
sobre CSS Modules, navegação, `useSearchParams` e `useRouter`. A skill
`revenue-centric-design` orientou a redução do esforço percebido: os filtros
mais frequentes ficaram visíveis e toda capacidade secundária foi preservada
por divulgação progressiva.

A barra principal passou a concentrar busca, prioridade, etapa, responsável e
SLA. As multisseleções nativas altas foram substituídas por dialogs com
checkboxes, busca interna quando há muitas opções, contagem, limpeza e aplicação
explícita. Todos os filtros antigos continuam no drawer agrupado; chips mostram
e removem os critérios realmente aplicados, inclusive os vindos de drilldowns.
Ordenação, direção, tamanho da página, colunas, visualizações salvas e ação em
massa ficaram separados. `LeadListQuery`, serialização, serviços, permissões e
rotas não foram alterados.

O primeiro typecheck apontou somente a interação entre CSS Modules e
`exactOptionalPropertyTypes`; as classes opcionais dos dialogs foram tornadas
explícitas. O primeiro E2E funcional encontrou dois seletores não exatos e o
segundo encontrou a ambiguidade intencional entre o campo de busca e seu chip;
os testes foram corrigidos. A primeira inspeção em 1440×900 detectou 81 px de
overflow na grade de filtros. A barra passou a se adaptar ao contêiner por flex
wrap, e a repetição aprovou 1440×900, 1280×800, 1024×768 e 390×844.

O resultado final com Node.js 22 foi: `pnpm lint` sem erros; `pnpm typecheck`
sem erros; `pnpm test` com 124/124 testes em 29 arquivos; integração da lista em
schema isolado com 7/7; build otimizado do Next.js 16.3.4 concluído; 5/5 E2E
próprios em produção e 3/3 E2E de acessibilidade existentes aprovados. Os E2E
cobrem filtros simples e combinados, chips, limpeza, query string, drilldown,
visualização salva, exclusão confirmada, ação em massa, RBAC, `Escape`, retorno
de foco, grupos avançados e responsividade.

Como verificação adicional, a suíte de integração completa executou 196/197
testes: apenas `demo-seed.integration.test.ts` falhou ao esperar 8 membros e
encontrar 9, porque outro teste da própria suíte criou um usuário no mesmo
schema compartilhado. A integração direcionada de Leads foi repetida em
`politizai_design04_integration` e passou integralmente; nenhum módulo de seed
ou administração foi alterado nesta task. Os avisos preexistentes do `pg` e do
Next.js sobre streams encerrados continuaram não bloqueantes. Não houve
migration, mudança de regra comercial, integração externa, publicação, deploy
ou execução da DESIGN-05.

## Validação da DESIGN-05

Em 11 de setembro de 2026, a dependência DESIGN-04 foi confirmada como
`CONCLUÍDA E VALIDADA` antes da alteração. Foram lidos `AGENTS.md`, este
checkpoint, `docs/METRICS.md`, contratos, serviços, API, consultas gerenciais,
seeds e testes, além da documentação local do Next.js 16.3.4 sobre Route
Handlers e Vitest. O Git permanece sem commits e com todos os arquivos não
rastreados; esse estado preexistente foi preservado.

A camada de métricas passou a retornar o período civil anterior equivalente,
23 comparações tipadas, 17 séries reais e um funil completo com caminho
principal e três desfechos ramificados. Hoje, semana e mês atuais terminam no
instante de geração; ontem é completo; mês completo personalizado compara com
o mês civil anterior; os demais personalizados usam o intervalo civil
imediatamente anterior com a mesma quantidade de dias. Cada comparação informa
valores, numeradores, denominadores, diferença, direção, interpretação e
drilldowns independentes para atual e anterior.

Os eventos necessários às séries foram acrescentados à evidência tipada do
`MetricsOverview`: submissão, primeira tentativa, primeira conexão,
qualificação, agendamento, oportunidade, proposta, ganho, perda,
desqualificação e amostras de SLA. A agregação escolhe hora até 48 horas, dia
até 120 dias e semana acima disso; não executa consultas por bucket. Contagens e
dinheiro usam zero somente dentro de buckets existentes; taxa sem denominador e
SLA sem amostra usam `null`. Valores financeiros continuam em centavos como
texto serializado.

Os testes direcionados criaram uma fonte isolada com dados nos dois períodos e
confirmaram filtros, escopo `OWN`/`TEAM`, drilldown atual/anterior, diferença de
100% entre volumes, SLA mediano de 30 s contra 45 s interpretado como melhora,
receita, ausência de denominador, funil com ganho/perda/desqualificação e
reconciliação das séries com os KPIs. Os testes de período cobrem hoje, ontem,
semana, mês parcial, mês completo, fevereiro, virada de ano e timezone
`America/Sao_Paulo`.

A primeira execução da integração completa encontrou a limitação preexistente
de isolamento registrada na DESIGN-04: o teste do seed contava todos os membros
do workspace e encontrava um usuário manual criado por outra suíte. A fixture
passou a contar somente os oito usuários do namespace do seed, que é a própria
semântica do teste. Uma chave idempotente estática da carga de 300 leads também
passou a incluir o ID da fonte isolada, permitindo repetir o teste no mesmo
schema. Nenhuma dessas correções altera código de produção.

O resultado final com Node.js 22.23.1 foi: `pnpm lint` sem erros; `pnpm
typecheck` sem erros; `pnpm test` com 127/127 testes em 29 arquivos; 25/25
integrações direcionadas de métricas e Copilot; `pnpm test:integration` com
198/198 testes em 24 arquivos e todas as 23 migrations aplicadas desde zero no
schema descartável `politizai_crm30_integration_test`; e build otimizado do
Next.js 16.3.4 concluído. O aviso preexistente do `pg` sobre consultas
concorrentes continuou visível e não causou falha.

Não houve migration nova, alteração do schema `public`, dado externo, novo
componente gráfico, redesign do Dashboard, integração, publicação, deploy ou
execução da DESIGN-06.

## Validação da DESIGN-06

Em 11 de setembro de 2026, a dependência DESIGN-05 foi confirmada como
`CONCLUÍDA E VALIDADA` antes da alteração. Foram lidos `AGENTS.md`, este
checkpoint, `docs/VISUAL_SYSTEM.md`, `docs/METRICS.md`, contratos, serviços,
API, filtros, drilldowns, seeds e testes, além da documentação local do Next.js
16.3.4 sobre Server/Client Components e lazy loading. A pesquisa oficial
confirmou Recharts 3.10.1 sob licença MIT e com peer React 19; somente essa
dependência direta foi adicionada.

O Dashboard continua sendo renderizado no servidor. Dois componentes de gráfico
client-side recebem séries já calculadas e autorizadas: evolução comercial com
cinco métricas selecionáveis e comparação atual/anterior, e receita/vendas com
escalas alternadas. Cada um tem legenda, tooltip, descrição acessível, tabela
alternativa e estado vazio. O painel superior apresenta receita, vendas,
conversão lead → venda e SLA humano com valores anteriores, datas exatas,
interpretação semântica e drilldowns.

A camada de métricas passou a fornecer a série anterior, conversão por origem,
performance de SDR/closer e sete recortes acionáveis: ausência de próxima ação,
SLA crítico, lead parado, reunião sem PACTO, oportunidade parada, no-show e
automação com erro. As consultas reutilizam o universo autorizado, índices de
evidência e serviços existentes. Não há valor decorativo, acesso direto ao banco
por componente, inferência causal ou mutação comercial.

Durante a validação, o compilador identificou uso desnecessário de `useMemo` e
tipos incompletos para os novos recortes; ambos foram corrigidos. A integração
completa revelou contaminação entre fixtures que compartilhavam a fila de
round-robin e contagens amplas do seed. Os testes foram isolados por equipe e
namespace, sem mudança de produção. Artefatos duplicados gerados em `.next/types`
também foram removidos antes da repetição do typecheck.

O resultado final com Node.js 22.23.1 foi: `pnpm lint` sem erros; `pnpm
typecheck` sem erros; `pnpm test` com 127/127 testes em 29 arquivos; `pnpm
test:integration` com 198/198 testes em 24 arquivos e 23 migrations aplicadas
desde zero; `pnpm test:e2e` com 49/49 cenários de produção e 1/1 local-only; e
build otimizado do Next.js 16.3.4 concluído. A suíte E2E inclui acessibilidade,
drilldowns, hidratação e os quatro viewports exigidos. A inspeção visual final
confirmou a hierarquia, datas legíveis e ausência de overflow em 1440×900,
1280×800, 1024×768 e 390×844.

Os avisos já conhecidos do `pg` sobre consulta concorrente e do Next.js sobre
stream encerrado durante navegação abortada apareceram sem falhar as suítes.
Não houve migration nova, alteração do schema `public`, integração externa,
publicação, deploy ou execução da DESIGN-07.

## Validação da CRM-42

Em 12 de setembro de 2026, CRM-34 e CRM-38 foram confirmadas como concluídas e
validadas antes da retomada. Foram lidos `AGENTS.md`, o checkpoint, PRD,
arquitetura, modelo, métricas, privacidade, integrações, readiness e os guias
locais do Next.js 16.3.4 sobre Route Handlers e fronteiras Server/Client. A
alteração parcial preservada pela PROD-01 foi revisada em vez de descartada.

A CRM-42 acrescentou localização canônica, observação append-only, perfil
corrente com revisão de divergência, issue de qualidade, territórios
versionados e memberships temporais. A origem é classificada como `FACT`,
`INFERENCE` ou `USER_CONFIRMED`; inferência nunca vira fato silenciosamente.
Publicação territorial possui prévia, hash canônico, prioridade, vigência,
detecção de empate e inativação sem apagar história. Resolução e backfill não
alteram owner, equipe, etapa ou lifecycle.

Antes da migration, o `public` foi salvo em
`.backups/crm-42/public-before-crm42-20260912T1943.dump` (3,0 MiB), SHA-256
`a72bca26a3a27b9126e37bd238e1ea34ad32d28317ce1658f372ca6255d7bf57`,
com 1.987 entradas no inventário. A restauração de ensaio em banco temporário
reconciliou 531 Leads, 146 usuários, 18 equipes, 1.183 atividades, 59
oportunidades e 35 migrations. O fingerprint `Lead.id:ownerMemberId`
`11698348dbf6863d71ee97d061208c3e` permaneceu idêntico antes/depois; o banco
temporário foi removido.

A migration foi aplicada ao banco local e o seed repetido sem duplicar a
estrutura. O backfill começou em dry-run: 475 elegíveis, 334 válidos, 141 sem
localização, zero conflitos e zero criações. A execução criou 334 perfis e 174
memberships, sem coordenadas; o replay com a mesma chave retornou a mesma run e
uma nova chave criou zero efeitos de domínio. Ao final, `public` tinha 155
tabelas, 36 migrations, 531 Leads, 10 localizações, 334 observações, 334 perfis,
zero issue aberta, cinco territórios, 174 memberships e zero latitude/longitude.
Não restou schema não sistêmico fora de `public`.

As métricas geográficas reutilizam `MetricsService`, expõem período atual e
anterior, funil e drilldowns, e suprimem amostra/totais/comparação/aquisição
quando o grupo tem menos de cinco Leads. CPL, CAC e ROAS permanecem
indisponíveis sem custos reconciliados. O mapa é uma representação esquemática
local com tabela equivalente, sem tiles, geocoder ou transmissão externa.

O primeiro E2E visual com conteúdo totalmente carregado revelou largura de 475
px em viewport de 390 px na faixa de contexto. A causa era o mínimo intrínseco
dos itens de grid; `min-width: 0`, limite de largura e quebra segura foram
aplicados. As capturas finais em 1440×900, 1280×800, 1024×768 e 390×844 foram
abertas e inspecionadas: conteúdo real, hierarquia legível, tabelas com rolagem
interna e nenhuma sobreposição ou overflow da página.

Resultado final: `pnpm lint` sem avisos; `pnpm typecheck` aprovado; `pnpm test`
com 183/183; `pnpm test:integration` com 239/239 e 36 migrations desde zero;
`pnpm test:crm29` com 4/4; `pnpm test:e2e` com 69/69 cenários de produção e 1/1
local-only; E2E geográfico final com 2/2; `pnpm audit` sem vulnerabilidades;
`pnpm build` aprovado; `pnpm db:status` atualizado; e
`pnpm db:test:cleanup` em dry-run com zero schema candidato. Os avisos conhecidos
do `pg` sobre consulta concorrente, do Next sobre stream encerrado em navegação
abortada e do Vite sobre futuro config loader não causaram falha.

Geocoding externo permanece deliberadamente adiado. Nenhuma credencial,
coordenada inferida, tile externo, egress, banco remoto, deploy, limpeza de
armazenamento, remoção de schema/volume ou mudança de provider foi executada.

## Validação da CRM-43

Em 12 de setembro de 2026, CRM-36 e CRM-37 foram confirmadas como concluídas e
validadas antes da implementação. Foram lidos `AGENTS.md`, o checkpoint, PRD,
arquitetura, modelo, métricas, permissões, privacidade, integrações, readiness e
os guias locais do Next.js 16.3.4 sobre Route Handlers, Server/Client Components,
formulários, navegação e CSS. O baseline era a `main` limpa no commit `e16d084`.

A CRM-43 estendeu, de forma aditiva, `Conversation` e `Message` como fontes
canônicas. Conversas mantêm contexto comercial opcional, canal, estado, SLA,
owner ou fila explícita e revisão otimista. Participantes, eventos de status,
tentativas de entrega, histórico de atribuição, revisões de identidade,
referências de anexos, templates versionados e backfill possuem tabelas
relacionais próprias. Eventos de status, atribuições e itens de backfill são
append-only por trigger; relações compostas protegem o isolamento por workspace.

O `OmnichannelService` centraliza entrada, saída, status, comando e template.
Chaves idempotentes e locks consultivos com retry serializável protegem eventos
concorrentes. A identidade usa `ContactPoint` exato e envia ausência ou
ambiguidade para revisão/Fila Geral, sem criar Lead. Saída consulta a decisão de
privacidade antes da fila e de cada tentativa. Opt-out recebido cancela
mensagem, outbox e job pendentes compatíveis, sem reescrever fatos anteriores.
Somente `INTERNAL_SIMULATOR` é executável; os outros canais são contratos.

Antes da migration, o `public` foi salvo em
`.backups/crm-43/public-before-crm43.dump` (3,3 MiB), SHA-256
`38eace0ae438fd333bb4649edca517880332fd9f5b44e36843c8b663b07800cc`,
com 2.070 entradas no inventário. A restauração isolada reconciliou 531 Leads,
146 usuários, 18 equipes, 1.183 atividades, 59 oportunidades, 3.265 logs de
auditoria e 36 migrations; o banco temporário foi removido. A migration foi
aplicada desde zero em schema descartável e ao `public` local.

O backfill iniciou em dry-run com oito elegíveis: sete conversas existentes e
uma identidade insuficiente. A execução preservou as sete, criou uma revisão e
o replay da mesma `runKey` retornou a execução existente. O seed repetido ficou
idempotente. Ao final, `public` tinha 165 tabelas, 37 migrations concluídas,
531 Leads, oito conversas, oito mensagens, oito eventos de status, sete
atribuições históricas, uma revisão de identidade, um template e uma versão.
Não existe conversa acionável sem owner/fila, vínculo de mensagem cruzado entre
workspaces ou schema não sistêmico fora de `public`. O fingerprint de `Lead.id`
permaneceu `f080bce4c8aeb25f23cdd24d9f741e60`.

Resultado final: `pnpm lint` sem erros; `pnpm typecheck` aprovado; `pnpm test`
com 188/188; `pnpm test:integration` com 247/247 e 37 migrations desde zero;
`pnpm test:crm29` com 4/4; `pnpm test:e2e` com 71/71 cenários de produção e 1/1
local-only; `pnpm audit` sem vulnerabilidades; `pnpm build` aprovado; `pnpm
db:status` atualizado; e `pnpm db:test:cleanup` em dry-run com zero schema
candidato. O E2E renderizou o inbox em 1440×900, 1280×800, 1024×768 e 390×844,
validou tabs/teclado, RBAC, estados vazios, entrega local e ausência de overflow.

A primeira execução conjunta do gate encontrou cinco cópias regeneráveis com
sufixo ` 2` em `.next/dev/types`, que duplicavam declarações geradas e fizeram
somente o `typecheck` falhar. Os cinco arquivos estavam ignorados pelo Git e
foram removidos por nomes exatos; `next typegen` os regenerou corretamente e a
repetição do `typecheck`, o build embutido no E2E e o build explícito passaram.
Nenhum arquivo-fonte foi removido.

Os avisos conhecidos do `pg` sobre consulta concorrente, do Next sobre stream
encerrado em navegação abortada e de `NO_COLOR`/`FORCE_COLOR` não causaram
falha. Não houve provider externo, credencial, egress, banco remoto, deploy,
armazenamento binário, integração WhatsApp/e-mail/telefonia ou execução da
CRM-44.

## Validação da CRM-44

Em 12 de setembro de 2026, a CRM-43 foi confirmada como concluída e validada
antes da implementação. Foram lidos `AGENTS.md`, o checkpoint, PRD, arquitetura,
modelo, privacidade, integrações, inbox, readiness e os guias locais do Next.js
16.3.4 sobre Route Handlers e fronteiras Server/Client. O baseline era a `main`
limpa no commit `4d2d674d3200287533560afb99985fe4a503a866`.

A pesquisa na documentação oficial confirmou assinatura do webhook, janela de
atendimento, template aprovado fora da janela, opt-in e opt-out. A política
também restringe partidos, políticos, candidatos, campanhas e entidades que
oferecem serviços relacionados. Como o enquadramento da Politizai não possui
parecer formal, `policyEligibility` permanece `PENDING_POLICY_REVIEW`. Nenhuma
credencial, conta, número, template, webhook público ou chamada à Meta foi usada.

A CRM-44 acrescentou `WhatsAppConnectionProfile`, `WhatsAppEventReview`, janela
na conversa, timestamps de status na mensagem, referência opaca de mídia e
estado de template no provider. O Route Handler valida limite, corpo cru, HMAC,
challenge e tenant antes de persistir receipt/job. O worker PostgreSQL usa
`SKIP LOCKED`, lock com expiração, advisory lock, retry/backoff, dead-letter e
replay autorizado. Idempotência, status fora de ordem e timestamps monotônicos
impedem duplicação ou regressão da projeção. O Inbox continua sendo a fonte
canônica; privacidade, opt-out, janela de 24 horas e template aprovado são
avaliados no serviço de domínio.

Antes das migrations, o `public` foi salvo em
`.backups/crm-44/politizai_crm_public_pre_crm44_20260912T224403Z.dump`, com
3,4 MiB, SHA-256
`d7c6eb8ca2747656a580cabac73e63743ecf9e349e9fcd69463a6f1018ce306a`
e 2.224 entradas no inventário PostgreSQL 17. A restauração de ensaio em banco
temporário reconciliou 165 tabelas, 37 migrations, 531 Leads, 146 usuários, 18
equipes, 1.183 atividades, 59 oportunidades e 3.267 logs; o banco temporário foi
removido. A primeira tentativa de restore foi interrompida porque o banco vazio
já continha `public`; a repetição removeu somente esse schema vazio no banco
temporário e usou `--exit-on-error` com sucesso. O backup real e o `public` real
não foram alterados pelo ensaio.

`prisma migrate dev` detectou um drift preexistente: a FK composta de
`marketing_campaigns(workspaceId, adAccountId)` registrada no histórico não
estava no `public`. Nenhum reset ou reparo alheio à CRM-44 foi executado. As duas
migrations aditivas foram escritas explicitamente, validadas desde zero em
schemas descartáveis e aplicadas pelo fluxo `migrate deploy`. O backfill público
executou dry-run e modo efetivo com zero candidatos; o replay da mesma chave foi
idempotente. Ao final, `public` possui 167 tabelas e 39 migrations; preserva 531
Leads, 146 usuários, 18 equipes, 1.183 atividades e 59 oportunidades. Há um
profile WhatsApp local, zero conversa/mensagem WhatsApp real, zero janela
incompleta e zero referência de segredo marcada como presente. Somente `public`
permanece como schema não sistêmico.

Resultado final: `pnpm lint` sem erros; `pnpm typecheck` aprovado; `pnpm test`
com 195/195; unitários direcionados com 12/12; integração direcionada com 7/7;
`pnpm test:integration` com 254/254; `pnpm test:crm29` com 4/4; `pnpm test:e2e`
com 73/73 cenários de produção e 1/1 local-only; `pnpm audit` sem
vulnerabilidades conhecidas; `pnpm build` aprovado; `pnpm db:status` atualizado;
e `pnpm db:test:cleanup` em dry-run com zero schema candidato.

O primeiro E2E completo encontrou dois seletores ambíguos depois da inclusão do
WhatsApp; ambos foram tornados contextuais. A segunda execução passou 72/73,
mas um teste visual antigo encontrou página de erro após timeout transitório do
banco. A terceira execução completa passou 73/73 e o teste local-only passou
1/1. Os avisos conhecidos do `pg`, do Next sobre stream encerrado e de
`NO_COLOR`/`FORCE_COLOR` não causaram falha final.

CRM-45 e tarefas posteriores não foram iniciadas. Não houve provider externo,
credencial, egress, banco remoto, deploy, download de mídia ou mudança de
elegibilidade para contornar a política.

## Validação da CRM-45

Em 12 de setembro de 2026, a CRM-43 e a CRM-44 foram confirmadas como concluídas
e validadas localmente antes da implementação. O baseline era a `main` limpa no
commit `7a11a8768bc153efdf4678dc428df364ada77724`. Foram lidos `AGENTS.md`, o
checkpoint, PRD, arquitetura, modelo, permissões, privacidade, integrações,
inbox, readiness e os guias locais do Next.js 16.3.4 sobre Route Handlers,
Server/Client Components e segurança de dados. As RFCs 5322, 3464, 8058 e 7489
foram consultadas apenas para contratos; nenhuma chamada de provider ou DNS foi
executada.

A CRM-45 especializou a inbox canônica com `EmailConnectionProfile`,
`EmailMessageProfile`, recipients, observações de domínio, suppressions e
revisões. Headers e recipients históricos são protegidos; threading depende de
`Message-ID`, `In-Reply-To` e `References`, nunca somente do assunto. O worker
usa job PostgreSQL, `SKIP LOCKED`, lease, tentativa por retry, backoff,
dead-letter e rechecagem de privacidade/suppression. O único transporte ativo é
o sink local determinístico com `externalEgress=false`; `PROVIDER_ACCEPTED` não
é promovido a `DELIVERED`.

Antes das migrations, `public` foi salvo em
`.backups/crm45-before-migration.dump`, com 3,4 MiB, SHA-256
`e0a713532e3dcee60f382cfe65a444823ba450b7d37653fdf9d194b3ce252ff3`
e 2.251 entradas no PostgreSQL 17.10. A restauração isolada reconciliou 167
tabelas, 531 Leads, 146 usuários, 18 equipes, 1.183 atividades, 59 oportunidades,
3.269 logs, 41 migrations registradas no backup e o fingerprint de IDs de Lead
`f080bce4c8aeb25f23cdd24d9f741e60`; o banco temporário foi removido. As duas
migrations aditivas foram aplicadas ao `public`, que terminou com 173 tabelas e
41 migrations aplicadas. O mesmo fingerprint, as contagens comerciais e o
schema `public` foram preservados.

O backfill público executou dry-run e modo efetivo com zero candidatos; o replay
da mesma `runKey` retornou a execução anterior, comprovando idempotência. Em
schema fresco, o seed normalizou as identidades demonstrativas pelo serviço
canônico e manteve 11 conversas, sendo três conversas e três mensagens de e-mail
fictícias; a repetição não duplicou dados. Há um profile e zero referência de
segredo marcada como presente. O smoke do build retornou
aplicação e banco `ok`, e acesso não autenticado à central respondeu com redirect
seguro.

Resultado final: `pnpm lint` sem erros ou warnings; `pnpm typecheck` aprovado;
`pnpm test` com 204/204; unitários direcionados com 9/9; integração direcionada
com 9/9 e regressão direcionada com 23/23; `pnpm test:integration` com 263/263;
`pnpm test:crm29` com 4/4; `pnpm test:e2e` com 75/75 cenários de produção e 1/1
local-only; `pnpm audit` sem vulnerabilidades conhecidas; `pnpm build` aprovado;
`pnpm db:status` atualizado; e `pnpm db:test:cleanup` em dry-run com zero schema
candidato. O E2E verificou a central e o Inbox, RBAC e ausência de overflow em
1440×900 e 390×844.

O primeiro gate de integração encontrou duas expectativas antigas: total de
concessões anterior à matriz de e-mail e `ACCEPTED` genérico projetado como
estado específico do provider. As fixtures foram reconciliadas e a distinção
`ACCEPTED_INTERNAL`/`PROVIDER_ACCEPTED` foi restaurada. A validação final também
removeu duas premissas frágeis de testes: contagem global fixa em schema
compartilhado e seleção implícita da conversa recém-recebida no Inbox. Um seletor
genérico de status no E2E do Meu Dia foi restringido ao texto operacional. A
repetição completa passou. Avisos conhecidos do `pg`, do Next sobre stream
encerrado e de `NO_COLOR`/`FORCE_COLOR` não causaram falha final.

CRM-46 e tarefas posteriores não foram iniciadas. Não houve SMTP, domínio,
mailbox, credencial, DNS, webhook público, provider externo, egress, banco
remoto ou deploy.

## CRM-50 — cobranças e pagamentos validados localmente

Em 13 de setembro de 2026, a CRM-49 foi confirmada como concluída no commit
`81dae2625b0453cd330fe4e1d7c12d71bf7f30b5`, igual à `origin/main`, antes da
continuação exclusiva da CRM-50. O escopo implementa `Invoice` e linhas de
snapshot imutáveis, tentativas, pagamentos, receipts, eventos append-only,
divergências, backfill conservador e um worker PostgreSQL com lock,
retry/backoff, dead-letter e replay. O adaptador local é determinístico, marca
`externalEgress=false` e oferece sucesso, recusa, timeout, falha permanente,
chargeback e evento sem correspondência. Aceite do simulador não equivale a
pagamento: somente callback local assinado e reconciliado confirma o fato.

O callback valida corpo bruto de até 128 KiB, timestamp, nonce, HMAC timing-safe,
versão e idempotência antes de persistir. A interface `/pagamentos` mantém estado
vazio honesto, RBAC, lista e detalhe persistidos, ações explícitas e revisão
humana para divergências, inclusive sem cobrança previamente vinculada. O
pagamento jamais cria `RevenueMovement`; competência/receita e caixa continuam
domínios separados.

Antes das migrations foi salvo o backup ignorado
`.backups/crm50/public-before-crm50-20260913.dump`, com 3.826.432 bytes,
SHA-256 `15e8602b38ef4348e4a4b80bd2d4062eb0caac92798b834004f8cdffc1b9f60f`
e 2.741 entradas. O ensaio de restauração isolado reconciliou 206 tabelas, 533
leads, 146 usuários, 18 equipes, 1.195 atividades, 59 oportunidades e o
fingerprint de IDs de lead `2c829e462f608b815ec33f26c783bcfb`; o banco
temporário foi removido. As três migrations aditivas da CRM-50 foram aplicadas
ao `public` e a cadeia completa de 49 migrations passou desde zero.

O seed público executado duas vezes retornou o mesmo hash estrutural
`9fe445c18a2231e92dd1456a63f8570f4c233765ec87cd034c7dc61633d35e93`. O
backfill dry-run encontrou zero assinatura e zero candidato; a execução manteve
zero criação e o replay retornou o mesmo run. Ao final, `public` contém 216
tabelas, 533 leads, 146 usuários, 18 equipes, 1.195 atividades, 59
oportunidades, 3.302 logs, zero assinatura, zero cobrança, zero pagamento e zero
movimento de receita; o fingerprint de leads permaneceu idêntico.

Passaram `pnpm lint`, `pnpm typecheck`, 235/235 testes unitários, 5/5 testes de
integração direcionados, 293/293 integrações completas, 4/4 CRM-29, 83/83 E2E
de produção, 3/3 local-only, `pnpm audit`, o build Webpack incluído no E2E,
`pnpm db:status` e o dry-run de limpeza com zero schema efêmero candidato. A
rota foi exercitada autenticada em 1440×900 e 390×844 sem overflow. Avisos já
conhecidos do `pg`, de stream encerrado do Next e de cor do runner não causaram
falha.

Durante a implementação foram corrigidos um índice incompatível com o alvo de
`upsert`, uma fixture de recipient que usava chave mutável, duas expectativas
globais frágeis e a grafia do estado `CHARGEBACK`. Nenhuma correção alterou
regra comercial anterior. Não houve provider real, credencial, captura de meio
de pagamento, ERP, contabilidade, emissão fiscal, egress, banco remoto, deploy
ou execução/revalidação da PROD-01. A CRM-51 não foi iniciada.

## CRM-48 — contratos e versões comerciais

Status: **CONCLUÍDA E VALIDADA LOCALMENTE**. Dependências CRM-34 e CRM-35
confirmadas no código, checkpoint e banco; CRM-47 permaneceu preservada. A
migration aditiva passou desde zero sobre as 44 migrations anteriores e foi
aplicada pelo fluxo normal ao `public`, sem reset. O banco terminou com 199
tabelas e 45 migrations; as contagens e fingerprints de 531 leads, 146 usuários,
18 equipes, 1.183 atividades e 59 oportunidades permaneceram idênticos.

Antes da aplicação foi salvo o backup ignorado
`.backups/crm-48/public-before-crm48.dump`, com 3.718.974 bytes, SHA-256
`9408bb4d3e084efad89e5cf418110fd215226bf4c55a7aff70a11b119d752948` e
2.566 entradas. A restauração de ensaio reconciliou 188 tabelas, 44 migrations,
59 oportunidades e 45 ofertas; o banco temporário foi removido. O checksum e o
inventário foram conferidos novamente após a migration.

O seed executado duas vezes manteve a estrutura, criou somente um template local
versionado e não criou contratos. O backfill dry-run avaliou 51 oportunidades;
a execução registrou as 51 como `SKIPPED`, sem fabricar contrato por ausência
dos pré-requisitos canônicos, e o replay com a mesma chave retornou o mesmo run
com `idempotent: true`. O `public` terminou com zero contrato criado
automaticamente, dois runs, 51 itens e os dois AuditLogs append-only esperados.

Passaram `pnpm lint`, `pnpm typecheck`, 229/229 testes unitários, 287/287 de
integração, 4/4 CRM-29, 81/81 E2E de produção, 2/2 local-only, `pnpm audit`,
`pnpm build`, `pnpm db:status` e o dry-run de limpeza com zero schema residual.
A rota `/contratos` foi inspecionada autenticada em 1440×900 e 390×844; o mobile
teve `scrollWidth` igual ao viewport de 390 px. Avisos conhecidos do Node 24 fora
da engine recomendada, do `pg`, do Next sobre stream encerrado e de cor do runner
não causaram falha.

O escopo entrega modelo, snapshots, estados, RBAC, serviço transacional, UI,
impressão HTML, aceite manual local, métricas e backfill conservador. Não houve
provider, assinatura eletrônica, revisão jurídica homologada, credencial,
egress, banco remoto ou deploy. A CRM-49 não foi iniciada.

## CRM-61 — qualidade de dados governada

Em 13 de setembro de 2026, CRM-38, CRM-49 e CRM-60 foram confirmadas como
concluídas antes da execução exclusiva da CRM-61. O módulo novo centraliza sete
regras determinísticas versionadas, dry-run, varredura idempotente, ocorrências
com owner/Fila Geral/SLA, histórico append-only, reconciliação financeira,
candidatos de duplicidade e decisão humana.

O merge é limitado a Contact e Account. Prévia, sobrevivente, decisões campo a
campo, motivo, confirmação literal, revisão, fingerprint, locks e ledger são
obrigatórios. Relações comerciais mutáveis elegíveis são transferidas na mesma
transação; contratos e fatos financeiros bloqueiam a operação. A origem recebe
estado `MERGED`, mantém seu ID e aponta para o sobrevivente. Rollback só ocorre
se nada mudou depois do merge. Aplicação e reversão concorrentes com a mesma
chave retornam a mesma execução.

A migration aditiva `20260913440000_data_quality_governed_merge` foi criada
manualmente porque `prisma migrate dev --create-only` detectou drift anterior e
se recusou corretamente a prosseguir sem reset. Nenhum reset foi feito. O fluxo
`prisma migrate deploy` aplicou a migration e a cadeia completa de 58 migrations
passou desde zero.

Antes da migration foi salvo o backup ignorado
`.backups/crm61/public-before-crm61.dump`, com 4.314.036 bytes e SHA-256
`bc546192d8db1168817512421411ff0fefc7aac6798d7f9ad28a1536fedd4bb1`.
`pg_restore --list` validou o inventário e a restauração limpa no banco isolado
`crm61_restore_trial` reconciliou 279 tabelas, 99 workspaces, 146 usuários, 533
leads, 477 contatos, 4 contas, 62 oportunidades, 3.324 logs e 62 migrations do
momento do backup (57 concluídas e cinco registros históricos); o banco de ensaio foi removido. Após a migration, `public`
possui 288 tabelas e 58 migrations, mantendo 99 workspaces, 146 usuários, 18
equipes, 533 leads, 477 contatos, 4 contas, 1.195 atividades, 62 oportunidades
e 3.324 logs. As tabelas de qualidade estão vazias até execução humana.

Passaram 278/278 testes unitários, 345/345 integrações, 4/4 CRM-29, 111/111 E2E
de produção e 3/3 local-only, além de lint, tipos, audit, build Webpack,
`db:status` e dry-run de limpeza com zero schema efêmero residual. O primeiro
gate integral expôs uma contagem antiga de grants, poluição de fixture por seed
CRM-29 e seleção global de outbox em teste; as fixtures foram isoladas e a suíte
completa repetida com sucesso. Avisos conhecidos de `pg`, stream encerrado do
Next, configuração futura do Vite e `NO_COLOR` não causaram falha.

Limitação declarada: a varredura síncrona cobre até 2.000 registros por entidade
e grava `bounded:2000` quando truncada. Worker incremental acima desse volume
permanece para a fase de readiness. Nenhum provider, credencial, egress, banco
remoto, deploy, PROD-01 ou CRM-62 foi executado nesta task.

## CRM-62 — observabilidade, segurança e privacidade operacional

Em 13 de setembro de 2026, CRM-50, CRM-58 e CRM-61 foram confirmadas como
concluídas antes da execução exclusiva da CRM-62. A migration aditiva
`20260913460000_observability_security_privacy` foi aplicada ao `public` e a
cadeia completa de 59 migrations passou desde zero em schemas efêmeros. Não há
`DROP`, `TRUNCATE`, `DELETE` nem remoção de coluna na migration.

O módulo entrega contrato `telemetry.v1` com correlação e redaction central,
labels de baixa cardinalidade, catálogo versionado de SLI/SLO, cálculo sem
denominador fictício, alertas determinísticos com deduplicação/cooldown/owner,
incidentes e timelines append-only. `/api/health` e `/api/ready` expõem somente
estado agregado seguro. Guardrails bloqueiam banco remoto e adapter externo por
padrão; o rate limit local protege a API sensível sem alegar coordenação
distribuída.

Privacidade inclui inventário, finalidade, base legal, retenção, legal hold e
solicitações de acesso, correção, portabilidade, restrição, oposição, revogação
e eliminação. Identidade, prazo, escopo, owner/fila e evidências são persistidos.
Exportação é minimizada e auditada. Eliminação/anonimização continuam
desabilitadas: o sistema produz apenas preview com blockers e exige decisão
humana futura. O backfill conservador só cria o evento `CREATED` ausente de DSR
histórica, usa IDs determinísticos, lock e opera apenas em `politizai_crm/public`.

Antes da migration foi salvo o backup ignorado
`.backups/crm62/public-before-crm62.dump`, com 4.366.833 bytes e SHA-256
`e8509aaf011caf3ff142454c2763b9ee6126c0198c01f55b53a70778972d08f0`.
`pg_restore --list` validou 3.732 entradas. A restauração de ensaio em banco
isolado reconciliou 533 leads, 3.324 logs de auditoria e 58 migrations do
checkpoint; o banco temporário foi removido. O dump e o checksum foram
revalidados ao final.

O seed público repetido permaneceu idempotente. O backfill em dry-run e duas
execuções confirmadas encontrou zero candidato e criou zero evento de DSR; o
AuditLog do run é idempotente. Ao final, `public` possui 59 migrations, 533
leads, 146 usuários, 18 equipes, 1.195 atividades, 62 oportunidades e 3.327
logs. O fingerprint dos IDs de lead continua
`2c829e462f608b815ec33f26c783bcfb`; não existe schema não sistêmico fora de
`public`.

Passaram `pnpm lint`, `pnpm typecheck`, 285/285 testes unitários, as etapas de
integração 336/336, 7/7, 5/5 e 3/3, 4/4 CRM-29, 114/114 E2E de produção e 3/3
local-only, `pnpm audit`, `pnpm build`, `pnpm db:status` e o dry-run de limpeza
com zero schema candidato. A console foi inspecionada autenticada nas abas de
Observabilidade, Segurança e Privacidade; o E2E confirmou 390×844 sem overflow
e navegação por teclado. Uma colisão de colunas observada no primeiro render foi
corrigida; a primeira execução E2E então revelou overflow herdado em Qualidade
de dados, corrigido com contenção explícita, e a suíte completa foi repetida.

Avisos conhecidos do `pg`, do loader futuro do Vite, de stream encerrado do
Next e de `NO_COLOR`/`FORCE_COLOR` não causaram falha final. Limitações
declaradas: telemetria apenas nas operações instrumentadas, rate limit por
processo, CSP ainda com `unsafe-inline`, políticas sujeitas a validação jurídica
e ausência de destruição real. Não houve provider, credencial, egress, banco
remoto, deploy, PROD-01, CRM-63 ou CRM-64 nesta task.

## FREE-STAGING-01 — ambiente gratuito de construção

Status: **CONCLUÍDO E VALIDADO PARA DADOS SINTÉTICOS** em 14 de setembro de
2026. Este checkpoint é separado das tasks PROD e não altera o NO-GO de
produção.

O código permanece no repositório privado `Menddon/crm-politizai`. Foi criado
o projeto Neon Free `crm-politizai-staging-db` em AWS São Paulo, banco
`politizai_staging`, com owner, migrator e runtime separados, TLS, endpoint
pooled para aplicação e conexão direta reservada a migration. As 59 migrations
foram aplicadas; o inventário validado possui 297 tabelas, um workspace, um
usuário sintético e zero lead. Nenhum dado local ou real foi copiado.

Foi criado o projeto Render `CRM Politizai — Staging`, ambiente `Staging` e
serviço Node Free `crm-politizai-staging` em Virginia. O deploy
`dep-dak3nsid0e5s738jblvg` do commit
`eb8c592400294fa0fc2af70729bc35edf002d198` ficou Live em
<https://crm-politizai-staging.onrender.com>. `/api/health`, `/api/ready`, login
sintético, cookie seguro e Dashboard autenticado retornaram HTTP 200. O CI
`34879743201` passou integralmente.

O primeiro build expôs exigência indevida de `DIRECT_URL` no processo web; a
configuração Prisma passou a consumir URL direta apenas em
`PROCESS_ROLE=migration`. O segundo build atingiu o heap padrão durante o
typecheck; o build do Render recebeu 3 GB de heap somente durante a compilação,
sem alterar os 512 MB do runtime gratuito. A credencial runtime que apareceu em
estado técnico do formulário foi rotacionada antes do deploy válido e os
arquivos temporários foram removidos.

Passaram localmente lint, typecheck, 17 testes direcionados e build Webpack. O
preflight remoto retornou `READY_FOR_STAGING`. Adapters, seed demo, credenciais
demo, bootstrap web e worker remoto permanecem desativados. O worker local
iniciou contra o staging no smoke e foi encerrado manualmente logo depois. Não houve cobrança,
upgrade, domínio, produção, dado real ou integração externa. Limites e operação
estão em [`FREE_STAGING_ENVIRONMENT.md`](./FREE_STAGING_ENVIRONMENT.md).
