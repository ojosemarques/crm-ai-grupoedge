# Inbox e atendimento unificado

Este documento registra o contrato funcional e a evidência executável da
Etapa 07 do roadmap. `Conversation` e `Message` continuam sendo a fonte
canônica do atendimento: os filtros, a transferência, as notas internas, o
contexto comercial e os estados de entrega projetam esses mesmos fatos, sem
criar uma segunda timeline.

## Contrato funcional

### Inbox, busca e contexto comercial

O inbox pesquisa contato, conta, assunto e conteúdo de mensagem. Os recortes
podem combinar canal, status, prioridade, setor/fila, atendente e presença de
negócio, além das visões operacionais de não lidas, SLA vencido, aguardando o
time e aguardando o contato.

A conversa conserva sua identidade por canal, participantes, ponto de contato
e thread externa. Correspondência desconhecida ou ambígua permanece na Fila
Geral com revisão explícita; o inbox não cria um lead para tornar a associação
conveniente. O painel contextual mostra os negócios possíveis do contato e
permite vincular a conversa a uma oportunidade existente. A edição de assunto
e prioridade altera o contexto da própria conversa. Nenhuma dessas ações muda
o responsável comercial do lead.

### Atendimento humano, setor e SLA

Cada conversa tem exatamente uma responsabilidade operacional: um atendente
ou uma fila. As filas representam os setores de Vendas, Especialista e
Customer Success e definem o SLA correspondente. Uma entrada do cliente
inicia ou reinicia o prazo; uma resposta humana autorizada encerra o relógio.
O vencimento usa o prazo persistido na conversa, de modo que filtros e detalhe
mostrem a mesma regra.

Assumir ou transferir exige permissão e revisão otimista. A transferência
registra responsável/fila anterior, responsável/fila novo, motivo, ator e
horário em `ConversationAssignmentHistory`. O histórico fica visível no
contexto da conversa, enquanto `Lead.ownerMemberId` permanece inalterado.

### Concorrência e envio

Responder exige que o operador seja o atendente atual e informe a revisão que
leu. O serviço serializa a tentativa por conversa, revalida posse e revisão
dentro da transação e só então cria `Message` e outbox. Se outra pessoa
assumir, transferir ou responder antes, a tentativa obsoleta recebe conflito e
nenhuma segunda mensagem é criada. A chave idempotente continua protegendo
replay da mesma operação.

### Notas, respostas rápidas e anexos

Notas internas são fatos append-only da timeline, assinados pelo ator, e não
são enviadas ao contato. Respostas rápidas reutilizam versões de
`MessageTemplate`; selecionar uma resposta preenche o compositor, e o envio
continua sujeito a posse, revisão, privacidade e política do canal.

Anexos permanecem referências opacas vinculadas à mensagem, com nome, tipo,
tamanho, hash, estado de verificação e metadados do provedor. O inbox não
expõe caminho interno nem transforma referência em download irrestrito.

### Uma história em três superfícies

Uma entrada ou saída cria uma única `Message`. A atividade comercial aponta
para esse `messageId`, e o card/negócio aponta para a mesma conversa e
oportunidade. Eventos de entrega são append-only em `MessageStatusEvent` e
podem chegar fora de ordem: o histórico preserva o fato recebido, enquanto o
estado projetado da mensagem só avança segundo a precedência definida.

Opt-out atualiza a preferência do lead e o ponto de contato, cancela saídas
pendentes e impede novos envios pelo mesmo serviço canônico.

## Matriz requisito → evidência

