# Checklist de go-live

> A execução atual deste checklist está em
> [`STAGE19_PRODUCTION_READINESS.md`](./STAGE19_PRODUCTION_READINESS.md), com
> manifesto fail-closed verificável. Os checkpoints abaixo preservam o histórico.

## Estado

Este checklist é um gate futuro. Em 16 de setembro de 2026, o resultado é:

- **homologação local/isolada:** aprovada;
- **produção ou dados reais:** bloqueada;
- **deploy realizado:** staging e um release candidate de produção protegido;
  produção continua sem Git, domínio customizado, usuário ou tráfego público;
- **banco/provider externo conectado:** Neon Free de staging e produção
  separados; produção possui 60 migrations, 298 tabelas, zero dado operacional
  e uma branch pré-migration preservada;
- **decisão PROD-10:** **homologada para staging gratuito / NO-GO para
  produção paga**; banco, web, CI, worker serverless manual, Pipeline, VoiceOver,
  zoom 200% e fault lab remoto passaram; falta o worker operacional definitivo;
- **decisão PROD-12:** release candidate fechado concluído no SHA `bf15b079`,
  com worker desligado, acesso Vercel protegido e custo R$ 0;
- **decisão PROD-13 atual:** **NO-GO para a PROD-14**. O relatório atual é
  `PROD13_FINAL_GO_NO_GO.md`; `FINAL_GO_NO_GO.md` permanece como auditoria
  preliminar histórica;
- **worker 24×7:** ausência aceita explicitamente para a fase gratuita de
  construção, sem alegação de disponibilidade contínua e sem autorizar dados
  reais.

Os detalhes da PROD-12 estão no relatório consolidado
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md) e nos
relatórios especializados de
[migrations](./PROD12_MIGRATION_REPORT.md),
[deployment](./PROD12_DEPLOYMENT_REPORT.md),
[rollback](./PROD12_ROLLBACK_REPORT.md) e
[aceite](./PROD12_ACCEPTANCE_REPORT.md).

## Gate já demonstrado localmente

- [x] commit e branch identificáveis, com árvore limpa após o aceite;
- [x] Node 22, pnpm 11, lint, TypeScript, audit e build aprovados;
- [x] migrations aplicáveis desde zero e `public` atualizado;
- [x] unitários do preflight, integrações críticas e smoke E2E aprovados;
- [x] health/readiness retornam apenas estado agregado;
- [x] RBAC impede acesso direto por URL no cenário de visualizador;
- [x] schema efêmero descartado após integração e E2E;
- [x] nenhum segredo conhecido versionado ou exposto em `NEXT_PUBLIC_*`;
- [x] adapters externos e banco remoto negados pelo preflight local;
- [x] restore, concorrência, idempotência e baseline local evidenciados na CRM-63;
- [x] dados fictícios, simulações e limitações identificados como tais.
- [x] contrato tipado de local/test/staging/production bloqueia fallback remoto;
- [x] liveness sem dependências e readiness somente do PostgreSQL;
- [x] scripts protegidos por CSP com nonce e headers de segurança testados;
- [x] bootstrap inicial CLI-only, transacional, idempotente e auditável;
- [x] configuração versionada fixa Node 22, pnpm 11, Webpack e região `gru1`.
- [x] CI sem secrets remotos cobre instalação congelada, migrations desde zero,
  lint, tipos, unitários, integrações críticas, audit, build e smoke;
- [x] gate manual exige SHA completo e reutiliza os mesmos checks sem deploy;
- [x] scanner versionável, SBOM SPDX e relatório de supply chain possuem testes;
- [x] Dependabot alerts, correções automatizadas e atualizações semanais estão
  configurados no repositório privado.
- [x] auditoria preliminar histórica documentada em `FINAL_GO_NO_GO.md`; ela
  não substitui nem marca como executada a PROD-13 atual;

## Blockers obrigatórios antes de produção

- [x] provisionar PostgreSQL gerenciado e isolado de staging com TLS, pool,
  migrator e runtime separados — PROD-05 no Neon Free;
- [x] homologar migrations, dataset sintético, RBAC, menor privilégio e restore
  isolado do banco de staging — PROD-06 e `STAGING_DATABASE_REPORT.md`;
- [x] publicar web de staging isolada em `gru1`, protegida por Vercel
  Authentication, conectada ao Neon e validar login, RBAC, páginas, criação e
  persistência sintéticas — PROD-07 e `STAGING_DEPLOYMENT.md`;
- [x] homologar o entrypoint real do worker contra o Neon de staging, com job
  sintético idempotente, backlog zero, shutdown gracioso e zero egress —
  PROD-08 e `STAGING_WORKER_REPORT.md`;
- [x] homologar o endpoint serverless protegido no Vercel: autenticação, query
  rejeitada, kill switch 503, concorrência, replay, resposta segura e pool
  desconectado — correção dirigida da PROD-10;
- [x] criar projeto Vercel de produção protegido, sem Git, domínio ou
  deployment, em `gru1`;
- [x] criar projeto Neon de produção exclusivo e vazio em São Paulo, com TLS,
  pooled/direct e owner/migrator/runtime separados;
