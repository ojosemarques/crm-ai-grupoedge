# 05 — Runtime público

## Objetivo

Servir somente a versão publicada ativa em `/f/[slug]` e conduzir uma state machine acessível, responsiva e idempotente.

## Resolução e cache

- `params: Promise<{slug:string}>` aguardado conforme Next 16.
- Validar slug antes da query; lookup por `publicSlug`, `status=ACTIVE`, `archivedAt=null`, `publishedVersionId!=null`.
- Qualquer falha de estado retorna `notFound()`/404 equivalente.
- `metadata.robots = {index:false,follow:false}`.
- Primeira release: `force-dynamic`/`no-store` para que pause seja imediato; sem `generateStaticParams`.
- `proxy.ts` libera prefixos `/f/` e `/api/public/forms/`, mas mantém trusted-host/CSP/correlation.
- `AppShell` trata prefixo `/f/` como público e retorna apenas children.

## JSON público

Inclui `publicId` da versão, título, perguntas/configs renderizáveis, style sanitizado, thank-you e config pública de pixel estritamente necessária. Exclui workspaceId, IDs de pipeline/source/tag/queue, secret references, regras internas e contadores de rotação.

## State machine

```text
LOADING -> READY(question 0)
READY -> VALIDATING -> READY(next|same+errors)
READY -> READY(previous)
last question -> SUBMITTING -> THANK_YOU
SUBMITTING -> ERROR_RECOVERABLE | ERROR_TERMINAL
THANK_YOU -> REDIRECTING | DONE
```

State: versionPublicId, sessionPublicId, idempotencyToken, current index, direction, answers map e fieldErrors. PII fica somente em memória; reload reinicia no v1.

## Rendering por tipo

- texto/email/telefone/número/data: controles nativos sem coerção de timezone em data civil.
- single choice/dropdown: uma option key; sem default implícito.
- multiple choice: option keys únicas e min/max.
- checkbox: boolean, consentimento com label completo.
- phone: máscara de apresentação; servidor normaliza.
- thank-you é tela, não answer.

## Teclado, foco e animação

- Heading da questão recebe foco programático a cada transição.
- Enter avança quando válido; textarea usa Ctrl/Meta+Enter; atalhos A–Z só fora de inputs.
- Back preserva answers.
- saída 180 ms; entrada 240 ms; progresso 500 ms ease-out.
- `prefers-reduced-motion` reduz a 0–50 ms sem perder foco/estado.
- setas anterior/próxima têm labels e estados disabled.

## Validação

Cliente usa o mesmo contrato serializável para UX; servidor revalida snapshot versionado. Erro fica junto ao controle, ligado por `aria-describedby`, e resumo é `aria-live`. HTML é texto React, nunca `dangerouslySetInnerHTML`.

## Sessão e eventos

- Session token opaco gerado pelo servidor/primeiro event; cookie first-party `HttpOnly`, `SameSite=Lax`, TTL curto, ou publicId retornado sem PII.
- Eventos são batch allowlisted e idempotentes.
- `QUESTION_ANSWERED` inclui apenas questionKey/optionKeys fechadas.
- Falha de telemetry não bloqueia navegação/submit.

## Submit

Payload strict: versionPublicId, idempotencyToken UUID, sessionPublicId, answers, honeypot vazio, startedAtProof/token opaco. Client desabilita botão durante request, mas a proteção real é server-side.

Resposta de sucesso: receipt publicId, `outcome`, thank-you sanitizado, redirect `{kind,url}` já decidido no servidor e delay mínimo. Nunca retorna lead/contact/submission IDs internos.

## Redirect precedence

1. grupo automático;
2. WhatsApp/round-robin;
3. URL allowlisted;
4. thank-you sem redirect.

Redirect só ocorre após sucesso confirmado. Link manual de grupo pode aparecer na thank-you sem auto redirect.

## Performance

- JS inicial somente renderer/state machine; admin code não entra no bundle.
- Assets com dimensões e lazy loading; background limitado.
- Nenhuma fonte remota adicional; usar Next font já empacotada/presets locais.

## Testes e aceite

- Unit para state machine, validators, keyboard e redirect.
- Route tests 404/cache/headers/body/rate/honeypot/replay.
- E2E todos os tipos, back, required, double click, error recoverable, thank-you.
- Visual desktop/mobile/reduced-motion.
- Nenhuma PII em URL/localStorage/console/telemetry.
