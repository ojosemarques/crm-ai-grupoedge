# TEMPO REAL — índice executivo

## Resultado

Nova área autenticada `Trabalho → TEMPO REAL` e placar público somente leitura para TV. As duas visões, Geral e Ranking, usam fatos de `CommercialMetricFact`, respeitam o timezone do workspace, alternam a cada 60 segundos e atualizam por polling resiliente a cada 15 segundos.

## Mapa

- `00-project.md`: baseline, auditoria e fluxos observados/propostos.
- `01-spec.md`: requisitos e aceite binário.
- `02-design.md`: arquitetura e contratos escolhidos.
- `03-tasks.md`: T0–T12, dependências e prompts executáveis.
- `04-state.md`: checkpoint operacional da execução.
- `05-decisions.md`: ADRs e evidências.
- `06-validation.md`: matriz e resultados reais.
- `07-metrics-source-of-truth.md`: dicionário das métricas.
- `08-ranking-and-time-windows.md`: períodos, elegibilidade e ranking.
- `09-tv-dashboard-ux.md`: wireflow e experiência de TV.
- `10-public-sharing-security.md`: RBAC, bearer e threat model.
- `11-data-api-and-realtime.md`: schema, APIs, polling e concorrência.
- `12-observability-rollout-production.md`: rollout, produção e rollback.

## Arquitetura recomendada

Um módulo `realtime-dashboard` agrega diretamente os fatos canônicos e produz um DTO mínimo compartilhado pelas APIs autenticada e pública. A autorização autenticada usa capabilities específicas; o acesso público resolve somente o hash SHA-256 de um token aleatório de 256 bits. O token fica no fragmento da URL e é enviado no header `Authorization`, nunca em path/query. Uma única linha por workspace controla criação, rotação e revogação.

## Ordem

T0 baseline → T1 domínio → T2 permissões/menu → T3 serviço autenticado → T4 visão Geral → T5 ranking/timers → T6 compartilhamento/migration → T7 público/Proxy/headers/rate limit → T8 resiliência → T9 integração/segurança/QA → T10 observabilidade/runbooks → T11 main/migration/deploy → T12 smoke/encerramento.

## Dependências e bloqueios conhecidos

- A árvore começou suja em `main` no HEAD `df7dd55657b53b7d2f224ce0572924ebb3269828`, com trabalho alheio de formulários/marketing, inclusive em `prisma/schema.prisma`, `app-shell.tsx` e `proxy.ts`. Commits desta iniciativa devem usar staging seletivo.
- Produção revalidada: GitHub `ojosemarques/crm-ai-grupoedge`, Supabase `zbzztpzviyjxpprqcegs`, Vercel `grupo-edge-crm`, alias `https://crm-ai-grupoedge.vercel.app`. O nome antigo no documento geral não foi usado como fonte operacional.
- O documento histórico `docs/PRODUCTION_READINESS.md` registra blockers de go-live com dados reais. Esta entrega pode publicar o software, mas não autoriza importar dados reais, abrir domínio ou contornar gates externos.

## Gate entre specs e implementação

O pedido de 22/10/2026 autorizou expressamente executar todas as specs, alterar diretamente a `main`, criar commits, enviar ao remoto, aplicar migrations e publicar em produção. Portanto, o gate da Etapa 2 está satisfeito; a execução só para diante de risco sem rollback, credencial ausente, conflito material ou gate crítico vermelho.

## Como retomar

Leia `04-state.md`, confira `git status --short --branch`, valide o HEAD e execute exatamente a próxima task registrada. Nunca assuma que mudanças não rastreadas pertencem ao TEMPO REAL.
