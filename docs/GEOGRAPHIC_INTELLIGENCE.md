# Inteligência geográfica e territórios

## Escopo da CRM-42

A inteligência geográfica é uma projeção operacional sobre fatos explícitos já
persistidos. Ela não altera o owner do Lead, não substitui lifecycle, não usa IP
e não chama geocoder, tiles ou APIs externas. A tela
`/inteligencia-geografica` funciona integralmente com o PostgreSQL local e com
uma representação esquemática offline das UFs.

## Fonte canônica e evidência

- `GeographicLocation` guarda um local normalizado e reutilizável. Município é
  sempre combinado com UF para evitar homônimos; coordenadas só existem quando
  vierem de fonte legítima e ponto exato exige verificação.
- `GeographicObservation` é um fato append-only ligado a Contact, Account,
  Lead, touchpoint ou conversão. Registra origem, classe da evidência, precisão,
  confiança, vigência e ator.
- `GeographicProfile` é a projeção corrente. Divergência não a sobrescreve:
  cria observação `NEEDS_REVIEW` e `GeographicDataIssue`.
- `FACT` significa dado declarado ou já existente; `USER_CONFIRMED` registra
  validação humana; `INFERENCE` permanece identificada e nunca é exibida como
  fato. Ausência continua ausência.

Evidência flexível é minimizada. O serviço aceita somente rótulos de fonte,
campos e códigos de motivo; valores pessoais, payload bruto e coordenadas não
são copiados para auditoria ou resposta executiva.

## Territórios versionados

`Territory` aceita país, região, UF, município, prefixo postal e polígono
GeoJSON limitado. Publicar cria uma nova versão com hash canônico, prioridade,
vigência, autor e motivo. A prévia informa cobertura e sobreposições; empate de
prioridade entre regras diferentes bloqueia a publicação. Inativação preserva
o histórico e exige autorização e motivo.

`TerritoryMembership` é append-only. Cada resolução registra a versão exata da
regra, local usado, forma do match, confiança, vigência, ator e chave
idempotente. Uma nova resolução acrescenta um fato mais recente; não encerra nem
apaga vínculos antigos. Override humano exige motivo. Nenhuma resolução muda
responsável, equipe comercial ou estágio.

## Backfill conservador

O comando começa sempre em dry-run:

```bash
pnpm db:geography:backfill
pnpm db:geography:backfill -- --execute
```

Ele recusa produção, banco remoto, banco diferente de `politizai_crm` e schema
diferente de `public`. Apenas `city`/`stateCode` explícitos do Lead viram fatos;
nenhuma coordenada é sintetizada. Local ausente é ignorado, valor inválido ou
divergente vira revisão, e um perfil confirmado nunca é sobrescrito. O lock é
por workspace, os efeitos têm chaves determinísticas e uma repetição não cria
perfil, observação, membership ou issue duplicado.

## Métricas e privacidade

O serviço reutiliza `MetricsService` para coorte, tentativas, contatos,
qualificados, reuniões, no-shows, oportunidades, propostas, ganhos, perdas,
desqualificações, receita, conversão e SLA humano. O período anterior tem a
mesma duração. Estado, território, aquisição, equipe, responsável, etapa,
prioridade, precisão, classe de evidência, verificação e confiança filtram o
universo já autorizado.

Grupos com menos de cinco registros têm amostra, totais, comparação e aquisição
suprimidos. O payload retorna `null`, nunca o tamanho exato disfarçado. Zero
significa evento ausente dentro de um grupo publicável; `null` significa dado
indisponível, denominador ausente ou proteção de privacidade. CPL, CAC e ROAS
ficam explicitamente indisponíveis quando não existe custo real reconciliado.

O mapa, o ranking e o painel selecionado usam o mesmo objeto de região. Links
para Leads preservam UF e período compatíveis. Variações são descritivas e não
afirmam causalidade.

## API e autorização

`GET /api/geography` retorna somente agregados do universo autorizado.
`POST /api/geography` aceita as ações `BACKFILL`, `PREVIEW_TERRITORY`,
`PUBLISH_TERRITORY`, `SET_TERRITORY_STATUS`, `RECORD_OBSERVATION` e
`RESOLVE_TERRITORY`. Todas exigem sessão, same-origin nas mutações, Zod, escopo
por workspace e permissões server-side:

- `geography.read`: leitura agregada conforme escopo efetivo;
- `geography.manage`: observações, versões, inativação e resolução;
- `geography.backfill`: dry-run e execução do backfill.

Publicação, inativação, resolução, observação e backfill geram `AuditLog`
minimizado. O mapa não usa tiles e não envia localização a terceiros.

## Limites e futuro

Geocoding externo, malha municipal oficial, mapas vetoriais externos,
geolocalização por IP, cálculo de distância e roteirização estão adiados. Uma
adoção futura exige fornecedor aprovado, DPA/base legal, região de tratamento,
retenção, precisão, orçamento, rate limit, redaction e validação explícita em
homologação. Nenhum desses itens foi integrado na CRM-42.
