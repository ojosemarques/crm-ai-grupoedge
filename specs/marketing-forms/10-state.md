# Estado de execução

Atualizado em: 2026-10-22 (America/Sao_Paulo)

## Baseline

- Repositório: `/Users/uscloser/Documents/ChatGPT/CRM`.
- Branch solicitada: `main`; HEAD inicial e `origin/main`: `df7dd55657b53b7d2f224ce0572924ebb3269828`.
- Working tree inicial: cinco documentos não rastreados preexistentes em `docs/`; devem ser preservados e somente o prompt master foi usado como fonte.
- Stack confirmada: Next.js 16.3.8, React 19.3, TypeScript 6, Prisma 7.10, PostgreSQL.
- Referências: URL pública e 11 screenshots inspecionados; evidência detalhada em `00-audit-evidence.md`.

## Progresso

| Task | Estado | Evidência |
| --- | --- | --- |
| T0–T2 | concluídas | specs, navegação/proxy e schema versionado validados |
| T3–T8 | concluídas | serviços admin, builder, sete abas, referências CRM, estilo, publicação e runtime público |
| T9–T14 | concluídas | receipt/intake idempotente, atribuição, QR/UTM, respostas/CSV, estatísticas e Meta consentida via outbox |
| T15 | concluída | E2E funcional e smoke do build em 1440/1024/768/390, sem overflow ou violação CSP |
| T16 | concluída | migrations verificadas, commit `e562f73` na `main`, deployment Production `dpl_ETkNU5edwE77EBS4GETzYaVtb37N` Ready e smoke remoto aprovado |

Task atual: nenhuma; escopo concluído.

Última task concluída: T15 — Acessibilidade, responsividade e QA visual.

Próximo passo: operação normal e observação das métricas descritas em `13-rollout-operations.md`.

O Vercel não expõe a `DATABASE_URL` sensível e Production não possui `DIRECT_URL`. A identidade foi confirmada sem credenciais pelo projeto Supabase `CRM POLITIZAI`, banco `postgres`, schema `crm`, região `ca-central-1`, entidades e histórico de migrations do repositório. As duas migrations aditivas foram aplicadas pela API oficial do Supabase com `search_path` fixado em `crm`; a verificação confirmou tabelas, coluna obrigatória, FK composta e ausência de criação acidental em `public`.

## Arquivos alterados nesta fase

- `specs/marketing-forms/README.md`
- `specs/marketing-forms/00-audit-evidence.md` a `13-rollout-operations.md`

## Checks reais

- `git status --short --branch`: baseline confirmado; somente documentos preexistentes antes desta iniciativa.
- inventário Prisma/rotas/serviços/testes: registrado em `00-audit-evidence.md`.
- `test -s` nos 14 paths obrigatórios: sucesso.
- inventário de headings com `rg '^#{1,3} '`: todas as seções obrigatórias presentes.
- busca `TODO|TBD|FIXME|[preencher|placeholder`: nenhum marcador pendente; quatro ocorrências são instruções de validação.
- `wc -l specs/marketing-forms/*.md`: 1.524 linhas.
- `pnpm test -- src/proxy.test.ts src/components/layout/app-shell-routes.test.ts`: 177 arquivos/872 testes aprovados.
- ESLint direcionado T1: aprovado, sem saída.
- `pnpm typecheck`: aprovado.
- `pnpm db:generate`: aprovado após evolução do schema.
- `pnpm test:integration -- tests/integration/marketing-form-schema.integration.test.ts`: 111 migrations desde zero + 3 contratos aprovados; schema efêmero removido.
- `pnpm lint`: aprovado.
- `pnpm typecheck`: aprovado.
- `pnpm test`: 184 arquivos e 899 testes aprovados no estado final integrado da `main`.
- integração direcionada final: 113 migrations do zero; 2 arquivos e 10 testes aprovados.
- produção: duas migrations aplicadas pela API oficial do Supabase e verificadas no schema `crm`; nenhum objeto novo correspondente foi criado em `public`.
- `main`: commit de implementação `e562f73` enviado ao GitHub.
- Vercel Production: deployment `dpl_ETkNU5edwE77EBS4GETzYaVtb37N` construído do commit `e562f73` e marcado `Ready`.
- smoke remoto em `https://crm-ai-grupoedge.vercel.app`: health/readiness 200, banco `ok`, `/formularios` redireciona para login, API pública inexistente 404, página inexistente `noindex`, CSP nonce/headers presentes e nenhum erro/fatal/HTTP 5xx no deployment.
- `pnpm test:integration`: gate global falhou em casos preexistentes/concorrentes fora do módulo; o runner isolou e aprovou diversas suites; nenhuma falha de marketing forms.
- `pnpm build`: aprovado com `/formularios`, `/f/[slug]` e APIs no manifesto.
- `pnpm ci:smoke`: aprovado; `pnpm security:scan`: aprovado; `pnpm audit --prod`: sem vulnerabilidades conhecidas.
- Playwright no build de produção: heading correto, CTA `rgb(37, 99, 235)`, nonce presente, zero atributo `style`, zero erro CSP e zero overflow em 1440/1024/768/390.

## Decisões vigentes

- Agregado próprio de formulários, snapshot imutável por publicação.
- `LeadIntakeService` continua único caminho de materialização no CRM.
- Recibo público resolve idempotência e reconciliação sem criar uma segunda tabela de leads.
- Analytics usam fatos separados e sem PII.
- Slug público globalmente único no v1.
- Branding v1 usa URLs HTTPS validadas; upload fica fora do escopo.
- Runtime publicado começa dinâmico/no-store para pausa imediata.

## Próximo prompt exato

Nenhum prompt de continuação é necessário para o escopo atual. Manter observabilidade e operar formulários reais somente com conteúdo, consentimento e integrações homologados.
