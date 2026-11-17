# Migração Cloudflare — grupo-edge-crm

## Escopo e linha de base

- Vercel: projeto `grupo-edge-crm` (`prj_XIAyc00k7rXhbpVDVqsdpeBVJiIF`), deployment de produção `DJWDQGNqqRARCKdovty3t9dGpQsJ`, status `Ready`.
- Repositório: `ojosemarques/crm-ai-grupoedge`, produção na branch `main`, baseline `f094cf43e397712212152f10f5e597dbe9d6429c`.
- Alias preservado: `crm-ai-grupoedge.vercel.app`; não há domínio próprio cadastrado no projeto.
- Destino preparado: Worker `grupo-edge-crm`, conta Cloudflare `Grupo Edge / Voukye`, branch `codex/cloudflare-migration`.
- A Vercel permanece operacional como origem e rollback. Nenhum domínio, alias, callback, cron Vercel ou dado de produção foi alterado.

## Runtime e banco

O Next.js 16 continua disponível pelo build original da Vercel e ganha um segundo alvo Cloudflare pelo vinext. O `vinext check` reconheceu 228 route handlers, 96 páginas e 98% de compatibilidade, sem issue impeditiva. A única indicação parcial é `reactStrictMode`, já padrão no App Router.

No Cloudflare, cada requisição cria um Prisma Client isolado com uma única conexão lógica sobre Hyperdrive e agenda `$disconnect()` em `waitUntil`. O pool global de cinco conexões continua inalterado no runtime Next/Vercel. Isso evita reuso de socket entre requisições Workers e preserva o rollback.

O Hyperdrive deve usar a conexão PostgreSQL direta do projeto Supabase `CRM POLITIZAI` (`zbzztpzviyjxpprqcegs`) com a mesma role de runtime de menor privilégio. O binding é `HYPERDRIVE`; o schema `crm` é aplicado no adaptador. O valor da conexão não é versionado nem registrado neste relatório.

## Build, deploy e cron

- Instalação: `pnpm install --frozen-lockfile` com Node `22.23.x` e pnpm `11.14.0`.
- Compatibilidade: `pnpm check:vinext`.
- Build Cloudflare: `pnpm build:vinext`.
- Deploy: `pnpm deploy:vinext`.
- Build Vercel preservado: `pnpm build`.
- Variável de build não sensível: `CLOUDFLARE_HYPERDRIVE_ID`.
- Compatibilidade Workers: `nodejs_compat`, data `2026-11-16`.
- Cron Cloudflare: `* * * * *`, protegido pelo mesmo segredo do tick e por `CLOUDFLARE_CRON_ENABLED=false` até a virada. O cron Vercel continua sendo a única agenda ativa antes do corte.

As dependências Cloudflare foram fixadas em versões exatas e passaram pelo audit: `vinext@1.4.4`, `@vinext/cloudflare@1.3.3`, `cf@1.0.0-beta.28`, `@cloudflare/vite-plugin@2.0.0-beta.v.12` e `vite@8.2.4`. Next foi atualizado dentro da mesma linha para `16.4.6`, eliminando advisory do audit. O runtime mínimo passou a Node `22.23.0`, requisito transitivo do tooling Cloudflare.

## Variáveis e integrações

O `cloudflare.config.ts` declara bindings Secret para o inventário de runtime, sem valores no Git. O catálogo inclui identidade do app, política de sessão, banco, worker, OpenAI, Google Calendar, MCP/OAuth, Meta Ads, Telegram, TopSend, MillionSend/Open Dot e webhooks. O valor `CLOUDFLARE_CRON_ENABLED` deve começar como `false`.

Antes do primeiro deploy, reconciliar no painel os nomes efetivos da Vercel com a lista declarada e transferir somente valores usados. Não copiar `DIRECT_URL`: ela é exclusiva do runner de migrations e não pertence ao runtime web/worker. `APP_CANONICAL_URL`, trusted hosts/origins e callbacks permanecem com os endereços atuais até a etapa de domínio; para validação temporária, acrescentar o hostname `workers.dev` sem remover a origem Vercel.

