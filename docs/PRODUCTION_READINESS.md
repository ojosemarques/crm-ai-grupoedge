# Prontidão para produção — decisão NO-GO da PROD-13

## Gate executivo atual

Em 16 de setembro de 2026, a PROD-12 aplicou as 60 migrations e publicou o SHA
`bf15b07920600da3283ac48598fe4985e032cddc` como release candidate **fechado**
no Vercel Hobby. Vercel Authentication continua obrigatória; não existe domínio
customizado, usuário do CRM, dado de negócio, worker ativo ou integração
externa. O relatório verificável está em
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md).

Produção continua **NO-GO para uso real e para a PROD-14**. A auditoria atual
está em [`PROD13_FINAL_GO_NO_GO.md`](./PROD13_FINAL_GO_NO_GO.md). O
Vercel Hobby não oferece processo persistente; os dois workers estão
desligados. O Neon Free oferece somente 6 horas de histórico e não permite
proteger a branch contra exclusão. A branch pré-migration foi preservada, e os
ensaios isolados de rollback de banco e aplicação foram removidos após o teste.

Evidências especializadas: [`PROD12_MIGRATION_REPORT.md`](./PROD12_MIGRATION_REPORT.md),
[`PROD12_DEPLOYMENT_REPORT.md`](./PROD12_DEPLOYMENT_REPORT.md),
[`PROD12_ROLLBACK_REPORT.md`](./PROD12_ROLLBACK_REPORT.md) e
[`PROD12_ACCEPTANCE_REPORT.md`](./PROD12_ACCEPTANCE_REPORT.md).

## Hardening preparado na PROD-03

A PROD-03 transformou o antigo gate exclusivamente local em um contrato
executável `prod03.1` para `local`, `test`, `staging` e `production`. Naquele
checkpoint ainda não havia deployment e a PROD-11 preparou o banco remoto
vazio; posteriormente, a PROD-12 publicou somente o release candidate fechado
descrito acima. A decisão de preflight é `READY_FOR_LOCAL`, `READY_FOR_STAGING`,
`READY_FOR_PRODUCTION` ou `BLOCKED`;
"ready" significa apenas que a configuração está coerente para o alvo, não que
o ambiente existe ou foi homologado.

- `DATABASE_URL` é o endpoint pooled do runtime; o papel isolado de migration
  exige `DIRECT_URL` distinta, com host, banco, schema e TLS esperados. Web,
  worker e bootstrap recusam a credencial direta para aplicar menor privilégio;
- local/test recusam host PostgreSQL não local, inclusive com o override legado;
- staging/produção exigem URL canônica HTTPS, allowlists de hosts/origens,
  cookie Secure/HttpOnly/SameSite, logs JSON e adapters explicitamente
  desativados;
- seed, credenciais e modo de dados demonstrativos são bloqueados em nuvem;
- `/api/health` é liveness sem dependências; `/api/ready` testa somente banco;
- CSP de páginas usa nonce por requisição e scripts sem `unsafe-inline`;
  estilos inline permanecem permitidos por compatibilidade documentada;
- HSTS só é emitido quando o ambiente remoto possui URL canônica HTTPS;
- o bootstrap administrativo é CLI-only, transacional, idempotente, auditado e
  consumível uma única vez. Nenhum usuário foi criado pela PROD-03.

Os modelos `.env.staging.example` e `.env.production.example` não contêm
valores. Os valores de produção ficam exclusivamente no Keychain/cofre e são
inventariados apenas pelo nome em `PRODUCTION_SECRETS_INVENTORY.md`.

## Decisão executiva

**PROD-12 concluída como release candidate gratuito, fechado e sem usuário.
PROD-13 concluída com NO-GO para dados reais, domínio e go-live.**

O banco remoto autorizado é exclusivamente `politizai_production/public`, no
projeto Neon `steep-credit-26086628`: 60 migrations, 298 tabelas, zero workspace,
usuário, lead ou auditoria e somente 11 linhas estruturais de permissões. O
deployment ativo `dpl_C18kCxoBVxc4pUgcvAcMLWgaTu6n` está protegido e executa o
SHA técnico aprovado. Isso não autoriza egress, domínio, bootstrap ou dados reais.

O preflight executável `prod03.1` valida ambiente, Node, banco, URL canônica,
sessão, origem, adapters e dados demo. Ele retorna apenas códigos e nomes de
variáveis, nunca valores:

```bash
pnpm readiness:preflight
pnpm exec tsx scripts/run-production-preflight.ts --target=staging
pnpm exec tsx scripts/run-production-preflight.ts --target=production
```

Qualquer blocker produz exit code não zero. Os alvos remotos só podem ficar
READY quando todas as expectativas forem informadas explicitamente; nenhum
fallback local é aceito.

## Matriz de rastreabilidade

