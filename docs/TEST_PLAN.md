# Plano de testes e endurecimento do MVP

## Objetivo e limite

Este plano define a validação local do Politizai CRM antes do aceite do MVP. Ele
não certifica segurança, disponibilidade ou desempenho de produção. Nenhum
comando usa credencial, schema ou integração de produção; os testes relacionais
recusam host PostgreSQL que não seja loopback e recriam somente schemas com
nomes efêmeros únicos e estritamente controlados.

## CRM-63 — recuperação, concorrência e capacidade local

`pnpm test:resilience` valida contratos, RPO/RTO, percentis, budgets, matriz de
recuperação, backpressure e bloqueios do fault injector. O comando
`pnpm test:resilience:integration` cria um schema
`politizai_test_resilience_*`, aplica migrations e valida rollback antes do
commit, retomada idempotente após resultado ambíguo, concorrência, invariantes e
o resumo do Console de Operações.

Os testes dirigidos de intake e automation worker são reutilizados para provar,
respectivamente, deduplicação concorrente e claim por `SKIP LOCKED`. Smoke e
baseline usam `scripts/run-resilience-load.ts`. Backup/restore usa banco local
descartável, manifesta fingerprints e remove o alvo em `finally`. Nenhuma suíte
pode apontar para `public` como alvo destrutivo ou para banco remoto.

Consulte `RESILIENCE_CAPACITY.md` para comandos, budgets e limitações.

## CRM-57 — métricas de receita

- unitário: ponte de MRR, coorte GRR/NRR, basis points, zero, denominador
  ausente, indisponibilidade e interpretação direcional;
- integração isolada: catálogo, comparação, séries, coortes, drilldown, corte
  futuro rejeitado e supressão de mídia em escopo `OWN`;
- E2E: navegação, drilldown, coortes, qualidade por escopo e overflow em
  desktop/mobile;
- regressão: suítes gerais, CRM-29, lint, tipos, audit e build.

Não há migration/backfill na CRM-57. O executor remove o schema dedicado mesmo
em falha, salvo `KEEP_TEST_SCHEMA=1` explícito.

## Gates reproduzíveis

