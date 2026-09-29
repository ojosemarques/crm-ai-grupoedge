# Ambiente gratuito de construção e staging

## Estado

- **Status:** ativo e validado em 14 de setembro de 2026;
- **PROD-05 a PROD-08:** concluídas e validadas para o perfil gratuito de staging;
- **Finalidade:** desenvolvimento, demonstração e homologação sintética;
- **Custo configurado:** US$ 0/mês, sujeito às cotas gratuitas dos provedores;
- **Operação real:** proibida;
- **Dados reais:** proibidos;
- **Integrações externas:** desativadas;
- **Worker:** homologado em janela transitória local contra staging; desligado
  por padrão e sem runtime remoto 24x7.

Este ambiente é uma alternativa temporária e gratuita à topologia de produção
definida na PROD-02. As autorizações explícitas da PROD-05 à PROD-08 adotaram o
Neon como banco formal, a Vercel como web protegida e o processo local
transitório para homologar o worker, sem alterar o NO-GO de produção. O perfil
gratuito não oferece SLA, alta disponibilidade ou retenção adequados para
operação comercial real.

## Topologia implantada

| Componente | Recurso | Plano/região | Evidência não sensível |
|---|---|---|---|
| Código | GitHub privado `Menddon/crm-politizai` | privado | `main` e CI sincronizados |
| Web Next.js | Vercel `crm-politizai-staging` | Hobby, funções `gru1` | deployment protegido documentado em `STAGING_DEPLOYMENT.md` |
| Banco | Neon `crm-politizai-staging-db` | Free, AWS São Paulo | projeto `hidden-mode-30035631` |
| Web legado | Render `crm-politizai-staging` | Free, Virginia | preservado, auto-deploy desligado |
| Worker | processo local transitório contra Neon staging | desligado fora das janelas | PROD-08 homologada sem custo; runtime remoto diferido |

URL de acesso:

- <https://crm-politizai-staging.vercel.app>

O projeto Vercel é integralmente de staging, usa Node 22, pnpm 11, Webpack,
branch `main` e funções em `gru1`. Vercel Authentication protege todos os
deployments. O serviço Render anterior permanece somente como fallback legado,
sem auto-deploy, e não recebeu as alterações da PROD-07.

## Banco e privilégios

- banco dedicado `politizai_staging`, schema `public`;
- endpoint pooled com `sslmode=verify-full` e channel binding para o runtime;
- endpoint direto com a mesma proteção, reservado ao fluxo de migration;
- owner administrativo do provider, migrator e runtime separados;
- runtime com DML necessário, sem DDL administrativo;
- runtime limitado a 20 conexões no PostgreSQL, `statement_timeout=15s`,
  `lock_timeout=5s` e transação ociosa limitada a 30 segundos;
- migrator limitado a 5 conexões, sem limite artificial de duração da migration,
  `lock_timeout=10s` e transação ociosa limitada a 2 minutos;
- o cliente da aplicação mantém o pool conservador de 5 conexões por processo e
  timeout de conexão de 2 segundos;
- 59 migrations aplicadas, 297 tabelas e dataset exclusivamente sintético; a
  PROD-07 adicionou um lead de validação pelo serviço real e comprovou sua
  persistência após novo deployment; a PROD-08 adicionou somente um job/run
  sintético e auditável para o smoke do worker;
- nenhum dado do PostgreSQL local foi copiado;
- nenhum seed demonstrativo foi executado remotamente.

Os valores das conexões e da senha administrativa ficam no Chaves do macOS,
fora do repositório. Os nomes das entradas são:

- `crm-politizai-staging-neon-owner-url`;
- `crm-politizai-staging-neon-migrator-url`;
- `crm-politizai-staging-neon-runtime-url`;
- `crm-politizai-staging-admin-password`;
- `crm-politizai-staging-admin-bootstrap-key`.

A credencial runtime foi rotacionada antes do primeiro deploy válido. Nenhuma
URL ou senha deve ser copiada para documentação, issue, log ou commit.

O item local do owner foi corrigido para apontar explicitamente para
`politizai_staging`, em vez do banco padrão `neondb`. Os fingerprints não
sensíveis observados foram `ebdee5e1761fa75b` para owner,
`54d8479377a75fe3` para migrator e `04711a1fdab8d279` para runtime.

### Estado inicial e desvio temporal

Quando a PROD-05 foi retomada, o ambiente gratuito anterior já havia aplicado
as 59 migrations e criado a identidade administrativa sintética. Portanto, o
estado vazio inicial não podia mais ser observado diretamente sem destruir uma
estrutura válida. A retomada preservou o banco, registrou o inventário atual e
não executou migration, seed, backfill ou cópia de dados. A homologação formal
posterior foi concluída e está registrada em `STAGING_DATABASE_REPORT.md`.

## Backup, retenção e custo

- organização Neon: `CRM Politizai Free`;
- projeto: `crm-politizai-staging-db`, identificador não sensível
  `hidden-mode-30035631`;
- branch default: `production`, pertencente exclusivamente a este projeto de
  staging — o nome da branch não transforma o recurso em produção;
- região: AWS South America East 1, São Paulo;
- PostgreSQL 18;
- compute com autoscaling entre 0,25 e 2 CU e scale-to-zero do plano;
- histórico/restore contínuo disponível por 6 horas;
- snapshots manuais disponíveis; agendamento de snapshots exige upgrade e não
  foi contratado;
- cotas visíveis: 100 CU-horas por projeto/mês, 0,5 GB de armazenamento e 5 GB
  de transferência;
