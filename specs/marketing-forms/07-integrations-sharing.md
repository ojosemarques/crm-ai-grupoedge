# 07 — Integrações e compartilhamento

## Meta

- Definition guarda `enabled`, Pixel ID público, eventos selecionados, `capiEnabled`, connection ID e secret reference alias; nunca token.
- Browser dispara somente eventos allowlisted com `event_id` derivado do receipt/session, após consent/política quando aplicável.
- Server-side usa `conversion-feedback`/outbox existente e o mesmo event ID.
- Test Event Code é referência/configuração de ambiente, não enviado ao JSON público salvo quando estritamente necessário e não secreto.
- Falha browser/CAPI é isolada do submit.

## Google Ads

- Campos públicos: Conversion ID/Label validados.
- Enhanced conversion/egress permanece bloqueado enquanto `conversion-feedback-service` reportar write não homologado.
- UI distingue configurado de homologado; nenhum teste local envia.

## Secrets/outbox

- `SecretResolver` e `IntegrationSecretReference` são os únicos caminhos.
- Outbox allowlisted contém IDs internos mínimos/hash normalizado; não raw answers.
- Retry/dead-letter seguem worker atual, com error safe/redacted.

## WhatsApp individual

- Destino normalizado E.164 e mensagem com variáveis allowlisted (`{{primeiro_nome}}`).
- Interpolação server-side, URL encoding com `URLSearchParams`; nenhuma PII no admin preview.
- `wa.me/{digits}?text=...` somente depois de receipt aceito.

## Grupo

- Somente `https://chat.whatsapp.com/{token}`.
- Botão manual e redirect automático são opções explícitas; precedência de `05`.

## Rotação

- Endpoints no snapshot com stableKey, label, E.164 e active.
- Lock/estado por version; pula inativos; total e próximo são admin-only.
- Reset exige motivo, revision e audit; não apaga histórico de receipts.

## QR Code

- Somente versão publicada; codifica URL canônica exata.
- Render local SVG/PNG; sem serviço externo e sem PII/token.
- T11 fará análise de dependência. Se biblioteca for necessária, usar `dependency-change-safety`, fixar versão, revisar licença/audit e validar lockfile.

## UTM builder

- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` com limites.
- `URL`/`URLSearchParams`; substitui somente UTMs editadas; preserva parâmetros permitidos.
- Copiar/abrir; URL final passa pelo mesmo host canônico.

## Branding

- v1 aceita `https` em origins de `MARKETING_FORM_ASSET_ORIGINS`.
- Sem upload porque `AttachmentReference` é exclusivo de mensagens.
- Sem SVG ativo, data/javascript URL, IP literal/privado ou credentials.

## Testes/aceite

- Meta browser/CAPI compartilham event ID; egress falso em testes.
- Secret ausente bloqueia publish quando capability ativa, sem revelar key/value.
- Google inválido/indisponível não perde lead.
- WhatsApp encoding/variáveis/grupo/precedência.
- Rotation replay/concurrency/reset.
- QR decodifica para a URL exibida; UTM roundtrip.