Execute com Node.js 22, PostgreSQL local ativo e `.env` baseado em
`.env.example`:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:crm29
pnpm test:e2e
pnpm audit
pnpm build
```

- `pnpm test:integration` recria apenas `politizai_crm30_integration_test`,
  aplica todas as migrations e executa os arquivos serialmente;
- `pnpm test:crm29` recria apenas `politizai_demo_crm29_test` e valida
  idempotência, coerência e métricas da demonstração;
- `pnpm test:e2e` recria apenas `politizai_demo_crm30_e2e`, aplica migrations,
  executa o seed, gera o build e roda a suíte principal contra `next start`;
- o cenário marcado `@local-only` roda separadamente em `next dev`, pois webhook
  e simulador são corretamente inexistentes quando `NODE_ENV=production`;
- qualquer falha encerra o executor imediatamente. Uma execução parcial não é
  aprovação do gate.

Os schemas são descartáveis. Os scripts validam o hostname antes de qualquer
`DROP SCHEMA`; nunca aceitam um banco remoto nem o schema `public`.

## Matriz de cobertura crítica

| Camada | Requisito | Evidência automatizada principal |
|---|---|---|
| Unitário | telefone e entrada | `phone-normalizer`, `lead-entry-contracts`, `csv-parser` |
| Unitário | score e prioridade | `score-calculator`, `immediate-sla` |
| Unitário | SLA e timezone | `immediate-sla`, `workspace-time` |
| Unitário | conversões e KPIs | `metric-math`, `dashboard-period`, contratos gerenciais |
| Unitário | transições | políticas de pré-vendas e oportunidade |
| Unitário | permissões e sessão | senha, cookie, origem da requisição e proxy |
| Unitário | automações | política do motor, contratos dos agentes |
| Unitário | hardening HTTP/CSV | limite de corpo, mídia, rate limit e neutralização de fórmula |
| Integração | criar e deduplicar lead | `lead-intake`, `lead-entry-channels` |
| Integração | distribuir e iniciar SLA | `lead-distribution`, `sdr-queue` |
| Integração | tentativa, tarefa e timeline | `operational-history` |
| Integração | PACTO e qualificação | `pacto-qualification`, `pre-sales-pipeline` |
| Integração | reunião e briefing | `meetings-agenda` |
| Integração | oportunidade, ganho/perda | `opportunities-sales` |
| Integração | dashboard e KPIs | `metrics`, `manager-copilot` |
| Integração | automações e worker concorrente | `automation-engine`, regras de entrada e ciclo de vida |
| Integração | auditoria e isolamento | `audit-process-health`, `auth-rbac` |
| Unitário | contratos de pagamento local | centavos inteiros, HMAC, expiração, limite de corpo e seis cenários determinísticos |
| Integração | cobrança e pagamento sandbox | snapshot, emissão, idempotência, retry/dead-letter, replay, chargeback, reconciliação, RBAC e separação de receita |
| E2E | pagamentos | leitura persistida, estado vazio, RBAC, desktop/mobile e rejeição de callback com assinatura inválida |
| Unitário | contrato Meta Ads | versão allowlisted, dinheiro inteiro, zero versus ausência, ação conhecida/desconhecida |
| Unitário | transporte Meta Ads | host/rota fixa, GET, cursor, timeout, limite de resposta, retry e erro seguro |
| Integração | Meta Ads local | referência de segredo, RBAC, descoberta, hierarquia, sync inicial/incremental, revisão e cursor |

## Fluxo E2E principal

`opportunities-sales.spec.ts` mantém um único registro correlacionável e percorre:

1. login local;
2. entrada manual e normalização;
3. score/ prioridade vigentes, distribuição, tarefa `Ligar agora` e SLA 0;
4. tentativa humana e congelamento do primeiro tempo de resposta;
5. preparação da ligação pelo provider local determinístico;
6. PACTO validado e qualificação;
7. agendamento e briefing do closer;
8. comparecimento, oportunidade, proposta, negociação e ganho;
9. dashboard calculado do período;
10. auditoria pesquisável do ganho.

## Fluxos E2E alternativos

- no-show, desqualificação, opt-out, ausência de próxima ação e falha terminal de
  automação são exercitados sobre cenários persistidos do seed em
  `hardening-alternatives.spec.ts`;
- indisponibilidade de todos os SDRs pausa somente membros do schema descartável,
  cria uma entrada, prova Fila Geral, tarefa, SLA e auditoria, e restaura o estado
  em `finally`;
- duplicidade e idempotência do webhook ficam no teste `@local-only`;
- negação por URL/API está em `foundation`, `lead-entry`, `lead-list`,
  `operational-history`, `commercial-settings`, `workspace-administration`,
  `manager-copilot` e `audit-process-health`;
- override de prioridade com motivo está em `operational-history`;
- rollback transacional, retry, concorrência e opt-out também são validados nos
  testes de integração, onde relógio e falhas podem ser controlados sem flake.

## Segurança local validada

- toda mutação continua protegida por autenticação, `assertSameOrigin`, política
  server-side e escopo de workspace;
- senha usa `scrypt`; sessão persiste apenas hash SHA-256 do token e cookie
  `HttpOnly`, `SameSite=Lax`, com `Secure` em produção;
- login, CSV, webhook/simulador local, IA e execução manual de automação têm
  limite de corpo antes do parse e rate limit por IP hash ou membro;
- CSV limita bytes/linhas e o relatório neutraliza células iniciadas por
  `=`, `+`, `-` ou `@` antes do escape;
- logs de rota não serializam exceções ou payloads e o logger mascara chaves
  sensíveis conhecidas;
- respostas globais incluem `nosniff`, bloqueio de frame, referrer restrito e
  Permissions Policy mínima;
- o audit de dependências deve terminar sem vulnerabilidade conhecida.

O rate limit atual é em memória e adequado apenas ao runtime local monolítico.
Produção exigirá armazenamento compartilhado, política por rota/tenant,
observabilidade, proteção na borda e teste de carga/abuso. CSP, HSTS, rotação de
segredos, recuperação, pentest, SAST/DAST, backup e resposta a incidentes também
permanecem revisão obrigatória antes de dados reais.

## Performance e confiabilidade

- lista: consulta paginada e filtrada no servidor, índices relacionais e cenário
  com mais de 300 leads;
- dashboard: camada única de métricas, agregados em lote e orçamento de teste com
  base demonstrativa;
- timeline: cursor, página máxima de 50 e índices por lead/data;
- worker: lock PostgreSQL, `SKIP LOCKED`, retry/backoff, efeito idempotente e
  concorrência exercitada em integração;
- seed e suítes usam relógio controlado quando a regra depende de datas;
- E2E usa build otimizado para evitar recompilação sob demanda e documentos
  duplicados do Fast Refresh.

Os testes locais usam uma carga funcional de 320 leads, não um ensaio de escala.
Antes de publicação são necessários teste de carga com volume previsto, análise
de planos SQL em dados representativos, limites de conexão e SLOs acordados.

## Política para falhas

Um teste só pode ser chamado de aprovado quando o comando completo termina com
código zero. Flake deve ser reproduzido e corrigido na causa; aumentar timeout é
aceitável apenas para uma operação legítima e mensurada. Falha conhecida que não
possa ser corrigida deve permanecer explícita no checkpoint, com comando, erro,
impacto e item de backlog. Testes nunca dependem da ordem nem de resíduos de uma
execução anterior.

## Isolamento e descarte de schemas — PROD-01

`test:integration`, `test:crm29` e `test:e2e` usam nomes únicos no padrão
`politizai_test_*` e removem o schema em `finally`, inclusive quando um comando
filho falha. O executor recusa `public`, host remoto, outro banco e produção.
`KEEP_TEST_SCHEMA=1` é a única exceção de depuração e deve ser seguida pelo
dry-run `pnpm db:test:cleanup`.

Os testes unitários de `test-schema-lifecycle` validam regex, denylist,
allowlist, host, banco, produção e confirmação. A integração homônima comprova
no PostgreSQL que o filho selecionado é removido e `public` permanece. Depois
de cada gate completo deve-se consultar `pg_namespace` e obter zero nomes
`politizai_test_*`. A manutenção também recusa qualquer outra conexão cliente,
mesmo ociosa; esse bloqueio possui cobertura relacional. Veja
`docs/TEST_SCHEMA_LIFECYCLE.md`.

Na revalidação após a CRM-39, o gate aprovou 160 unitários, 230 integrações, 4
CRM-29, 63 E2E de produção e 1 E2E local-only, além de lint, typecheck, audit,
build e status das 33 migrations do código (35 registros históricos no banco,
incluindo tentativas resolvidas). Ao final havia zero schema
`politizai_test_*`; `public` manteve 145 tabelas e os mesmos fingerprints das
entidades comerciais protegidas.

## CRM-40 — limite da validação

Fixtures determinísticas exercitam o contrato oficial sem egress e sem segredo
real. O teste relacional cria um schema efêmero, configura referências, descobre
uma conta fixture, persiste cinco mappings exatos, importa insight diário,
preserva ação desconhecida, relê dado tardio como revisão, prova idempotência e
mantém cursor no commit. Ausência de credencial prova o estado
`PENDING_CREDENTIALS` sem chamar a rede.

Esses testes não substituem validação externa. Teste real de token, escopo,
conta, paginação e rate limit permanece pendente e não pode ser descrito como
aprovado enquanto as credenciais server-side não forem disponibilizadas.

## CRM-41 — Google Ads somente leitura

- unitário de contrato: customer ID, versões allowlisted, micros/centavos,
  arredondamento, zero versus ausência e status;
- unitário de transporte: OAuth e service account, hosts/rotas fixos, GAQL
  allowlisted, Search paginado, `login-customer-id`, ausência de Mutate, limite,
  retry/`Retry-After`, request ID e erro seguro;
- integração efêmera: RBAC, referência sem valor, descoberta/hierarquia,
  mappings exatos, dois assets, métricas provider separadas das métricas CRM,
  revisão tardia, idempotência, cursor commit-safe e rollback em falha;
- E2E: configuração sem campo secreto, estado de validação externa adiada e
  bloqueio do Visualizador por URL direta.

Fixtures não substituem validação externa. Projeto Google Cloud, OAuth/service
account, customer real, quota, paginação real e reconciliação com Google Ads
permanecem explicitamente adiados. Nenhum teste local abre egress.

## Revalidação PROD-01 após CRM-41

O gate foi executado sobre uma cópia limpa da `main`, separada da CRM-42 parcial
preexistente. O primeiro `pnpm typecheck` reproduziu a ausência dos tipos de
assets do Next em clone limpo. Após incorporar `next typegen` ao script, o gate
final aprovou lint, TypeScript, 177 unitários, 233 integrações, 4 CRM-29, 67 E2E
de produção, 1 E2E local-only, audit, build e status de 35 migrations.

Integração, CRM-29 e E2E criaram schemas com nomes controlados e os removeram no
`finally`. O dry-run e a confirmação de `pnpm db:test:cleanup` encontraram zero
candidato. O smoke confirmou HTTP 200 em health, login, Dashboard e Auditoria.
O host atual usa Node 24.18.0 e emitiu aviso porque o projeto declara Node 22;
antes de um release futuro, repetir o gate na versão documentada.

## Identidade canônica — CRM-33

A suíte de integração `contact-identity.integration.test.ts` cobre dual write,
dois Contacts com ponto compartilhado, unicidade ativa por Contact, unicidade
de primário por tipo, review auditado, RBAC, dry-run sem mutação, pausa/retomada,
falha com rollback, duas chamadas concorrentes e replay idempotente. A suíte de
entrada confirma Contact e submissão ligados tanto em criação quanto em nova
conversão, incluindo opt-out aderente.

O gate operacional exige ainda: migration em schema vazio efêmero; reconciliação
do workspace alvo antes/depois; IDs históricos invariantes; zero vínculo entre
workspaces; zero `politizai_test_*` ao final; suíte E2E da aba Identidade; e
execução do backfill real primeiro em dry-run. Os 82 schemas legados protegidos
não podem ser usados como fixture nem removidos.

## Cobertura CRM-34

- unitário: normalização de nome, documento, domínio e ausência;
- integração: cadeia completa de migrations, unicidade de documento ativo,
  isolamento da hierarquia, auto-parentesco e concorrência de papel ativo;
- E2E: lista, criação e Conta 360 com administrador; leitura sem mutação para
  visualizador;
- operação: seed repetido, dry-run, execução e replay do backfill;
- regressão: lint, typecheck, suíte unitária, integração, CRM-29, E2E, audit e build.

Todo executor continua usando schema `politizai_test_*` e descarte em `finally`.
Os 82 schemas legados protegidos e o schema `public` não são fixtures.

## Cobertura CRM-36

- unitário: precedência de opt-out/revogação, ausência distinta de negativa,
  política pendente, granularidade por canal/ponto e decisão reproduzível;
- integração: migration vazia, consent event append-only, projeção corrente,
  idempotência e concorrência, rollback de concessão inválida, isolamento de
  workspace, RBAC, DSR/verificação/exportação, legal hold, preview de retenção,
  backfill dry-run/execute/replay e auditoria;
- E2E: painel `/privacidade` com pendência jurídica explícita, Lead 360 em
  opt-out, tentativa bloqueada e Visualizador sem acesso administrativo;
- operação: backup do `public` antes da migration, dry-run real, execução,
  replay com zero novo efeito, reconciliação de contagens/IDs e zero schema
  `politizai_test_*` residual.

Nenhum teste trata uma política `PENDING_LEGAL` como `ALLOW`, nem usa integração,
provider, banco remoto ou eliminação física.

## Cobertura CRM-37

- unitário: redação recursiva, HMAC, expiração e backoff/retry-after;
- integração: migration vazia, RBAC, isolamento, webhook concorrente,
  idempotência, conflito, limite, outbox/rollback, entrega única, cursor
  commit-safe e precedência humana;
- E2E: `/integracoes`, teste local, ausência explícita de egress e negativa ao
  Visualizador;
- regressão: lint, tipos, unitários, integração, CRM-29, E2E, audit e build.

Os dois projetos Playwright gravam resultados regeneráveis em
`.cache/playwright-results` por padrão. `PLAYWRIGHT_OUTPUT_DIR` permite um
diretório isolado em validações específicas; ambos permanecem ignorados pelo
Git. Essa configuração evita reutilizar diretórios antigos do provedor de
arquivos sem alterar a cobertura ou o isolamento do schema E2E.

## Cobertura CRM-38

- unitário: normalização de UTM/referrer/click ID, ausência distinta de fato,
  first-touch, last-touch, linear determinístico, parcial/desconhecido e soma
  exata de 10.000 bps;
- integração: migration vazia, entrada transacional, RBAC, outro workspace,
  três modelos, replay, conversão sem evidência, append-only e backfill
  dry-run/execute/replay sem inventar histórico;
- E2E: `/aquisicao` com Gestor, cálculo local e Visualizador sem mutação;
- operação: backup/restore pré-migration, seed repetido, backfill real,
  reconciliação do `public`, zero schema `politizai_test_*`, lint, tipos,
  unitários, integração, CRM-29, E2E, audit e build.

Nenhum teste ativa a finalidade `PENDING_LEGAL`, provider, credencial, banco
remoto ou egress. Créditos não são interpretados como causalidade e a CRM-38
não testa custo, ROAS ou hierarquia de mídia, que pertencem à CRM-39.

## CRM-39

- domínio: CSV seguro, limites, valores negativos, alcance/impressões e divisão
  por zero;
- integração: migration desde vazio, RBAC/workspace, prévia, confirmação,
  idempotência, correção, trigger append-only, rollback com restauração da
  revisão anterior e proteção contra rollback de fato já superado, backfill por UUID e
  reconciliação sem mutação do CRM;
- E2E: leitura gerencial, estado vazio e fluxo local de prévia/confirmação;
- regressão: lint, typecheck, unitários, integração completa, CRM-29, E2E,
  audit, build e `db:status`.

## CRM-42 — inteligência geográfica

- domínio: validação de UF, precisão/confiança, fatos versus inferências, regra
  territorial e hash canônico;
- integração: migration desde banco vazio, backfill dry-run/aplicação/repetição,
  ausência de coordenadas inventadas, conflito com perfil confirmado, territórios
  versionados, sobreposição, membership idempotente, owner preservado, supressão
  de grupos pequenos, RBAC, isolamento e auditoria;
- E2E: leitura gerencial, mapa local acessível, tabela equivalente, drilldown,
  filtros, backfill confirmado, modo read-only e quatro viewports;
- banco local: backup exclusivo do `public`, checksum, inventário e restauração
  de ensaio antes da migration; fingerprint dos Leads e ownership comparado após
  backfill;
- regressão: lint, typecheck, unitários, integração, CRM-29, E2E, audit, build,
  `db:status` e dry-run de schemas temporários.

## CRM-43 — inbox omnichannel

- unitário: normalização/máscara, matriz de capacidades, progressão de status,
  evento fora de ordem, SLA e template com escaping/limite;
- integração: migration desde vazio, identidade exata/desconhecida, ausência de
  criação de Lead, Fila Geral, concorrência/idempotência, privacidade, aceite
  interno versus entrega, retry/opt-out, RBAC, revisão otimista, append-only e
  backfill dry-run/execute/replay;
- E2E: `/inbox`, filtros/visões, simulador local, responsabilidade explícita,
  conteúdo protegido para Visualizador e viewports de desktop a mobile;
- banco local: backup exclusivo do `public`, checksum e restauração de ensaio
  antes da migration; seed e backfill repetidos; contagens e IDs reconciliados;
- regressão: lint, typecheck, unitários, integração, CRM-29, E2E, audit, build,
  `db:status` e zero schema temporário residual.

Nenhum teste local equivale a validação de WhatsApp, e-mail, telefonia ou outro
provider. A decisão `ALLOW` injetada no teste da máquina de estados é fixture
isolada; o caminho padrão continua chamando a política real e é testado no
cenário de bloqueio.

## CRM-44 — WhatsApp local e fronteira Cloud API

- unitário: normalização dos payloads oficiais suportados, conteúdo desconhecido,
  opt-out, janela de 24 horas, política de template, HMAC raw-body, challenge,
  versões allowlisted e transporte com egress desligado;
- integração: RBAC, seed sem segredo, inbound conhecido/desconhecido, Fila Geral,
  idempotência, status fora de ordem, receipt assinado, tenant, job assíncrono,
  retry/backoff/dead-letter, replay autorizado e backfill dry-run/execute/replay;
- banco: 39 migrations aplicadas desde vazio, relação de review composta por
  workspace e índice único de mensagem externa por provider;
- regressão: lint, tipos, unitários, integração completa, CRM-29, E2E, audit,
  build, status de migrations e ausência de schema temporário residual.

Fixtures assinadas e o transport local não constituem validação da Meta. A
ativação externa continua `PENDING_POLICY_REVIEW`, sem segredo e sem egress.

## CRM-45 — e-mail local

- unitário: endereço/header injection, Message-ID/threading, sanitização HTML,
  limites MIME, status monotônico, DSN, assinatura, unsubscribe e transport
  SMTP fail-closed;
- integração: 41 migrations desde zero, seed/RBAC, inbound idempotente,
  threading por headers, assunto ignorado, worker/sink sem egress, status,
  suppression, bloqueio posterior, ownership e backfill dry-run/execute/replay;
- E2E: `/integracoes/email`, entrada local, Inbox, negativa ao Visualizador e
  desktop/mobile sem overflow;
- regressão: lint, tipos, unitários, integração completa, CRM-29, E2E, audit,
  build, status de migrations e ausência de schema temporário residual.

Nenhum teste desta task representa entrega, DNS, mailbox, webhook ou provider
externo validado.

## CRM-46 — telefonia local

- unitário: E.164/máscara/hash, DDI não confirmado, janela de contato e timezone,
  status monotônico, callback HMAC, sanitização de metadata e nove cenários do
  transport, incluindo transferência e falhas;
- integração: 43 migrations desde zero, seed/RBAC, chamada atômica,
  idempotência e concorrência, SLA/Activity, callback repetido/atrasado,
  disposição e próxima tarefa, transferências, DNC/IDOR, retry/dead-letter,
  backfill dry-run/execute/replay e triggers append-only;
- E2E: `/integracoes/telefonia`, origem pelo Lead 360, operação autorizada,
  mutações indisponíveis ao Visualizador e desktop/mobile sem overflow;
- operação: backup exclusivo do `public`, inventário, restauração isolada,
  migrations, seed repetido, backfill real, reconciliação e zero schema
  temporário residual;
- regressão: lint, tipos, unitários, integração completa, CRM-29, E2E, audit,
  build e `db:status`.

Fixtures e callback local não constituem validação de carrier, provider, PSTN,
gravação ou transcrição externos.

## CRM-47 — calendário local

- unitário: contratos Zod, duração 30/40, HMAC/timestamp, hash, adapter local e
  falha fechada externa;
- integração: seed sem segredo, RBAC/workspace, PUSH concorrente idempotente,
  create/update/reschedule/cancel, runs/cursors, callback repetido, retomada
  pós-interrupção, conflito sem overwrite, resolução, retry/dead-letter/replay,
  backfill e triggers append-only;
- E2E: origem pela Agenda, tela `/integracoes/calendario`, operação autorizada,
  visualizador somente leitura, callback local assinado e desktop/mobile sem
  overflow;
- banco: backup/restore isolado, 44 migrations desde zero, upgrade do baseline,
  seed repetido, backfill dry-run/execute/reexecução e reconciliação;
- regressão: lint, geração/tipos, unitários, integração completa, CRM-29, E2E,
  audit, build Webpack, `db:status` e ausência de schema temporário residual.

Nenhum teste desta task valida Google Calendar, Microsoft 365, CalDAV, OAuth,
webhook público, credencial, rede externa ou banco remoto.

## CRM-48 — contratos

- unitário: Zod, placeholders allowlisted, escape HTML e hash canônico;
- integração: migration, seed/RBAC, snapshot, numeração, idempotência, emissão,
  aceite manual, nova versão, triggers append-only, tenant e backfill;
- E2E: `/contratos`, criação, leitura, vazio e desktop/mobile sem overflow;
- regressão: lint, tipos, unitários, integração, CRM-29, E2E, audit, build,
  migrations e zero schema temporário residual.

Nenhum teste local valida assinatura, revisão jurídica, provider ou deploy.

## CRM-51 — handoff e onboarding

- unitário: schemas de comando, transições permitidas e prazos;
- integração: 50 migrations desde zero, seed idempotente, pré-requisitos,
  idempotência, concorrência, revisão otimista, envio, aceite, marcos,
  bloqueio de ativação, conclusão, RBAC, tenant, append-only e backfill;
- E2E: rota /onboarding, leitura autorizada, vazio honesto e ausência de overflow
  em 1440×900 e 390×844;
- operação: backup/restore anterior, seed duplo, dry-run/execute/replay,
  fingerprints e zero criação sobre fatos legados incompletos;
- regressão: lint, tipos, unitários, integração, CRM-29, E2E, audit, build,
  status de migrations e limpeza de schemas efêmeros.

Nenhum teste da CRM-51 valida provisionamento externo, ERP, contabilidade,
help desk, provider, credencial, egress, banco remoto ou deploy.

## CRM-55 — metas e quotas versionadas

- unitário: contratos tipados, unidade por métrica, período civil/timezone,
  precedência pessoa > equipe > função e distinção entre zero e ausência;
- integração: cadeia completa de migrations, seed/RBAC, criação concorrente e
  idempotente, revisão otimista, publicação atômica, imutabilidade por trigger,
  nova versão, tenant, fatos por corte, drilldown e backfill conservador;
- E2E: `/metas`, leitura persistida, criação/edição/publicação autorizadas,
  visualizador sem mutação, estado vazio e desktop/mobile sem overflow;
- operação: backup/restore anterior à migration, seed duplo,
  dry-run/execute/replay, fingerprints do `public` e zero schema efêmero
  residual;
- regressão: lint, tipos, unitários, integração, CRM-29, E2E, audit, build e
  status das migrations.

Nenhum teste da CRM-55 valida forecast, provider, credencial, remuneração,
egress, banco remoto ou deploy.

## CRM-56 — forecast e snapshots

- unitário: elegibilidade, categorias cumulativas sem dupla contagem, weighted
  pipeline condicionado à cobertura manual, fingerprint, delta sem denominador
  e movimentos entre cortes;
- integração isolada: 55 migrations desde zero, seed duplo, submissão/revisão,
  concorrência e idempotência, snapshot imutável, override separado do
  bottom-up, RBAC/tenant e backfill sem fabricação de história;
- E2E: gestor publica corte, visualizador somente lê e closer submete o próprio
  recorte; desktop 1440×900 e mobile 390×844 sem overflow horizontal;
- operação: backup e restore isolado anteriores à migration, upgrade do
  `public`, seed duplo, dry-run/execute/replay, fingerprints e limpeza de schema;
- regressão: lint, tipos, unitários, integração, CRM-29, E2E, audit, build e
  status das migrations.

Nenhum teste da CRM-56 usa provider, credencial, egress, banco remoto, modelo
preditivo ou deploy. Os avisos conhecidos de stream do Next e `pg` não alteram o
resultado dos testes.
## CRM-58 — home por função, 360 e busca global

- unitário: normalização de termo, máscara de telefone/e-mail, escolha de visão
  por papel e ordenação determinística de ações;
- integração isolada: seed/RBAC, home SDR/Admin, alternância permitida,
  `OWN`, isolamento de workspace, mascaramento anterior à serialização e
  negativa no Contact 360;
- E2E: home multifunção, atalho `Ctrl+K`, debounce da busca, Account 360,
  Contact 360, Escape/retorno de foco e ausência de overflow em 390×844;
- regressão: lint, tipos, unitários, integração, CRM-29, E2E, audit, build,
  status de migrations e zero schema efêmero residual.

Nenhum teste da CRM-58 valida provider, busca externa, credencial, egress,
banco remoto ou deploy. A task não possui migration nem backfill.

## CRM-59 — governança e avaliações de IA

- unitário: allowlist, redação de PII/segredo, prompt injection, fingerprint,
  orçamento, retry e dataset determinístico;
- integração: migration desde zero, seed idempotente, RBAC, avaliação antes de
  aprovação, imutabilidade, execução rastreável, decisão humana idempotente e
  sugestão obsoleta;
- E2E: acesso de Gestor/Administrador, bloqueio por URL ao Visualizador,
  execução local de avaliação e ausência declarada de provider externo;
- gate: `pnpm test:ai:evals` deve terminar com nove casos aprovados;
- não validado: provider/modelo/credencial/egress externos, custo real e SLO de
  produção.

## CRM-60 — extensibilidade n8n governada

- unitário: contrato estrito, allowlists, limites, HMAC, janela temporal,
  profundidade de causação e redação;
- integração efêmera: RBAC humano e de máquina, token hash/rotação, kill switch,
  evento minimizado, isolamento, nonce, idempotência, proposta, decisão humana,
  auditoria e evidência append-only;
- E2E: Administrador, Gestor, negativa por URL ao Visualizador, credencial de
  uso único, catálogo, foco e ausência de overflow em 390×844;
- migration: aplicação desde zero, backup prévio do `public`, restauração de
  ensaio e seed repetido;
- não validado: instalação ou provider n8n real, egress, TLS/DNS, banco remoto,
  carga distribuída ou deploy.

## CRM-61 — qualidade, reconciliação e merge

- unitário: contratos estritos, confirmação literal, filtros, paginação e
  limites de pontuação/prioridade;
- integração efêmera: 58 migrations desde zero, seed/RBAC, dry-run, execução
  idempotente e concorrente, versões, owner/fila, reconciliação, append-only,
  tenant, merge campo a campo, bloqueios, ledger e rollback;
- E2E: Administrador executa varredura e revisa candidatos; Visualizador lê sem
  controles de mutação; mobile valida foco e ausência de overflow;
- migration: backup do `public`, restauração de ensaio e aplicação aditiva;
- não validado: escala acima de 2.000 registros por entidade, provider externo,
  egress, banco remoto ou deploy.

## CRM-62 — observabilidade, segurança e privacidade

- unitário: redaction de segredo/PII, labels allowlisted, SLO/zero denominador,
  burn rate, rate limit e runtime guard;
- integração efêmera: 59 migrations desde zero, telemetria, dedup/cooldown,
  concorrência, incidentes, append-only, tenant, permissões separadas, DSR,
  legal hold, destruição bloqueada, checkpoint e backfill dry-run/execute/replay;
- E2E: Gestor opera as três tabs, Visualizador não contorna URL, readiness e
  headers seguros, teclado e mobile sem overflow;
- regressão: unitários, integrações, CRM-29 e E2E completos, lint, typecheck,
  audit, build Webpack, db status e zero schema efêmero residual;
- não validado: observabilidade distribuída, notificação externa, execução
  destrutiva, parecer jurídico, provider, egress, banco remoto e deploy.

## CRM-64 — homologação e aceite local

- unitário dirigido: 11 cenários do preflight, incluindo runtime, Node, banco,
  schema, timezone, override remoto, credencial, adapter e `NEXT_PUBLIC_*`;
- integração efêmera: cadeia completa de 59 migrations mais 14 cenários de
  autenticação/RBAC, workspace, redaction, SLO, rate limit e runtime guard;
- E2E curto: login de gestor, oito superfícies centrais, readiness, negação por
  URL ao visualizador e quatro rotas prioritárias em 390×844 sem overflow;
- gates: lint, typecheck, audit, build Webpack, migration status, inventário de
  `public`, scanner de arquivos versionados e zero schema residual;
- evidência reutilizada: gate da CRM-63 para restore, fault injection,
  concorrência, idempotência, smoke e baseline;
- não validado: deploy, banco/provider remoto, credencial, egress, jurídico,
  pentest, multibrowser, carga/soak/failover em infraestrutura equivalente e
  operação com dados reais.
