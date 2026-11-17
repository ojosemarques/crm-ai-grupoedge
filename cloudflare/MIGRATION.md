# Migração Cloudflare — grupo-edge-crm

Data da conclusão do núcleo: 2026-11-17 (America/Sao_Paulo)

## Produção

- Repositório `ojosemarques/crm-ai-grupoedge`, branch `main`, commit `54cc5d73f31cae6be5ecfbb9909f2c8a6c9e5626`.
- Worker `grupo-edge-crm`, conta Cloudflare `Grupo Edge / Voukye`.
- Domínio oficial: `https://crm.edgegrupo.com`.
- URL técnica: `https://grupo-edge-crm.grupo-edge-voukye.workers.dev`.
- Deployment `b58bed5e-fcd5-49ba-9a07-adae3094e626`, versão `8dcabea4-c996-418a-b081-a1fe08bc7472`, 100% do tráfego.
- Rollback preservado na Vercel: projeto `grupo-edge-crm`, deployment `DJWDQGNqqRARCKdovty3t9dGpQsJ` e alias `crm-ai-grupoedge.vercel.app`.

O núcleo web, banco, login e domínio estão publicados. Integrações sem credencial própria continuam desligadas e não bloqueiam o CRM.

## Banco e runtime

O banco é o Supabase `CRM POLITIZAI` (`zbzztpzviyjxpprqcegs`), schema `crm`. A role dedicada `crm_cloudflare_runtime` não tem superuser, `createdb`, `createrole`, replication ou bypass de RLS. Sua conexão direta foi validada antes do corte.

O Hyperdrive `grupo-edge-crm-supabase` usa o ID não sensível `d3a856bfac8a440b8302b540456c2d28`, TLS obrigatório e limite de cinco conexões na origem. O binding é `HYPERDRIVE`; `DATABASE_URL` existe apenas como Secret.

O Prisma Client usa `runtime = "workerd"`, carregando o query compiler WASM como módulo Cloudflare. Isso eliminou a tentativa de compilação dinâmica bloqueada pelo Workers. O build usa Node `22.23.4`, `nodejs_compat` e gera o alvo vinext.

## Domínio e DNS

`crm.edgegrupo.com` é Custom Domain de produção do Worker. Após o corte:

- health, readiness e login respondem HTTP 200;
- readiness confirma `database: ok`;
- entrada inválida no login retorna HTTP 400 controlado, sem erro 500;
- `edgegrupo.com` e `www.edgegrupo.com` continuam HTTP 200;
- MX da Hostinger e SPF da zona foram preservados.

## Secrets e flags

Secrets presentes, conferidos somente por nome:

- `DATABASE_URL`;
- `META_ADS_ACCESS_TOKEN`;
- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_WEBHOOK_SECRET`.

O dataset/pixel Meta está configurado como variável não sensível. `META_ADS_SERVER_CREDENTIALS_ENABLED=true` libera a credencial server-side, mas o worker de conversões e os diagnósticos permanecem desligados para não enviar eventos reais sem uma janela de teste.

Telegram possui token e segredo de webhook armazenados. `TELEGRAM_ENABLED=false` permanece seguro até existir vínculo do workspace/chat e o webhook poder ser registrado sem gerar retries ou mensagens indevidas.

Cron, worker serverless, automações, Copilot, adaptadores externos, MillionSend, TopSend, demo e bootstrap administrativo continuam desativados. O gatilho agendado retorna imediatamente enquanto `CLOUDFLARE_CRON_ENABLED=false`.

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
2. **Google Calendar:** client ID, client secret, chave de cifragem e teste dos callbacks no domínio oficial.
3. **Google Ads:** OAuth ou service account, refresh token e developer token quando exigido.
4. **Meta reporting/lead ads:** credencial `ads_read`, app secret, verify token, workspace, business e contas. A CAPI/pixel já está armazenada.
5. **Telegram operacional:** vincular workspace/chat, registrar e testar o webhook; depois ativar `TELEGRAM_ENABLED`.
6. **Worker/cron:** gerar segredo dedicado, validar um tick, retirar a agenda anterior e só então ativar os flags.
7. **MillionSend/Open Dot:** clientes HMAC, API key, webhook secret e decisão de habilitar egress de e-mail.
8. **MCP/OAuth:** clientes, hashes/tokens, chaves de assinatura e escopos do CRM/Politizai.
9. **TopSend voz:** token, URL de áudio, atraso operacional e ativação.
10. **Checkout/aquisição:** `CHECKOUT_WEBHOOK_SECRET` e HMACs das conexões realmente criadas.

## Rollback

Em regressão, manter integrações externas desligadas, remover apenas o Custom Domain do Worker e restaurar `crm.edgegrupo.com` para o alias Vercel preservado. Não alterar apex, `www`, MX, SPF ou outros registros de `edgegrupo.com`. Nenhuma migration de banco foi executada neste corte.
