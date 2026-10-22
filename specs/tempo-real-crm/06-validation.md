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

## Resultados reais — 2026-10-22

| Verificação | Resultado |
|---|---|
| Domínio/serviço/Proxy/menu direcionados | PASS; 20 testes no checkout limpo |
| Unitários completos no estado combinado da `main` | PASS; 184 arquivos, 899 testes |
| Integração de schema Tempo Real | PASS; 2 testes; cadeia de 113 migrations aplicada desde zero |
| E2E Chromium | PASS; 1 fluxo gestor → rotate → público → revoke |
| Prisma validate | PASS |
| Lint | PASS |
| Typecheck/Next typegen | PASS |
| Build Next 16 webpack | PASS; quatro rotas Tempo Real presentes |
| Scanner de política | PASS; 1.748 arquivos rastreados no gate final local |
| Audit de dependências | PASS no nível high após override `vite@8.2.4`; resta um high explicitamente ignorado pela política preexistente |
| Diff check | PASS |
| Checkout limpo do commit funcional | PASS; 179 arquivos/874 testes, lint, scanner e build |
| CI remoto final | PASS; run `39720622753` no SHA `909635c`; quality gate completo em 9m35s |
| Migration de produção | PASS; Supabase `20261022035416_realtime_dashboard_share` |
| Deployment final | PASS; `dpl_6F6wtXjWQo2EFfJPhKNCpMtuZSTM` `READY` e alias canônico ativo |
| Smoke produção | PASS; redirect, login, privado/público, headers, DTO, hash-only, audit e revogação |
| Ciclos/polling produção | PASS; slides 1→2→1 em 0/60/120 s; 8 requests; máximo concorrente 1 |

## QA visual

PASS. Capturas inspecionadas após estabilizar a animação: Geral e Ranking em 1920×1080, público em 1366×768. O E2E também valida ausência de shell público e estado revogado; reduced motion desativa a animação por CSS.

## Go/no-go

`GO` técnico concluído para o painel e seu deployment. O token temporário de validação foi revogado. Go-live com dados reais continua sujeito aos blockers externos do checklist de produção.
