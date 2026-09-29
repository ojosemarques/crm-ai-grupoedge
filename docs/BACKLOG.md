# Backlog executivo

## P0 — MVP obrigatório

| Ordem | Entrega | Estado |
|---:|---|---|
| 1 | CRM-00 — inspeção e plano executivo | Concluída |
| 2 | CRM-01 — bootstrap e ambiente local | Concluída |
| 3 | CRM-02 — modelo relacional, migrations e integridade | Concluída |
| 4 | CRM-03 — login local, RBAC e isolamento | Concluída |
| 5 | CRM-04 — seed idempotente de estrutura e usuários | Concluída |
| 6 | CRM-05 — serviço único de entrada de leads | Concluída |
| 7 | CRM-06 — distribuição, Fila Geral e SLA imediato | Concluída e validada |
| 8 | CRM-07 — cadastro manual, CSV, webhook local e simulador | Concluída e validada |
| 9 | CRM-08 — histórico operacional baseado em eventos | Concluída e validada |
| 10 | CRM-09 — tabela de leads, filtros e visualizações | Concluída e validada |
| 11 | CRM-10 — fila priorizada do SDR | Concluída e validada |
| 12 | CRM-11 — visão completa e ações do lead | Concluída e validada |
| 13 | CRM-12 — qualificação PACTO | Concluída e validada |
| 14 | CRM-13 — scoring configurável e prioridade explicável | Concluída e validada |
| 15 | CRM-14 — pipeline de pré-vendas e transições | Concluída e validada |
| 16 | CRM-15 — agenda interna, reuniões e briefing | Concluída e validada |
| 17 | CRM-16 — oportunidades, propostas, ganho e perda | Concluída e validada |
| 18 | CRM-19 — métricas calculadas do banco | Concluída e validada |
| 19 | CRM-20 — dashboard acionável e drilldowns | Concluída e validada |
| 20 | CRM-21 — motor local, worker e idempotência | Concluída e validada |
| 21 | CRM-22 e CRM-23 — doze automações simuladas | Concluída e validada |
| 22 | CRM-24 — auditoria e saúde do processo | Concluída e validada |
| 23 | CRM-25 — provedores, contratos e prompts versionados | Concluída e validada |
| 24 | CRM-29 — base demonstrativa coerente de 30 dias | Concluída e validada |
| 25 | CRM-30 — cobertura crítica e endurecimento | Concluída e validada |
| 26 | CRM-31 — documentação, demonstração e aceite local | Concluída e validada |

## P1 — Após o P0

- CRM-17 — configurações de pipeline, SLA, scoring e catálogo: concluída e
  validada;
- CRM-18 — administração de usuários, equipes e disponibilidade: concluída e
  validada;
- CRM-26 — análise, briefing, extração e próxima ação: concluída e validada;
- CRM-27 — consultas gerenciais e auditoria assistida: concluída e validada;
- CRM-28 — sistema visual e refinamento de UX: concluída e validada;
- revisão de UX com SDRs e closers reais antes de congelar o produto;
- calendário comercial para SLA e feriados;
- exportações administrativas após revisão específica de segurança;
- notificações internas em tempo real com infraestrutura compartilhada;
- compatibilidade automatizada com navegadores além do Chromium;
- observabilidade, retenção e políticas operacionais para ambiente publicado.

## P2 — Futuro

- ativação externa do WhatsApp (fundação local da CRM-44 concluída, mas
  elegibilidade/sandbox/provider bloqueados), Instagram, telefonia (simulador
  local da CRM-46 concluído; provider/PSTN/gravação adiados), e-mail e SMS;
- calendários externos;
- pagamentos;
- habilitação governada de provedores externos de LLM;
- SSO, BI externo e aplicativo móvel.

Itens P1 e P2 exigem autorização explícita após o aceite local da CRM-31.

## Produção e armazenamento

| Ordem | Entrega | Estado |
|---:|---|---|
| PROD-01 | Backup privado do código, backup local validado de `public`, limpeza restrita e lifecycle efêmero de testes | Concluída e revalidada após CRM-41; zero schema residual e zero remoção nesta rodada; 140 legados comprovados removidos no histórico; `next typegen` incorporado ao typecheck limpo; nenhum deploy ou banco remoto |