- custo contratado: US$ 0; não há autorização para upgrade ou cobrança.

O plano Free fornece painel de consumo, mas não o conjunto de alertas pagos
previsto na arquitetura definitiva. O limite financeiro atual é o próprio
plano gratuito: ao atingir cotas, o ambiente deve suspender ou aguardar a
renovação, nunca fazer upgrade automaticamente. A revisão do painel permanece
manual durante a construção.

## Acesso sintético

- workspace: `politizai-staging`;
- e-mail: `admin-staging@politizai.local`;
- nome: `Administrador de staging`;
- papel: `Administrador`.

Para consultar a senha localmente, sem enviá-la ao chat:

```bash
security find-generic-password \
  -a "$USER" \
  -s crm-politizai-staging-admin-password \
  -w
```

O bootstrap foi executado uma vez, com idempotência e auditoria, e está
desabilitado no runtime web.

A correção da PROD-10 adicionou uma identidade exclusivamente sintética de
closer (`closer-prod10@synthetic.politizai.local`) pelo homologador auditado. A
senha não consta neste documento nem no repositório; localmente, ela pode ser
consultada no Chaves do macOS pela entrada
`crm-politizai-staging-closer-password`. O closer possui escopo próprio e não
recebe privilégios administrativos.

## Configuração de segurança

- `APP_ENV=staging`, `NODE_ENV=production` e `PROCESS_ROLE=web` explícitos;
- URL canônica e allowlists limitadas ao domínio do serviço;
- cookies `Secure`, `HttpOnly` e `SameSite=Lax`;
- logs JSON;
- `DIRECT_URL` ausente do processo web;
- adapters externos desativados;
- seed, credenciais demo e bootstrap desativados;
- readiness consulta somente a dependência necessária;
- preview não recebe conexão de banco; o target estável do projeto é staging;
- Vercel Authentication protege todos os deployments e não há exceção pública.

O build canônico da Vercel usa:

```text
pnpm install --frozen-lockfile
pnpm build
```

O build usa Webpack pelo script do projeto. As funções ficam em `gru1`; a
máquina de build pode ser alocada pela Vercel em outra região.

## Evidências da validação

- preflight: `READY_FOR_STAGING`;
- conectividade owner, migrator e runtime: aprovada no banco
  `politizai_staging/public` sem revelar credenciais;
- TLS de transporte: ativo nos três perfis;
- runtime: DML efetivo nas 297 tabelas, sem `CREATE`, `TRUNCATE` ou `TRIGGER`;
- migrator: DDL somente no schema necessário, sem superuser, criação de banco,
  criação de papel, replicação ou bypass de RLS;
- limites e timeouts dos papéis: persistidos e validados após reciclar uma
  conexão pooled ociosa; readiness voltou a HTTP 200;
- inventário seguro: 1 workspace, 1 usuário, 0 equipes, 0 leads, 0 atividades,
  0 oportunidades, 2 logs de auditoria, 59 migrations e 297 tabelas;
- Backup & Restore do console: restore point-in-time disponível dentro da janela
  de 6 horas; nenhum restore foi executado nesta task;
- liveness: `GET /api/health` retornou HTTP 200;
- readiness: `GET /api/ready` retornou HTTP 200 e banco `ok`;
- login sintético: HTTP 200;
- sessão: cookie `Secure`, `HttpOnly` e `SameSite=Lax`;
- Dashboard autenticado: HTTP 200;
- worker local: iniciou com o ID `worker-staging-local-smoke`, permaneceu sem
  egress e foi encerrado manualmente após o smoke;
- worker PROD-08: o entrypoint real processou um job sintético no Neon uma vez,
  preservou um recibo, deixou backlog zero e encerrou por `SIGTERM`; evidência
  detalhada em `STAGING_WORKER_REPORT.md`;
- CI do commit `eb8c592400294fa0fc2af70729bc35edf002d198`: sucesso;
- deployment Vercel da PROD-07: estado `READY`, protegido e em `gru1`;
- criação de lead sintético: HTTP 201; busca após redeploy: 1 correspondência;
- acesso anônimo: redirecionado para Vercel Authentication;
- bypass temporário da validação: revogado;
- serviço Render legado: preservado com auto-deploy desligado;
- TLS/HSTS, CSP, proteção contra framing, MIME sniffing, referrer policy e
  permissions policy presentes.

## Limites do gratuito

- Vercel Hobby e Neon Free não possuem SLA de produção;
- o Neon Free possui cotas de compute, armazenamento e transferência e janela
  curta de histórico/restore;
- o Neon pode entrar em scale-to-zero; o primeiro readiness pode ser transitório;
- não existe worker remoto contínuo, alerta externo, WAF dedicado, log drain, PITR de
  produção ou restore drill de produção;
- `style-src 'unsafe-inline'` permanece como limitação conhecida da CSP;
- o rate limit distribuído e a observabilidade multi-instância continuam
  pendentes para produção.

Se uma cota gratuita for atingida, o ambiente deve parar ou aguardar a
renovação da cota. Não há autorização para upgrade ou cobrança automática.

## Próximo uso seguro

1. abrir a URL e autenticar com a identidade sintética;
2. usar somente dados fictícios;
3. iniciar o worker local apenas durante testes autorizados, conforme
   `STAGING_WORKER_REPORT.md`;
4. conferir as cotas na Vercel e no Neon;
5. manter integrações e egress desativados;
6. manter produção bloqueada; runtime persistente e tarefas posteriores exigem
   autorização explícita.
