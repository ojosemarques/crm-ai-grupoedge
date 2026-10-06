# Prospecção Ativa + Open-Dot — operação, go-live e rollback

## Estado seguro inicial

A implantação cria o domínio, o workspace, a fila e os controles com dois kill
switches independentes:

- `releaseEnabled = false`: nenhum candidato do estoque vira Lead;
- `emailEgressEnabled = false`: nenhuma ordem pode ser reclamada para envio.

O estado esperado antes das dependências externas é
`READY_FOR_EMAIL_CONFIGURATION`. Não registrar aprovação de privacidade ou de
canário sem referência de evidência real.

## Fronteiras e identidades

O CRM é a fonte oficial de estado. O Open-Dot pesquisa ou executa uma ordem já
autorizada; não cria Lead, não escolhe vendedor, não altera pipeline e não cria
copy durante o envio.

Configure três clientes separados em `OPEN_DOT_CLIENTS_JSON`:

| cliente | ator técnico | escopos mínimos |
| --- | --- | --- |
| pesquisa | `open-dot-research` | `RESEARCH_WRITE`, `RESEARCH_READ` |
| auditoria | `open-dot-auditor` | `RESEARCH_READ`, `RESEARCH_REVIEW` |
| e-mail | `open-dot-email` | `EMAIL_CLAIM`, `EMAIL_RECEIPT`, `EMAIL_EVENT_WRITE` |

O JSON e os segredos ficam somente nas variáveis protegidas do runtime. A
rotação aceita `currentSecret` e, temporariamente, `previousSecret`. Remova o
segredo anterior depois que todos os clientes tiverem sido atualizados.

## Assinatura do conector

Cada chamada usa estes headers:

```text
X-Open-Dot-Client-Id: <clientId>
X-Open-Dot-Timestamp: <ISO-8601 com offset>
X-Open-Dot-Nonce: <16..160 caracteres base64url>
X-Open-Dot-Signature: sha256=<hex HMAC-SHA256>
Idempotency-Key: <chave única da operação>
Content-Type: application/json
```

O payload assinado é a concatenação, com `\n`, de:

```text
METHOD
/caminho/exato-sem-query
timestamp
nonce
sha256(bytes-do-corpo)
```

GET assina corpo vazio. O timestamp tolera cinco minutos. Nonce é uso único e
a chave idempotente só pode ser repetida com o mesmo endpoint e corpo. Nunca
inclua segredo em prompt, corpo, URL, log ou mensagem de erro.

## Endpoints permitidos

| método | endpoint | escopo |
| --- | --- | --- |
| POST | `/api/integrations/open-dot/v1/research-batches` | `RESEARCH_WRITE` |
| GET | `/api/integrations/open-dot/v1/research-batches/{id}` | `RESEARCH_READ` |
| PATCH | `/api/integrations/open-dot/v1/research-batches/{id}` | `RESEARCH_WRITE` |
| POST | `/api/integrations/open-dot/v1/candidates` | `RESEARCH_WRITE` |
| POST | `/api/integrations/open-dot/v1/candidates/{id}/review` | `RESEARCH_REVIEW` |
| POST | `/api/integrations/open-dot/v1/email-jobs/claim` | `EMAIL_CLAIM` |
| POST | `/api/integrations/open-dot/v1/email-jobs/{id}/revalidate` | `EMAIL_CLAIM` |
| POST | `/api/integrations/open-dot/v1/email-jobs/{id}/receipt` | `EMAIL_RECEIPT` |
| POST | `/api/integrations/open-dot/v1/email-events` | `EMAIL_EVENT_WRITE` |

O contrato de candidato é estrito. Propriedade desconhecida, município abaixo
de 30.000 habitantes, contato inválido, fonte ausente ou URL não pública são
rejeitados. `mandateStatus = INCONCLUSIVE` permanece em revisão e nunca vira
Lead automaticamente.

## Pré-flight de release

1. Aplicar migration em homologação e executar o bootstrap/foundation.
2. Confirmar exatamente um pipeline ativo chamado `Prospecção Ativa` e sete
   `stableKey` começando por `active-prospecting.`.
3. Confirmar Carlos, Jhon e Ede por `WorkspaceMember.id`; corrigir ausências na
   aba Configuração. O nome só é usado na reconciliação inicial.
4. Configurar capacidade, reserva e calendário útil.
5. Ingerir lote controlado, verificar fontes e manter egress desligado.
6. Executar o planejador e conferir que a projeção não excede o limite efetivo.
7. Habilitar somente `releaseEnabled`; observar D1, Meu Dia, pipeline e métricas.

