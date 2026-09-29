# Relatório de homologação completa do staging — PROD-10

## Decisão executiva

**PROD-10 homologada para staging gratuito; PROD-11 permanece NO-GO até a
definição do worker operacional de produção.**

O web de staging, o banco, o release gate, as migrations, os fluxos funcionais,
o rollback da aplicação e a compatibilidade Chromium/Firefox/WebKit passaram.
O staging gratuito ainda não reproduz a topologia futura de produção: não
existe worker automático de um minuto ou processo persistente com reinício e
health externo. A correção dirigida fechou as demais lacunas com um endpoint
serverless remoto protegido, regressão do Pipeline, VoiceOver real, zoom real
de 200%, fault lab Neon isolado e responsáveis nominais. O worker fica
desabilitado por kill switch fora das janelas de homologação. Essa evidência
aprova o staging gratuito, mas não autoriza a PROD-11.

Nenhum recurso de produção foi criado ou alterado. Nenhuma integração externa
foi habilitada e nenhum dado real foi utilizado.

## Release candidate congelado

- branch: `main`;
- commit técnico homologado: `a642fd5a998e8a9ebdfac426613c6260dfbac35e`;
- commit técnico da correção: `0233cb05a98e75797d45980683a4054e2b502e14`;
- commit do kill switch serverless: `476b3e26b48a449aa4793537500ca74fe99ff6a9`;
- commit da regressão do Pipeline: `c5ad0b5c400b063f00ceab5cd7ba910e01537077`;
- CI do kill switch: [execução 35034243590](https://github.com/Menddon/crm-politizai/actions/runs/35034243590), concluída com sucesso;
- CI do Pipeline: [execução 35035561582](https://github.com/Menddon/crm-politizai/actions/runs/35035561582), concluída com sucesso;
- CI da correção: [execução 34919710724](https://github.com/Menddon/crm-politizai/actions/runs/34919710724), concluída com sucesso;
- CI: [execução 34916132608](https://github.com/Menddon/crm-politizai/actions/runs/34916132608), concluída com sucesso;
- deployment protegido: `dpl_Hysue6xdQ9rZueirmjxrijERKZxw`;
- deployment da correção: `dpl_EogTvhS9Dmh4gw9Q4hQtxdvGvfJf`, `READY`,
  readiness e login closer HTTP 200;
- projeto: `crm-politizai-staging`;
- região web: `gru1`;
- banco: Neon Free `crm-politizai-staging-db`, `politizai_staging/public`, AWS São Paulo;
- timezone funcional: `America/Sao_Paulo`.

O primeiro SHA avaliado foi `51bbbe0ede6ebee3b2d8121c4b6ad913e38d0c4b`.
O teste WebKit revelou que o servidor local compilado como produção marcava o
cookie como `Secure` mesmo em HTTP local. O código passou a usar o contrato do
ambiente/transporte: staging e produção continuam obrigatoriamente `Secure`, e
somente `APP_ENV=local` pode executar o servidor de teste HTTP. O candidato foi
então congelado novamente em `a642fd5` e todos os gates aplicáveis foram
reexecutados.

## Matriz de aceite

| Área | Resultado | Severidade | Evidência |
|---|---|---:|---|
| CI e gates do release | PASS | crítica | CI 34916132608: instalação congelada, scanner, Prisma, 60 migrations desde zero, lint, typecheck, 348 unitários, 51 integrações críticas, audit, build Webpack, smoke, SBOM e limpeza |
| Migrations desde zero | PASS | crítica | PostgreSQL 17 efêmero do CI recebeu as 60 migrations uma única vez; schema temporário descartado |
| Estado do banco de staging | PASS | crítica | `prisma migrate status` com migrator confirmou `politizai_staging/public`, host esperado em São Paulo, 60 migrations e schema atualizado |
| Liveness/readiness | PASS | crítica | `/api/health` 200 e `/api/ready` 200 com `database: ok`, sem detalhes sensíveis |
| Login, logout e sessão | PASS | crítica | login administrativo protegido 200; logout 200; sessão posterior 401; cookies e expiração cobertos por unitários/E2E |
| RBAC por URL e ação | PASS | alta | closer sintético criado por bootstrap idempotente e auditado; login remoto 200; agenda, oportunidades e forecast 200; administração redirecionada para `/acesso-negado`; senha somente no Chaves do macOS |
| Dashboard e drilldowns | PASS | alta | KPI mensal de leads = 2 e drilldown `kpi.leads` = 2 registros, mesmo período e timezone |
| Páginas obrigatórias | PASS | alta | remoto autenticado retornou 200 para as páginas obrigatórias; a regressão do Pipeline foi corrigida e Quadro/Lista/filtros/transições/RBAC foram exercitados |
| Worker funcional | PASS transitório | alta | homologador contra Neon concluiu job/run/attempt/effect, replay idempotente, backlog zero, shutdown gracioso e zero egress |
| Worker serverless remoto | PASS controlado | alta | endpoint protegido no mesmo SHA da web: 401 sem Bearer/incorreto, 400 query, 503 kill switch, um job sintético processado uma vez sob duas chamadas concorrentes e replay ocioso |
| Worker automático 24×7 | BLOCKED para produção | crítica | Vercel Hobby não oferece frequência de um minuto/processo persistente; endpoint permanece desabilitado fora das janelas de homologação |
| Chromium, Firefox e WebKit | PASS | alta | 9/9 cenários no build de produção, com admin, SDR, closer, viewer, rotas, sessão e mobile |
| Desktop e mobile | PASS com limite | média | Dashboard inspecionado visualmente em desktop; E2E em 390×844 confirmou conteúdo, foco e ausência de overflow horizontal |
| Acessibilidade automatizada/teclado | PASS | alta | foco inicial visível, controles visíveis nomeados e navegação por teclado cobertos no E2E |
| Leitor de tela real e zoom manual | PASS com recomendação | média | VoiceOver real no macOS e zoom real de 200% no Chrome; landmarks, foco, diálogo, status/alert e ausência de overflow verificados; rodada humana independente recomendada |
| Carga local proporcional | PASS local | média | 83.942 operações em 20 s, concorrência 8, zero erro, p95 3,12 ms, p99 4,89 ms, backlog 0→0 |
| Soak local proporcional | PASS local | média | 61.363 operações em 60 s, concorrência 4, zero erro, p95 7,86 ms, p99 14,06 ms, backlog 0→0 |
| Carga/soak no deployment remoto | PASS controlado | alta | burst read-only: 80/80 HTTP 200, concorrência 4, p95 2,150 s, p99 3,416 s; soak: 60/60 HTTP 200, concorrência 2, p95 1,778 s, p99 3,483 s; backlog permaneceu zero |
| Falha de banco, concorrência e recuperação | PASS local | alta | 4/4 integrações de resiliência e fault injection em schema efêmero; nenhum efeito duplicado |
| Falha remota isolada do banco | PASS | alta | branch Neon `prod10-fault-*` descartável: health 200, readiness 503 durante `NOLOGIN`, job permaneceu pendente; após recuperação readiness 200, execução única e replay ocioso; zero residual |
| Reinício/rollback do web | PASS | crítica | rollback remoto para `dpl_BQmT2vZkcQd1to6YRJAt3ErQWUyU`, health/login/drilldown com 2 registros, seguida de promoção de volta a `dpl_Hysue6xdQ9rZueirmjxrijERKZxw` |
| Restore isolado | PASS atual | alta | branch Neon `prod10-restore-20260914-2256` clonou 298 tabelas, 60 migrations, 4 membros, 2 leads, 6 atividades e fingerprint `f519eaca4fa123f9b56730051db8bab1`; reconciliação idêntica e branch temporária removida |
| Métricas e reconciliação | PASS | alta | KPI e drilldown remotos reconciliados; comparações, séries e denominadores retornaram do banco sem valores decorativos |
| Headers e segurança de borda | PASS no modo atual | alta | CSP sem `unsafe-inline`, HSTS, DENY framing, nosniff, referrer/permissions policy e correlation ID observados no deployment promovido |
| Logs e redaction | PASS amostral | alta | 14 eventos recentes: 12×200, 1×401, 1×403; zero correspondência de URL PostgreSQL, senha, cookie ou Authorization expostos |
| Integrações externas | PASS | crítica | Meta, Google, WhatsApp, e-mail, telefonia, calendário, pagamentos, IA externa e n8n permaneceram desabilitados |

## Comandos e resultados relevantes

- `gh workflow run "Release Gate" -f ref=<SHA>`: execução manual anterior do
  checkpoint `51bbbe0` aprovada;
- `pnpm lint`: aprovado;
- `pnpm typecheck`: aprovado após remover apenas cópias numeradas regeneráveis
  de `.next/types` criadas pelo toolchain;
- `pnpm test`: 75 arquivos, 348 testes aprovados;
- `pnpm test:integration -- <6 arquivos críticos>`: 6 arquivos, 51 testes,
  60 migrations desde zero e schema isolado removido;
- `pnpm test:e2e:cross-browser`: 9/9 em Chromium, Firefox e WebKit;
- `pnpm audit --audit-level=high`: nenhuma vulnerabilidade conhecida;
- `pnpm security:scan`: 980 arquivos rastreados aprovados;
- `pnpm build`: Next.js 16.3.4 com Webpack aprovado;
- `pnpm resilience:load` baseline local: aprovado;
- `pnpm resilience:load` soak local: aprovado;
- `pnpm test:resilience:integration`: 4/4;
- `pnpm resilience:restore`: dump local de 4.411.752 bytes, SHA-256
  `9ce0d5f2525843a28388db26f04d6c3387ea8f7d6a99ff8d8deee3427f522a03`,
  restauração isolada e contagens reconciliadas;
- `pnpm db:test:cleanup`: zero schema efêmero residual;
- `pnpm db:status` no staging: 60 migrations, banco atualizado;
- CI 34916132608: aprovado em 5 min 43 s;
- rollback e promoção Vercel: aprovados, com persistência dos dois leads de
  homologação.
- `pnpm db:staging:homologate`: closer sintético criado/reutilizado, RBAC próprio
  permitido, administração negada, replay idempotente e um único AuditLog;
- carga HTTP protegida e somente leitura: 140 respostas 200, zero erro;
- Neon CLI: restore atual em branch isolada reconciliado e recurso temporário
  removido, mantendo somente a branch principal;
- gates da correção: lint, typecheck, 75 arquivos/350 unitários, scanner de 984
  arquivos, audit sem vulnerabilidade conhecida e build Webpack aprovados.
- testes dirigidos finais: 14 testes da política/rota serverless e 9 integrações
  do motor/regressão idempotente do Pipeline aprovados;
- smoke remoto serverless: um `BATCH_COMPLETED`, uma chamada concorrente e um
  replay `BATCH_IDLE`, uma tentativa/um efeito, backlog zero e
  `externalEgress=false`;
- fault lab remoto: liveness 200 durante a falha, readiness 503→200, job
  pendente preservado e retomada idempotente; branch e papel temporários
  removidos;
- acessibilidade: VoiceOver real e zoom 200% em Dashboard, Meu Dia, Leads,
  filtros, Pipeline e diálogo.

## Defeitos e observações

1. **Corrigido:** cookie local do servidor de produção incompatível com WebKit.
   A correção não relaxa staging/produção.
2. **Toolchain:** `next typegen` encontrou cópias numeradas antigas em
   `.next/types`. Foram removidos somente esses artefatos regeneráveis e o gate
   passou; o fenômeno deve ser observado em futuras execuções locais.
3. **Avisos não bloqueantes:** o driver `pg` avisa que `client.query()`
   concorrente será removido no pg 9; duas navegações WebKit registraram stream
   encerrada antecipadamente sem falha funcional.
4. **Corrigido:** o homologador passou a exigir a senha sintética de closer por
   variável não versionada, não sobrescreve credencial existente e redige o
   diagnóstico de erro antes de exibi-lo.

## Ações obrigatórias antes da produção

1. Provisionar ou aprovar um runtime persistente/automático compatível com o
   ADR, com auto-restart, health/readiness e o mesmo commit do web.
2. Nomear substituto e on-call adicional; a concentração de owners em Matheus
   Mendonça é aceita somente para staging.
3. Obter as validações jurídica, DPO/privacidade e pentest aplicáveis.

As lacunas anteriores de closer, carga/soak remoto e restore atual foram
resolvidas em 14 de setembro de 2026 sem custo, dado real ou egress comercial.

PROD-11 permanece bloqueada exclusivamente por gates de produção. Produção,
domínio público, dados reais e providers externos continuam fora do escopo.
