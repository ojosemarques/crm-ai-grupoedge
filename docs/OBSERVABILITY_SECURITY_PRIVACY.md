# Observabilidade, segurança e privacidade operacional

## Escopo e limites

A CRM-62 fornece um console local em `/operacoes`, contratos `telemetry.v1` e
`operations.v1`, SLOs determinísticos, alertas, incidentes e operação de
solicitações de titulares. Não conecta serviço externo, não envia notificações,
não executa eliminação ou anonimização e não substitui revisão jurídica. O
workspace da sessão é sempre a fronteira de acesso.

## Telemetria e correlação

`TelemetryRecord` aceita `LOG`, `METRIC`, `TRACE` e `SECURITY`. Cada registro
possui operação, resultado, instante, versão de contrato e `correlationId`; pode
referenciar `requestId`, `jobId` e `outboxEventId`. O sink é o PostgreSQL local.
Registros são append-only e não participam da transação comercial: uma falha de
telemetria não desfaz uma ação de domínio já confirmada.

A redação central ocorre antes do logger e antes do sink. Chaves de segredo,
sessão, credencial, payload e PII são removidas; e-mail, telefone e bearer token
também são reconhecidos dentro de texto. Labels são allowlisted, limitadas e
recusam identificadores de alta cardinalidade. Nunca use nome, e-mail, telefone,
ID de lead, ID de usuário ou texto livre como label.

## Catálogo SLI/SLO v1

| Chave | SLI | Meta | Janela | Responsável | Runbook |
|---|---|---:|---:|---|---|
| `api-availability` | respostas sem erro / respostas observadas | 99% | 24 h | Plataforma | `runbook-api` |
| `api-latency` | respostas em até 1 s / respostas com duração | 95% | 24 h | Plataforma | `runbook-api-latency` |
| `jobs` | jobs concluídos / jobs terminais | 99% | 24 h | Operações | `runbook-jobs` |
| `outbox` | entregas locais / eventos terminais | 99% | 24 h | Integrações | `runbook-outbox` |
| `privacy-sla` | DSR concluídas no prazo / DSR concluídas | 99,99% | 30 dias | Privacidade | `runbook-dsr` |

Sem denominador, o resultado é `NO_DATA`; não existe porcentagem inventada. O
burn rate é a fração do orçamento de erro consumida. Uma versão publicada é
imutável; uma nova meta exige uma nova versão.

## Alertas e incidentes

As regras v1 detectam jobs atrasados, outbox atrasada, automações com falha e
DSR vencidas. Elas têm severidade, limiar, cooldown, owner e runbook. O dedup é
`workspace + regra ativa`; avaliação concorrente usa advisory lock. O alerta
guarda evidência mínima e pode ser reconhecido ou resolvido com revisão otimista.

Incidentes são criados por decisão humana a partir de um alerta. Possuem impacto,
owner, correlação, runbook, revisão e timeline append-only. Transições permitidas:
`OPEN -> INVESTIGATING|MITIGATED|RESOLVED`, `INVESTIGATING -> MITIGATED|RESOLVED`
e `MITIGATED -> INVESTIGATING|RESOLVED`. Não há pager, e-mail ou webhook.

## Threat model v1

| Ameaça | Controle local | Evidência | Risco residual |
|---|---|---|---|
| acesso entre tenants | workspace derivado da sessão, FKs compostas e filtros server-side | testes de outro workspace | erro futuro em consulta nova |
| elevação de privilégio | RBAC server-side e permissões separadas | `authorization.denied` e testes por papel | revisão contínua da matriz |
| roubo/replay de sessão | sessão protegida, expiração e auditoria | eventos `auth.*` | hardening de produção ainda necessário |
| vazamento em logs/métricas | redactor central e labels allowlisted | testes de PII/segredo | texto não reconhecido exige revisão |
| abuso de endpoint | same-origin, Zod, limite de corpo e rate limit local | testes HTTP e resposta 429 | store em memória não é distribuído |
| XSS/clickjacking | CSP, frame-ancestors, nosniff e políticas de browser | headers HTTP | CSP ainda permite inline por compatibilidade Next |
| adapter externo acidental | runtime guard local e modos allowlisted | testes de configuração | ativação futura exige revisão específica |
| alteração de histórico | triggers append-only e AuditLog separado | teste de update/delete | administrador do banco continua privilegiado |
| destruição indevida | somente dry-run, identidade, legal hold, política e aprovação humana | blocker codes persistidos | execução real não implementada |

