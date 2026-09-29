# Inventário de segredos de produção

Este arquivo registra somente nomes, finalidade e destino. Ele não contém
valores, hashes reversíveis, fragmentos ou URLs de conexão.

| Referência | Destino | Exposto ao web? | Finalidade |
|---|---|---:|---|
| `DATABASE_URL` | Vercel Sensitive + Keychain `crm-politizai-production-database-runtime` | sim, server-side | runtime pooled com menor privilégio |
| `DIRECT_URL` | Keychain `crm-politizai-production-database-migrator` | não | migration manual futura |
| `DATABASE_OWNER_URL` | Keychain `crm-politizai-production-database-owner` | não | administração excepcional do provider |
| `SESSION_SECRET` | Vercel Sensitive + Keychain `crm-politizai-production-session-secret` | sim, server-side | material criptográfico da sessão |
| `SERVERLESS_WORKER_SECRET` | Vercel Sensitive + Keychain `crm-politizai-production-serverless-worker-secret` | sim, server-side | autenticação do tick; kill switch permanece desligado |

## Regras

- nenhuma referência usa `NEXT_PUBLIC_*`;
- `DIRECT_URL` e owner não entram no ambiente web;
- staging e produção não compartilham valor, ID ou entrada Keychain;
- bootstrap não possui segredo ou identidade configurada; nenhuma identidade
  foi criada na PROD-12;
- o runner de migration recebeu `DIRECT_URL` apenas durante o processo e não a
  persistiu no projeto web;
- rotação deve criar novo valor no cofre, validar a implantação fechada e só
  então revogar o anterior;
- incidentes nunca devem copiar valor, cookie, Authorization ou URL de banco
  para logs, issues, chat ou documentação.
