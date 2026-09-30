# Etapa 15 — checkout e verdade financeira

## Recorte transacional

O checkout transacional aceita somente uma versão ativa de produto com audiência
`INDIVIDUAL`, moeda `BRL`, preço positivo, disponibilidade `AVAILABLE`, gate
`STANDARD`, categoria de receita `SOFTWARE` e tipo `PRODUCT`, `PLAN` ou
`LICENSE`. Mandato, implantação, serviço e projeto permanecem no fluxo de
oportunidade, proposta, contrato, assinatura, implantação e cobrança.

Cada checkout grava snapshots da versão, SKU, nome, tipo, preço e moeda do
produto. A origem, o identificador externo e os metadados de atribuição também
ficam persistidos. Assim, uma alteração futura do catálogo não muda uma compra
anterior e um evento de outro produto é rejeitado.

## Provedor aprovado

`POLITIZAI_SIGNED_CHECKOUT_V1` é o contrato inbound aprovado nesta etapa. O
sistema cria `externalCheckoutId`; o checkout externo deve devolver esse valor,
o `productId`, o método e o preço originais em cada webhook. O endpoint público é
`POST /api/payments/checkouts/webhook`.

O corpo bruto é autenticado por HMAC SHA-256 com `CHECKOUT_WEBHOOK_SECRET`, os
headers `x-politizai-checkout-timestamp` e
`x-politizai-checkout-signature`, e nonce. A assinatura usa
`timestamp + "." + rawBody`, em hexadecimal, e tolerância de 300 segundos.
Produção não possui segredo padrão. `eventId`, nonce e hash do payload protegem
contra repetição e conflito; timestamp futuro e `providerSequence` repetida ou
anterior são rejeitados ou registrados como ignorados sem alterar a projeção
vigente. `providerSequence` é inteiro positivo e obrigatório em todo evento.

Eventos suportados:

- pagamento pendente, expirado ou recusado;
- compra confirmada e reembolso;
- assinatura ativada, atrasada ou cancelada para produto recorrente elegível.

O histórico é append-only e conserva eventos aplicados e ignorados. A projeção
de caixa usa somente `PURCHASE_CONFIRMED` e `PURCHASE_REFUNDED` aplicados e expõe
bruto, reembolsado e líquido. Repetir o mesmo evento não soma o valor novamente.

## APIs internas

- `GET|POST /api/payments/checkouts`: lista e cria pré-checkout autenticado.
- `GET|POST /api/payments/checkouts/{checkoutId}`: detalhe/histórico e abandono.
- `GET /api/revenue/consultative-indicators`: ganho, bookings, faturado,
  pagamentos, reversões e chargebacks do fluxo consultivo.

As APIs internas aplicam sessão, RBAC, isolamento por workspace, same-origin nas
mutações e limites de requisição. O webhook não usa sessão e depende da
assinatura obrigatória.

## Semântica financeira

Venda consultiva e checkout possuem caminhos diferentes. O fluxo consultivo
mantém fatos separados para oportunidade ganha, contrato aceito, fatura emitida,
pagamento confirmado e compensações. Pagamento e reembolso transacionais não
criam `RevenueMovement`; receita recorrente consultiva continua vindo de
assinatura/contrato. Os indicadores deduplicam por chave semântica e isolam
divergências, preservando proveniência, correlação e ordem persistida.

## Operação

Produção exige `CHECKOUT_WEBHOOK_SECRET` com pelo menos 32 caracteres. A rotação
deve ser coordenada com o emissor dos webhooks. Depois da implantação, validar
assinatura inválida, evento repetido, conflito de hash, produto divergente,
compra seguida de reembolso e evento fora de ordem.
