# 12 — Observabilidade, rollout e produção

## Sinais

- Latência/status por operação usando logging/correlation já existentes, sem token/path fragment.
- `generatedAt`, `freshnessAt`, quality e estado stale visíveis no cliente.
- AuditLog apenas para `realtime.share.rotated` e `realtime.share.revoked`, com revision e ação, sem hash/token.
- Rate limit usa namespace estável e subject hash; não auditar cada leitura.
- Consulta lenta e divergência aparecem nos mecanismos atuais de banco/métricas; não criar telemetry de alta cardinalidade.

## Runbooks

### Link comprometido

Autenticar como gestor autorizado → Revogar → confirmar 404 pública → gerar novo somente se necessário → distribuir por canal seguro → revisar audit. Não recuperar token antigo.

### Métrica divergente

Comparar período/timezone → consultar `CommercialMetricFact` pelos event types → verificar último backfill/reconciliation → conferir correções/quantities → não alterar UI para mascarar → executar reconciliação oficial com autorização separada.

### Rollback

1. Reverter deployment ao SHA anterior no Vercel.
2. Manter tabela aditiva: app antiga a ignora.
3. Se vazamento/defeito público, revogar shares antes do rollback.
4. Não dropar tabela durante incidente; schema rollback só em janela aprovada e após prova de ausência de dependência.

## Ordem de rollout

1. Congelar SHA e revisar diff/staging seletivo.
2. CI/local: migrations desde zero, lint, types, unit, integração, build, security scan.
3. Confirmar projeto Supabase/Vercel, região, schema, identities e backup/PITR/restore.
4. Aplicar migration com `DIRECT_URL`/migrator; verificar `prisma migrate status` e tabela/constraints.
5. Reaplicar `supabase/runtime-grants.sql` se a role runtime não obtiver acesso à nova tabela.
6. Deploy do mesmo SHA; confirmar Ready e alias.
7. Smoke health/ready/auth/RBAC.
8. Gerar token temporário em workspace autorizado, validar público/headers/polling/dois ciclos e revogar.
9. Comparar métricas com consulta canônica sem imprimir PII/token.

## Gates que impedem deploy

Falha de migration/cadeia, lint/type/test/build, RBAC/tenant, DTO público, token/revogação, rate limit, rollback, projeto/conta/ambiente, backup ou conflito com mudanças alheias.

## Verificação pós-deploy

- deployment Ready e SHA correto na fonte;
- migration list/status contém a versão nova;
- `/tempo-real` redireciona sem sessão e abre com capability;
- `/tempo-real-publico` abre sem shell; bearer válido 200, inválido/revogado 404;
- headers `no-store`, `no-referrer`, `noindex,nofollow`, `nosniff`;
- dois ciclos completos de 60 s;
- pelo menos três pollings sem overlap;
- audit de rotate/revoke sem segredo;
- token temporário revogado, salvo pedido expresso para preservar.

Publicar o software não remove o NO-GO histórico para dados reais/domínio/go-live; esses gates exigem responsáveis e aprovações externas registrados em `GO_LIVE_CHECKLIST.md`.
