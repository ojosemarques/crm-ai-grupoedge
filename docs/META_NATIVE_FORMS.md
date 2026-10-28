# Formulários nativos da Meta

Marketing → Formulários → **Forms Nativo** mostra o catálogo de Instant Forms da Página, entradas de hoje, total importado e pendências. As respostas de qualificação também aparecem no histórico e nas telas de leads que já exibem respostas de formulários.

## Conexão e credenciais

A conexão usa `META_LEAD_ADS`, separada dos relatórios `meta-ads`. Precisa de Page Access Token; um token de usuário do sistema sem a delegação da Página não permite listar `leadgen_forms`. A Meta exigiu `leads_retrieval`, `pages_manage_metadata`, `pages_read_engagement` e `pages_manage_ads` para os endpoints utilizados. O código não cria ou altera campanhas/anúncios.

Armazenar no cofre do ambiente de produção:

- `META_ADS_NATIVE_ACCESS_TOKEN`: token delegado da Página.
- `META_ADS_NATIVE_APP_SECRET`: chave do app que assina o webhook.
- `META_ADS_NATIVE_VERIFY_TOKEN`: valor aleatório exclusivo para o challenge.
- `META_ADS_NATIVE_WORKSPACE_ID`, `META_ADS_NATIVE_PAGE_ID`, `META_ADS_NATIVE_BUSINESS_ID`: vínculo obrigatório da credencial com o destino. Outro workspace não pode reutilizar essas referências.

O cadastro autenticado usa `POST /api/acquisition/connections`, com permissões de gerenciamento de integrações e segredos. Exemplo de configuração sem valores secretos:

```json
{
  "key": "meta-native-leads",
  "displayName": "Meta Ads · Forms Nativo",
  "provider": "META_LEAD_ADS",
  "sourceKey": "meta-native-leads",
  "secretReferenceKey": "META_ADS_NATIVE_APP_SECRET",
  "verificationTokenReferenceKey": "META_ADS_NATIVE_VERIFY_TOKEN",
  "enrichmentTokenReferenceKey": "META_ADS_NATIVE_ACCESS_TOKEN",
  "mapping": { "fullName": "fields.full_name", "phone": "fields.phone_number", "email": "fields.email" },
  "metaNative": {
    "pageId": "PAGE_ID",
    "businessId": "BUSINESS_ID",
    "pipelineId": "UUID_DA_FRENTE_ANUNCIOS",
    "initialStageId": "UUID_DA_ETAPA_NOVO_LEAD",
    "importFrom": "2026-10-28T03:00:00.000Z",
    "fieldMapping": { "jobTitle": "qual_o_seu_cargo_atual?" }
  }
}
```

Se a origem não existir, o cadastro nativo cria uma origem `PAID_MEDIA`. O destino precisa ser uma etapa aberta de pipeline de leads do mesmo workspace. `fieldMapping` usa a chave exata de uma pergunta nativa; o telefone também é reconhecido pela pergunta de tipo `PHONE`, pois formulários da Meta podem usar `phone` ou `phone_number`.

Ativar pela operação `ACTIVATE` do endpoint de conexões, com ID e revisão atuais. A resposta de cadastro informa o `webhookPath`. Configurar nesse endereço a assinatura do objeto `page`, campo `leadgen`, em `<APP_ID>/subscriptions`; depois instalar o app em `<PAGE_ID>/subscribed_apps`. Confirmar as duas inscrições por leitura. O fluxo exige HTTPS público, challenge correto e HMAC SHA-256 dos bytes recebidos.

## Importação e recebimento

`POST /api/acquisition/meta-native`, autenticado e com mesma origem:

```json
{ "connectionId": "UUID_DA_CONEXAO", "importToday": true }
```

Sincroniza o catálogo e importa exclusivamente o dia atual em São Paulo, respeitando `importFrom`. `false` atualiza somente o catálogo. A consulta usa `time_created` na Graph API e verifica o intervalo novamente antes da entrada canônica. Paginação aceita apenas o cursor e mantém o host fixo da Graph API. O receptor confere Página, formulário, identidade e data contra a API, sempre usando o token no cabeçalho e `appsecret_proof` calculado no servidor.

Novos leads chegam pelo webhook, sem depender da importação manual ou de polling. A entrega e a latência dependem da Meta; em indisponibilidade, sua política de reentrega e a fila auditável permitem identificar pendências. A importação inicial e a entrega posterior do mesmo lead compartilham a identidade sem gerar outra entrada. Novos formulários da Página são reconhecidos quando o primeiro lead é recebido. Não são importados leads anteriores ao início configurado.

O inbox guarda somente IDs e data. Identidade fica nas entidades canônicas; respostas de qualificação ficam na submissão, com limites de tamanho e sem campos de autenticação. A conexão não presume consentimento porque um lead preencheu um formulário.

## Retorno de reuniões e vendas

O worker `meta-native-feedback` usa os fatos canônicos `MEETING_SCHEDULED` (evento `Schedule`) e `SALE_WON` (`Purchase`), com ID de evento estável e `user_data.lead_id` da Meta. Backfills, marcações sem reunião e correções/reversões não produzem sinais. A entrega exige recibo `events_received`, tem tentativas limitadas e revalida conexão, identidade, finalidade, base legal e consentimento antes de cada envio.

Para habilitar, configurar `metaNative.datasetId` no dataset correto e adicionar à conexão uma referência `conversion-token` própria para esse dataset. Não reutilizar automaticamente o token de relatórios ou o token de uma outra BM. A finalidade `marketing-conversion-feedback`, sua versão/base legal ativas e o consentimento `OTHER/GRANTED` do contato são requisitos do controle existente. Ausência ou revogação bloqueia o envio, com evidência de privacidade; não fabricar consentimentos.

**Limite:** o recebimento de eventos na Conversions API é um recurso distinto da alteração visual de etapas na Central de Leads. Não foi confirmado um endpoint público de atualização dessas colunas; o SDK oficial de `Lead` oferece leitura e exclusão, sem operação para definir `Qualificado`/`Convertido`. Não usar chamadas internas da interface como contrato de integração nem anunciar essa movimentação como validada.

## Operação e rollback

Verificar entradas, pendências e falhas em Forms Nativo; investigar códigos do inbox/outbox sem registrar payloads ou credenciais. `REVOKE` da conexão interrompe novas entradas e bloqueia sinais pendentes. A remoção da inscrição `leadgen` deve preservar outras inscrições que venham a existir. Mudanças de configuração são versionadas. Não há migration de banco para este adaptador.

Referências: [checker oficial de recuperação de leads](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/leads/leads-retrieval-set-up-checker.md), [Lead no SDK oficial](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/lead.js), [identificação de lead na CAPI](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/serverside/user-data.js).
