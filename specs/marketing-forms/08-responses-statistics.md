# 08 — Respostas e estatísticas

## Tabela de respostas

Fonte: receipt + LeadFormSubmission + versão + lead/contact/opportunity quando existir. Query obrigatoriamente por workspace/form, com `page/pageSize<=100`, ordenação `(createdAt desc,id desc)`.

Filtros: busca (nome normalizado/receipt público/UTMs sem full scan ilimitado), data inicial/final semiaberta, status, tags, UTM source/medium/campaign e versão. Colunas seguem as imagens; “—” representa vínculo ausente.

## Detalhe

Carrega receipt por `(workspaceId,formId,publicId)` e renderiza perguntas na ordem da versão respondida. Inclui timestamps, status, versão, UTMs e links autorizados. Raw payload não é mostrado integralmente; answers são projetadas por contrato. Dialog acessível com scroll/focus.

## Export CSV

- Exige `MARKETING_EVIDENCE_EXPORT` + `EXPORTS_EXECUTE`.
- Respeita filtros e workspace.
- UTF-8 BOM, CRLF e cabeçalhos PT-BR.
- Reusar `csvCell`/`recordsCsv`; células iniciadas por `= + - @ tab CR` recebem apóstrofo.
- Colunas fixas + `v{version}:{questionKey}:{titleSnapshot}`; opção exporta label do snapshot e key auditável.
- Conteúdo não vai para log; audit registra filtros, count e hash, não rows.
- Processar em lotes; limite síncrono inicial 10.000 com erro/ orientação explícita, ou stream se validado.

## Métricas e grão

- views: sessões distintas com `FORM_VIEW`.
- starts: sessões distintas com `FORM_START`.
- submits: receipts distintos `ACCEPTED`.
- conclusão: submits / starts; `null` quando denominator 0.
- abandono por etapa: sessões que visualizaram question K e não chegaram ao próximo/submitted, deduplicadas por sessão/version.
- tempo mediano: submitAt - firstStartAt em sessões válidas.
- escolha: receipts aceitos distintos com optionKey por questionKey/version.
- checkbox: true/false/não respondido separados quando opcional.

Todas as métricas retornam numerator, denominator, percent/value, grain, period, version e coverage. Texto livre não é agregado.

## Versões e qualidade

- Default: versão ativa, com seletor “todas” que mantém breakdown explícito.
- Options renomeadas nunca são combinadas só por label; stable option key + version.
- Sessão sem UTM entra em `Não atribuído`.
- Evento órfão/receipt sem submission aparece em qualidade, não some.

## Privacidade/remoção/reprocess

- Soft delete/retention; legal hold bloqueia remoção.
- Reprocess apenas failed receipt sem submission.
- Ações em lote não fazem parte do v1 salvo export.
- Resposta apagada logicamente sai da listagem comum, mas audit/retention preservam regra.

## Testes/aceite

- Busca/filtro/período/paginação/ordenação determinísticos.
- Cross-tenant/ID previsível negado.
- Detalhe usa versão histórica.
- CSV neutraliza fórmulas/Unicode e não loga PII.
- Fórmulas reconciliam fixtures; zero denominator vira null.
- Rename/version/UTM ausente/receipt órfão testados.
