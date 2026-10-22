# 03 — Tasks executáveis

## Sequência e gates

Todas são seriais por compartilharem contratos. Cada gate exige teste direcionado, `git diff --check` e atualização de `04-state.md`/`06-validation.md`.

### T0 — Baseline e auditoria final

**Aceite:** branch/HEAD/dirty tree, versões, fontes, permissões e deploy registrados; nenhum código alterado antes das specs.

```text
Execute SOMENTE T0. Leia AGENTS.md e todas as specs tempo-real-crm. Revalide Git, package.json, CI, docs Next 16, shell, fatos, metas, membros, auth, Proxy e deploy. Preserve mudanças alheias. Registre evidência em 00-project.md, 04-state.md e 06-validation.md. Gate: todas as fontes e riscos nomeados.
```

### T1 — Domínio de períodos, métricas e ranking

**Aceite:** funções puras cobrem fronteiras, correções, contatos distintos, mensagens, ações e desempates.

```text
Execute SOMENTE T1. Crie contratos/funções puras em src/modules/realtime-dashboard/domain. Use CommercialMetricFact e helpers existentes; não crie nova fonte. Implemente Hoje, semana Mon–Sex, totais e ranking. Adicione unitários com sábado/domingo, fronteira, quantidade negativa, mensagens falhas ausentes e empate. Gate: testes direcionados verdes.
```

### T2 — Permissões e menu

**Aceite:** capabilities próprias no catálogo/default roles/migration; menu em Trabalho; acesso direto negado.

```text
Execute SOMENTE T2. Adicione realtime.read e realtime.share.manage; admin e gestor recebem WORKSPACE. Inclua TEMPO REAL no grupo Trabalho e rota protegida. Não use role como autorização backend. Teste catálogo, menu e guard. Gate: usuário sem capability não vê nem abre.
```

### T3 — Serviço autenticado

**Aceite:** snapshot usa workspace, fatos, membros, meta e qualidade reais; sem ID/PII no DTO.

```text
Execute SOMENTE T3. Implemente RealtimeDashboardService e GET /api/tempo-real com authn/authz workspace-scoped. Leia fatos apenas da semana/hoje, reuse qualidade canônica e meta OPPORTUNITIES_WON publicada. Retorne meta ausente como null. Teste tenant e autorização. Gate: comparação fixture a fixture.
```

### T4 — UI Geral para TV

**Aceite:** Hoje/Semana lado a lado, meta, freshness, estados vazios/parciais e 1366×768 sem perda crítica.

```text
Execute SOMENTE T4. Crie /tempo-real e UI escura 16:9 com cards grandes usando design system/CSS existente. Renderize status, timezone, períodos, totais e meta. Não adicione dependência. Teste render/semântica. Gate: QA visual 1920×1080 e 1366×768.
```

### T5 — Ranking, alternância e fullscreen

**Aceite:** top 3 + lista, exatamente dois slides, 60 s, manual reinicia, reduced motion e fullscreen.

```text
Execute SOMENTE T5. Implemente ranking neutro, paginação/compactação para muitos vendedores, alternância automática e manual, indicador de ciclo e Fullscreen API. Faça cleanup de timers e teste com relógio falso. Gate: 60/120 s comprovados.
```

### T6 — Lifecycle do link e migration

**Aceite:** 256 bits, hash only, uma linha/workspace, rotação/revogação atômicas e auditadas.

```text
Execute SOMENTE T6. Adicione RealtimeDashboardShare e migration aditiva. Gere token com randomBytes(32), persista SHA-256, use transação serializável/advisory lock, retorne plaintext uma vez. Implemente estado/ROTATE/REVOKE em /api/tempo-real com same-origin e capability manage. Teste concorrência, tenant, auditoria e ausência do token em DB/logs. Gate: migration desde zero e contratos verdes.
```

### T7 — Página/API pública e hardening

**Aceite:** `/tempo-real-publico#token`, Authorization bearer, 404 uniforme, no shell, no-store/no-referrer/noindex, rate limit e DTO mínimo.

```text
Execute SOMENTE T7. Libere apenas a página pública exata no shell/Proxy. Crie GET /api/public/tempo-real, valide bearer sem eco, aplique rate limit tokenHash+cliente e resolva somente share ativo. Adicione headers/metadata e testes de prefixo parecido, malformado, desconhecido, revogado e cross-workspace. Gate: payload sem IDs/PII e nenhuma API mutável pelo bearer.
```

### T8 — Polling, stale e resiliência

**Aceite:** 15 s, uma requisição por vez, backoff+jitter, aba oculta reduzida, última leitura preservada e recuperação.

```text
Execute SOMENTE T8. Implemente loop de polling abortável e estados freshness/stale/offline. Não use setInterval concorrente. Pausar/reduzir em aba oculta, exceto fullscreen TV. Teste falha, recuperação, unmount e visibilidade. Gate: sem overlap ou timer órfão.
```

### T9 — Integração, segurança e QA

**Aceite:** unitários, integração DB, RBAC, tenant, rate limit, migration, E2E e screenshots.

```text
Execute SOMENTE T9. Adicione integração em schema efêmero para share/fatos/metas/dois tenants; E2E autenticado e público sem dados reais. Rode testes adversariais, QA 1920×1080/1366×768 e diff review. Gate: nenhum P0/P1 e checks direcionados verdes.
```

### T10 — Observabilidade e runbooks

**Aceite:** logs seguros e documentação de divergência, comprometimento e rollback.

```text
Execute SOMENTE T10. Reuse correlation/error handler e auditoria; não registre leitura pública nem bearer. Finalize runbooks e orçamento de consulta em 12-observability-rollout-production.md. Gate: scanner sem segredo/debug.
```

### T11 — Main, migration e produção

**Aceite:** commits seletivos, CI/gates verdes, projeto/backup confirmados, migration aplicada antes do deploy e versão ativa verificada.

```text
Execute SOMENTE T11. Revalide autorização e dirty tree. Rode format/validate, migrations desde zero, lint, typecheck, testes, build e security scan. Faça staging seletivo sem trabalho alheio, commits coesos, push main. Confirme Supabase/Vercel, backup/rollback; aplique só a migration validada, reaplique grants de runtime quando necessário e publique pelo fluxo oficial. Gate: deploy Ready no SHA correto.
```

### T12 — Smoke, link final e encerramento

**Aceite:** health/readiness, auth, público, headers, polling, dois ciclos, revogação e fonte canônica confirmados.

```text
Execute SOMENTE T12. Faça smoke seguro no deployment: rota autenticada, token temporário, público sem sessão, payload mínimo, headers, invalid/revoked, pelo menos dois ciclos de slide e comparação de métricas. Revogue token temporário salvo pedido contrário. Atualize state/validation e entregue URL sem token persistido em docs/logs. Gate: aceite binário completo ou blockers verificáveis.
```

## Commits esperados

1. `docs: especifica painel tempo real`
2. `feat: adiciona painel tempo real seguro`
3. `test: valida painel tempo real ponta a ponta` (pode ser consolidado se o diff continuar coeso)

Não stagear arquivos de `marketing-forms` ou outras iniciativas, mesmo que coexistam no working tree.
