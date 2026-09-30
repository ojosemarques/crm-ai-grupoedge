# Analytics das páginas da empresa

O CRM recebe visitas, tempo visível e cliques em elementos nomeados, agrupados por página e UTMs em **Aquisição → Mídia paga e performance**. A coleta usa consentimento explícito e um relay no backend do site. O script e o endpoint estão disponíveis no projeto; as páginas externas precisam instalar e configurar essa integração para gerar dados reais.

## Configuração do backend

1. Cadastre e ative uma conexão **LANDING_PAGE** em Integrações, com a URL canônica da página e uma referência de segredo `ACQUISITION_*` configurada no servidor do CRM. Reutilize o segredo HMAC dessa conexão somente no backend do site.
2. Instale `examples/tracking-relay.mjs` no backend do site. Exponha seu handler em `/api/analytics` usando `createTrackingRelay` com `siteOrigin`, `crmEndpoint`, `secret` e `rateLimit`. O limitador deve usar armazenamento compartilhado, limitar por cliente e retornar boolean. Nunca use variáveis públicas para o segredo.
3. `crmEndpoint` deve ser `https://SEU-CRM/api/marketing/tracking/WORKSPACE/CONNECTION-KEY`. `siteOrigin` deve ser a origem exata da URL canônica cadastrada, sem barra final. O relay exige `Origin` correspondente, JSON com até 32 KiB, até 50 eventos e assina corpo + timestamp. O CRM exige HMAC válido dentro de cinco minutos e deduplica por evento.

## Instalação no navegador

Carregue `/politizai-analytics.js` do domínio do CRM. Inicie somente quando sua ferramenta de consentimento confirmar analytics:

```html
<script src="https://SEU-CRM/politizai-analytics.js" defer></script>
<button data-politizai-track="cta-agendar">Agendar conversa</button>
```

```javascript
// Execute após o script carregar e após consentimento explícito.
const tracking = window.PolitizaiAnalytics.start({
  consent: true,
  endpoint: "/api/analytics"
});
// Envie tracking.sessionPublicId como sessionPublicId no formulário de lead
// para associar a sessão à conversão pelo webhook de aquisição existente.

// Ao revogar consentimento:
window.PolitizaiAnalytics.stop();
```

Não há coleta antes de `start`, cookies, localStorage, texto de elementos, campos de formulário, caminho visitado ou URL completa. A sessão é efêmera por inicialização. Somente elementos com `data-politizai-track` são contados. Use nomes de eventos e UTMs sem informações pessoais; os identificadores aceitam letras, números, ponto, sublinhado, til e hífen, com até 120 caracteres. O caminho exibido vem da URL canônica configurada no CRM. Tempo visível mede visibilidade da aba, não comprova atenção. O script envia lotes a cada dez segundos e ao ocultar/sair da página; falhas de rede podem causar perda de eventos e emitem `politizai:tracking-error`.

Para páginas diferentes, configure uma conexão por página e seu relay correspondente. Não instale o segredo HMAC no JavaScript. O pixel Meta/Google deve ser configurado separadamente no site, sob o consentimento apropriado; esta integração não envia dados a esses provedores.

## Auditoria de mídia

O worker já agendado em `/api/internal/worker/tick` inclui o processador `marketing-audit`. Para cada workspace ativo com ator de sistema e fatos confirmados no dia anterior, cria no máximo uma reconciliação por data local. Precisa do worker habilitado e da importação/sincronização de mídia. Divergências aparecem na tela para marcar **Em revisão** ou **Resolvida**, sempre com responsável, data e justificativa. O scanner não corrige vendas e não substitui o sync de anúncios. Dados importados tardiamente após a auditoria exigem uma nova reconciliação manual.

## Validação operacional

Em uma página de teste, aceite analytics, clique em um alvo marcado e mantenha a aba visível por dez segundos. Confira que o relay responde 204 e que a página aparece no painel com a UTM usada. Repita o mesmo evento assinado e confirme `duplicates: 1`. Teste recusa de consentimento e confirme ausência de coleta. Verifique também o envio de `sessionPublicId` no webhook do formulário. Sem instalação e um evento recebido, o painel permanece vazio; essa situação não confirma uma integração operacional.
