# Inventário do ambiente de produção

Data do inventário: 16 de setembro de 2026. Valores secretos são
deliberadamente omitidos.

## Fronteiras

| Item | Produção | Staging | Compartilhado? |
|---|---|---|---|
| Vercel project | `crm-politizai-production` | `crm-politizai-staging` | não |
| Vercel project ID | `prj_BJ4G7j1vgbL3tRMerhJ3MJ8f6lBS` | `prj_Eyr41l0Vm8zTxxucQH8QNC2JNdCQ` | não |
| Neon project | `crm-politizai-production-db` | `crm-politizai-staging-db` | não |
| Neon project ID | `steep-credit-26086628` | `hidden-mode-30035631` | não |
| Banco | `politizai_production` | `politizai_staging` | não |
| Branch | `main` / `br-bold-lake-ac2oqk9o` | branch própria de staging | não |
| Credenciais | prefixo `crm-politizai-production-` | prefixo de staging | não |

## Estado de produção

- Vercel: Hobby, `gru1`, Node 22, projeto protegido, não vinculado ao Git;
- deployment fechado ativo: `dpl_C18kCxoBVxc4pUgcvAcMLWgaTu6n`, SHA técnico
  `bf15b07920600da3283ac48598fe4985e032cddc`;
- domínio customizado: nenhum;
- Neon: Free, AWS São Paulo, PostgreSQL 18;
- schema: `public`;
- tabelas: 298;
- migrations: 60 aplicadas, zero pendente;
- usuários do CRM: 0;
- dados de negócio: 0; existem somente 11 linhas estruturais em `permissions`;
- ponto de recuperação pré-migration:
  `prod12-pre-migration-20260916` (`br-delicate-river-ac1k3pf7`);
- worker persistente: inexistente;
- worker serverless: configurado com kill switch desligado (`false`);
- integrações externas e egress comercial: desativados.

## Próxima mutação permitida

A PROD-12 foi executada somente até o release candidate fechado. Bootstrap,
worker, domínio, dados reais e go-live continuam proibidos. A próxima tarefa
possível é a auditoria PROD-13, somente após autorização explícita.

## Evidências da PROD-12

O relatório consolidado é
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md). Os
recortes de [migrations](./PROD12_MIGRATION_REPORT.md),
[deployment](./PROD12_DEPLOYMENT_REPORT.md),
[rollback](./PROD12_ROLLBACK_REPORT.md) e
[aceite](./PROD12_ACCEPTANCE_REPORT.md) registram as mesmas evidências sem
substituir a fonte principal.
