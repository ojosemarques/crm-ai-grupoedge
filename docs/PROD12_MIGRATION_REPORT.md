# Relatório de migrations da PROD-12

## Escopo e fonte de verdade

Este documento especializa as evidências de migrations já consolidadas em
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md). Ele não
registra nova execução e não substitui o relatório consolidado.

## Alvo validado

- ambiente: produção fechada, sem tráfego público;
- projeto Neon: `steep-credit-26086628`;
- banco/schema: `politizai_production/public`;
- identidade de migration: `crm_politizai_prod_migrator`;
- identidade de runtime: `crm_politizai_prod_runtime`, sem privilégio `CREATE`;
- conexão de migration: direta e protegida fora do runtime web;
- conexão de runtime: pooled, com TLS obrigatório.

O preflight `prod03.1` retornou `READY_FOR_PRODUCTION` antes da mutação, sem
expor host, senha ou connection string. A branch
`prod12-pre-migration-20260916` (`br-delicate-river-ac1k3pf7`) foi criada antes
da primeira migration e permanece como ponto de recuperação do estado vazio.

## Resultado registrado

As migrations versionadas do commit técnico
`bf15b07920600da3283ac48598fe4985e032cddc` foram aplicadas uma única vez com
`prisma migrate deploy`. `migrate dev` não foi usado.

| Evidência | Resultado |
|---|---:|
| Duração total | 229 s |
| Migration mais lenta | `20260910005226_relational_foundation` — 23,975 s |
| Migrations concluídas | 60 |
| Migrations falhas ou pendentes | 0 |
| Tabelas finais em `public` | 298 |
| Locks aguardando ao final | 0 |
| Sessões alheias ao verificador | 0 |

Nenhum seed foi executado. As migrations criaram somente 11 linhas estruturais
em `permissions`; `workspaces`, `users`, `leads` e `audit_logs` permaneceram
vazias. Nenhum dado local, de staging ou pessoal foi transferido.

## Controles preservados

- o runtime permaneceu sem DDL, `CREATEDB`, `CREATEROLE`, superuser ou
  replication;
- a URL direta não foi entregue ao runtime web;
- o status final apresentou zero migration pendente;
- a branch principal de produção não foi restaurada, removida ou recriada;
- o limite do Neon Free permanece explícito: histórico de 6 horas e ausência
  de proteção da branch contra exclusão.

Não houve nova migration durante esta correção documental.
