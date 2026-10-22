# Plano executável

## Regras comuns

As tasks são sequenciais. Cada uma só avança após teste direcionado, revisão do diff e atualização de `10-state.md` e `12-validation.md`. O executor deve ler `AGENTS.md`, as specs citadas e a documentação local do Next.js antes de alterar APIs ou rotas. Em todas as tasks: preservar isolamento por `workspaceId`, nunca registrar PII/secrets, não fazer egress real em testes e não alterar lockfile sem o processo de segurança de dependências.

| ID | Resultado | Depende de | Gate principal |
| --- | --- | --- | --- |
| T0 | Auditoria e contrato congelados | — | specs consistentes |
| T1 | Permissões, menu e rotas vazias | T0 | auth/proxy |
| T2 | Persistência versionada | T1 | migration do zero |
| T3 | Domínio administrativo | T2 | concorrência/tenant |
| T4 | Índice e criação | T3 | UI + API |
| T5 | Editor e mappings | T4 | schemas/tipos |
| T6 | Opções CRM e WhatsApp | T5 | referências tenant |
| T7 | Estilo e preview | T5 | sanitização de URLs |
| T8 | Publicação e runtime | T6–T7 | imutabilidade/publicação |
| T9 | Submit e intake | T8 | idempotência/abuso |
| T10 | Sessões e atribuição | T9 | fatos e ownership server-side |
| T11 | Compartilhamento | T8 | QR/UTM seguros |
| T12 | Respostas e CSV | T9 | PII/permissões |
| T13 | Estatísticas | T10 | grão/denominadores |
| T14 | Meta/Google/outbox | T9–T10 | zero egress em teste |
| T15 | A11y, responsividade e QA | T4–T14 | browser real |
| T16 | Integração, produção e operação | T15 | CI/migration/deploy/smoke |

## Prompts copiáveis

### T0 — Auditoria final e contrato de definição

```text
Execute SOMENTE a task T0 — Auditoria final e contrato de definição do projeto Formulários de Marketing do CRM Politiza AI.

Leia antes: AGENTS.md e todas as specs em specs/marketing-forms/.
Objetivo: validar a evidência repository-first, fechar contratos de definição, lifecycle, versão, recibo, eventos, segurança e plano executável.
Escopo permitido: specs/marketing-forms/**; inspeção read-only do repositório e URL de referência.
Fora de escopo: código de produto, schema, dependências ou efeitos externos.
Evidência atual: 00-audit-evidence.md e arquivos/símbolos nele citados.
Implementação esperada: reconciliar specs entre si; eliminar placeholders; registrar decisões persistentes; validar todos os 14 arquivos obrigatórios.
Segurança, privacidade e tenant: exigir workspace em toda leitura administrativa e excluir secrets/PII de logs/definições públicas.
Critérios de aceite: arquivos 00–13 + README existem; requisitos, ADRs, tasks, testes e rollout são coerentes; próximo passo é T1.
Validação obrigatória: listar arquivos, buscar TODO/placeholders, conferir links e revisar git diff/status.
Ao concluir: atualizar 10-state.md e 12-validation.md; não executar código, commit, push ou deploy; avançar somente após o gate local.
```

### T1 — Permissões, navegação e esqueleto de rotas

```text
Execute SOMENTE T1 — Permissões, navegação e esqueleto de rotas. Leia AGENTS.md, README, 00, 01, 02, 03, 04, 09, 10, 11 e 12.
Objetivo: expor Formulários em Marketing para usuários autorizados e criar shells autenticados/admin e públicos sem lógica de negócio.
Escopo permitido: capability registry apenas se necessário; src/components/layout/app-shell.tsx; src/proxy.ts; src/app/formularios/**; src/app/f/**; testes associados.
Fora de escopo: banco, editor completo, submit e providers.
Evidência atual: AppShell/proxy usam listas exatas; MARKETING_DEFINITIONS_MANAGE e MARKETING_JOURNEY_READ já existem.
Implementação esperada: menu Marketing; proteção admin; prefixo /f público sem AppShell; páginas/route shells tipadas.
Segurança: admin autenticado com capability e tenant; somente runtime /f é público; não tornar /formularios público.
Aceite: menu correto; acesso negado correto; /f não redireciona a login; testes de proxy/layout passam.
Validação: testes direcionados, pnpm typecheck e lint dos arquivos quando suportado.
Ao concluir: revisar diff/untracked; atualizar estado/validação; não executar commit/push/deploy; avançar após gate.
```

