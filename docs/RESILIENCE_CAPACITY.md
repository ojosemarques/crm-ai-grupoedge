# Resiliência, recuperação e capacidade local

## Escopo e limites

A CRM-63 cria ensaios locais, determinísticos e descartáveis. Ela não define
capacidade de produção, não acessa provedores, não usa egress e não executa
falhas contra `public`. Evidência gerada fica em `.cache/resilience/`, diretório
ignorado pelo Git. O contrato dos relatórios é `resilience.v1`.

Não houve migration nesta task: o catálogo é código versionado e o resumo do
Console de Operações reutiliza `TelemetryRecord`. Isso evita alterar `public`
para armazenar infraestrutura de teste. O estado “Sem ensaio” é intencional e
não equivale a aprovação.

## Catálogo de criticidade

| Capacidade | Criticidade | RPO proposto | RTO proposto | Dono | Runbook |
|---|---:|---:|---:|---|---|
| Autenticação e RBAC | crítica | 0 min | 30 min | Plataforma | RB-IDENTITY |
| Entrada e identidade de leads | crítica | 0 min | 30 min | Revenue Ops | RB-LEAD-INTAKE |
| Timeline, tarefas e auditoria | crítica | 0 min | 60 min | Revenue Ops | RB-HISTORY |
| Reuniões, oportunidades e receita | alta | 5 min | 120 min | Vendas | RB-SALES |
| Jobs, automações e outbox | alta | 15 min | 120 min | Operações | RB-AUTOMATION |
| Dashboard, métricas e forecast | média | 60 min | 240 min | RevOps | RB-ANALYTICS |
| Privacidade, retenção e DSR | crítica | 0 min | 60 min | Privacidade | RB-PRIVACY |

RPO/RTO são objetivos para homologação, não garantias. RPO zero significa que
perda silenciosa é inaceitável: o caminho usa transação, idempotência,
reconciliação ou revisão humana.

## Runbooks resumidos

1. **RB-IDENTITY:** bloquear mutações, preservar sessões/auditoria, validar RBAC
   e isolamento, aplicar forward-fix; nunca rebaixar autorização para recuperar.
2. **RB-LEAD-INTAKE:** interromper ingressos, verificar idempotency key,
   identidade, submissão, atribuição, SLA e tarefa; repetir apenas pelo serviço.
3. **RB-HISTORY:** fatos append-only não recebem rollback destrutivo. Corrigir
   por evento compensatório e reconciliar contagens/atores.
4. **RB-SALES:** congelar fechamento conflitante, reconciliar reunião,
   oportunidade, proposta, valores em centavos e ledger; exigir revisão humana.
5. **RB-AUTOMATION:** pausar regra, deixar lock expirar, retomar pelo worker,
   conferir tentativas e dead-letter; não executar ação direta no banco.
6. **RB-ANALYTICS:** reduzir refresh analítico, manter operações transacionais,
   validar freshness e recomputar a partir dos fatos.
7. **RB-PRIVACY:** suspender ação destrutiva, preservar legal hold e auditoria,
   validar identidade, escopo e evidências antes de forward-fix.

## Matriz de recuperação

| Estado observado | Decisão | Regra |
|---|---|---|
| falha antes do commit | rollback | a transação não pode deixar efeito parcial |
| commit ocorreu e existe replay idempotente | retry | a mesma chave deve retornar o mesmo efeito |
| commit ocorreu sem replay seguro | forward-fix | correção compensatória pelos serviços de domínio |
| qualquer invariável violada | revisão humana | bloquear automação e preservar evidências |

Resultado ambíguo depois do commit deve ser tratado como “pode ter ocorrido”. A
primeira ação é consultar pela chave/correlação; nunca repetir com nova chave.

## Backup e restauração de ensaio

```bash
pnpm resilience:restore
pnpm resilience:restore -- --execute
```

O primeiro comando é dry-run. O executor valida host loopback, banco
`politizai_crm`, ambiente não produtivo e o container Compose `db`; gera dump
custom somente de `public`; valida o catálogo com `pg_restore --list`; cria banco
`politizai_resilience_restore_*`; restaura; compara contagens de migrations,
workspaces, usuários, memberships, leads, atividades, oportunidades e auditoria;
e remove o banco temporário em `finally`. O manifesto registra SHA-256, versão
PostgreSQL, tamanho, fingerprints e cleanup. O dump nunca é enviado ao Git.

