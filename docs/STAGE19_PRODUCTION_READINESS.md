# Etapa 19 — prontidão produtiva e go-live

Data da verificação: 30 de setembro de 2026.

## Decisão

**NO-GO para declarar a etapa 19 concluída ou “100% pronta”.**

O release em produção está saudável e o worker programado está operacional. A
decisão continua bloqueada por requisitos que não podem ser derivados do código
nem aprovados implicitamente: MFA/recuperação, jurídico/DPO, PITR e restore do
projeto produtivo, segundo operador, plantão e alertas externos, pentest
independente, controle financeiro, homologação de providers/dados reais e
aprovações formais.

O manifesto executável é
[`STAGE19_GO_LIVE_EVIDENCE.json`](./STAGE19_GO_LIVE_EVIDENCE.json). Rode:

```bash
pnpm readiness:go-live -- --evidence=docs/STAGE19_GO_LIVE_EVIDENCE.json
```

O comando retorna código diferente de zero enquanto qualquer gate estiver
`BLOCKED`. Um manifesto ausente, inválido ou incompleto também resulta em
`NO_GO`; nenhuma ausência de evidência é convertida em aprovação.

## Produção verificada

| Item | Resultado | Evidência em 30/09/2026 |
|---|---|---|
| Git | PASS | `main` e `origin/main` em `1e5683760f17b9a4f4b9c48cc5f2de2293d2ec60` no início da verificação |
| Vercel | PASS | projeto `crm-ai-grupoedge`, deployment `dpl_7gExoY1VHH2d4drYUoKBfU7RFzTQ`, target `production`, status `Ready` |
| URL/TLS | PASS | `https://crm-ai-grupoedge.vercel.app`; HSTS, CSP sem `unsafe-inline`, frame deny, nosniff e demais headers presentes |
| Liveness | PASS | `/api/health` retornou HTTP 200 e `status=ok` |
| Readiness | PASS | `/api/ready` retornou HTTP 200, `ready=true` e `database=ok` |
| Banco | PASS técnico | Supabase remoto conciliado com 19 migrations, última `20260930380000` |
| Identidades | PARCIAL | 1 workspace, 8 usuários e 8 memberships; MFA/recuperação não homologados |
| Worker | PASS | cron executa a cada minuto, retornou `BATCH_IDLE`/200, chamada sem credencial retornou 401, backlog e falhas em zero |
| Segredos | PASS técnico | Vercel registra os segredos como `Secret`; valores não foram lidos nem registrados |
| Providers externos | BLOQUEADO | credenciais/configuração não equivalem a homologação; adapters permanecem desativados |

As consultas ao banco limitaram-se a contagens agregadas. Nenhum dado pessoal,
token, senha ou valor de variável foi incluído na evidência.

## Matriz de gates

| Gate | Estado | Para fechar |
|---|---|---|
| Identidade, MFA e recuperação | BLOCKED | implementar e homologar MFA/recovery no fluxo administrativo |
| Jurídico/DPO | BLOCKED | aprovar finalidade, base, retenção, avisos, DPA e direitos dos titulares |
| Backup/PITR/restore | BLOCKED | registrar política do Supabase, RPO/RTO e restore recente em destino isolado |
| Segundo operador | BLOCKED | nomear e homologar acesso, rotação, revogação e resposta a incidente |
| Observabilidade/on-call | BLOCKED | configurar monitor externo, retenção, alertas técnicos/financeiros e escala |
| Pentest independente | BLOCKED | anexar relatório e tratamento dos achados críticos/altos |
| Domínio produtivo | PASS | alias Vercel estável e TLS validados; domínio de marca continua decisão de produto |
| Worker | PASS | cron, autenticação, logs e fila validados no deployment atual |
| Custo | BLOCKED | definir orçamento, cotas, alertas e owner financeiro |
| Providers e dados reais | BLOCKED | homologar individualmente por escopo, quota, custo, revogação, webhook e reconciliação |
| Aprovações formais | BLOCKED | nomear aprovadores de negócio, segurança, privacidade e operações |

## Procedimento da próxima janela

1. Atualizar o manifesto somente com fonte verificável e responsável nomeado.
2. Executar `pnpm readiness:go-live`; prosseguir apenas com decisão `GO`.
3. Fixar SHA, deployment, migration e backup/restore usados na decisão.
4. Aplicar migration reversível uma vez e publicar web/worker da mesma versão.
5. Validar health, readiness, login/MFA, RBAC, jornada crítica e worker.
6. Observar erros, pool, filas, SLOs, cotas e custos durante a janela.
7. Reconciliar contagens e estados canônicos após a ativação.
8. Reverter a aplicação diante de falha; restaurar dados somente após diagnóstico
   e autorização específica.

## Rollback

Rollback web deve promover o deployment produtivo anterior. Migration não é
revertida por rollback de aplicação. Qualquer restauração deve ocorrer primeiro
em destino isolado, reconciliar schema e dados e manter worker/providers
pausados até a decisão do incident commander.
