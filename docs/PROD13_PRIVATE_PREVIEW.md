# Prévia privada de staging — PROD-13.1

## Decisão

A prévia privada do CRM Politizai está disponível no **staging sintético** para
Matheus. Esta entrega não altera o `NO-GO` da PROD-13 para produção real, não
inicia a PROD-14 e não autoriza leads reais, abertura pública, domínio próprio,
worker 24×7 ou integrações externas.

## Endereço e proteção

- URL: <https://crm-politizai-staging.vercel.app/login?workspace=politizai-staging&email=mattheusmendon%40gmail.com>;
- projeto Vercel: `crm-politizai-staging` (`prj_Eyr41l0Vm8zTxxucQH8QNC2JNdCQ`);
- deployment validado: `dpl_GmS4pinkesgZTfvVYKwanHFXZNEz`;
- commit técnico publicado: `8128f6baa5a771270c5edf40bfc04e4f271e1118`;
- estado: `READY`, Next.js, Node.js 22 e Vercel Authentication em todos os
  deployments;
- conta Vercel autenticada: o e-mail da conta corresponde ao e-mail autorizado
  nesta tarefa;
- acesso anônimo continua bloqueado. Nenhuma proteção foi removida e nenhum
  link público de bypass foi criado.

## Identidade autorizada

- nome: `Matheus`;
- e-mail: `mattheusmendon@gmail.com`;
- workspace: `politizai-staging`;
- papel: `Administrador`, limitado ao workspace sintético de staging;
- estado: ativo;
- criação: serviço administrativo oficial, com prévia, confirmação e AuditLog
  `workspace.member.created`;
- isolamento: exatamente um vínculo de workspace, sem vínculo com produção.

A senha foi gerada localmente com entropia criptográfica e armazenada somente
no Chaves do macOS. O valor não foi incluído em Git, arquivos temporários,
documentação, resposta ou logs.

- service do Keychain: `crm-politizai-staging-mattheusmendon-gmail-admin-password`;
- account do Keychain: `mattheusmendon@gmail.com`.

O próprio usuário pode recuperar a senha localmente, quando estiver diante do
formulário de login, com:

```bash
security find-generic-password \
  -a 'mattheusmendon@gmail.com' \
  -s 'crm-politizai-staging-mattheusmendon-gmail-admin-password' \
  -w
```

O produto ainda não possui uma política técnica de troca obrigatória no
primeiro acesso; portanto, nenhuma promessa de rotação automática foi feita.

## Smoke autenticado

| Verificação | Resultado |
|---|---|
| Login da identidade autorizada | PASS — Administrador em `politizai-staging` |
| Dashboard `/` | PASS — HTTP 200 com conteúdo autenticado |
| Meu Dia `/meu-dia` | PASS — HTTP 200 com conteúdo autenticado |
| Leads `/leads` | PASS — HTTP 200 com conteúdo autenticado |
| Pipeline `/pipeline` | PASS — HTTP 200 com conteúdo autenticado |
| Administração `/administracao` | PASS — HTTP 200 com conteúdo autenticado |
| RBAC | PASS — administração visível e permitida no workspace de staging |
| AuditLog da criação | PASS — exatamente um registro correspondente |
| Liveness | PASS — HTTP 200 e `status=ok` |
| Readiness | PASS — HTTP 200, `ready=true` e banco `ok` |

As requisições de validação usaram o acesso autenticado da Vercel e uma sessão
do próprio CRM. Cookies, senhas, tokens, URLs de banco e IDs internos de sessão
não foram registrados.

## Estado dos dados e serviços

- banco: Neon Free exclusivo de staging, `politizai_staging/public`;
- dados: dataset de homologação já existente e claramente sintético;
- integrações externas habilitadas: `0`;
- jobs ativos (`PENDING`, `RETRYING` ou `RUNNING`): `0`;
- worker automático: desligado;
- cron, self-ping e processo persistente: ausentes;
- Meta, Google Ads, WhatsApp, e-mail, telefonia, calendário, pagamentos, IA
  externa e n8n: desabilitados;
- custo incremental desta tarefa: `R$ 0`;
- plano: Vercel Hobby e Neon Free, sem upgrade, compra ou cobrança.

## Limites preservados

- ambiente gratuito sem SLA produtivo;
- Neon Free com retenção limitada já documentada;
- sem worker automático 24×7;
- sem dado comercial real;
- sem domínio ou DNS;
- sem produção aberta;
- a PROD-13 permanece `NO-GO` para a PROD-14.

## Alterações efetuadas

A única mutação remota foi a criação auditada da identidade autorizada no banco
de staging. O projeto, deployment, banco, migrations, dataset, proteção Vercel,
produção fechada, worker e providers permaneceram inalterados.