`/api/health` e `/api/ready` divulgam apenas serviço, estado agregado e checks
`application/database`; não retornam host, credencial, SQL, stack ou contagens.

## Inventário e governança de dados

O inventário usa `DataCategory`, `ProcessingPurpose`, `PurposeVersion`,
`LegalBasis`, `RetentionPolicyVersion` e `LegalHold`. Cada categoria registra
classificação, versão e sistemas de origem; cada finalidade pode apontar para
base legal, canais, owner e aviso versionado; retenção registra gatilho, duração,
ação, exceções e owner. Estados `PENDING_LEGAL` são ausência de aprovação, não
autorização implícita.

| Classe | Exemplos no CRM | Finalidade típica | Acesso | Retenção |
|---|---|---|---|---|
| padrão | etapa, origem, tarefa | operação comercial | escopo comercial | política versionada |
| pessoal | nome, e-mail, telefone | relacionamento autorizado | permissões de lead/privacidade | política + DSR |
| sensível | evidência classificada como sensível | somente finalidade explícita | permissão restrita | legal hold prevalece |
| segredo | senha, token, cookie, chave | autenticação técnica | nunca exposto ao console | fora de telemetria/export |

## Solicitações de titulares

Tipos suportados: acesso, correção, portabilidade, restrição, oposição,
revogação e eliminação. A solicitação exige contato, categorias, motivo,
responsável ou fila, prazo, status de identidade e chave idempotente. A timeline
é append-only e registra criação, verificação, mudança de status, exportação e
preview de destruição.

O pacote de acesso/portabilidade é minimizado: titular, categorias autorizadas,
instante, expiração e limitações. Não inclui dados de terceiros, hashes, sessões,
segredos ou conteúdo interno fora do escopo. Correção e decisões continuam nos
serviços de domínio; nenhuma sugestão aplica mutação silenciosa.

Eliminação e anonimização não são executadas na CRM-62. O preview persiste
`destructiveExecution=false` e bloqueia quando identidade, política, legal hold,
fatos comerciais/auditoria imutáveis ou aprovação humana não estiverem
satisfeitos. Resolver uma solicitação não apaga sua timeline.

## Retenção e backfill

`RUN_RETENTION_CHECKPOINT` cria um `Job` idempotente concluído em dry-run e
lista apenas solicitações vencidas no lote. Não altera dados. O comando abaixo
reconstrói somente o evento inicial de DSRs históricos que ainda não o possuem:

```bash
pnpm db:operations:backfill
pnpm db:operations:backfill -- --execute
```

O primeiro comando é dry-run. O modo execute é permitido apenas no banco local
`politizai_crm/public`, usa lock, IDs determinísticos e não infere fatos novos.

## Permissões

- `operations.read`: lê SLOs, alertas e incidentes do workspace.
- `operations.manage`: avalia regras, reconhece alertas e conduz incidentes.
- `security.monitor.read`: lê sinais agregados e integridade de auditoria.
- `privacy.operations.manage`: lê inventário/DSR e executa previews/checkpoints.

Administrador recebe todas. Gestor recebe todas no workspace demo. Outros
papéis não recebem por padrão. A UI não é a fronteira de autorização.

## Limitações e decisões futuras

- telemetria local cobre as operações instrumentadas; não é tracing distribuído;
- rate limit é por processo e precisa de store compartilhado em topologia multi-instância;
- SLOs não prometem disponibilidade de produção;
- CSP com `unsafe-inline` deve migrar para nonce antes de publicação pública;
- políticas LGPD permanecem sujeitas a validação jurídica e do encarregado;
- nenhuma destruição, provider, egress, banco remoto ou deploy foi ativado.
