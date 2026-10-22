# 01 — Especificação de produto

## Problema e usuários

Gestores de marketing precisam criar formulários conversacionais versionados e acompanhar respostas sem depender de produto externo; visitantes precisam responder com baixo atrito; gestores comerciais precisam receber leads no CRM com origem verificável.

Usuários:

- administrador/gestor com `marketing.definitions.manage`;
- leitor de marketing com `marketing.journey.read`;
- exportador com `marketing.evidence.export` e `exports.execute`;
- visitante anônimo;
- sistema/worker para intake e egress.

## Jornadas

1. Criar rascunho, editar, configurar destino, estilo e integrações.
2. Validar preview, publicar snapshot imutável, compartilhar URL/QR/UTM.
3. Visitante responde uma pergunta por vez e recebe thank-you/redirect.
4. Submission idempotente entra no intake; admin vê vínculo, resposta e estatística.
5. Admin pausa, retoma, duplica ou arquiva sem alterar versões históricas.

## Escopo funcional

### Índice `/formularios`

Busca, filtros de status, paginação, criar, abrir, duplicar, preview, compartilhar, pausar/reativar e arquivar. Estados: loading, vazio, sem resultado, erro e sem permissão.

### Editor e sete abas

- **Editor:** perguntas, stable keys, tipos, ordem, obrigatório, opções, mapping.
- **Opções:** nome/slug, pipeline/etapa/origem/tags/fila/prioridade, thank-you, redirects e WhatsApp.
- **Estilo:** cores, tipografia allowlisted, raio/alinhamento, URL allowlisted de logo/fundo e preview desktop/mobile.
- **Métricas:** eventos internos e configuração Meta/Google por referência segura.
- **Compartilhar:** URL publicada, QR e UTM builder.
- **Respostas:** filtros, paginação, detalhe histórico, vínculo e CSV.
- **Estatísticas:** views/starts/submits, conclusão, abandono e opções por versão.

### Tipos mínimos

`SHORT_TEXT`, `LONG_TEXT`, `EMAIL`, `PHONE`, `NUMBER`, `DATE`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `DROPDOWN`, `CHECKBOX`, `THANK_YOU`. Exatamente um `THANK_YOU`; ao menos uma pergunta respondível.

### Mapping CRM

No máximo um campo por destino compatível: `fullName`, `phone`, `email`, `jobTitle`, `organizationName`, `city`, `stateCode`, `interestSummary`, `budgetCents`, `consent`, `doNotContact`. `fullName` e `phone` são publish gates enquanto o intake atual os exigir.

### Runtime público

Uma pergunta por viewport, progresso, back/forward, teclado, validação contextual, foco transferido, reduced motion, mobile/desktop e thank-you. Sem PII em localStorage, URL, telemetry ou logs.

## Regras de lifecycle

- Novo formulário começa `DRAFT` com revision 1.
- Editar só altera draft e incrementa revision.
- Publicar cria `MarketingFormVersion`; o snapshot nunca é mutado.
- Editar publicado cria novo draft baseado na versão ativa; público continua na versão anterior.
- Pausar deixa de resolver publicamente, mantendo `publishedVersionId` para reativação.
- Arquivar é reversível por política/admin e retorna 404 público.
- Duplicar copia definição sem respostas, versões, rotação, secrets ou slug.

## Não objetivos

Lógica condicional arbitrária, upload de documentos do visitante, scripts/CSS customizados, domínio customizado, IA em texto livre, colaboração realtime, pagamento, assinatura, criação automática de oportunidade e hard delete.

## Estados e falhas

- `409 REVISION_CONFLICT` em edição/publicação obsoleta.
- `422 PUBLISH_VALIDATION_FAILED` com issues por campo.
- Público desconhecido/draft/paused/archived retorna o mesmo 404.
- Erro recuperável mantém respostas em memória.
- Intake indisponível deixa receipt reprocessável; visitante recebe mensagem genérica.
- Falha de pixel/outbox nunca desfaz submission aceita.

## Critérios de aceite binários

1. Item Formulários visível no Marketing somente com leitura autorizada.
2. Índice lista/cria/filtra/pagina sem cross-tenant.
3. Editor contém exatamente as sete abas e todos os tipos mínimos.
4. Stable keys sobrevivem a reorder/rename; opção histórica não usa label como ID.
5. Publish gate bloqueia definição, mapping, destino, redirect ou integração inválidos.
6. Publicação cria versão imutável e troca ponteiro atomicamente.
7. Draft/paused/archived/unknown retornam 404 idêntico.
8. Público funciona por teclado, mobile, desktop e reduced motion.
9. Replay/duplo clique retorna mesmo receipt/submission/lead e não avança rotação duas vezes.
10. Pipeline, etapa, origem, tags, versão, UTMs e click IDs ficam corretos.
11. Respostas detalham o snapshot respondido e exportam CSV neutralizado.
12. Estatísticas apresentam grão/denominador/versão e não transformam ausente em zero.
13. Secrets não aparecem em JSON, bundle, logs ou respostas.
14. Falha de provider não perde lead.
15. QA visual cobre 1440, 1024, 768 e 390 px.

## Riscos e defaults

- Slug: globalmente único em v1 para resolução tenant-safe; colisão sugere suffix.
- Branding: URL HTTPS em origins configuradas; upload bloqueado até existir storage genérico.
- Google write: UI mostra `não homologado` e não promete envio.
- Retenção: soft delete e políticas existentes; hard delete fora do aceite.
