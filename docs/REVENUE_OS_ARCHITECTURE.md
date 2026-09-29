# Arquitetura planejada — Politizai Revenue OS

## Estado e decisões

A CRM-32 mantém o monólito modular Next.js + PostgreSQL + Prisma. Route Handlers
e Server Components continuam adaptadores; serviços de aplicação autorizam,
orquestram transações e publicam eventos; domínio mantém invariantes; Prisma e
`pg` ficam no servidor. Não há microserviço, Redis, Kafka ou warehouse planejado
como pré-requisito.

Decisões estruturais:

1. evoluir por módulos no mesmo repositório e banco;
2. preservar `Lead`, `Opportunity`, `Activity`, `AuditLog`, `Job` e demais IDs atuais;
3. criar identidade canônica em `Contact`, sem converter `Lead` em pessoa;
4. tratar `Account` como organização e cliente, sem criar identidade duplicada;
5. integrar por inbox/outbox e adapters; payload externo nunca é a projeção oficial;
6. usar eventos persistidos e tabelas históricas para métricas passadas;
7. manter escrita por serviços de domínio, inclusive quando o chamador for n8n;
8. adotar complexidade progressiva na UI, segmentada por função.

## Topologia lógica

```text
Browser
  ↓ Next.js App Router (Server Components + ilhas cliente)
Route Handlers / Server Actions finas
  ↓ autenticação, autorização, Zod, idempotência
Serviços de aplicação do monólito
  ↓ transações, locks, eventos e auditoria
Domínios modulares
  ↓ adapters de persistência
PostgreSQL
  ├─ estado relacional oficial
  ├─ históricos/eventos/auditoria
  ├─ inbox/outbox/jobs
  └─ payload bruto minimizado e retido por política

Provedores/n8n
  ↕ APIs assinadas, webhooks, polling e outbox
  ✕ sem acesso direto ao PostgreSQL
```

O App Router permanece server-first. Componentes cliente são usados somente
para interação, gráficos, edição e atualização local. Server Components chamam
serviços diretamente; não fazem round-trip para Route Handlers internos. Cada
mutação repete autenticação e autorização na fronteira server-side.

## Mapa de módulos

| Módulo | Responsabilidade | Relação com o estado atual |
|---|---|---|
| `auth` / `users` | identidade de acesso, sessão, RBAC e escopo | preservado e expandido com novas permissões/funções |
| `contacts` | Contact, ContactPoint, deduplicação e preferências | novo; `Lead` ganha vínculo compatível |
| `accounts` | Account, papéis dos contatos e comitê de compra | novo; organização textual vira candidato de backfill |
| `lifecycle` | estágio do ciclo e ownership por função | novo; não substitui pipelines de lead/oportunidade |
| `privacy` | finalidade, base legal, consentimento e retenção | CRM-36 implementada; incorpora sem apagar `contactPreference`/opt-out |
| `marketing` | touchpoints, sessões, atribuição, mídia e custo | expande `LeadSource`, `AcquisitionCampaign` e `AcquisitionCreative` |
| `geography` | dimensões geográficas normalizadas e territórios | CRM-42 implementada localmente; preserva cidade/estado legados e não usa geocoder externo |
| `integrations` | conexões, sync, cursor, inbox, outbox e mapeamento | novo; reaproveita `Job`, `WebhookEvent` e auditoria |
| `communications` | inbox, canal, entrega, ligação e calendário | expande `Conversation`, `Message`, `Activity`, `Meeting` |
| `leads` / `qualification` | aquisição, SLA, PACTO e score | preservado; passa a referenciar identidade canônica |
| `pipelines` / `opportunities` | pré-venda, venda, proposta e desfecho | preservado; vincula conta/contato/contrato |
| `contracts` | proposta aceita, contrato e versões | novo sobre `Offer`/`Opportunity`, sem gestão jurídica ampla |
| `revenue` | assinatura, cobrança, pagamento e movimentos de MRR | novo; não é contabilidade geral |
| `onboarding` | handoff, plano, marcos e ativação | expande `CustomerHandoff` |
| `customer-success` | carteira, plano de sucesso, saúde e risco | novo |
| `customer-service` | solicitação ligada ao cliente e satisfação | novo e propositalmente limitado |
| `farmer` | renovação, expansão, contração e churn | novo; usa Opportunity quando houver nova venda |

