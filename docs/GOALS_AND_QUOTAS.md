# Metas e quotas versionadas

## Escopo e fonte oficial

A CRM-55 cria o domínio local de metas em `src/modules/goals`. `GoalPlan` é o
plano versionado; `GoalQuota` é um alvo tipado de uma métrica canônica para uma
pessoa, equipe ou função. A interface `/metas` e as rotas `/api/goals` chamam o
mesmo serviço de aplicação e nunca acessam Prisma diretamente.

Um plano nasce como `DRAFT`. Nesse estado, período, descrição e quotas podem ser
revistos com controle de concorrência por `revision`. A publicação é explícita,
auditada e congela os campos materiais. Qualquer mudança posterior começa em
uma nova versão que referencia a anterior. Retirar um plano altera seu estado,
mas não elimina quotas, eventos ou evidências.

## Período, timezone e corte

Datas são informadas como dias civis inclusivos no timezone do workspace. No
banco, o intervalo é persistido como `[início do primeiro dia, início do dia
seguinte ao fim)`. Para o workspace Politizai, a exibição usa
`America/Sao_Paulo`. O progresso aceita `asOf` e conta somente fatos anteriores
ao menor valor entre o corte e o fim do plano. Assim, uma consulta histórica é
reproduzível e não usa o estado futuro do período.

## Alvos e precedência

Cada quota possui exatamente um alvo:

- `MEMBER`: um `WorkspaceMember` do mesmo workspace;
- `TEAM`: uma equipe do mesmo workspace;
- `FUNCTION`: uma função canônica de ownership.

Quando uma pessoa é coberta por mais de uma quota da mesma métrica, a regra é
`MEMBER > TEAM > FUNCTION`. A tela identifica a quota efetiva; metas agregadas
continuam visíveis somente a quem tem escopo para consultá-las. A autorização é
revalidada no servidor para o workspace e, quando selecionada, para a pessoa.

## Catálogo canônico

| Chave | Unidade | Fato usado |
|---|---|---|
| `LEADS_ASSIGNED` | quantidade | Lead recebido no período e owner alvo |
| `HUMAN_ATTEMPTS` | quantidade | Activity humana de tentativa |
| `MEETINGS_HELD` | quantidade | Meeting concluída |
| `OPPORTUNITIES_WON` | quantidade | Opportunity ganha |
| `REVENUE_WON_CENTS` | centavos BRL | valor da Opportunity ganha |
| `NEW_MRR_CENTS` | centavos BRL | MRR da Opportunity ganha |
| `EXPANSION_MRR_CENTS` | centavos BRL | movimento positivo de expansão |
| `RENEWALS_COMPLETED` | quantidade | renovação com decisão terminal |
| `LEAD_TO_SALE_BPS` | basis points | leads ganhos / leads recebidos |

Valores monetários são inteiros em centavos; percentuais são inteiros de 0 a
10.000 basis points. Métrica e unidade são validadas no contrato e por
constraint no PostgreSQL.

## Zero, ausência e cobertura

`ZERO` significa que o universo está definido e nenhum fato foi encontrado.
`NO_DENOMINATOR` significa que uma taxa não possui universo elegível.
`PARTIAL` identifica ausência de vínculo suficiente para calcular a quota.
`NOT_APPLICABLE` é usado quando a própria meta não admite percentual de
atingimento, por exemplo alvo zero. Esses estados não são convertidos em zero.

O atingimento é `realizado × 10.000 / alvo`, em basis points e sem truncar o
valor persistido. Cada resultado informa contagem de evidências e um drilldown
para os registros de origem.

## Integridade, concorrência e auditoria

- transações `Serializable`, advisory lock e retry limitado protegem criação,
  atualização e publicação concorrentes;
- chaves idempotentes são únicas por workspace;
- quotas publicadas e campos materiais do plano são protegidos por trigger;
- `GoalPlanEvent` é append-only e sequencial por plano;
- `AuditLog` registra criação, revisão, publicação, nova versão, retirada,
  negações relevantes e backfill;
- FKs compostas impedem referências entre workspaces e deleções históricas.

## Permissões

- `goals.read`: consulta de planos e progresso conforme escopo;
- `goals.manage`: criação e edição de rascunhos e novas versões;
- `goals.publish`: publicação e retirada;
- `goals.backfill`: execução administrativa do diagnóstico legado.

Administrador possui todas as permissões. Gestor comercial gerencia, publica e
executa backfill no workspace demonstrativo. SDR e closer leem o próprio
recorte; visualizador possui leitura sem mutação. A matriz efetiva continua
configurável por `RolePermission`.

## Seed e backfill

O seed local cria um plano fictício e idempotente para setembro de 2026 com
quotas de pessoa, equipe e função. Nenhum dado pessoal real é usado.

O comando abaixo é `DRY_RUN` por padrão:

```bash
pnpm db:goals:backfill -- --run-key=crm55:dry-run:manual
```

O modo efetivo exige `--execute`, opera somente em
`politizai_crm/public` local e continua conservador: sinais legados sem período,
alvo e valor confiáveis viram `REVIEW_REQUIRED`; o processo nunca inventa nem
publica uma meta oficial. Repetir a mesma `runKey` devolve o run anterior.

## Limites

A CRM-55 não implementa forecast, snapshots de previsão, pace por dias úteis,
pipeline coverage ou remuneração variável. Esses itens pertencem a tarefas
posteriores. Não há provider, credencial, egress, banco remoto ou deploy.