Integrações identificadas: Supabase PostgreSQL, OpenAI, Google Calendar OAuth, Meta Ads, Telegram, TopSend, MillionSend/Open Dot, MCP/OAuth do CRM/Politizai e endpoint de checkout. Nenhum write real será usado no teste publicado; apenas health/readiness, autenticação negativa, páginas públicas e chamadas sintéticas isoladas que não persistam dados de tenant.

## Evidências locais

- `vinext check`: 98% compatível, 21 itens suportados, 1 parcial, 0 issues.
- `vite build`: aprovado; Worker, assets, Hyperdrive e 228 APIs empacotados.
- `next build --webpack`: aprovado; o caminho Vercel/rollback continua compilando.
- `tsc --noEmit`: aprovado.
- `eslint .`: aprovado.
- Testes direcionados: 12/12 aprovados para cliente de banco por requisição e cron em produção independente de `VERCEL_ENV`.
- Suíte Vitest: 1.303 testes aprovados de 1.308. Os 5 erros estão em `route-auto-refresh.test.ts`, já inconsistentes no baseline: o componente original usa `useRef`, mas o mock original não o exporta. Nenhum arquivo desse fluxo foi alterado pela migração.
- Política do repositório: aprovada para 2.045 arquivos rastreados.
- `pnpm audit --prod`: nenhuma vulnerabilidade conhecida.
- `git diff --check`: aprovado.

## Pendências externas

- O GitHub App da Cloudflare foi autorizado somente para os repositórios da migração; `crm-ai-grupoedge` está conectado à branch `codex/cloudflare-migration`.
- Em 2026-11-16, `vercel env pull --environment=production` foi executado com sessão CLI autorizada. Das 89 variáveis retornadas, 33 secrets foram substituídos por `[SENSITIVE]`; entre eles estão `DATABASE_URL`, credenciais OAuth/MCP, OpenAI, Google Calendar, Meta, Telegram, TopSend, MillionSend/Open Dot e webhooks. O Vercel confirma que valores Secret não são legíveis depois da criação.
- As origens alternativas foram verificadas sem ler valores: não há GitHub Actions Secrets no repositório nem nos ambientes `Production`/`Preview`; no Supabase, `vault.secrets` e `crm.integration_secret_references` têm zero registros. Portanto não existe cópia máquina-a-máquina autorizada para importar.
- Estado: **BLOCKED — CREDENCIAIS DE ORIGEM IRRECUPERÁVEIS**. Sem `DATABASE_URL` não é possível criar o Hyperdrive sem redefinir a credencial PostgreSQL; sem os demais valores, o runtime publicado perderia integrações. Nenhuma rotação, alteração de callback ou credencial foi executada.
- Após uma origem autorizada fornecer os valores ou cada rotação ser aprovada separadamente: criar o Hyperdrive, registrar seu ID como variável de build, transferir somente os secrets/runtime vars efetivamente usados e publicar a branch.
- Validar na URL `workers.dev`: `/api/health`, `/api/ready`, login sem credencial, headers/cookies, páginas públicas, APIs negativas, logs sem secrets e ausência de execução do cron.
- Manter `CLOUDFLARE_CRON_ENABLED=false` até a futura virada de domínio/agenda.

## Cutover e rollback

Na futura janela de corte, cadastrar o domínio decidido, atualizar canonical/trusted hosts/origins e callbacks de OAuth/webhooks, validar TLS e então desativar o cron Vercel antes de ativar `CLOUDFLARE_CRON_ENABLED=true`. A virada deve validar login, sessão, autorização multi-tenant, health/readiness, integrações e um ciclo de worker controlado.

O rollback é desativar imediatamente o cron Cloudflare, restaurar o apontamento para `crm-ai-grupoedge.vercel.app`/deployment `DJWDQGNqqRARCKdovty3t9dGpQsJ` e reativar somente a agenda Vercel. O banco Supabase permanece a fonte única e nenhuma migration faz parte deste trabalho.