| Requisito da Etapa 07 | Estado | Evidência executável | Contrato persistido |
|---|---|---|---|
| Busca por contato, conta, assunto e conteúdo | **Concluído** | Integração consulta termo presente no corpo e encontra a conversa canônica | `Conversation` e `Message` |
| Filtros por estado, setor, atendente, prioridade, canal e negócio | **Concluído** | Integração exercita os parâmetros no servidor; UI expõe os mesmos recortes | consulta com RBAC e escopo |
| Estados e SLA por tipo de atendimento | **Concluído** | Entrada inicia o SLA configurado da fila e a visão de vencidos usa `slaDueAt` | `serviceType`, `slaTargetSeconds`, `slaDueAt` |
| Setor e transferência com contexto | **Concluído** | Handoff entre Vendas, Especialista e CS preserva conversa, mensagens e oportunidade | `Queue`, `ConversationAssignmentHistory` |
| Handoff não troca dono do lead | **Concluído** | Teste compara `Lead.ownerMemberId` antes e depois da transferência | responsabilidade comercial separada da operacional |
| Notas internas | **Concluído** | Integração cria nota assinada, retorna-a na timeline e confirma ausência de mensagem outbound/outbox | nota append-only ligada à conversa |
| Respostas rápidas | **Concluído** | Template versionado aparece nas opções e é aplicado no compositor antes do envio governado | `MessageTemplate` e `MessageTemplateVersion` |
| Edição contextual do negócio | **Concluído** | Serviço vincula uma oportunidade elegível e edita prioridade/assunto sob revisão otimista | `Conversation.opportunityId` e contexto local |
| Identidade e correspondência ambígua | **Concluído** | Endereço desconhecido segue para revisão e Fila Geral sem criação implícita de lead | `MessageIdentityReview` |
| Timeline e eventos fora de ordem | **Concluído** | Integração recebe callbacks fora de ordem, deduplica replay e conserva projeção monotônica | `MessageStatusEvent` append-only |
| Exclusão mútua de resposta humana | **Concluído** | Duas respostas partem da mesma revisão; apenas a primeira cria mensagem e a segunda recebe conflito | lock transacional, posse e `revision` |
| Opt-out | **Concluído** | Entrada de opt-out marca contato/lead, cancela outbox e bloqueia envio posterior | privacidade e supressão canônicas |
| Anexo seguro | **Concluído** | Integração e detalhe exercitam referência opaca e metadados sem caminho público | `AttachmentReference` |
| Conversa, card e atividade contam a mesma história | **Concluído** | Teste confirma uma mensagem, uma atividade com o mesmo `messageId` e a mesma oportunidade | relações canônicas entre conversa, mensagem, atividade e oportunidade |
| RBAC e isolamento de workspace | **Concluído** | Serviço filtra no servidor e rejeita leitura/comando fora do escopo | autorização por workspace, owner, equipe e origem |

## Cenário de aceite executado

1. Receber uma mensagem e resolver a identidade para o contato e negócio
   existentes.
2. Pesquisar pelo conteúdo e aplicar os recortes de canal, status, prioridade,
   setor, atendente e negócio.
3. Registrar uma nota interna e confirmar que ela aparece na timeline sem
   criar mensagem ou outbox.
4. Vincular a oportunidade e editar assunto/prioridade sob revisão otimista.
5. Transferir de Vendas para Especialista e depois para Customer Success,
   preservando a conversa e registrando todos os handoffs.
6. Confirmar que o responsável comercial do lead não mudou.
7. Tentar duas respostas a partir da mesma revisão e confirmar uma única
   `Message`/atividade/outbox.
8. Registrar anexo como referência opaca e validar sua projeção no detalhe.
9. Receber eventos de entrega fora de ordem e repetir callback sem regredir nem
   duplicar o estado projetado.
10. Receber opt-out, cancelar a saída pendente e bloquear novo envio.
11. Comparar conversa, atividade e oportunidade para confirmar a mesma
    identidade e cronologia.

## Evidência de validação

- `prisma validate`: schema válido;
- migration canônica `20260930130000_stage07_unified_inbox` aplicada junto à
  cadeia completa de 66 migrations em schema PostgreSQL limpo;
- migration Supabase `20260930140000_stage07_unified_inbox` replica o DDL da
  migration canônica no schema `crm`;
- teste dirigido final de `omnichannel-inbox.integration.test.ts`,
  `email.integration.test.ts` e `opportunities-sales.integration.test.ts`: 3
  arquivos e 26 testes aprovados;
- testes de contrato omnichannel: 5 testes aprovados;
- suíte unitária completa: 83 arquivos e 391 testes aprovados;
- TypeScript, ESLint completo, política do repositório e build de produção
  aprovados;
- `git diff --check` aprovado.

A migration remota e o deploy de produção são confirmados pelo gate de release
depois da integração na `main`.

## Fontes oficiais da Clint e adaptação Politizai

- [Caixa de entrada unificada](https://ajuda.clint.digital/pt-BR/articles/8156771-como-gerenciar-sua-caixa-de-entrada-do-whatsapp): centralização de WhatsApp e Instagram, busca por conteúdo, filtros, estados e histórico.
- [Transferência de atendente ou setor](https://ajuda.clint.digital/pt-BR/articles/8770221-como-transferir-a-conversa-de-atendente-ou-setor-no-atendimento-de-whatsapp): handoff manual, nota interna e preservação do histórico no mesmo dispositivo.
- [Notas internas](https://ajuda.clint.digital/pt-BR/articles/9072450-notas-no-whatsapp-ou-instagram-como-ter-anotacoes-nas-conversas): nota assinada, somente interna e sem edição posterior.
- [Respostas rápidas](https://ajuda.clint.digital/pt-BR/articles/8307097-como-adicionar-respostas-rapidas-no-atendimento): mensagens pré-definidas por canal e compartilhamento.
- [Setores de atendimento](https://ajuda.clint.digital/pt-BR/articles/8306932-como-configurar-os-setores-de-atendimento-no-whatsapp): separação operacional entre Comercial, Sucesso do Cliente e outras equipes.

SLA persistido por tipo, revisão otimista, posse exclusiva para responder e a
separação entre responsável operacional da conversa e dono comercial do lead
são decisões de governança da Politizai. Este documento não atribui essas
estruturas específicas à Clint.
