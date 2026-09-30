# Etapa 09 — canais, agenda e reunião

## Estado comprovado

A Etapa 09 preserva uma distinção explícita entre fluxo local e homologação
externa. E-mail, telefonia, calendário, videoconferência e Instagram retornam
`externalEgress=false`, `externalValidation=false` e `homologated=false` no
contrato agregado `GET /api/integrations/channels`. Não há credenciais Google,
Microsoft, Meta, telefonia ou videoconferência no runtime.

O endpoint agrega contagens persistidas de entrada, saída, erro e resposta.
Essas contagens são evidência de fixtures locais e nunca representam entrega
ou recebimento por provider externo.

## Instagram

`GET /api/integrations/instagram` expõe decisão, readiness e métricas locais.
`POST /api/integrations/instagram` aceita somente `SIMULATE_INBOUND` para os
tipos `DIRECT`, `COMMENT`, `MENTION` e `STORY_REPLY`. Comentário, menção e
resposta a story exigem referência opaca da publicação. Todos entram em
`Conversation`/`Message` com canal `INSTAGRAM_MESSAGING`, idempotência e revisão
de identidade. Handle do Instagram nunca é comparado com `ContactPoint` de
telefone.

Conta Meta, app, permissões, webhook e o alcance real do agente da Clint no
Instagram continuam bloqueados por dependência externa. O contrato retorna
`agentCapability=NOT_VALIDATED`.

## E-mail, telefonia e calendário

As fundações locais existentes continuam canônicas:

- e-mail cobre inbound, outbound, reply, bounce, complaint, descadastro e
  threading no sink local;
- telefonia cobre chamada inbound/outbound, status, falha, cancelamento e
  disposição, com gravação e transcrição desativadas;
- calendário cobre criação, atualização, remarcação, cancelamento, conflito e
  replay no sandbox local.

Mensagens e chamadas expõem a oportunidade relacionada quando ela existe. A
timeline guarda referência ao fato canônico e descrição operacional; o corpo
da mensagem permanece somente em `Message`, sem cópia na `Activity`.

## Reunião, oportunidade e próxima ação

Ao agendar, uma única oportunidade aberta do lead é ligada automaticamente.
Quando há mais de uma, a API exige seleção explícita por `opportunityId`. A
reunião, tarefa e atividade recebem o mesmo vínculo, e a próxima ação é
projetada na oportunidade. Remarcação atualiza a tarefa da reunião e republica
os lembretes com a nova revisão.

## Transcrição e resumo

O registro local usa `MeetingTranscriptArtifact` e exige:

- permissão `meetings.transcripts.manage`;
- `consentConfirmed=true` e evidência textual;
- política literal `meeting-transcript-policy/v1`;
- instante de consentimento não futuro;
- retenção aprovada com término futuro.

A leitura exige `meetings.transcripts.read`, gera `AuditLog` e omite conteúdo
para usuário sem a permissão. Depois de `retentionUntil`, o conteúdo também é
omitido. O artefato não implica gravação, transcrição automática ou provider
de videoconferência; a resposta de criação registra `externalRecording=false`.
