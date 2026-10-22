# Matriz de validação

Este arquivo registra resultados reais. “Planejado” não equivale a execução.

## Gate por camada

| Camada | Verificação | Estado | Resultado/evidência |
| --- | --- | --- | --- |
| Specs | 14 arquivos obrigatórios | aprovado | `test -s` em README + 00–13; 1.524 linhas |
| Specs | links/placeholders/consistência | aprovado | headings inventariados; nenhum TODO/TBD/FIXME/campo a preencher |
| Prisma | generate + migration do zero | aprovado | 113 migrations aplicadas; 2 suites/10 testes direcionados aprovados em PostgreSQL efêmero |
| Domínio | lifecycle/version/idempotência/tenant | aprovado | unit + integração direcionada |
| UI admin | abas, estados, teclado, mobile | aprovado | E2E funcional + QA responsivo |
| Runtime | tipos, progresso, back, validação | aprovado | E2E + smoke do build |
| Intake | browser → API → DB → resposta | aprovado | fluxo E2E e serviço integrado |
| Analytics | fórmulas, versões, retries | aprovado | integração direcionada |
| Integrações | outbox/no-egress/redaction | aprovado localmente | Meta somente com finalidade/base/consentimento ativos; Google bloqueado |
| Segurança | auth/tenant/abuse/XSS/SSRF/redirect/CSV | aprovado no escopo | testes negativos, CSP e gates de capability |
| Repositório | lint/typecheck/test/build/smoke/scan/audit | aprovado com ressalva documentada | 184 arquivos/899 testes; integração direcionada 10/10; integração global tem falhas preexistentes fora do módulo |
| Produção | target/migration/deploy/smoke/logs | aprovado | migrations no schema `crm`; deployment Production Ready; smoke e logs sem 5xx/erro/fatal |

## Casos obrigatórios

### Lifecycle e concorrência

- create → draft → publish → edit draft → nova publish.
- versão anterior permanece byte/hash equivalente.
- revision desatualizada retorna conflito sem overwrite.
- paused/archived/draft retornam 404 pública.

### Tipos e runtime

- short, long, email, phone, number, date, single, multiple, dropdown, checkbox e thank-you.
- obrigatório/limites/opções; Enter/Tab/Escape quando aplicável; back preserva estado.
- reduced motion, foco, leitor de tela, contraste e viewports 360×800 e 1440×900.

### Submit/intake

- sucesso cria receipt + uma submission/contact/lead conforme dedupe canônico.
- retry concorrente/serial retorna o mesmo resultado.
- falha antes e depois do intake reconcilia sem duplicar rotação/conversão.
- pipeline/stage/source/tag/queue válidos e cross-tenant rejeitados.

### Segurança e privacidade

- anonymous somente definition/events/submit públicos.
- admin sem capability e workspace divergente: 403/404 seguro.
- malformed, oversized, honeypot, min-time, rate-limit/replay.
- XSS em título/opção/resposta; SSRF e esquema inválido em assets; open redirect.
- CSV formula injection; logs/outbox/respostas públicas sem PII/secrets indevidos.
- nenhum egress provider em testes.

### Métricas

- view/start/complete únicos e versão explícita.
- conversão = completos/inícios no mesmo filtro; abandono não mistura sessão com lead.
- distribuições apenas estruturadas, com denominadores e unknown explícitos.

## Comandos previstos

Começar pelo teste direcionado. Gate final, conforme scripts reais do `package.json` e CI:

```bash
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm ci:smoke
pnpm security:scan
```

Os comandos de migration-from-zero e E2E serão registrados com o nome exato descoberto antes da execução. Banco remoto não será usado como suíte genérica.

## QA visual

Referências 01–11 e URL registradas em `00-audit-evidence.md`. Evidência a coletar em T15:

- índice/editor e sete abas em desktop;
- dialog de resposta em desktop/mobile;
- formulário público do início ao thank-you em desktop/mobile;
- teclado e `prefers-reduced-motion`;
- diferenças intencionais: sem badge de terceiros e sem cópia de identidade proprietária externa.

## Performance

- definição pública sem payload administrativo e com limite de tamanho;
- eventos batched e rate-limited;
- queries de respostas/estatísticas paginadas/indexadas;
- observar bundle/client boundaries, latência p95 local e plano de query quando necessário.

## Go/no-go

Estado atual: **GO operacional**. O módulo foi aprovado localmente, as duas migrations foram aplicadas e verificadas no schema `crm` de produção, o commit `e562f73` está na `main` e o deployment Production `dpl_ETkNU5edwE77EBS4GETzYaVtb37N` está `Ready`.

Smoke remoto aprovado no domínio canônico: health/readiness 200 com banco `ok`; área administrativa protegida por login; API pública inexistente 404; página pública inexistente com `noindex`; CSP/headers presentes; consultas pós-deploy sem erro/fatal de runtime ou HTTP 5xx.