A implementação local da CRM-54 mantém esse limite: leitura e decisão passam
por um único serviço de domínio; APIs e UI não acessam o banco diretamente.
Advisory locks, revisão otimista e chaves idempotentes protegem concorrência.
Expansão confirmada cria Opportunity, Task e StageHistory na mesma transação;
contração/churn escrevem no ledger, e correção cria reversão append-only.
| `planning` | metas, quotas, submissões e snapshots de forecast | novo |
| `metrics` | definições e consultas únicas do ciclo | expande a camada atual, sem SQL na UI |
| `automations` | jobs/eventos/efeitos idempotentes | preservado; ações novas chamam serviços de domínio |
| `ai` | prompts, providers, avaliações e confirmação | preservado e governado para provider real futuro |
| `data-quality` | regras, issues, reconciliação e merge review | novo |
| `audit` | trilha append-only e saúde determinística | preservado e ampliado |
| `shared/core` | config, tempo, banco, erros, log e telemetria | preservado; sem regra comercial |

A CRM-55 materializa metas e quotas; a CRM-56 completa `planning` com ciclos,
submissões humanas e snapshots de forecast. Server Components, rotas HTTP e CLIs
de backfill usam serviços de aplicação separados. O domínio centraliza RBAC,
período civil, elegibilidade, categorias exclusivas, consolidação, comparação,
transações serializáveis, idempotência e auditoria. A página recebe contratos
serializáveis e não consulta Prisma. Snapshot e itens são append-only e carregam
um fingerprint canônico, portanto a alteração do pipeline atual não reescreve o
corte. O papel `OWN` não recebe agregado de equipe.

CRM-53 materializa `customer-service` como módulo do monólito. Server Components
e rotas HTTP chamam o mesmo serviço de aplicação; o serviço concentra RBAC,
locks, revisão otimista, idempotência, eventos e auditoria. O banco preserva a
versão de SLA e os fatos de satisfação. Nenhum componente acessa Prisma
diretamente e nenhum provider externo é chamado.

CRM-36 materializa a fronteira `privacy` como decisão central reutilizada por
entrada, atividades, automações simuladas e IA. Consent events são append-only,
o estado corrente é projeção por finalidade/canal/ponto, e sinal sem prova
permanece revisão necessária. Finalidades, bases e retenção seedadas ficam
`PENDING_LEGAL`; retenção real e contato externo continuam bloqueados. O
backfill local é conservador, idempotente e não remove o campo legado.

CRM-38 materializa a fronteira `marketing` até atribuição: definições e versões
de landing page/formulário, sessão minimizada, touchpoint e conversão append-only,
modelo/versionamento, execução, crédito e fila de qualidade. A entrada de Lead
faz o dual write na mesma transação e publica somente outbox local. Atribuição é
uma projeção reproduzível de correlação, com cobertura e bucket desconhecido;
não é causalidade. A finalidade de analytics permanece `PENDING_LEGAL`, portanto
evidência capturada ou reconstruída fica em revisão e não autoriza egress.
`docs/MARKETING_ATTRIBUTION.md` contém os contratos e limites operacionais.

## Fronteiras por função

- Marketing é dono de configuração e leitura de aquisição; não altera score ou pipeline.
- SDR é dono do atendimento e qualificação no escopo atribuído; não altera custo de mídia.
- Closer é dono de reunião/oportunidade/proposta; não confirma pagamento.
- CS assume após handoff aceito; não reescreve ganho nem contrato.
- Farmer conduz renovação/expansão; expansão comercial cria oportunidade rastreável.
- Financeiro confirma fatos de cobrança/pagamento, sem obter acesso comercial irrestrito.
- Gestor/RevOps governa processo, definições, qualidade, forecast e reconciliação.
- Administrador governa acesso, configuração e integrações, sem ser automaticamente dono comercial.

`RolePermission` continua concedendo permissão técnica com escopo `OWN`, `TEAM`
ou `WORKSPACE`. `TeamMember.function` deverá receber funções novas de forma
aditiva; isso não concede permissões automaticamente.

## Famílias planejadas de permissão

```text
contacts.read/write/merge
accounts.read/write/assign
marketing.read/manage/costs
integrations.read/manage/replay
communications.read/send/manage
contracts.read/write/approve
revenue.read/manage/confirm
onboarding.read/write
customer_success.read/write/manage
customer_service.read/write
renewals.read/write
planning.read/manage/submit
forecast.read/manage/submit
data_quality.read/manage/resolve
privacy.read/manage/export/erase
ai.external.use/manage
```

