# Política de entrada e duplicidade de leads

## Fronteira única

`LeadIntakeService.intake` é a única fronteira de escrita para uma nova entrada
de lead. Cadastro manual, CSV, webhook local e simulador adaptam seus dados para
o mesmo contrato e informam o canal tipado. Os contratos e limites desses
adaptadores estão em [`LEAD_ENTRY_CHANNELS.md`](./LEAD_ENTRY_CHANNELS.md).

O workspace e o ator nunca vêm do payload. Eles vêm de um
`AuthenticatedContext` validado no servidor ou de um `ServiceActorContext`
técnico previamente resolvido. Atores humanos precisam de `leads.write` no
escopo da Fila Geral; atores automáticos são novamente conferidos no banco.

O retorno é discriminado e nunca deixa o chamador inferir o resultado:

- `CREATED`: nova identidade e primeira submissão;
- `ATTACHED`: submissão ligada a uma identidade já existente;
- `REJECTED`: payload, telefone, referência, configuração ou idempotência
  inválida. Rejeições anteriores à persistência não criam registros parciais.

## Transação e concorrência

Cada entrada aceita ocorre em uma única transação PostgreSQL. Antes da leitura
de identidade, o serviço adquire advisory locks transacionais, em ordem estável,
para `(workspace, idempotencyKey)` e `(workspace, normalizedPhone)`. Assim, duas
entradas simultâneas do mesmo telefone resultam em um lead e duas submissões, e
duas execuções da mesma chave retornam o resultado já persistido.

A constraint única parcial de `Lead` continua sendo a última defesa contra duas
identidades ativas com o mesmo telefone no workspace. Um lock adicional por
workspace/fila serializa o cursor do round-robin. Uma falha depois da criação da
submissão reverte submissão, lead, cursor, atribuição, ciclo de SLA, tarefa,
alerta, histórico, revisão, notificação e auditoria.

## Normalização de telefone

- números brasileiros com DDD aceitam máscaras usuais, prefixo tronco `0`,
  prefixo de operadora `0XX` e país `55` explícito;
- a forma persistida é E.164, por exemplo `+5511987654321`;
- telefone brasileiro sem DDD é ambíguo e rejeitado;
- telefone internacional precisa começar por `+` ou `00` para não ser
  reinterpretado silenciosamente como brasileiro;
- letras e ramais no mesmo campo são rejeitados, não removidos.

## Identidade e atualização

Telefone normalizado é a chave de identidade somente dentro do workspace. E-mail
não provoca mesclagem automática. Soft delete permite que o telefone seja
reutilizado por uma nova identidade, preservando a anterior e seu histórico.

Essa regra continua definindo a deduplicação comercial do `Lead`. A CRM-33
introduz uma camada distinta: `Contact` representa a pessoa canônica e
`ContactPoint` representa seus meios de contato. Cada Lead novo recebe Contact
na mesma transação; Lead já existente reutiliza o vínculo canônico. O mesmo
telefone/e-mail não pode ser repetido ativamente dentro do mesmo Contact, mas
pode existir em Contacts diferentes. Nesse caso o sistema abre
`ContactIdentityReview` com fatos e fingerprint, sem unir pessoas, apagar Lead
ou substituir dado humano.

O vínculo `Lead.contactId` e o de cada submissão são aditivos. Os campos legados
permanecem disponíveis durante a migração e continuam sendo escritos junto com
a identidade nova. Resolver uma revisão como `KEEP_SEPARATE` exige
`contacts.review` e gera auditoria; merge não faz parte da CRM-33.

Na primeira conversão, o lead recebe os dados consolidados, entra na etapa aberta
inicial do pipeline padrão e, quando existe regra ativa, recebe score provisório
e faixa P1/P2/P3 calculados dos dados submetidos. A faixa informada pela
fronteira é apenas fallback técnico para workspace sem regra. O responsável é o próximo SDR elegível do
round-robin ou, na ausência de candidato, a Fila Geral explícita.

Uma nova submissão cria outro score provisório. Ele só substitui o vigente se o
vigente também for provisório; PACTO validado e override humano são preservados,
e o novo cálculo permanece como sinal histórico para revisão.

Em uma duplicidade, a política é deliberadamente não destrutiva:

| Dado | Regra automática |
|---|---|
| Nome, e-mail, cargo, organização, cidade, UF e orçamento consolidados | Nunca sobrescrever |
| Origem, campanha e criativo iniciais | Nunca sobrescrever |
| Última origem, campanha e criativo | Atualizar apenas se a submissão não for cronologicamente anterior à última |
| Interesse inicial | Nunca sobrescrever |
| Último interesse | Atualizar apenas pela submissão cronologicamente mais recente que o informe |
| Contador de conversões | Incrementar para cada nova chave idempotente aceita |
| Score | Criar novo score provisório pela regra ativa; só torná-lo vigente sobre outro provisório |
| Etapa | Preservar; uma nova submissão não promove nem rebaixa o pipeline |
| Prioridade e SLA | Usar a faixa calculada no novo ciclo; preservar ciclos históricos e prioridade humana vigente |
| Última atividade | Avançar de forma monotônica; nunca regredir por evento atrasado |

Toda diferença entre dado consolidado e submetido é registrada como campo tipado
em `LeadIdentityReview.divergenceFields`; os valores comparados ficam em
`evidence.facts`. A inferência se limita a “candidato por mesmo telefone” e deixa
explícito que nenhuma mesclagem automática ocorreu. Mesmo sem divergência textual,
a nova submissão abre revisão humana, marca o lead e notifica gestores ativos do
time responsável pela Fila Geral.

## Consentimento e não contatar

O estado é tipado como `UNKNOWN`, `CONSENTED`, `NOT_CONSENTED` ou
`DO_NOT_CONTACT`. A submissão preserva o estado efetivamente informado; ausência
permanece `null`, separada de uma negativa explícita.

`DO_NOT_CONTACT` é aderente: uma nova submissão com consentimento não o remove.
Qualquer mudança futura para sair desse estado exigirá uma ação humana explícita,
permissão própria e auditoria. Os demais estados podem avançar quando a própria
submissão traz informação explícita. A atribuição e o ciclo de SLA continuam
existindo para rastreabilidade, mas a tarefa `Ligar agora` nasce cancelada e
nenhuma tentativa de contato pode ser registrada.
O mesmo bloqueio é propagado ao `ContactPoint`; o dual write nunca transforma
um ponto bloqueado em contatável por causa de uma submissão posterior.

## Histórico e auditoria

Cada primeira entrada cria `StageHistory`; cada conversão cria uma atividade de
entrada e outra de atribuição na timeline. `LeadFormSubmission` preserva o
payload original e os snapshots tipados do formulário. `LeadAssignment` preserva
o responsável anterior e o novo. `AuditLog` registra ator, chave de requisição,
resultado e referências, sem duplicar o payload bruto.

O payload bruto pode conter dados pessoais e serve apenas como evidência. Política
de retenção, anonimização e exclusão por obrigação legal será definida em task
específica; não há descarte automático nesta entrega.
