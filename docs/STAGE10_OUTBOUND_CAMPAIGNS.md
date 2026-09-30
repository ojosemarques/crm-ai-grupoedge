# Etapa 10 — campanhas de comunicação em escala

## Escopo entregue

`OutboundCampaign` representa uma execução de comunicação e não reutiliza `AcquisitionCampaign`, que continua restrita a aquisição e mídia paga.

A configuração aceita WhatsApp, SMS, Flash e voz, segmento por IDs de lead, lista/CSV normalizada, origem, tags, ofertas e campos comerciais. Template, janela, fuso, agenda, limite, custo unitário e ações posteriores fazem parte da definição aprovada.

## Fluxo governado

1. `CREATE` cria o rascunho apenas em `LOCAL_SIMULATOR`.
2. `PREVIEW` resolve o segmento, avalia supressão e sobreposição, congela endereço, mensagem renderizada e status por destinatário, e grava um SHA-256 do conjunto completo.
3. `APPROVE` exige o hash visto pelo aprovador e registra motivo, custo, volume e ações posteriores.
4. `START` recalcula o hash, rejeita alteração e cria um `Job` idempotente por destinatário com `runAt` da agenda.
5. `PROCESS_NEXT` faz claim condicional do job, revalida opt-out, `doNotContact`, cadência/agente/campanha concorrente, respeita janela e registra tentativa e recibo.
6. `CANCEL` encerra destinatários e jobs ainda pendentes.

Ações de tag, tarefa, atribuição e criação de oportunidade usam marcadores/consultas idempotentes e só rodam após aceite do simulador.

## Segurança e privacidade

- Quatro permissões separam leitura, configuração, aprovação e execução.
- Consultas são sempre filtradas por `workspaceId`.
- O DTO mascara endereços e reduz listas/CSV a contagens; valores brutos não saem em `screen()`.
- Opt-out e `doNotContact` são reavaliados imediatamente antes de cada tentativa.
- Attempts têm constraint `externalEgress = false`.
- Nenhum fornecedor externo está autorizado. `EXTERNAL_AUTHORIZED` falha fechado.
- Tabelas Supabase não são acessíveis por `anon` ou `authenticated`.

## API

- `GET /api/campaigns?campaignId=<uuid>`: estado, público mascarado, métricas reconciliadas e gate de provedor.
- `POST /api/campaigns`: comandos `CREATE`, `PREVIEW`, `APPROVE`, `START`, `PROCESS_NEXT`, `CANCEL` e `RECORD_STATUS`.

## Limite externo

O código suporta os tipos de canal solicitados somente no simulador local. WhatsApp, SMS/Flash e voz permanecem `EXTERNAL_BLOCKED` até existirem fornecedor, finalidade, credenciais e homologação explicitamente autorizados.
