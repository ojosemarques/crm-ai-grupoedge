# CRM Grupo Edge: Supabase e Vercel

## Recursos vinculados

- Código: `ojosemarques/crm-ai-grupoedge`, branch `main`.
- Banco: projeto Supabase `zbzztpzviyjxpprqcegs`, região `ca-central-1`.
- Web: projeto Vercel `crm-ai-grupoedge`, equipe Grupo Edge, funções em `yul1`.
- URL canônica: `https://crm-ai-grupoedge.vercel.app`.

Os identificadores e URLs acima não são credenciais. Senhas, URLs de conexão
com senha e segredos ficam fora do Git. O diretório `.credentials/` e os
arquivos `.env*` locais são ignorados.

## Banco e permissões

O schema `crm` foi criado pela migration Supabase
`20260929204214_crm_private_schema.sql`. Os modelos do CRM são criados pelas
60 migrations Prisma existentes, usando uma conexão de migração separada.
`public` permanece sem tabelas da aplicação. As roles Supabase `anon`,
`authenticated` e `service_role` não recebem acesso ao schema `crm`.

O processo web usa `crm_politizai_runtime`, com DML nas tabelas da aplicação.
A role não tem permissão para criar objetos nem ler `_prisma_migrations`.
`supabase/runtime-grants.sql` documenta e reaplica esses grants após futuras
migrations que adicionarem tabelas ou sequências. Execute-o com uma identidade
de migração somente depois de revisar o diff da migration.

`DATABASE_URL` de produção usa o pooler transacional Supabase, porta 6543,
`schema=crm`, TLS e usuário de runtime. `DIRECT_URL` deve existir apenas no
processo de migração, nunca como variável do projeto web Vercel. Para maior
garantia de identidade TLS, instale a CA do projeto Supabase no processo web;
`sslmode=require` com `uselibpqcompat=true` cifra a conexão, mas não valida o
certificado do servidor.

## Deploy e automações

O projeto Vercel usa Next.js, Node 22 e `pnpm install --frozen-lockfile`.
Configure as variáveis de produção a partir de `.env.production.example` e
do contrato em `src/shared/core/config/environment-contract.ts`; marque
`DATABASE_URL`, `CRON_SECRET` e `SERVERLESS_WORKER_SECRET` como secrets.
Os dois segredos do worker devem ter o mesmo valor e pelo menos 32 caracteres.
O cron chama `GET /api/internal/worker/tick` a cada minuto; a rota exige
`Authorization: Bearer <segredo>` e possui kill switch
`SERVERLESS_WORKER_ENABLED`.

Antes de publicar alterações, execute `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`, `pnpm security:scan` e o preflight de produção com
o ambiente efetivo. Migrations são uma etapa explícita anterior ao deploy e
devem ser verificadas com `pnpm db:status`. Nunca rode `pnpm db:seed` no
Supabase de produção.

O primeiro usuário administrador deve ser criado pelo fluxo
`pnpm admin:bootstrap`, com `PROCESS_ROLE=bootstrap`, segredo e confirmação
explícitos. O bootstrap não precisa de `DIRECT_URL` e seu segredo não fica
armazenado no Vercel. Depois, teste o login e desative o fluxo novamente.
