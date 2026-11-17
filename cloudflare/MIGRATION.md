# Migração Cloudflare — grupo-edge-crm

Data da conclusão do núcleo e da auditoria: 2026-11-17 (America/Sao_Paulo)

## Produção

- Repositório `ojosemarques/crm-ai-grupoedge`, branch `main`. O corte Cloudflare-only foi publicado no commit `870695611e1144e9c180a967312cafdb78fefae4`.
- Worker `grupo-edge-crm`, conta Cloudflare `Grupo Edge / Voukye`.
- Domínio oficial: `https://crm.edgegrupo.com`.
- URL técnica: `https://grupo-edge-crm.grupo-edge-voukye.workers.dev`.
- Deployment do corte `27e12bfe-f3f6-4939-ad4d-1ef3e9350711`, versão `e5c73266-6c53-4ba3-a9e4-e84b17bd376c`, 100% do tráfego.
- Workers Builds conectado ao GitHub, branch de produção `main`, auto-build ativo, previews desativados e último build concluído com sucesso.
- O projeto Vercel legado `grupo-edge-crm` continua acessível somente como rollback. A integração Git foi desconectada em 2026-11-17 e não pode ser reconectada. A pausa do projeto exige confirmação humana na CLI da Vercel.

O núcleo web, banco, login e domínio estão publicados. Integrações sem credencial própria continuam desligadas e não bloqueiam o CRM.

## Banco e runtime

O banco é o Supabase `CRM POLITIZAI` (`zbzztpzviyjxpprqcegs`), schema `crm`. A role dedicada `crm_cloudflare_runtime` não tem superuser, `createdb`, `createrole`, replication ou bypass de RLS. Sua conexão direta foi validada antes do corte.

O Hyperdrive `grupo-edge-crm-supabase` usa o ID não sensível `d3a856bfac8a440b8302b540456c2d28`, TLS obrigatório e limite de cinco conexões na origem. O binding é `HYPERDRIVE`; `DATABASE_URL` existe apenas como Secret.

O Prisma Client usa `runtime = "workerd"`, carregando o query compiler WASM como módulo Cloudflare. Isso eliminou a tentativa de compilação dinâmica bloqueada pelo Workers. O build usa Node `22.23.4`, `nodejs_compat` e gera o alvo vinext.

Em 2026-11-17, a migration `20261117193000_fix_auth_session_actor_guard` tornou a validação de sessão independente do `search_path` da conexão. O trigger continua exigindo o ator humano correspondente, mas consulta `crm.actors` explicitamente para funcionar também via Hyperdrive. A função foi aplicada no banco de produção e validada com criação de sessão e auditoria dentro de uma transação revertida, sem deixar dados de teste.

## Domínio e DNS

`crm.edgegrupo.com` é Custom Domain de produção do Worker. Após o corte:

- health, readiness e login respondem HTTP 200;
- readiness confirma `database: ok`;
- entrada inválida no login retorna HTTP 400 controlado, sem erro 500;
- `edgegrupo.com` e `www.edgegrupo.com` continuam HTTP 200;
- MX da Hostinger e SPF da zona foram preservados.

## Secrets e flags

Secrets presentes, conferidos somente por nome:

