# Relatório da infraestrutura de produção — snapshot histórico da PROD-11

> As seções até “Atualização da PROD-12” registram o estado no encerramento da
> PROD-11. Elas não descrevem o estado atual após a execução autorizada da
> PROD-12.

## Resultado executivo

Em 16 de setembro de 2026, a PROD-11 criou somente a infraestrutura vazia e
isolada de produção na camada gratuita. Nenhuma migration, tabela de negócio,
seed, usuário do CRM, deployment, domínio ou integração externa foi criado.

O custo confirmado desta execução foi **R$ 0**. A infraestrutura não está
liberada para tráfego e não constitui um go-live.

## Recursos criados

| Camada | Recurso | Identificador não sensível | Região/plano | Estado |
|---|---|---|---|---|
| Web | Vercel `crm-politizai-production` | `prj_BJ4G7j1vgbL3tRMerhJ3MJ8f6lBS` | `gru1` / Hobby | sem Git, sem deployment e sem domínio customizado |
| Banco | Neon `crm-politizai-production-db` | `steep-credit-26086628` | `aws-sa-east-1` / Free | projeto exclusivo de produção |
| Branch | `main` | `br-bold-lake-ac2oqk9o` | primária | vazia, sem proteção de exclusão no Free |
| Banco lógico | `politizai_production` | nome não secreto | PostgreSQL 18 | `public` com zero tabelas e zero migrations |

Os recursos de staging permanecem separados: projeto Vercel
`crm-politizai-staging` e projeto Neon `hidden-mode-30035631`. Nenhum ID,
segredo, banco ou variável foi reutilizado entre os ambientes.

## Identidades e menor privilégio

- `crm_politizai_prod_owner`: identidade administrativa criada pelo Neon;
- `crm_politizai_prod_migrator`: proprietária do banco e reservada para a
  futura execução explícita de migrations;
- `crm_politizai_prod_runtime`: login de aplicação com `CONNECT` e `USAGE`,
  sem `CREATE`, `CREATEDB`, `CREATEROLE`, superuser ou replication;
- os privilégios padrão do migrator concedem ao runtime somente DML,
  sequências e execução de funções que vierem a ser criadas pelas migrations;
- a URL direta não foi entregue ao projeto web da Vercel.

## Configuração Vercel

- Next.js, Node `22.x`, build `pnpm build` e instalação com lockfile;
- Functions configuradas em `gru1`;
- Vercel Authentication definida para todos os deployments;
- `autoAssignCustomDomains=false`;
- nenhum repositório Git vinculado, evitando build ou promoção automática;
- 31 variáveis configuradas somente no alvo `production`;
- `DATABASE_URL`, `SESSION_SECRET` e `SERVERLESS_WORKER_SECRET` são valores
  sensíveis no cofre;
- `AUTOMATION_WORKER_ENABLED=false` e `SERVERLESS_WORKER_ENABLED=false`;
- adapters externos, demo, seed e bootstrap permanecem desativados;
- inventário confirmou **zero deployments**.

O repositório só deve ser vinculado na PROD-12, se autorizada, junto ao SHA
congelado e ao gate que impeça promoção automática.

## Configuração Neon

- TLS obrigatório nas URLs direta e pooled;
- runtime usa endpoint pooled; migrator usa endpoint direto;
- banco e branch são exclusivos de produção;
- histórico de recuperação informado pelo provider: 21.600 segundos (6 horas);
- compute padrão do Free: 0,25 CU; o plano recusou a personalização do intervalo
  de suspensão sem criar cobrança;
- tentativa de proteger a branch retornou HTTP 422 por limite do plano. Não
  houve upgrade e a branch continuou sem proteção;
- zero tabelas de aplicação, zero `_prisma_migrations` e nenhum dado importado.

## Segredos

Os valores não constam deste repositório nem deste relatório. As URLs e
segredos administrativos foram guardados no Keychain local; os valores
necessários ao futuro runtime estão no cofre do projeto Vercel. O inventário de
nomes e destinos está em
[`PRODUCTION_SECRETS_INVENTORY.md`](./PRODUCTION_SECRETS_INVENTORY.md).

## Rollback desta task

Se a infraestrutura vazia precisar ser abandonada antes da PROD-12:

1. confirmar os IDs deste relatório e zero deployment/tabela;
2. remover primeiro o projeto Vercel `crm-politizai-production`;
3. remover somente o projeto Neon `steep-credit-26086628`;
4. remover as cinco entradas Keychain prefixadas por
   `crm-politizai-production-`;
5. registrar a remoção e confirmar que staging continuou saudável.

Nenhuma dessas ações foi necessária nesta execução.

## Atualização da PROD-12

A infraestrutura deixou de estar vazia somente no escopo autorizado do release
candidate fechado. As 60 migrations criaram 298 tabelas e 11 linhas estruturais
em `permissions`; não há workspace, usuário, lead ou auditoria. O deployment
protegido `dpl_C18kCxoBVxc4pUgcvAcMLWgaTu6n` executa o SHA técnico `bf15b079`.
O ponto pré-migration `br-delicate-river-ac1k3pf7` permanece preservado. Detalhes
e limitações estão em
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md). Os
recortes especializados estão em
[`PROD12_MIGRATION_REPORT.md`](./PROD12_MIGRATION_REPORT.md),
[`PROD12_DEPLOYMENT_REPORT.md`](./PROD12_DEPLOYMENT_REPORT.md),
[`PROD12_ROLLBACK_REPORT.md`](./PROD12_ROLLBACK_REPORT.md) e
[`PROD12_ACCEPTANCE_REPORT.md`](./PROD12_ACCEPTANCE_REPORT.md).
