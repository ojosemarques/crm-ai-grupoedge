<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Produção e deploy

- Cloudflare é o provedor exclusivo de build, deploy, runtime, cron, domínio e secrets deste projeto.
- A produção é o Worker `grupo-edge-crm`, na conta `Grupo Edge / Voukye`, publicado automaticamente pelo Workers Builds a partir da branch `main` do repositório `ojosemarques/crm-ai-grupoedge`.
- O domínio canônico é `https://crm.edgegrupo.com`; a URL técnica é `https://grupo-edge-crm.grupo-edge-voukye.workers.dev`.
- Não criar, reconectar, configurar nem executar deployments na Vercel. O projeto Vercel legado pode existir apenas como rollback inativo e sem integração Git.
- Antes de qualquer mudança em produção, confirmar conta, Worker, repositório, branch, commit, domínio, bindings e secrets no Cloudflare. Nunca expor valores de secrets.
- A configuração versionada do Cloudflare é `cloudflare.config.ts`; build e deploy oficiais usam `pnpm build:vinext` e `pnpm deploy:vinext`.