### T2 — Schema e migration

```text
Execute SOMENTE T2 — Schema/migration de lifecycle, versão, respostas e eventos. Leia AGENTS.md, README, 00–03, 06, 08–13 e a skill database-migration-validation.
Objetivo: implementar o modelo persistente aprovado sem destruir dados existentes.
Escopo: prisma/schema.prisma, uma migration aditiva, fixtures/testes de migration e contratos diretamente afetados.
Fora de escopo: UI e endpoints.
Evidência: MarketingForm/Version e LeadFormSubmission existentes; decisões em 11-decisions.md.
Implementação: lifecycle/revision/draft; publicação imutável; recibo idempotente; evento analítico; rotação; vínculo opcional com submissão.
Segurança: FKs/índices/uniques por workspace; nenhuma secret; rollback documentado; sem reset/drop.
Aceite: Prisma gera; migration sobe do zero e em baseline compatível; constraints de dedupe/slug/versão funcionam.
Validação: pnpm db:generate, script oficial de migrations-from-zero e testes direcionados.
Ao concluir: revisar diff; atualizar estado/validação/ADR; sem commit/push/deploy; avançar após gate.
```

### T3 — Domínio e serviços administrativos

```text
Execute SOMENTE T3 — Domínio e serviços administrativos. Leia AGENTS.md, README, 00–03 e 09–12.
Objetivo: CRUD de rascunho, validação, publicação, pausa, arquivamento e resolução pública em serviços transacionais.
Escopo: src/lib/marketing-forms/**, contratos Zod, audit log e testes unitários/integrados.
Fora de escopo: UI e submit de respostas.
Evidência: marketing-attribution-service.saveMarketingForm atual mistura save e versão; substituir consumidores com compatibilidade explícita.
Implementação: optimistic revision; hash de definição; snapshot imutável; transições válidas; sanitização pública.
Segurança: todo método admin exige actor/workspace/capability; slug público não revela tenant; erros seguros.
Aceite: conflitos 409; versão não muta; pausa bloqueia resolução; audit trail sem PII.
Validação: testes do serviço, typecheck e integration direcionada.
Ao concluir: atualizar estado/validação e ADR se necessário; sem efeitos externos.
```

### T4 — Índice e criação

```text
Execute SOMENTE T4 — Índice e criação. Leia AGENTS.md, README, 01–04 e 09–12.
Objetivo: /formularios listar, filtrar, criar e abrir um formulário.
Escopo: src/app/formularios/**, componentes locais, route handlers/server actions e testes.
Fora de escopo: editor funcional e publicação.
Evidência: padrões de páginas autenticadas e dialogs existentes citados no audit.
Implementação: empty/loading/error/permission states; cards/tabela; criação com nome+slug seguro.
Segurança: tenant/capability server-side; CSRF/same-origin em mutações; mensagens sem vazamento.
Aceite: lista tenant-safe; criação idempotente no duplo clique; navega ao editor.
Validação: unit/integration, typecheck e QA desktop/mobile básico.
Ao concluir: atualizar estado/validação; sem commit/push/deploy.
```

### T5 — Editor e mapping CRM

