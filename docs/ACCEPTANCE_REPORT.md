# Relatório de aceite — CRM-64

## Escopo e decisão

A CRM-64 consolidou evidências do programa CRM-32–64, adicionou um preflight
fail-closed e executou um smoke final proporcional. O resultado é
**READY_FOR_LOCAL_STAGING** e **NO-GO para produção**. Nenhum deploy, egress,
credencial externa ou banco remoto foi usado.

Baseline: `8fe89aee199bbffc982709ed112ab83aa147181d`, igual a `origin/main` no início.
O hash final fica registrado no Git e no relatório entregue ao usuário.

## Evidências reutilizadas

A task não repetiu indiscriminadamente todas as suítes históricas. Foram
reutilizados os checkpoints versionados de cada CRM e, em especial, o gate da
CRM-63: 290 unitários, quatro integrações próprias, 27 regressões críticas,
três E2E, restore reconciliado, smoke/baseline dentro do budget e zero schema
residual. Consulte `docs/EXECUTION_STATUS.md` e
`docs/RESILIENCE_CAPACITY.md` para comandos, limites e invariantes.

## Validação executada nesta task

| Comando/verificação | Resultado |
|---|---|
| `node --version` | `v22.23.1`, compatível com `>=22.12 <23` |
| `pnpm --version` | `11.14.0` |
| `pnpm readiness:preflight` | 10 checks `PASS`; `READY_FOR_LOCAL_STAGING` |
| `pnpm exec vitest run src/modules/readiness/domain/production-preflight.test.ts` | 11/11 aprovados |
| `pnpm lint` | aprovado, zero erro/warning |
| `pnpm typecheck` | aprovado após correção do parser de versão |
| `pnpm audit` | nenhuma vulnerabilidade conhecida |
| integração dirigida de `auth-rbac` e `operations-security-privacy` | 14/14 aprovados em schema efêmero |
| `pnpm test:e2e -- tests/e2e/crm64-acceptance.spec.ts` | 3/3 aprovados após correção de espera de loading |
| build incluído no runner E2E e `pnpm build` final | Next 16.3.4/webpack aprovado nas duas execuções |
| `pnpm db:status` | 59 migrations; `public` atualizado |
| `pnpm db:test:cleanup` | zero candidato; nenhuma alteração |

O primeiro `pnpm typecheck` falhou porque `RegExp.exec` não garantia ao
TypeScript a existência do grupo `minor`; a indexação foi convertida
explicitamente com `Number`. O primeiro E2E teve uma corrida entre o shell de
loading e a página, produzindo dois `h1`; o teste passou a aguardar o status de
loading desaparecer e então confirmou exatamente um título. Não houve defeito
de regra comercial ou alteração em dados de `public`.

## Banco e migrations

- container local: `politizai-crm-db-1`, PostgreSQL 17.10;
- banco/schema: `politizai_crm/public`;
- 59 migrations e 297 tabelas;
- 99 workspaces, 146 usuários, 146 memberships, 533 leads, 1.195 atividades,
  62 oportunidades e 3.327 AuditLogs;
- fingerprint de IDs de lead: `2c829e462f608b815ec33f26c783bcfb`;
- zero conexão de aplicação ativa no inventário e zero schema de teste residual;
- revisão de migrations: nenhum `DROP TABLE`, `TRUNCATE TABLE`, `DELETE FROM`
  ou `DROP COLUMN`; os `DROP` existentes alteram constraints/índices/triggers ou
  encerram tabelas temporárias `ON COMMIT DROP`.

## Segurança e configuração

A varredura analisou 930 arquivos rastreados. Dois achados heurísticos eram
URLs PostgreSQL fictícias em testes de rejeição, não segredos. `.env`, `.next`,
backups, cache, relatórios e chaves permanecem ignorados. Somente
`.env.example` é versionado, com valores locais explícitos e referências
externas vazias. O preflight não serializa valores e bloqueia produção, banco
remoto, override remoto, schema/banco inesperado, credencial externa conhecida,
adapter externo e nome sensível em `NEXT_PUBLIC_*`.

## Fluxos exercitados no smoke

- login de gestor e navegação por Home, Dashboard, Meu Dia, Leads, Pipeline,
  Agenda, Oportunidades e Operações/Resiliência;
- `/api/ready` com aplicação e banco prontos;
- visualizador redirecionado para acesso negado ao abrir Operações por URL;
- Home, Dashboard, Meu Dia e Leads em 390×844 sem overflow horizontal.

## Pendências e riscos

Os blockers para produção estão em `GO_LIVE_CHECKLIST.md`. Os principais são
jurídico/DPO, ambiente equivalente, secret manager, banco gerenciado/TLS/PITR,
rate limit e observabilidade distribuídos, SAST/DAST/pentest, multibrowser,
carga/soak/failover, operação/on-call e homologação de cada provider. CSP ainda
usa `unsafe-inline`; o aviso de concorrência do `pg` deve ser tratado antes de
pg 9. Nada disso foi mascarado como aprovado.

## Mudanças desta task

- contrato e CLI de preflight local;
- testes unitários do preflight e smoke E2E;
- documentação de prontidão, go-live e aceite;
- atualização dos checkpoints e índices documentais.

Não houve migration, backfill, seed em `public`, mudança de regra comercial,
deploy, conexão remota ou envio de dados.