Falha de release reverte toda a transação. O worker faz até três tentativas com
backoff e mantém o candidato fora do Lead quando não há capacidade ou vendedor.

## Gate de e-mail

O servidor recusa `emailEgressEnabled = true` enquanto faltar qualquer item:

- aprovação registrada de privacidade/compliance;
- aprovação registrada do canário;
- sete templates publicados e imutáveis;
- remetente mapeado por vendedor;
- `reply-to`, SPF, DKIM e DMARC verificados externamente;
- limite diário por remetente/vendedor;
- cliente Open-Dot com `EMAIL_CLAIM` e `EMAIL_RECEIPT`.

Ainda são insumos externos obrigatórios: sete assuntos/corpos/assinaturas,
contas remetentes, conexão Composio/provedor, mapeamento vendedor→conta,
limites, janela aprovada e evidências formais. Sem eles, não force o flag nem
altere o banco diretamente.

Fluxo do executor:

1. `claim` obtém lease e conteúdo renderizado;
2. imediatamente antes do provedor, `revalidate` confirma gate, destinatário,
   janela, dia útil, limite, supressão, ausência de reunião/resposta e lease;
3. o provedor usa `idempotencyKey` da ordem;
4. `receipt` grava `SENT`, falha transitória/retry ou
   `RECONCILIATION_REQUIRED`;
5. eventos de reply, auto-reply, bounce, complaint e unsubscribe retornam ao
   CRM. Eventos fora de ordem não regridem o estado.

Nunca marque `SENT` sem `providerMessageId`. Resultado desconhecido exige
reconciliação; não reenvie às cegas.

## Canário

1. Lote pequeno sem egress; reconciliar estoque, releases e capacidade.
2. Sink/local controlado para as sete versões.
3. Conta controlada externa, sem destinatário real.
4. Registrar relatório, contagens, discrepâncias e rollback.
5. Somente com autorização explícita e evidência registrada, executar amostra
   real mínima.

Critérios de parada: duplicidade, taxa anormal de bounce/complaint, qualquer
envio fora de janela, remetente sem autenticação, discrepância CRM/provedor,
capacidade excedida por nova liberação ou vazamento de PII/segredo.

## Pausa e recuperação

- Pausar pesquisa: revogar/remover o cliente de pesquisa ou retirar seus
  escopos; dados já persistidos permanecem auditáveis.
- Pausar release: desligar `releaseEnabled`; planejamentos ficam preservados e
  podem ser retomados sem duplicar.
- Pausar e-mail: desligar `emailEgressEnabled` e pausar os perfis externos. Jobs
  reclamados serão negados na revalidação.
- Revogar credencial: remover o cliente ou girar `currentSecret`; manter
  `previousSecret` apenas durante a janela controlada.
- Retomar: corrigir o gate, revisar jobs expirados/reconciliação, reativar o
  menor kill switch necessário e observar os alertas.

## Rollback

Prefira rollback operacional, não destrutivo:

1. desligar e-mail;
2. desligar releases;
3. revogar clientes Open-Dot;
4. pausar worker se houver invariante quebrada;
5. preservar receipts, fontes, histórico, jobs e auditoria;
6. corrigir por forward-fix e reprocessar somente itens idempotentes.

A migration é aditiva para as tabelas de staging/cadência/e-mail, mas também
normaliza o pipeline solicitado para sete etapas estáveis. Antes de produção,
gere backup e preview dos cards por etapa. Não execute `DROP`, `TRUNCATE` ou
remoção de histórico como rollback. Reverter o binário é seguro com os kill
switches desligados; remover schema requer janela e autorização próprias.

## Privacidade e retenção

Finalidade: contato institucional de agentes políticos em mandato, limitado a
prefeitos e vereadores de municípios elegíveis. Não coletar partido ou dado não
necessário. Registrar fonte, escopo do contato, data de observação e base legal
aprovada. Opt-out é imediato; `DO_NOT_CONTACT`, complaint e unsubscribe
suprimem novos e-mails e encerram a cadência. Retenção, balanceamento de
legítimo interesse e responsável devem ser aprovados pelo jurídico/DPO antes de
dado real ou egress.

## Verificação mínima pós-implantação

- migration aplicada e Prisma compatível;
- `/health` e worker saudáveis;
- sete etapas e transições presentes;
- replay do mesmo candidato não duplica;
- telefone institucional compartilhado mantém Leads distintos;
- duas instâncias não liberam o mesmo candidato;
- três tarefas D1 contam um político tocado;
- resposta/reunião/recusa/opt-out cancelam toda pendência fria;
- claim/revalidate/receipt e retry não duplicam envio;
- workspace mostra paginação, capacidade, alertas e dados sensíveis conforme
  permissão.