Permissões sensíveis terão checagem adicional por propósito e campos. Exportar,
mesclar identidade, enviar comunicação, aprovar contrato, confirmar pagamento,
apagar/anonomizar dado e ativar integração exigem confirmação e auditoria.

## Fonte oficial e precedência

### Camada canônica de métricas de receita

A CRM-57 compõe os fatos existentes em `modules/metrics`, sem warehouse ou
materialização prematura. O catálogo `crm57.1` é executável e versionado; o
serviço reutiliza universo relacional e `metrics.read`, aplica período civil e
`asOf`, e entrega comparativos, séries, ponte de MRR, coortes, qualidade e
drilldowns. Rotas e Server Components chamam o mesmo serviço. Não houve
migration nem backfill porque nenhuma nova fonte oficial foi necessária.

| Informação | Fonte oficial no Revenue OS | Papel do sistema externo |
|---|---|---|
| identidade e pontos de contato | `Contact` e `ContactPoint` validados | fornece candidatos/evidência |
| acesso e escopo | `User`, membership, role e team | nenhum |
| lead, SLA, PACTO e score | módulos atuais | nenhum conector pode sobrescrever diretamente |
| campanha e custo | dimensões/fatos de marketing versionados | fonte do fato bruto com provenance |
| pipeline e venda | `Opportunity`, `StageHistory`, `Offer` | recebe/fornece mapeamento conforme política |
| contrato | `Contract` e versões aprovadas | assinatura pode confirmar evento externo |
| assinatura e MRR | `Subscription` + movimentos de receita | billing fornece eventos reconciliados |
| pagamento | `Payment` reconciliado | provedor é origem; CRM é projeção auditada |
| atividade e comunicação | `Activity` + Conversation/Message | entrega/status vêm do provider |
| lifecycle e ownership | registros históricos internos | externos não substituem ownership |
| CS, renovação e churn | módulos internos e eventos confirmados | sinais externos são evidência |
| métricas | camada `metrics` sobre fatos persistidos | nunca calculadas na interface |

Conflitos entram em fila de reconciliação. Precedência é configurada por campo,
provedor e versão; uma sincronização nunca sobrescreve silenciosamente valor
humano confiável.

## Eventos de domínio planejados

Eventos são fatos imutáveis com `workspaceId`, `eventId`, `eventType`, versão,
`occurredAt`, `recordedAt`, ator, correlação, causação e referência ao agregado.

- `contact.identified`, `contact.point.verified`, `contact.merge.requested`;
- `account.created`, `account.contact_role.changed`;
- `lifecycle.stage.changed`, `ownership.assigned`;
- `privacy.consent.changed`, `privacy.retention.due`;
- `marketing.touchpoint.recorded`, `attribution.calculated`;
- eventos atuais de lead, SLA, PACTO, meeting e opportunity;
- `contract.signed`, `subscription.activated`, `payment.confirmed`;
- `onboarding.started`, `onboarding.activated`;
- `customer.health.changed`, `renewal.due`, `expansion.created`, `customer.churned`;
- `integration.sync.completed/failed`, `data_quality.issue.detected/resolved`.

O evento e a alteração de domínio são gravados na mesma transação por outbox.
Consumers usam idempotency key e registram efeito; publicar novamente não
duplica tarefas, mensagens ou receita.

## Integrações e n8n

Cada provider implementa adapter com operações explícitas: conectar, testar,
sincronizar, receber webhook, enviar comando e revogar. Credenciais ficam em
secret store futuro; o banco guarda somente referência, escopos e fingerprint.

n8n poderá:

- consumir eventos publicados;
- chamar APIs versionadas e autorizadas;
- iniciar comandos idempotentes permitidos;
- consultar status e receber resultado.

n8n não poderá consultar tabelas, forjar ator, ignorar consentimento, calcular
estado oficial ou executar SQL. Toda chamada entra por `IntegrationConnection`
de tipo `N8N`, autenticação própria, rate limit, correlação e auditoria.

## Observabilidade e execução

- logs estruturados com request/correlation ID e sem payload sensível;
- métricas de HTTP, jobs, sync, webhook, outbox, provider e banco;
- traces apenas após política de redaction;
- health de aplicação separado de readiness de dependências;
- retry limitado com backoff e dead-letter inspecionável;
- SLOs por fluxo crítico definidos antes de homologação;
- backup, restore rehearsal e runbooks por release.

PostgreSQL permanece fila inicial. Redis só será avaliado com evidência de
contenção/latência que o modelo atual não resolva. Warehouse só será considerado
quando volume e carga analítica justificarem réplica/ETL separado.