- `CRM_MCP_CLIENTS_JSON`;
- `CRM_MCP_OAUTH_SIGNING_SECRET`;
- `DATABASE_URL`;
- `GOOGLE_CALENDAR_CLIENT_ID`;
- `GOOGLE_CALENDAR_CLIENT_SECRET`;
- `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`;
- `META_ADS_ACCESS_TOKEN`;
- `MILLIONSEND_API_KEY`;
- `MILLIONSEND_WEBHOOK_SECRET`;
- `SERVERLESS_WORKER_SECRET`;
- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_WEBHOOK_SECRET`.

O dataset/pixel Meta está configurado como variável não sensível. `META_ADS_SERVER_CREDENTIALS_ENABLED=true` libera a credencial server-side, mas o worker de conversões e os diagnósticos permanecem desligados para não enviar eventos reais sem uma janela de teste.

Telegram possui token e segredo de webhook armazenados e `TELEGRAM_ENABLED=true`.

O cron Cloudflare (`* * * * *`), o worker serverless e o MillionSend estão habilitados. Copilot, adaptadores externos genéricos, conversões/diagnósticos Meta, TopSend, demo, bootstrap administrativo e o worker legado de automação permanecem desativados.

## Pendências da auditoria

- HTTP em `crm.edgegrupo.com` ainda responde sem redirecionar para HTTPS; `always_use_https` está desligado na zona e o header HSTS não foi observado. Corrigir em regra restrita ao hostname ou numa mudança de zona explicitamente aprovada.
- A zona aceita TLS mínimo 1.0. Elevar para TLS 1.2 afeta todos os hosts de `edgegrupo.com` e exige uma mudança de zona separada.
- O deployment Vercel legado ainda responde e permanece apenas para rollback. Excluir o projeto ou o alias é destrutivo e exige autorização específica.
- O projeto Vercel ainda não está pausado e sua configuração antiga de cron continua registrada. Para suspender tráfego e execução legados de forma reversível, executar `vercel project pause grupo-edge-crm --scope ejosemarquess-gmailcoms-projects` e confirmar digitando o nome do projeto. O rollback exige `vercel project resume` antes de restaurar tráfego.
- O CI encontra `GHSA-fc5q-39xc-vjpf` em `picomatch@4.0.7`, transitivo do toolchain vinext/Vite. O feed exige `>=4.0.8`, mas essa versão ainda não foi publicada no npm; não ignorar o advisory nem apontar para commit Git não lançado. Atualizar a resolução assim que existir uma release oficial e repetir o gate completo.
- A observação confirmou schedule, handler, bindings e secret do worker, mas não incluiu um log de execução do cron em produção.

## Validação executada

- `pnpm exec vitest run` direcionado: 17/17 testes aprovados.
- ESLint direcionado: aprovado.
- `pnpm build:vinext`: aprovado, incluindo Prisma WASM.
- Cloudflare: health 200, readiness 200, login 200 e autenticação inválida 400.
- CSP com nonce, cookies seguros, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` e `Referrer-Policy` presentes.
- A suíte completa continua com cinco falhas preexistentes em `route-auto-refresh.test.ts`, causadas pelo mock original sem `useRef`; esse fluxo não foi alterado.

## O que ainda falta no CRM

Nada abaixo bloqueia o núcleo publicado. Cada item exige credencial própria e decisão de ativação:

1. **Copilot/OpenAI:** `OPENAI_API_KEY`, `OPENAI_MODEL` e ativar `COPILOT_EXTERNAL_ENABLED`.
2. **Google Calendar:** credenciais e chave de cifragem estão vinculadas; falta evidência de um fluxo OAuth completo no domínio oficial.
3. **Google Ads:** OAuth ou service account, refresh token e developer token quando exigido.
4. **Meta reporting/lead ads:** credencial `ads_read`, app secret, verify token, workspace, business e contas. A CAPI/pixel já está armazenada.
5. **Telegram operacional:** habilitado; ainda falta evidência do registro e de um ciclo completo do webhook no domínio oficial.
6. **Worker/cron:** habilitado; falta evidência de logs de pelo menos um tick concluído no Cloudflare.
7. **MillionSend/Open Dot:** API key, webhook secret e MillionSend estão habilitados; clientes HMAC/Open Dot dependem do cadastro operacional correspondente.
8. **MCP/OAuth:** bindings de clientes e assinatura estão presentes; a validade dos clientes e escopos depende de teste autenticado.
9. **TopSend voz:** token, URL de áudio, atraso operacional e ativação.
10. **Checkout/aquisição:** `CHECKOUT_WEBHOOK_SECRET` e HMACs das conexões realmente criadas.

## Rollback

Em regressão, manter integrações externas desligadas, remover apenas o Custom Domain do Worker e restaurar `crm.edgegrupo.com` para o deployment Vercel preservado. Não reconectar o Git ao projeto Vercel, não alterar apex, `www`, MX, SPF ou outros registros de `edgegrupo.com`. Nenhuma migration de banco foi executada neste corte.
Se o projeto Vercel estiver pausado, executar `vercel project resume grupo-edge-crm --scope ejosemarquess-gmailcoms-projects` antes de iniciar o rollback.
