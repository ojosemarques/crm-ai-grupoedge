# Validações externas adiadas

Este documento separa implementação local de homologação com terceiros. A
ausência de credencial não invalida contratos, fixtures, RBAC, persistência ou
rollback já testados; também não autoriza afirmar que uma API real foi validada.

## Meta Ads — CRM-40

Status: `CONCLUÍDA E VALIDADA LOCALMENTE — VALIDAÇÃO EXTERNA ADIADA`.

Pendente: token de menor privilégio, conta de teste autorizada, paginação real,
rate limit, expiração/revogação, reconciliação com Ads Manager e runbook de
rotação. Nenhuma credencial foi usada e nenhum egress ocorreu na validação local.

## Google Ads — CRM-41

Status: `CONCLUÍDA E VALIDADA LOCALMENTE — VALIDAÇÃO EXTERNA ADIADA`.

Pendente: projeto Google Cloud com acesso aprovado, OAuth ou service account de
teste, hierarquia manager/customer real, escopo mínimo, versão vigente,
paginação, quotas, request IDs, reconciliação de custo/conversões e revogação.
Nenhuma credencial foi solicitada ou usada e nenhum egress ocorreu.

## Regra de retomada

Uma validação externa precisa de autorização explícita, credencial criada para
teste, conta permitida identificada e janela de mudança. Segredos entram apenas
no ambiente server-side. Evidências devem registrar IDs não sensíveis, versão,
horário, contagens e reconciliação; nunca valores de token ou chave privada.

## CRM-42 — geocoding e mapas externos adiados

A implementação local não usa geocoder, IP, tiles, malha municipal externa ou
serviço de roteirização. Uma validação futura precisa definir fornecedor e
região de tratamento, DPA/base legal, finalidade, retenção, redaction, precisão,
quota, orçamento, rate limit, fallback e ambiente de homologação. Coordenadas
recebidas de fornecedor devem manter proveniência, confiança e revisão humana;
jamais podem ser promovidas silenciosamente a fato confirmado. Nenhuma
credencial, chamada externa ou egress foi usado na CRM-42.

## CRM-44 — WhatsApp com ativação externa bloqueada

A CRM-44 implementou e validou localmente o profile, contratos, proteção do
webhook, receipt/job, worker, retry/dead-letter/replay, janela de 24 horas,
templates, opt-out, identidade e UI do WhatsApp. Nenhuma credencial, chamada à
Meta, webhook público, WABA/número real, template provider ou egress foi usado.

A ativação externa foi bloqueada porque a política oficial restringe entidades
e serviços relacionados a partidos, políticos, candidatos e campanhas. A
Politizai precisa de decisão formal de elegibilidade antes até mesmo de uma
homologação. Depois disso, ainda serão necessários sandbox autorizado,
credenciais de menor privilégio, opt-in rastreável, templates aprovados,
retenção, rate limit real, rotação/revogação e reconciliação externa. Evidências
e checklist: `docs/WHATSAPP_CLOUD_API.md`.

## CRM-45 e CRM-46 — canais externos não ativados

E-mail (CRM-45) está concluído e validado somente com sink local. Telefonia
(CRM-46) está concluída e validada somente com simulador local determinístico.
Cada validação futura exige autorização própria, conta sandbox, credencial de
menor privilégio, finalidade/base legal aprovadas, domínio ou números de teste,
retenção, rate limit, assinatura de webhook, reconciliação e procedimento de
revogação.

## E-mail — pendência externa da CRM-45

Provider, domínio, mailbox, credenciais, DNS, sandbox, webhook, DSN, replies,
bounces, complaints e unsubscribe reais não foram configurados nem testados.
Antes de habilitar egress, executar o checklist de
[`EMAIL_CHANNEL.md`](./EMAIL_CHANNEL.md), registrar evidências externas e manter
o modo fail-closed até aprovação explícita.

## Telefonia — pendência externa da CRM-46

Provider, conta sandbox, número/caller ID, PSTN, credenciais, tarifas, limites,
webhook, gravação, transcrição e storage não foram configurados nem testados. A
política de contato e a base legal precisam de aprovação; gravar exige decisão
específica, consentimento quando aplicável, retenção e controle de acesso. Antes
de habilitar qualquer egress, executar o checklist de
[`TELEPHONY_CHANNEL.md`](./TELEPHONY_CHANNEL.md) e reconciliar estados/durações
com o provider real.

## Calendário — pendência externa da CRM-47

A CRM-47 valida somente o sandbox determinístico local. Google Calendar,
Microsoft 365, CalDAV, conta, OAuth, consent screen, credencial, webhook público,
quota, egress e reconciliação remota não foram configurados nem testados. Antes
de ativar um provider, homologar escopos mínimos, identidade dos participantes,
política de conflito, assinatura/replay do webhook, rate limit, revogação e
reconciliação conforme [`CALENDAR_CHANNEL.md`](./CALENDAR_CHANNEL.md).