## Premissas e decisões ainda abertas

- BRL permanece a moeda operacional inicial; multi-moeda exige fonte e versão
  de câmbio antes de qualquer consolidação;
- um Contact pode participar de várias Accounts e uma Account de vários Contacts;
- não existe telemetria de produto confiável hoje, portanto health não usa “uso”;
- providers, storage de documentos, secret manager e hospedagem não foram escolhidos;
- bases legais, retenção e textos de consentimento dependem de validação jurídica;
- volumes futuros são desconhecidos; PostgreSQL é suficiente até medição contrária;
- autenticação local permanece no ambiente atual; MFA/SSO e identidade de produção
  entram no hardening antes da ativação real;
- CRM-64 é gate de prontidão, não autorização automática de deploy.

## Registro de riscos

| Risco | Impacto | Mitigação/gate |
|---|---|---|
| merge de Contact incorreto | perda de identidade e privacidade | review humano, alias, evidência e operação auditada |
| atribuição apresentada como causa | decisão de mídia enganosa | modelo/janela/cobertura versionados e linguagem de correlação |
| ganho confundido com receita | KPIs financeiros falsos | fatos distintos de ganho, contrato, ativação e pagamento |
| backfill reescrever história | métricas e IDs inconsistentes | idempotência, shadow read, reconciliação e contract separado |
| regra cross-workspace | vazamento crítico | FKs compostas, RBAC server-side e testes negativos |
| provider duplicar/atrasar evento | efeito/receita duplicados | inbox, versão, cursor, idempotência e replay controlado |
| n8n virar domínio paralelo | estado divergente | zero SQL, machine RBAC e comandos via serviços |
| consentimento mal interpretado | envio indevido/LGPD | eventos por finalidade e ausência distinta de opt-in |
| IA exfiltrar ou inventar | dano de privacidade/decisão | minimização, evals, contrato estrito e confirmação humana |
| forecast reescrito pelo presente | histórico gerencial inválido | snapshots por data de corte e regra/versionamento |
| dashboards excessivos | baixa adoção e duplicidade | homes por função sobre métricas compartilhadas |
| escopo virar ERP/help desk | prazo e complexidade insustentáveis | limites funcionais e critérios de aceite explícitos |
| locks/carga de migration | indisponibilidade | lotes, medição, janela, rollback e teste de upgrade |
| custo operacional dos conectores | manutenção desproporcional | um adapter por vez, sandbox e SLO/custo antes de ativar |

## Compatibilidade com CRM-00 a CRM-31 e PROD-01

- nenhuma entidade atual é removida na fase de expansão;
- `Lead.phoneNormalized`, email e organização permanecem durante dual-read;
- `LeadFormSubmission` continua registrando conversões; ganha links aditivos;
- `AcquisitionCampaign/Creative` são preservados e ligados à hierarquia nova;
- `Conversation`, `Message`, `Meeting`, `Offer` e `CustomerHandoff` são expandidos;
- `Activity`, `StageHistory`, `AuditLog`, `AIInsight` e métricas atuais mantêm semântica;
- os scripts efêmeros da PROD-01 são obrigatórios em todas as novas integrações;
- backup de `public`, allowlist de limpeza e proibição de banco remoto continuam vigentes.

## Critério para separar componentes no futuro

Uma separação de processo ou storage só será considerada se houver isolamento de
falha, escala independente ou requisito regulatório medido. Organização de time,
preferência de fornecedor ou tamanho do módulo não são justificativa para criar
microserviço.

## CRM-39 — fronteira de mídia paga

`media-performance-service` é a única porta para prévia, confirmação, rollback,
backfill e reconciliação. A página Server Component carrega dados autorizados e
o workspace cliente apenas chama a API protegida por sessão e same-origin. A
camada de fatos é apêndice versionado; métricas selecionam a última revisão do
grão. A ponte com aquisição legada é por UUID e não por nome. Nenhum componente
acessa Prisma, nenhuma automação altera mídia e nenhuma ação faz rede externa.

## CRM-60 — n8n como cliente, nunca como domínio

A fronteira n8n reutiliza outbox, autorização, auditoria e serviços do monólito.
Eventos allowlisted saem com payload minimizado; comandos assinados entram como
resultado técnico ou proposta. Identidade de máquina, escopo e workspace são
resolvidos no servidor. Nenhum workflow recebe SQL ou realiza transição de
pipeline, envio, mudança de owner ou fechamento fora do domínio.
