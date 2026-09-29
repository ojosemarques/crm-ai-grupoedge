# Observabilidade e segurança de borda do staging

## Estado e escopo

- **Task:** PROD-09;
- **Ambiente:** somente staging;
- **Web:** Vercel Hobby `crm-politizai-staging`, região `gru1`, com Vercel
  Authentication;
- **Banco:** Neon Free `politizai_staging/public`, endpoint pooled para o web;
- **Worker:** homologado de forma transitória na PROD-08, sem runtime remoto
  contínuo;
- **Providers comerciais e egress:** desabilitados;
- **Log drain, Redis, add-on e upgrade:** não criados.

Produção permanece em NO-GO. Esta entrega fortalece o staging gratuito, mas não
converte planos sem SLA em infraestrutura produtiva.

## Logs e correlação

O logger estruturado inclui em toda linha `appEnvironment`, `service`,
`processRole`, commit e deployment. O Proxy aceita apenas correlation IDs com
formato restrito ou gera UUID, encaminha `x-correlation-id` ao servidor e o
devolve na resposta. Erros controlados e erros não tratados do Next.js registram
o mesmo identificador sem expor mensagem interna.

A redaction central remove, em qualquer profundidade:

- senha, cookie, sessão, bearer, JWT, token, API key e chave privada;
- URL PostgreSQL, e-mail, telefone, documentos, nome, mensagem e payload;
- slug/ID do workspace, substituído por bucket determinístico `ws_*`.

Labels de métrica continuam em allowlist e possuem limite de tamanho e
cardinalidade. O worker usa um child logger com papel `worker`; nenhuma linha
inclui connection string ou credencial. Vercel Runtime Logs é o sink gratuito
disponível nesta fase. Não há retenção central, exportação ou log drain pago.

## Métricas e console

O console autorizado `/operacoes` combina fatos persistidos das últimas 24
horas e sinais agregados do PostgreSQL:

| Área | Fonte |
|---|---|
| disponibilidade, latência, 4xx/5xx | `TelemetryRecord` e Vercel Observability |
| pool | contagem agregada de `pg_stat_activity`, sem host ou SQL |
| jobs, tentativas, falha terminal | `Job` e `AutomationAttempt` |
| worker | última tentativa e backlog; backlog sem tentativa recente = parado |
| SLA | `LeadSlaCycle`, faixas até 60 s, 61–180 s, crítico e sem tentativa |
| falhas de login | `AuditLog`, agregado por ação |
| queries lentas | console Neon; o CRM não lê nem exibe texto SQL |
| custo e uso | consoles Vercel e Neon; revisão manual no plano gratuito |

Ausência de amostra permanece “Sem dados”; nunca vira zero fictício. O
PostgreSQL não expõe texto de query, hostname, versão ou credencial na UI.

## Alertas

As regras determinísticas são versionadas, deduplicadas por workspace/regra,
possuem cooldown, responsável funcional, evidência minimizada e timeline
append-only. A avaliação é manual/autorizada nesta fase e não envia mensagem
externa.

| Regra | Limiar staging | Severidade | Responsável | Runbook |
|---|---:|---|---|---|
| job atrasado | > 0 por 5 min | alta | Operações | `runbook-jobs` |
| outbox atrasada | > 0 por 5 min | alta | Integrações | `runbook-outbox` |
| automação falha | > 0 em 24 h | crítica | Revenue Ops | `runbook-automations` |
| falha terminal de job | > 0 | crítica | Operações | `runbook-jobs` |
| worker parado com backlog | > 0 | crítica | Operações | `runbook-worker` |
| erro de API | > 4 em 24 h | alta | Plataforma | `runbook-api` |
| falha de login | > 9 em 24 h | alta | Segurança | `runbook-auth` |
| SLA crítico | > 0 em 24 h | alta | Revenue Ops | `runbook-sla` |
| DSR vencida | > 0 | crítica | Privacidade | `runbook-dsr` |

O botão “Avaliar alertas” exige `operations.manage`. Reconhecer ou resolver não
apaga o fato; abrir incidente cria histórico próprio. O responsável humano
nominal e a escala on-call continuam bloqueadores antes de produção.

## Rate limit compartilhado

Staging e produção deixaram de depender do `Map` do processo. Endpoints
sensíveis usam a tabela `request_rate_limits` e um único `INSERT ... ON
CONFLICT ... RETURNING` atômico. A chave do cliente é SHA-256; IP, e-mail e
workspace não são armazenados em claro. Não existe fallback para memória em
ambiente remoto: falha do banco resulta em falha segura.