## Concorrência e fault injection

O fault injector só inicia com `NODE_ENV=test`,
`RESILIENCE_FAULT_INJECTION=1` e `PRISMA_TEST_SCHEMA` igual a um
`politizai_test_resilience_*` válido. Os pontos são antes/depois do commit,
claim de worker e entrega da outbox. A suíte comprova rollback antes do commit,
retomada idempotente após resultado ambíguo, ownership explícito e unicidade sob
concorrência. As suítes dirigidas existentes complementam lead duplicado e
`SKIP LOCKED` do worker. Não há chave de falha no runtime normal.

## Runner de carga

```bash
pnpm resilience:load -- --profile=smoke --seed=63001 --concurrency=2 --duration=2 --target=ephemeral --output=.cache/resilience/smoke.json
pnpm resilience:load -- --execute --profile=smoke
pnpm resilience:load -- --execute --profile=baseline --seed=63001 --concurrency=8 --duration=10
pnpm resilience:load -- --execute --profile=stress --confirm=RUN_LOCAL_STRESS
```

Dry-run é o padrão. `--target` aceita somente `ephemeral`; concorrência é
limitada a 100 e duração a 300 segundos. Stress exige confirmação adicional. O
runner cria schema `politizai_test_resilience_*`, aplica migrations, semeia
dados fictícios e mede consultas representativas de dashboard, lista, timeline,
tarefas, reuniões, oportunidades, jobs, outbox, reconciliação, alertas e
privacidade. Atualização de lead e claim de job executam em transação revertida.
Isso mede a fundação SQL/local; não é teste HTTP nem capacidade de produção.

Saída humana e JSON incluem min, p50, p90, p95, p99, máximo, throughput, erros,
timeouts, backlog, memória, pool, cenário, gargalo, budget e ação.

| Perfil | Concorrência | Duração | p95 | Erros | Throughput mínimo |
|---|---:|---:|---:|---:|---:|
| smoke | 2 | 2 s | 500 ms | 0 bps | 1/s |
| baseline | 8 | 10 s | 750 ms | 100 bps | 5/s |
| stress | 20 | 30 s | 1500 ms | 500 bps | 10/s |

Budget reprovado retorna exit code 2; não é mascarado como sucesso.
Para publicar somente o resumo minimizado no Console de Operações local, acrescente
`--record-workspace=politizai`. Essa opção explícita grava `TelemetryRecord` no
workspace indicado; não grava dump, IDs do alvo, queries ou dados pessoais.

## Backpressure e degradação

O runner limita concorrência pelo pool. A política determinística classifica:

- `NORMAL`: refresh analítico e operações críticas ativos;
- `DEGRADED`: preserva escritas críticas, suspende refresh analítico, reduz
  worker a 50% e sugere retry em 5 s;
- `SHED_NON_CRITICAL`: preserva escritas críticas, rejeita trabalho não crítico,
  reduz worker a 25% e sugere retry em 30 s.

Espera de pool, backlog e taxa de erro determinam o estado. Aplicação automática
em produção exige homologação; a CRM-63 define e testa a decisão sem mudar os
workers comerciais.

## Invariantes pós-recuperação

- `public` permanece fora dos alvos destrutivos;
- migrations e fingerprints reconciliam;
- nenhum lead fica sem owner e sem fila explícita;
- idempotency keys críticas continuam únicas;
- timeline e auditoria permanecem append-only;
- valores monetários e ledgers não recebem recomposição inventada;
- jobs/outbox não repetem o mesmo efeito;
- alvo efêmero é removido, salvo `KEEP_TEST_SCHEMA=1` explícito;
- nenhum adapter externo ou egress é habilitado.

## Console e limites

A aba **Resiliência** exige `operations.read` e mantém o escopo do workspace. Ela
mostra catálogo, último restore, última baseline e invariantes a partir de
telemetria persistida. Sem telemetria, mostra “Sem ensaio”. Detalhes completos
ficam no artefato local ignorado para reduzir PII e cardinalidade.

Resultados dependem do hardware local; não incluem latência de rede, CDN,
provedor, banco gerenciado, soak test, failover físico ou recuperação regional.
RPO/RTO ainda exigem homologação. CRM-64 permanece um gate separado.
