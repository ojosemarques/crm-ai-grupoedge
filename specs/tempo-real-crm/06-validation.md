# 06 — Validação e evidências

## Matriz planejada

| Camada | Verificação | Gate |
|---|---|---|
| Domínio | Vitest de períodos, métricas, correções e ranking | 100% dos casos direcionados |
| RBAC | admin/gestor permitido; capability ausente negada | positivo + negativo |
| Tenant | ator/token A não lê ou muta B | teste integração |
| Migration | `prisma format/validate`, cadeia desde zero, contrato DB | exit 0 |
| API | malformed/unknown/revoked uniformes; DTO mínimo | testes de rota/integração |
| Cliente | 60/120 s, manual reset, polling/backoff/cleanup | relógio falso |
| Segurança | same-origin mutações, hash only, no-store/no-referrer/noindex, rate limit | abuso real |
| Qualidade | lint, typecheck, unitários, integração, build, scanner | exit 0 |
| Visual | 1920×1080 e 1366×768; desktop/tablet; reduced motion | screenshot + inspeção |
| Produção | migration, deployment SHA, health/ready, smoke e revogação | evidência na fonte |

## Comandos

```bash
pnpm exec prisma format
pnpm db:generate
pnpm exec prisma validate
pnpm exec vitest run <testes tempo-real>
pnpm test:integration -- tests/integration/realtime-dashboard.integration.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm security:scan
git diff --check
```

## Resultados reais

Ainda não executados após a implementação. Registrar comando, timestamp, exit code e contagens sem substituir falha por inferência.

## QA visual

Pendente. Capturar Geral e Ranking em 1920×1080 e 1366×768, estados live/stale/empty/revoked e `prefers-reduced-motion`.

## Go/no-go

`NO-GO` até T9 passar localmente e T11 confirmar alvo, migration, rollback, CI e deploy. Go-live com dados reais continua sujeito aos blockers externos do checklist de produção.