PROD-01 é separada do backlog funcional CRM. Ela não autoriza deploy, Vercel,
Neon ou banco remoto.

## Expansão Revenue OS — planejamento CRM-32 concluído

A CRM-32 concluiu e validou documentalmente a arquitetura e a fila CRM-33 a CRM-64 em
[`REVENUE_OS_BACKLOG.md`](./REVENUE_OS_BACKLOG.md). CRM-33 a CRM-64 estão
concluídas e validadas localmente. A CRM-64 aprovou somente homologação
local/isolada e manteve produção em NO-GO. O protocolo de checkpoint,
status, validação e parada está em [`EXECUTION_PROTOCOL.md`](./EXECUTION_PROTOCOL.md).

## Revenue OS — execução

| Task | Entrega | Estado |
|---|---|---|
| CRM-33 | Contatos e identidades canônicas | Concluída e validada |
| CRM-34 | Contas, papéis de contato e comitê de compra | Concluída e validada |
| CRM-35 | Lifecycle de receita e ownership por função | Concluída e validada |
| CRM-36 | Consentimento, finalidade, base legal e retenção | Concluída e validada |
| CRM-37 | Plataforma agnóstica de integrações locais | Concluída e validada |
| CRM-38 | Jornada factual e atribuição multitoque | Concluída e validada |
| CRM-39 | Hierarquia, performance e reconciliação de mídia paga local | Concluída e validada localmente |
| CRM-40 | Conector Meta Ads somente leitura | Concluída e validada localmente; validação externa adiada |
| CRM-41 | Conector Google Ads somente leitura | Concluída e validada localmente; validação externa adiada |
| CRM-42 | Inteligência geográfica | Concluída e validada localmente; geocoding externo adiado |
| CRM-43 | Inbox omnichannel canônico | Concluída e validada localmente; somente entrega local |
| CRM-44 | WhatsApp Cloud API | Concluída e validada localmente; ativação externa bloqueada |
| CRM-45 | Canal de e-mail e sink local seguro | Concluída e validada localmente; domínio/provider externos adiados |
| CRM-46 | Telefonia e worker em simulador local | Concluída e validada localmente; provider/PSTN/gravação externos adiados |
| CRM-47 | Calendário bidirecional em sandbox local | Concluída e validada localmente; provider/OAuth/webhook público externos adiados |
| CRM-48 | Contratos e versões comerciais | Concluída e validada localmente; assinatura/provider e revisão jurídica externos adiados |
| CRM-49 | Assinaturas e ledger append-only de receita | Concluída e validada localmente; sem pagamento, contabilidade ou provider externo |
| CRM-50 | Cobranças e pagamentos em sandbox local | Concluída e validada localmente; provider, credenciais, ERP, contabilidade e fiscal permanecem fora do escopo |
| CRM-51 | Handoff comercial e onboarding local | Concluída e validada localmente; integrações externas adiadas |
| CRM-52 | Customer Success e health score | Concluída e validada localmente |
| CRM-53 | Solicitações, SLA e satisfação | Concluída e validada localmente |
| CRM-54 | Farmer, renovação, expansão e churn | Concluída e validada localmente |
| CRM-55 | Metas e quotas versionadas | Concluída e validada localmente |
| CRM-56 | Forecast e snapshots reproduzíveis | Concluída e validada localmente |
| CRM-57 | Camada completa de métricas de receita | Concluída e validada localmente |
| CRM-58 | Home por função, busca global e entidades 360 | Concluída e validada localmente |
| CRM-59 | IA governada e avaliações locais | Concluída e validada localmente; provider externo não ativado |
| CRM-60 | Extensibilidade segura via n8n | Concluída e validada localmente; n8n/provider externo não conectado |
| CRM-61 | Qualidade, reconciliação e merge governado | Concluída e validada localmente; merge limitado a Contact/Account e escala síncrona explicitamente limitada |
| CRM-62 | Observabilidade, segurança e privacidade operacional | Concluída e validada localmente; sem provider, egress ou deploy |
| CRM-63 | Recuperação, concorrência e testes de carga isolados | Concluída e validada localmente |
| CRM-64 | Homologação e aceite de prontidão | Concluída e validada localmente; produção permanece NO-GO e exige autorização separada |
