# Release candidate fechado de produção — PROD-12

## Decisão executiva

Em 16 de setembro de 2026, o release candidate do CRM Politizai foi publicado
em produção **com acesso protegido**, sem identidade do CRM, sem dado de negócio,
sem domínio customizado e sem go-live público. A tarefa não autoriza uso real.

- commit técnico publicado: `bf15b07920600da3283ac48598fe4985e032cddc`;
- CI reutilizado: execução `35138250850`, concluída com sucesso para esse SHA;
- deployment ativo: `dpl_C18kCxoBVxc4pUgcvAcMLWgaTu6n`, estado `READY`;
- projeto Vercel: `crm-politizai-production`, Hobby, funções em `gru1`;
- banco Neon: `politizai_production/public`, projeto
  `steep-credit-26086628`, Free, São Paulo;
- custo gerado: **R$ 0**.

O alias automático da Vercel continua coberto por Vercel Authentication. A URL
não é reproduzida neste relatório para evitar que documentação operacional seja
interpretada como convite público. Não houve domínio customizado, DNS ou
remoção de proteção.

Este é o relatório consolidado e a fonte principal da PROD-12. Os recortes
especializados, sem nova execução, estão em
[`PROD12_MIGRATION_REPORT.md`](./PROD12_MIGRATION_REPORT.md),
[`PROD12_DEPLOYMENT_REPORT.md`](./PROD12_DEPLOYMENT_REPORT.md),
[`PROD12_ROLLBACK_REPORT.md`](./PROD12_ROLLBACK_REPORT.md) e
[`PROD12_ACCEPTANCE_REPORT.md`](./PROD12_ACCEPTANCE_REPORT.md).

## Preflight e ponto de recuperação

O preflight `prod03.1` foi executado com os valores sensíveis entregues ao
processo somente pelo Keychain e retornou `READY_FOR_PRODUCTION`. Foram
confirmados o projeto, banco, schema `public`, runtime pooled, migrator direto,
TLS requerido, URL HTTPS, cookies seguros, adapters externos desativados e
ausência de fallback.

Antes da primeira migration foi criada a branch Neon
`prod12-pre-migration-20260916` (`br-delicate-river-ac1k3pf7`), derivada de
`main` ainda vazia e sem compute. Ela permanece como ponto de recuperação do
estado pré-migration. A limitação do Neon Free continua explícita: histórico de
6 horas e ausência de branch protection contra exclusão.

## Migrations

As 60 migrations versionadas do SHA congelado foram aplicadas uma única vez
com `prisma migrate deploy` e a identidade `crm_politizai_prod_migrator`, pela
URL direta mantida fora do web runtime.

| Evidência | Resultado |
|---|---:|
| Duração total | 229 s |
| Migration mais lenta | `20260910005226_relational_foundation` — 23,975 s |
| Tabelas finais em `public` | 298 |
| Migrations concluídas | 60 |
| Migrations falhas/pendentes | 0 |
| Locks aguardando ao final | 0 |
| Sessões ativas alheias ao verificador | 0 |

Nenhum seed foi executado. As migrations criaram 11 linhas no catálogo
estrutural `permissions`; `workspaces`, `users`, `leads` e `audit_logs`
permaneceram com zero linhas. O runtime conservou `USAGE`/DML e continua sem
`CREATE`, `CREATEDB`, `CREATEROLE` ou superuser.

## Deployment e proteção

O build remoto usou Next.js 16.3.4, Node 22, pnpm 11 e Webpack. A compilação e
o TypeScript passaram. O primeiro deployment revelou que a URL canônica
preparada na PROD-11 não recebia alias quando `autoAssignCustomDomains=false`.
Sem alterar DNS ou domínio customizado, os três valores de URL/host/origin
foram alinhados ao alias automático já protegido do team, e o mesmo SHA foi
republicado.

O smoke fechado confirmou:

- acesso anônimo redirecionado para Vercel Authentication;
- `/api/health` HTTP 200;
- `/api/ready` HTTP 200 e banco `ok`;
- `/login` HTTP 200 por sessão autenticada da Vercel;
- raiz redireciona para `/login` dentro do mesmo host confiável;
- worker sem Bearer ou com segredo incorreto retorna HTTP 401;
- segredo correto com kill switch retorna HTTP 503 `WORKER_DISABLED`;
- `AUTOMATION_WORKER_ENABLED=false` e `SERVERLESS_WORKER_ENABLED=false`;
- nenhum cron, self-ping, GitHub Actions ou processo persistente foi criado;
- os logs inspecionados não continham segredo do worker, URLs de banco,
  Authorization, senha ou literal PostgreSQL.

Não existe Git link nem auto-deploy no projeto. O deployment executa o SHA
técnico aprovado. O commit final desta task contém somente documentação e é
registrado como equivalente de código, sem alegar igualdade falsa entre os
SHAs.

## Bootstrap, dados e RBAC

Nenhuma identidade foi criada porque nome e e-mail administrativos não foram
fornecidos explicitamente. Consequentemente, login autenticado no CRM, RBAC
interno e criação de registro sintético foram corretamente **não executados**.
O banco segue com zero workspaces, usuários, leads e logs de auditoria. O
bootstrap permanece desativado.

## Ensaio de rollback

O rollback de banco foi ensaiado em `prod12-rollback-test-20260916`, derivado
do ponto pré-migration. A branch apresentou zero tabelas e ausência de
`_prisma_migrations`; depois foi removida, sem tocar em `main` nem na branch de
recuperação.

O rollback de aplicação usou o commit anterior
`8128f6baa5a771270c5edf40bfc04e4f271e1118`. A comparação confirmou zero
alteração fora de documentação em relação ao candidato. Sob proteção, health e
readiness continuaram HTTP 200; em seguida o deployment `bf15b079` foi
promovido novamente. O deployment laboratorial e o deployment inicial obsoleto
foram removidos. O banco e suas contagens permaneceram inalterados.

## Responsáveis e limites

- release owner: Matheus Mendonça;
- migration owner: Matheus Mendonça;
- rollback owner: Matheus Mendonça;
- incident commander provisório da janela: Matheus Mendonça.

Não existe substituto/on-call. Worker 24×7, retenção produtiva, proteção de
branch, bootstrap, dados reais, domínio público, jurídico/DPO, pentest e
integrações externas continuam bloqueadores para operação real. A próxima
tarefa permanece a auditoria PROD-13 e exige autorização explícita.