```text
Execute SOMENTE T5 — Editor de perguntas e mapping CRM. Leia AGENTS.md, README, 01–05 e 09–12.
Objetivo: editar sequência linear, tipos suportados, obrigatoriedade, opções e mapping canônico.
Escopo: editor em src/app/formularios/**, contracts/domain correspondentes e testes.
Fora de escopo: lógica condicional, upload e runtime público final.
Evidência: lista de tipos e mappings em 01-product-spec.md/03-data-api-security.md.
Implementação: adicionar/reordenar/duplicar/remover; IDs estáveis; autosave explícito/debounced com revision; preview.
Segurança: sem HTML arbitrário; limites de comprimento/quantidade; conflitos não sobrescrevem silenciosamente.
Aceite: todos os tipos configuráveis; erro inline; estado persiste/recarrega; teclado básico.
Validação: reducer/contracts/components, integration save/conflict, typecheck.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T6 — Opções, CRM e WhatsApp

```text
Execute SOMENTE T6 — Opções, destino CRM, WhatsApp e rotação. Leia AGENTS.md, README, 01–04, 06–07 e 09–12.
Objetivo: configurar mensagens, pipeline/etapa/origem/tags/fila e redirect WhatsApp individual/grupo/round-robin.
Escopo: aba Opções, contracts/domain/reference loaders e testes.
Fora de escopo: envio de mensagem e provider real.
Evidência: modelos Pipeline/Stage/Source/Tag/Queue e precedência documentada.
Implementação: selects filtrados por workspace; invariantes pipeline-stage; normalização E.164; rotação configurável.
Segurança: nunca aceitar IDs cross-tenant; URLs allowlisted; nenhum secret/egress.
Aceite: configurações válidas persistem; referências inválidas rejeitam; precedência testada.
Validação: testes de contrato/tenant/opções e typecheck.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T7 — Estilo, branding e preview

```text
Execute SOMENTE T7 — Estilo, branding e preview. Leia AGENTS.md, README, 01, 03–05 e 09–12.
Objetivo: configurar cores, fonte suportada, logo/fundo por URL e refletir tudo no preview seguro.
Escopo: aba Estilo, renderer compartilhado, validação de tema e testes.
Fora de escopo: upload de arquivo, CSS/HTML arbitrário e fontes remotas livres.
Evidência: ADR de branding URL allowlisted e prints 05.
Implementação: tokens restritos; contrast hints; preview desktop/mobile; fallback determinístico.
Segurança: somente https, bloqueio de esquemas/hosts locais e atributos perigosos; CSP coerente.
Aceite: preview e runtime compartilham modelo; entradas maliciosas rejeitadas; reduced motion preservado.
Validação: contracts, XSS/SSRF negative tests, component tests e typecheck.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T8 — Publicação e runtime público

```text
Execute SOMENTE T8 — Publicação versionada e runtime público. Leia AGENTS.md, README, 01–05 e 09–12, mais docs locais de rotas dinâmicas/caching do Next.
Objetivo: publicar snapshot imutável e renderizar /f/[slug] conversacional.
Escopo: serviço publish/resolve, rotas públicas, renderer/state machine e testes.
Fora de escopo: persistir submit real e pixels.
Evidência: params assíncronos no Next 16; ADR de no-store e lifecycle.
Implementação: validação pré-publicação; URL; uma pergunta/tela; progresso/back/enter; thank-you simulada.
Segurança: definição pública sanitizada; draft/paused/archived 404; noindex; sem admin data.
Aceite: versão não muda após draft editar; todos os tipos renderizam; obrigatório bloqueia; back preserva.
Validação: service/integration/component, build/typecheck, QA referência desktop/mobile.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T9 — Submit público e LeadIntakeService

```text
Execute SOMENTE T9 — Submit público endurecido e LeadIntakeService. Leia AGENTS.md, README, 02–06 e 09–12, mais security-change-baseline.
Objetivo: aceitar resposta uma vez e materializar CRM exclusivamente via LeadIntakeService.
Escopo: receipt service, endpoint público, extensão aditiva LeadIntakeInput.initialStageId, intake transaction e testes.
Fora de escopo: adapters de Meta/Google.
Evidência: lead-intake-service.ts é seam canônico; hardening/read-limits/rate-limit já existem.
Implementação: validar versão/answers; honeypot/min-time/rate-limit; receipt idempotente; transaction; status/reprocess seguro.
Segurança: payload limitado, PII redigida, IDs de referência revalidados no server, open redirect bloqueado.
Aceite: retry devolve mesmo resultado; uma submission/contact/lead/rotation/conversion; falha antes/depois do intake reconciliável.
Validação: negativos malformed/oversized/replay/rate/XSS/tenant, integration do fluxo e typecheck.
Ao concluir: atualizar estado/validação/ADR; sem efeitos externos.
```