O papel `crm_politizai_runtime` recebeu apenas `SELECT`, `DELETE`, `INSERT` e as
colunas de `UPDATE` necessárias dessa tabela. Continua sem `CREATE` no banco ou
schema. Local/test mantêm o limitador em memória para isolamento dos testes.

A integração concorrente executou três consumos simultâneos por dois limiters
independentes com limite 2: dois foram aceitos, um negado e um único contador
persistiu. A limpeza removeu o registro sem resíduo.

## WAF e borda Vercel

As mitigações de sistema/DDoS estão ativas. Foram publicadas três regras
customizadas exclusivamente no projeto de staging, todas com ação **Log**:

1. autenticação (`/api/auth/`);
2. importações e webhooks (`/api/leads/imports`, `/api/webhooks/`);
3. integrações, pagamentos e operações (`/api/integrations/`, `/api/payments`,
   `/api/operations`).

O smoke protegido retornou liveness HTTP 200 e a rota de autenticação HTTP 405
para método não aceito, confirmando que o WAF não bloqueou tráfego legítimo. O
plano Hobby não inclui OWASP Managed Rules nem bypass avançado; Bot Protection
e Attack Mode permanecem desligados para não introduzir falso positivo. Qualquer
mudança de `Log` para `Deny`, `Challenge` ou rate limit na borda exige observar
tráfego, definir exceções e nova autorização.

## Headers e revisão de ameaças

- CSP de script e estilo usa nonce por request, sem `unsafe-inline`;
- atributos `style` são proibidos e os estilos dinâmicos do produto passaram a
  usar elementos nativos ou atributos com CSS versionado;
- HSTS é emitido somente sob URL canônica HTTPS;
- framing, MIME sniffing, referrer, permissions policy, isolamento de opener e
  recursos cross-origin estão restritos;
- CSRF usa validação de origem/fetch-site nos comandos autenticados;
- host/origem canônicos impedem host poisoning e redirect aberto arbitrário;
- payload JSON/CSV possui limite, parsing estrito, preview e escape de fórmulas;
- serviços de autorização verificam workspace/recurso no servidor, reduzindo
  IDOR; testes cross-workspace continuam obrigatórios;
- providers externos estão desligados, reduzindo superfície SSRF; URLs de
  integração não são aceitas como fetch genérico;
- React escapa conteúdo e HTML contratual passa por escape explícito; a CSP é
  defesa adicional, não substituto de validação.

Esta revisão não é pentest independente. OWASP gerenciado, DAST, teste de
invasão, on-call nominal e monitoramento externo continuam pendentes.

## Evidências da PROD-09

- preflight remoto: `READY_FOR_STAGING`;
- migration `20260914190000_prod09_shared_rate_limit`: aplicada uma vez;
- inventário após migration: 298 tabelas, 60 migrations, zero contador residual;
- runtime: DML do limitador aprovado; `CREATE` em banco/schema negado;
- unitários locais antes do fechamento: 347/347; CI do commit corrigido:
  348/348 em 75 arquivos;
- integrações críticas: 32/32, incluindo RBAC, CSV, worker e observabilidade;
- integração isolada da observabilidade: 7/7;
- WAF: 3 regras Log ativas e mitigação de sistema ativa;
- deployment homologado: `dpl_BQmT2vZkcQd1to6YRJAt3ErQWUyU`, commit
  `6c7ba3feae8112cebd1876141ab9559161c3ba14`, estado `READY` em `gru1`;
- CI: execução `34909533050`, com migrations desde zero, lint, typecheck,
  348 unitários, 51 integrações críticas, audit, build Webpack, smoke e SBOM;
- smoke remoto: liveness/readiness HTTP 200, login sintético HTTP 200,
  `/api/operations` HTTP 200, pool agregado e worker `IDLE` sem backlog;
- sonda deliberada de redaction: HTTP 401, zero ocorrência do e-mail/senha de
  teste e de URL PostgreSQL nos logs consultados; três entradas correlacionadas;
- alerta remoto: avaliação autorizada HTTP 200, um alerta visível e nenhum
  egress externo;
- nenhum dado real, provider comercial, Redis, log drain pago ou produção.

O primeiro smoke do console no commit `1aac57b` retornou
`REMOTE_DATABASE_BLOCKED`: o guard legado da CRM-62 aceitava apenas loopback.
O guard foi corrigido para aceitar banco remoto exclusivamente em staging ou
produção quando o contrato completo valida ambiente, host, banco, schema, TLS,
origens e adapters. Um alvo divergente continua rejeitado. O commit corrigido
passou lint, tipos, scan, build, integração isolada e validação remota.

O CI pode ser consultado em
<https://github.com/Menddon/crm-politizai/actions/runs/34909533050>.