| Área | Estado local | Evidência principal | Limite para produção |
|---|---|---|---|
| Fundação, build e configuração | Aprovada no RC fechado | preflight `READY_FOR_PRODUCTION`, CI `35138250850`, build Vercel Next 16.3.4 | artefato assinado e operação pública não homologados |
| Login, sessão, RBAC e workspace | Aprovada | CRM-03, CRM-30, integração `auth-rbac` e E2E CRM-64 | MFA/SSO, recuperação, pentest e revogação distribuída pendentes |
| Leads, identidade, contas e ownership | Aprovada | CRM-05–14 e CRM-33–35; testes e serviços canônicos | volume e operação com dados reais não homologados |
| SDR, closer, reuniões e oportunidades | Aprovada | CRM-10–16 e smoke E2E CRM-64 | pesquisa operacional com usuários e múltiplos browsers pendentes |
| Contratos, assinatura e ledger | Aprovada no modo local | CRM-48–49; snapshots e ledger append-only | assinatura, revisão jurídica e reconciliação contábil externas pendentes |
| Cobrança e pagamentos | Aprovada no sandbox local | CRM-50 | provider, meio de pagamento, fiscal, ERP e caixa real pendentes |
| Onboarding, CS, atendimento e Farmer | Aprovada | CRM-51–54 | canais e SLAs externos não homologados |
| Aquisição, campanhas e atribuição | Aprovada localmente | CRM-38–42, métricas com cobertura/proveniência | Meta/Google/geocoding reais e base legal pendentes |
| Métricas, metas e forecast | Aprovada localmente | CRM-55–58; fórmulas, snapshots e drilldowns | observabilidade e escala de ambiente equivalente pendentes |
| Automações, jobs, inbox e outbox | Aprovada localmente | CRM-21–23, CRM-37 e CRM-43 | múltiplas réplicas, filas externas e providers reais não homologados |
| WhatsApp, e-mail, telefonia e calendário | Aprovada somente em simulação | CRM-44–47 e `EXTERNAL_VALIDATIONS.md` | elegibilidade, contas, credenciais, webhooks e reconciliação reais pendentes |
| IA e n8n | Aprovada no modo governado local | CRM-59–60; mock determinístico, schemas e confirmação humana | provider/modelo/DPA/custo/egress e n8n externo pendentes |
| Qualidade, reconciliação e merge | Aprovada localmente | CRM-61; preview, decisão humana, ledger e rollback | varredura incremental acima de 2.000 itens pendente |
| Segurança, privacidade e auditoria | Aprovada localmente com ressalvas | CRM-24, CRM-36 e CRM-62; testes de redaction/RBAC | jurídico/DPO, secret manager, SAST/DAST, pentest e eliminação real pendentes |
| Observabilidade e resposta | Aprovada localmente | CRM-62; SLI/SLO, alertas e incidentes persistidos | logs/métricas centralizados, on-call e alerta externo pendentes |
| Backup, restore, concorrência e carga | Parcial no RC | branch pré-migration preservada e rollback isolado aprovado | retenção de 6h, sem branch protection, cópia off-site/failover e RPO/RTO produtivos pendentes |
| UX e acessibilidade | Aprovada no staging | DESIGN-01–07, Chromium/Firefox/WebKit, VoiceOver real e zoom 200% | pesquisa independente com operadores permanece recomendada |

## Integridade verificada

- cadeia de 59 migrations aplicada desde zero em schemas efêmeros;
- migration status de `public` atualizado;
- revisão textual sem `DROP TABLE`, `TRUNCATE TABLE`, `DELETE FROM` ou
  `DROP COLUMN` nas migrations versionadas;
- schema `public` preservado com 297 tabelas, 99 workspaces, 146 usuários, 146
  memberships, 533 leads, 1.195 atividades, 62 oportunidades e 3.327 logs;
- fingerprint dos IDs de lead `2c829e462f608b815ec33f26c783bcfb`;
- nenhum schema não sistêmico fora de `public` após os testes;
- arquivos `.env`, backups, relatórios, caches e clientes gerados continuam
  ignorados; a varredura versionada não encontrou credencial real publicável.

## Riscos aceitos somente para o ambiente local

- `style-src` ainda usa `unsafe-inline` por componentes legados com style props;
  scripts usam nonce. HSTS depende do terminador TLS e da URL canônica HTTPS;
- rate limit e telemetria vivem no processo local;
- somente Chromium foi exercitado neste gate;
- avisos do driver `pg` sobre consulta concorrente e do runner de cores não
  causaram falha, mas devem ser eliminados antes de elevar a versão do driver;
- credenciais de demonstração e seed fictício são proibidos em produção;
- nenhuma validação desta task mede latência de rede, banco gerenciado, CDN,
  provider, failover regional ou comportamento de usuários reais.

## Regra de promoção

Operação real permanece bloqueada até todos os itens obrigatórios de
[`GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md) terem responsável, evidência,
data e aprovação. A aprovação deve nomear commit, migrations, artefato, janela,
backup, rollback e aprovadores. O release candidate fechado não substitui a
auditoria PROD-13 nem a autorização posterior de go-live.