- [x] manter worker, adapters, demo, seed e bootstrap de produção desligados;
- [ ] concluir a topologia de staging equivalente à produção: web, worker,
  observabilidade, proteção e homologação; o runtime remoto persistente ainda
  não foi contratado/provisionado;
- [ ] aprovar finalidade, base legal, retenção, avisos, DPA e fluxos de titulares
  com jurídico/DPO;
- [x] remover credenciais demo da configuração e separar projetos, bancos e
  segredos de staging/produção;
- [x] armazenar os segredos iniciais de produção somente em Vercel
  Sensitive/Keychain, com runtime sem DDL e direct URL fora do web;
- [ ] homologar rotação, acesso por segundo operador e trilha de mudança;
- [ ] promover para o perfil produtivo de PostgreSQL gerenciado com TLS, usuário
  restrito, pool dimensionado, backup criptografado, PITR e restore ensaiado; o
  staging e produção gratuitos possuem apenas histórico de 6 horas; a branch de
  produção não pôde ser protegida no Free; o ensaio formal da PROD-06 não
  substitui a política futura de produção;
- [x] validar as 59 migrations no staging sintético e em branch isolado, com
  duração persistida, zero pendência, zero lock aguardando e rollback de
  aplicação/recuperação documentados;
- [x] repetir o restore Neon após a migration 60 e reconciliar 298 tabelas,
  contagens e fingerprint antes de remover a branch temporária;
- [ ] homologar web e worker em runtime remoto com reinício automático e teste
  prolongado; concorrência, backlog, dead-letter e shutdown foram aprovados no
  motor e no smoke transitório, mas não em duas réplicas remotas;
- [x] substituir rate limit em memória por coordenação PostgreSQL compartilhada
  e publicar WAF de staging em modo Log, sem Redis ou bloqueio prematuro;
- [ ] concluir observabilidade produtiva: staging possui correlação, redaction,
  métricas, alertas internos e runbooks, mas ainda não possui retenção central,
  monitor externo, alertas financeiros automáticos ou on-call nominal;
- [x] remover `unsafe-inline` da CSP, confirmar HSTS no TLS remoto e revisar
  CSRF, XSS, SSRF, IDOR, upload CSV, open redirect e webhooks no staging;
- [ ] executar DAST/pentest e promover regras WAF de observação para enforcement
  somente após baseline e plano produtivo aprovados;
- [ ] contratar GitHub Pro/Team/Enterprise e aplicar ruleset da `main` com o
  check obrigatório `CI / Quality gate` (API atual bloqueia proteção privada);
- [ ] habilitar GitHub Secret Protection/Code Security, dependency review e
  CodeQL ou equivalentes para histórico e SAST privado;
- [ ] executar DAST, assinatura/atestação do artefato e pentest independente;
- [x] validar Chromium, Firefox e WebKit no build de produção local, incluindo
  rotas de admin, SDR, closer e viewer e viewport 390×844 — 9/9 na PROD-10;
- [x] validar VoiceOver real e zoom manual de 200% nas jornadas centrais de
  staging; uma rodada humana independente continua recomendada;
- [x] executar carga e soak controlados no deployment protegido de staging:
  140/140 respostas HTTP 200, zero erro e backlog zero;
- [x] executar fault injection remoto em branch Neon descartável, preservando
  health, readiness, job pendente e retomada idempotente; failover regional e
  RPO/RTO produtivos continuam pertencendo ao perfil futuro;
- [ ] homologar individualmente cada provider externo autorizado, incluindo
  escopo, quota, custo, revogação, webhook, reconciliação e fallback;
- [ ] aprovar IA externa, se usada, com contrato, região, retenção, evals,
  orçamento, kill switch e minimização;
- [x] designar owners nominais de staging em `OPERATIONAL_OWNERS.md`;
- [ ] nomear substituto/on-call e aprovadores de negócio, segurança,
  jurídico/privacidade para produção;
- [x] congelar o SHA técnico, confirmar ponto de recuperação e ensaiar rollback
  de aplicação/banco para o release candidate fechado;
- [x] obter autorização explícita separada para o deployment fechado da PROD-12;
- [x] executar a auditoria PROD-13 sobre o release candidate fechado;
- [ ] fechar os bloqueios críticos da PROD-13 e obter nova decisão GO antes de
  qualquer autorização para PROD-14.

Nenhum item produtivo aberto foi implicitamente aceito. O staging gratuito não
precisa repetir a homologação completa. A PROD-12 encerrou somente o release
candidate fechado; identidade, dados reais, worker, domínio e go-live
permanecem bloqueados. A PROD-13 encerrou em NO-GO; nova autorização, sozinha,
não substitui as evidências humanas e técnicas pendentes.

## Gate da janela de mudança futura

1. Confirmar commit, artefato, migrations e configuração sem imprimir segredo.
2. Registrar backup/PITR e resultado do restore recente.
3. Aplicar migrations uma única vez com a identidade de migration.
4. Subir web e worker da mesma versão.
5. Executar smoke de health, login, RBAC, lead, tarefa, worker e métricas.
6. Observar SLOs, erros, pool, jobs e outbox pela janela aprovada.
7. Interromper e reverter a aplicação ao falhar; restaurar dados apenas pelo
   runbook aprovado e quando a análise confirmar necessidade.
8. Registrar resultado, riscos aceitos, responsáveis e comunicação.
