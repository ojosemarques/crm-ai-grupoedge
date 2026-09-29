# Deployment web de staging

## Estado

- **Task:** PROD-07;
- **Status:** concluída e validada em 14 de setembro de 2026;
- **Aplicação:** `CRM Politizai — Staging`;
- **Projeto Vercel:** `crm-politizai-staging`;
- **URL canônica:** <https://crm-politizai-staging.vercel.app>;
- **Conta/team:** `mattheusmendon-5037s-projects`, plano Hobby;
- **Código homologado:** commit `afee0bdc9887e9b8d9cff7ab9d46d09f3982c3e1`;
- **Deployment homologado:** `dpl_EYqj4PBVS9jNPpvEfCFgPCJGcxay`;
- **Banco:** Neon Free de staging, `politizai_staging/public`, AWS São Paulo;
- **Produção, domínio público e providers externos:** não criados ou não habilitados;
  o worker foi homologado depois em modo transitório, sem runtime remoto.

O alvo `Production` mostrado pela Vercel significa somente o alias estável dentro
do projeto que é integralmente de **staging**. Não existe projeto Vercel de
produção do CRM nesta etapa.

## Isolamento e configuração

O projeto foi criado do zero e conectado ao repositório privado
`Menddon/crm-politizai`. Nenhum `.vercel`, project ID, token, variável ou segredo
do Opadillis foi copiado. O Opadillis foi inspecionado somente para confirmar a
organização e convenções operacionais; nenhum recurso dele foi alterado.

Configuração efetiva:

- framework Next.js;
- Node.js 22.x;
- pnpm 11 com lockfile congelado;
- build `pnpm build`, que usa Webpack no projeto;
- funções em `gru1`;
- integração GitHub na branch `main`;
- Git fork protection habilitada;
- Vercel Authentication em **All Deployments**;
- protected sourcemaps habilitado;
- nenhuma exceção de domínio ou link compartilhável criado;
- bypass temporário de automação removido depois da validação;
- nenhum domínio customizado conectado.

A máquina de build foi alocada pela Vercel em `iad1`; isso não muda a região
`gru1` das funções em runtime. A topologia gratuita ainda possui latência de rede
entre as funções Vercel e o Neon em São Paulo e não oferece SLA contratual.

## Variáveis e segredos

As variáveis foram limitadas ao target estável deste projeto de staging. Preview
não recebeu conexão de banco para evitar acesso remoto acidental. O inventário
inclui apenas o contrato exigido pelo preflight:

- ambiente, processo, URL canônica, hosts/origens confiáveis e timezone;
- logging e política de sessão/cookie;
- `DATABASE_URL` pooled como Secret;
- host, banco e schema esperados como configuração;
- flags de worker, adapters, seed, demo e bootstrap desabilitadas.

`DIRECT_URL` não existe no runtime web. Credenciais de provider, bootstrap,
produção ou Opadillis também não existem neste projeto. Valores sensíveis ficam
no cofre da Vercel ou no Keychain local e não foram gravados no Git, nos
documentos ou no relatório.

## Validação remota

O deployment foi produzido a partir do push do commit homologado e chegou ao
estado `READY`. As seguintes verificações foram executadas contra o alias
canônico protegido:

| Verificação | Resultado |
|---|---|
| acesso anônimo | HTTP 302 para Vercel Authentication; aplicação não exposta |
| liveness | HTTP 200 e `status=ok` |
| readiness | HTTP 200, `ready=true` e PostgreSQL `ok` |
| TLS | certificado verificado, HTTP/2 e HSTS presente |
| headers | CSP, HSTS, `X-Frame-Options: DENY` e `nosniff` presentes |
| login sintético | HTTP 200, Administrador no workspace `politizai-staging` |
| sessão | cookie `Secure`, `HttpOnly` e `SameSite=Lax` |
| RBAC | API administrativa permitida autenticada; sem sessão negada |
| páginas | Dashboard, Leads e Meu Dia retornaram conteúdo autenticado |
| lead controlado | criação HTTP 201 pelo serviço real, somente dado sintético |
| persistência | busca após novo deployment retornou exatamente o lead criado |
| logs | zero 5xx nas 25 entradas finais e nenhuma URL PostgreSQL, senha, token ou chave detectada |
| egress/provider | adapters desabilitados e nenhuma credencial externa configurada |

O readiness retornou `error` uma vez enquanto o Neon retomava o compute e voltou
a `ok` na repetição. O plano gratuito pode fazer scale-to-zero; essa ocorrência é
limitação esperada de staging e não deve ser interpretada como disponibilidade
de produção.

## Correção mínima durante a homologação

A primeira criação controlada confirmou rollback com erro de referência porque
o payload usou uma origem inexistente. Depois de usar a origem persistida, o
fluxo revelou que o dataset da PROD-06 não possuía ator `AUTOMATION`, necessário
às automações internas disparadas pela entrada web. Nenhum lead parcial foi
criado em qualquer falha.

O homologador de staging passou a preparar esse ator de forma idempotente e a
registrar a ação em `AuditLog`. A alteração não muda regra comercial, migration
ou dados de produção. Após executar novamente o homologador, a criação retornou
201 com responsável, tarefa e SLA, e o registro permaneceu após o redeploy.

## Limites e próximos gates

- plano Hobby e Neon Free não possuem SLA de produção;
- o acesso exige conta membro do team Vercel; não foi criado link público;
- a PROD-09 removeu `unsafe-inline` de scripts e estilos, adotou nonce por
  request e proibiu atributos de estilo;
- worker remoto contínuo continua ausente; a PROD-08 homologou o processo em
  janela transitória sem custo, conforme `STAGING_WORKER_REPORT.md`;
- observabilidade do aplicativo, rate limit PostgreSQL e WAF em modo Log foram
  homologados na PROD-09; runtime contínuo do worker e homologação ampla
  continuam para PROD-10;
- o serviço Render gratuito anterior foi preservado com auto-deploy desligado;
  ele não é o alvo canônico desta homologação;
- dados reais, custom domain, produção e providers externos seguem proibidos.

A homologação posterior do worker não alterou o deployment web nem suas
variáveis: o processo foi executado fora da Vercel, em uma janela transitória,
com a URL pooled restrita do Neon. Consulte `STAGING_WORKER_REPORT.md`.

## Reprodução segura

O acesso humano deve ocorrer pela URL canônica e pela Vercel Authentication. A
senha da identidade sintética permanece somente no Keychain, conforme
`FREE_STAGING_ENVIRONMENT.md`. Qualquer automação futura deve receber um segredo
temporário e revogável pelo cofre; nunca se deve enviar bypass por query string
ou registrá-lo em arquivo.