### T10 — Sessões, UTMs e atribuição

```text
Execute SOMENTE T10 — Sessões, UTMs e atribuição. Leia AGENTS.md, README, 02–03, 05–06, 08–12.
Objetivo: persistir sessões/eventos/UTMs/click IDs e atribuição server-owned sem duplicidade.
Escopo: runtime capture, event endpoint/service, marketing attribution e testes.
Fora de escopo: dashboards além dos fatos necessários.
Evidência: MarketingSession/Touchpoint/AttributionConversion e recordLeadIntakeAttributionInTransaction existentes.
Implementação: IDs opacos; first/last touch; allowlist/limites; eventos batched e idempotentes; vínculo receipt/submission.
Segurança: referrer/UTM tratados como untrusted; nenhuma PII em eventos; rate-limit.
Aceite: UTMs percorrem submit; retry não duplica conversão/evento; versão permanece dimensão.
Validação: unit/integration e negativos de tamanho/sanitização.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T11 — Compartilhamento, QR e UTM builder

```text
Execute SOMENTE T11 — Compartilhamento, QR e UTM builder. Leia AGENTS.md, README, 01–03, 07 e 09–12; use dependency-change-safety se houver nova biblioteca.
Objetivo: oferecer URL canônica copiável, QR e construtor UTM determinístico.
Escopo: aba Compartilhar, utilitários URL/QR, testes e dependência estritamente necessária.
Fora de escopo: shortener e analytics de terceiros.
Evidência: URL /f/[slug] e contrato UTM em 07-integrations-sharing.md.
Implementação: URL origin confiável; parâmetros allowlisted/encoded; QR SVG/PNG seguro; download/copy feedback.
Segurança: prevenir javascript/open redirect/injeção; não incorporar secrets.
Aceite: QR decodifica para URL exibida; UTMs preservam URL e encoding; draft claramente não público.
Validação: unit/component, auditoria de dependência se aplicável, QA de QR.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T12 — Respostas, detalhe, filtros e CSV

```text
Execute SOMENTE T12 — Respostas, detalhe, filtros e CSV. Leia AGENTS.md, README, 01–04, 08–12.
Objetivo: listar e detalhar receipts/submissions tenant-safe e exportar CSV neutralizado.
Escopo: aba Respostas, queries paginadas, dialog acessível, export e testes.
Fora de escopo: edição de resposta e export assíncrono.
Evidência: accessible-dialog e csvCell existentes.
Implementação: filtros por período/status/versão; colunas dinâmicas limitadas; detalhe com campos/CRM/atribuição; CSV streaming/limites.
Segurança: capability de leitura/export; workspace obrigatório; formula neutralization; cache privado/no-store; logs sem respostas.
Aceite: sem cross-tenant; filtros consistentes; CSV correto/seguro; estados vazio/erro/permissão.
Validação: query/route/component, CSV injection e tenant negatives.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T13 — Estatísticas e funil

```text
Execute SOMENTE T13 — Estatísticas e funil. Leia AGENTS.md, README, 01–03, 08–12.
Objetivo: mostrar visualizações, inícios, conclusões, conversão, abandono e distribuições por versão/pergunta.
Escopo: agregador de eventos/receipts, aba Estatísticas, visualizações leves e testes.
Fora de escopo: texto livre agregado, IA, warehouse e métricas aproximadas sem rótulo.
Evidência: fórmulas/grão em 08-responses-statistics.md.
Implementação: denominadores explícitos; filtro de versão/período; zero states; cardinalidade limitada.
Segurança: somente agregados autorizados e tenant-safe; não exibir texto livre.
Aceite: fixtures provam fórmulas; retries não inflam métricas; versões não se misturam.
Validação: unit do agregador, integration tenant e component tests.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T14 — Meta, Google e outbox

