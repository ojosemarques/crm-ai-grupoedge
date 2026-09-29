# Publicação futura — requisitos antes de produção

## Estado atual e limite

O Politizai CRM foi construído e validado como MVP local. Este documento é um
plano de preparação; não descreve um ambiente já publicado, não autoriza deploy
e não afirma prontidão para dados reais. O Compose, as credenciais de
demonstração, o rate limit em memória e o provider local de IA são adequados ao
desenvolvimento, não a produção.

A CRM-64 aprovou somente homologação local/isolada e manteve produção em
**NO-GO**. O gate vigente e seus blockers estão em
[`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) e
[`GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md).

Existe agora um ambiente remoto gratuito, destinado exclusivamente a construção
e demonstração com dados sintéticos. Ele usa Render Free, Neon Free e worker
local, não satisfaz os requisitos desta publicação futura e não autoriza dados
reais. Consulte [`FREE_STAGING_ENVIRONMENT.md`](./FREE_STAGING_ENVIRONMENT.md).

A PROD-03 adicionou somente preparação local: contrato de quatro ambientes,
preflight `prod03.1`, duas URLs PostgreSQL com papéis distintos, health/readiness
separados, CSP com nonce, headers condicionais, modelos de variáveis sem valores,
configuração Vercel para Node 22/pnpm 11/Webpack/`gru1` e bootstrap administrativo
CLI-only. Nenhum recurso remoto foi criado e nenhuma variável real foi definida.

## Topologia recomendada

Manter o monólito modular e o PostgreSQL como fonte única da verdade:

```text
proxy/TLS
   └── Next.js (processo web, múltiplas réplicas quando necessário)
            ├── PostgreSQL gerenciado
            └── worker do mesmo código, executado como processo separado
```

Não introduzir microserviços, Redis ou filas externas antes de medir uma
necessidade real. O worker pode continuar usando `Job`, locks, retry e
idempotência no PostgreSQL. Web e worker devem receber a mesma versão do código;
somente um release aprovado pode aplicar migrations.

## Configuração e segredos

- substituir todas as credenciais locais e nunca executar o seed demonstrativo;
- guardar `DATABASE_URL`, segredos de sessão e futuros tokens em um cofre de
  segredos, com rotação e acesso de menor privilégio;
- separar ambientes, bancos, contas e chaves de desenvolvimento, homologação e
  produção;
- validar `APP_TIME_ZONE` e manter banco, logs e jobs em UTC, exibindo o fuso do
  workspace;
- não habilitar provider externo de IA sem task própria, minimização de dados,
  contrato, avaliação, orçamento, opt-out e revisão jurídica;
- revisar logs e traces para garantir que senha, cookie, token, telefone,
  payload bruto e URL do banco não sejam exportados.

## Banco, migrations e recuperação

1. Usar PostgreSQL gerenciado com TLS, usuário da aplicação sem privilégios de
   administração, limites de conexão e monitoramento.
2. Ensaiar as 59 migrations atuais em uma cópia anonimizada e medir lock/duração.
3. Disponibilizar `DIRECT_URL` somente ao runner de migration e aplicar
   `pnpm db:migrate:deploy` uma única vez no release; nunca executar
   `prisma migrate dev` em produção.
4. Definir migrations compatíveis com implantação progressiva e rollback por
   release da aplicação; alterações destrutivas exigem etapas expand/contract.
5. Configurar backup criptografado, retenção, restauração ponto no tempo e teste
   periódico de restauração com RPO/RTO aprovados.
6. Formalizar retenção e descarte de payloads, mensagens, auditoria e dados
   pessoais sem apagar fatos que precisam permanecer por obrigação legítima.

## Segurança obrigatória

- revisão independente de autenticação, sessão, RBAC, escopo por equipe e
  isolamento por workspace;
- MFA ou SSO para administração, recuperação segura de acesso, política de
  senha e revogação/rotação de sessões;
- manter a CSP com nonce e retirar `style-src 'unsafe-inline'` após eliminar
  estilos inline legados; HSTS só depois de HTTPS confirmado; TLS moderno, proteção de borda,
  limites compartilhados por rota/tenant e defesa contra abuso;
- SAST, DAST, secret scanning, revisão de dependências, SBOM e assinatura dos
  artefatos do release;
- teste específico de CSV, webhook, prompt injection, IDOR, CSRF, XSS, SSRF,
  elevação de privilégio e vazamento entre workspaces;
- avaliação de privacidade/LGPD: finalidade, base legal, consentimento,
  não-contatar, direitos do titular, operadores, retenção e resposta a incidente;
- pentest antes de dados reais e após mudanças substanciais de autenticação ou
  integrações. As fundações locais de WhatsApp, e-mail e telefonia não autorizam
  egress; provider, número, PSTN, gravação e transcrição da telefonia continuam
  adiados.

## Operação e observabilidade

- logs estruturados centralizados com correlação, redaction testada e retenção;
- métricas de HTTP, pool do banco, filas, jobs, retries, dead-letter, SLA e erros;
- alertas acionáveis, dashboards operacionais, SLOs e responsáveis de plantão;
- health/readiness separados, desligamento gracioso do web/worker e política de
  concorrência compatível com múltiplas réplicas;
- runbooks para banco indisponível, migration incompleta, job preso, integração
  degradada, segredo exposto e incidente de segurança;
- teste de carga com volume, concorrência e distribuição esperados, incluindo
  análise de planos SQL e dimensionamento do pool.

## Homologação e aceite de release

Antes de cada publicação futura:

- criar ambiente de homologação isolado com configuração equivalente;
- executar lint, typecheck, unitários, integração, seed de teste, E2E, audit e
  build a partir do commit exato do release;
- validar visualmente os perfis Administrador, Gestor, SDR, Closer e Visualizador;
- ensaiar migration, backup/restauração, reinício de web/worker e rollback;
- verificar que dashboards e drilldowns reconciliam e que não há dados
  decorativos;
- confirmar que simulações continuam rotuladas e que integrações desabilitadas
  falham de forma segura;
- registrar aprovadores, evidências, riscos aceitos e plano de comunicação.

## Procedimento de publicação futura

Somente após todos os gates anteriores:

1. congelar e identificar o artefato versionado;
2. confirmar backup restaurável e janela de mudança;
3. aplicar migrations aprovadas;
4. iniciar web e worker com configuração do ambiente;
5. executar smoke tests de health, login, autorização, entrada, tarefa, worker e
   leitura de métricas sem usar dados reais desnecessários;
6. observar erros, filas e banco durante a janela definida;
7. interromper e reverter o release da aplicação se o gate falhar; restaurar o
   banco somente pelo runbook aprovado quando uma mudança de dados exigir;
8. registrar o resultado e encerrar a janela de mudança.

## Integrações ainda não homologadas externamente

Meta Ads e Google Ads possuem adapters read-only testados com fixtures;
WhatsApp, e-mail, telefonia, calendário e pagamentos possuem fundações locais
ou sandbox. Nenhuma delas foi homologada com provider real ou habilitada para
egress. Instagram, SMS, onboarding externo, SSO, BI e LLM externo permanecem
futuros. Cada ativação exige contrato de idempotência, escopo de permissão,
minimização, auditoria, retry, desligamento seguro e testes próprios. Registros
simulados não comprovam entrega, cobrança ou reconciliação externa.

## Decisão desta entrega

Nenhum deploy, publicação, alteração de banco remoto ou envio de dados a um
serviço externo foi realizado na PROD-03. Os arquivos de configuração são
somente preparação versionada e não comprovam infraestrutura homologada.