```text
Execute SOMENTE T14 — Meta/Google, outbox e testes sem egress. Leia AGENTS.md, README, 02–03, 06–07, 09–13 e security-change-baseline.
Objetivo: configurar referências de credencial e enfileirar conversões sem comprometer o lead.
Escopo: aba Métricas, contracts, outbox/adapters/test doubles, redaction e testes.
Fora de escopo: armazenar token; ativar Google write sem homologação; chamadas reais em teste.
Evidência: SecretResolver, conversion-feedback-service e OutboxEvent existentes.
Implementação: Meta pixel browser opcional + CAPI mesmo event_id; Google gated; retries worker existentes quando compatíveis.
Segurança: somente secretRef; consent/PII hash quando aplicável; SSRF/egress allowlist; falha isolada.
Aceite: submit permanece aceito se provider falha; outbox idempotente; nenhum egress em suite; UI nunca retorna secret.
Validação: unit/adapters/no-egress/integration/redaction.
Ao concluir: atualizar estado/validação/ADR; sem efeitos externos.
```

### T15 — Acessibilidade, responsividade e QA visual

```text
Execute SOMENTE T15 — Acessibilidade, responsividade e QA visual. Leia AGENTS.md, README, 01, 04–05, 09–12 e as skills React/verification aplicáveis.
Objetivo: validar e corrigir o fluxo completo em desktop/mobile/teclado/reduced-motion comparado às referências.
Escopo: componentes já criados, estilos, testes a11y/E2E e evidências de QA.
Fora de escopo: redesign ou nova feature.
Evidência: imagens 01–11 e formulário público de referência documentados no audit.
Implementação: foco/labels/erros/contraste/touch targets; viewports; animações discretas; sem overflow.
Segurança: não relaxar CSP/validação para resolver UI.
Aceite: fluxos admin/public navegáveis por teclado; mobile e reduced-motion verificados; diferenças intencionais registradas.
Validação: testes E2E/a11y, screenshots e fluxo browser→API→DB→resposta em dados de teste.
Ao concluir: atualizar estado/validação; sem efeitos externos.
```

### T16 — Integração, segurança, produção e operação

```text
Execute SOMENTE T16 — Integração completa, segurança, performance e documentação operacional. Leia AGENTS.md e todas as specs; use verification-before-completion, local-diff-review e skills Vercel aplicáveis.
Objetivo: provar o aceite completo, integrar na main autorizada, migrar/deployar o alvo de produção confirmado e executar smoke/rollback checks.
Escopo: correções mínimas decorrentes dos checks; 10-state.md, 12-validation.md, 13-rollout-operations.md; commit/push/migration/deploy expressamente autorizados pelo usuário desta execução.
Fora de escopo: providers reais sem credenciais/consentimento e refatorações não relacionadas.
Evidência: CI real, diff, projeto Vercel/banco confirmados e critérios 1–25.
Implementação: checks direcionados→completos; secrets/debug scan; verificar alvo/conta; backup/rollback compatível; commit/push; migration production; deploy; smoke e logs.
Segurança: nenhuma secret em output/diff; não usar reset/drop/force; parar diante de alvo ambíguo ou migration destrutiva inesperada.
Aceite: todos os critérios locais com evidência; origin/main contém commit; migration e deployment confirmados na fonte; smoke público/admin seguro.
Validação: db:generate, migrations-from-zero, lint, typecheck, test, integration, build, smoke, security scan, E2E/QA proporcional e verificação remota.
Ao concluir: registrar resultados e riscos; só declarar concluído com evidência; não ativar providers externos sem gate específico.
```

## Checkpoints externos

- T11: nova dependência QR só após demonstrar ausência de utilitário compatível.
- T14: secrets/provider reais continuam gate externo; a entrega padrão usa referências e testes doubles.
- T16: conferir projeto/conta/domínio/banco e migration pendente antes de qualquer alteração remota; rollback é deploy anterior + migration aditiva compatível, nunca downgrade destrutivo.
