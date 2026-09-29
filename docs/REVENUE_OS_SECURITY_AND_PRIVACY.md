# Segurança e privacidade planejadas — Revenue OS

## Estado

Este é um plano de controles, não uma certificação. A aplicação continua local,
sem provider externo ou dado real. Produção exige revisão independente,
homologação, runbooks e autorização específica.

## Modelo de proteção

- negação por padrão;
- autenticação e autorização em cada fronteira server-side;
- workspace obrigatório em query, FK, cache, job, evento e integração;
- papel técnico separado de função comercial e ownership;
- menor privilégio e propósito mínimo;
- auditabilidade sem duplicar dado sensível;
- secrets fora do código, banco, logs e client bundle;
- retenção e minimização desde o desenho.

## Papéis e segregação

Marketing não precisa de conversa privada para medir aquisição. SDR/Closer veem
contatos do escopo comercial. CS/Farmer veem clientes atribuídos. Financeiro vê
contratos/pagamentos necessários, sem herdar notas comerciais. RevOps possui
visão agregada e acesso operacional explicitamente concedido. Administrador
configura acesso/integrations, mas não recebe automaticamente conteúdo sensível.

Merge, exportação, anonimização, aprovação contratual, confirmação de pagamento,
ativação de provider e replay externo são permissões separadas e auditadas.

## LGPD e ciclo do dado

Para cada categoria deve existir: finalidade, base legal, campos mínimos,
origem, compartilhamentos, retenção, owner e procedimento do titular.

- consentimento é evento por finalidade/canal, não booleano global;
- ausência de consentimento não é consentimento e ausência de dado não é recusa;
- revogação bloqueia envios incompatíveis e preserva prova mínima permitida;
- legítimo interesse exige avaliação e opt-out quando aplicável;
- dados de campanhas e conversas são minimizados antes de provider/IA;
- solicitação de titular tem identidade verificada, prazo, escopo e evidência;
- legal hold impede eliminação somente no conjunto justificado;
- anonimização preserva métricas apenas quando não permitir reidentificação.

Uma matriz de retenção versionada será requisito antes de dados reais. Payload
bruto de webhook terá prazo menor que fatos normalizados quando possível.

## Segurança das integrações

- OAuth/chaves em secret manager com rotação e owner;
- callback com state/PKCE quando aplicável;
- assinatura, timestamp, nonce e replay protection em webhook;
- allowlist de redirect URI e egress quando disponível;
- escopo mínimo por conexão e ambiente explícito;
- idempotência para entrada e saída;
- rate limit por conexão/workspace/IP conforme risco;
- validação de tamanho, content type e schema;
- SSRF bloqueado por endpoints configurados/allowlisted;
- credencial revogada desativa jobs e dispara alerta;
- sandbox, homologação e produção não compartilham segredo nem mapping.

## Segurança do n8n

n8n recebe credencial de máquina com escopo e expiração. Não recebe acesso ao
banco, cookie humano ou segredo de outro provider. Eventos são minimizados,
assinados e versionados. Cada workflow possui owner/finalidade e toda mutação
volta a passar por política, domínio e auditoria do Revenue OS.

## IA governada

- provider aprovado com contrato de tratamento, região e retenção conhecidos;
- DTO mínimo e redaction antes da chamada;
- prompt/versionamento, modelo, modo, custo e latência rastreáveis;
- defesa contra prompt injection em conteúdo de lead/mensagem;
- schema de saída estrito e fallback seguro;
- evals de qualidade, viés, vazamento e recusa;
- ações sensíveis sempre confirmadas por pessoa autorizada;
- provider não recebe IDs internos, credencial ou payload bruto desnecessário;
- kill switch por workspace/provider.

Inferência nunca substitui fato. Confiança não é probabilidade calibrada até
existirem testes que comprovem calibração.

## Aplicação e infraestrutura

- cookies `HttpOnly`, `Secure` em produção, SameSite adequado e rotação de sessão;
- CSRF/same-origin nas mutações, CSP e headers revisados;
- validação Zod e limites de entrada;
- DAL server-only e nenhum Prisma no cliente;
- logs estruturados com redaction e request ID;
- dependências fixadas/auditadas, SBOM e revisão de supply chain futura;
- banco com TLS, usuário de mínimo privilégio, backup criptografado e PITR;
- migrations com conta separada da aplicação quando em produção;
- ambientes e dados segregados; produção nunca usada por testes;
- arquivos/documentos em storage privado com checksum, autorização e malware scan.

RLS poderá ser avaliado como defesa em profundidade após testes de compatibilidade;
não substitui filtros por workspace nem será ativado de forma improvisada.

## Ameaças prioritárias

| Ameaça | Controle principal |
|---|---|
| vazamento entre workspaces | FKs compostas, escopo server-side, testes cruzados |
| deduplicação/merge destrutivo | review, alias, evento e reversibilidade lógica |
| webhook forjado/replay | assinatura raw-body, nonce, idempotência |
| overwrite por sync | versionamento, política de precedência e issue |
| envio sem consentimento | checagem antes da fila e antes do provider |
| n8n contornando domínio | somente APIs/eventos com machine RBAC |
| prompt injection/exfiltração | conteúdo não confiável, minimização, contrato estrito |
| segredo em log/banco | secret reference e scanners/redaction |
| métricas revelando indivíduos | autorização, supressão e drilldown restrito |
| perda/ransomware | backup, PITR, restore rehearsal e cópia off-site |
| job duplicado | chave idempotente, lock, efeito persistido |

## Auditoria e detecção

AuditLog continua append-only. Novos logs registram ator humano/técnico,
conexão, finalidade, ação, entidade, correlação, resultado e motivo, com before/
after minimizado. Eventos de segurança incluem login, mudança de permissão,
exportação, merge, acesso sensível, segredo rotacionado, provider conectado,
replay e mudança de retenção.

Alertas planejados: falhas de autenticação anormais, cross-workspace negado,
webhook inválido, lag/outbox, volume de exportação, provider degradado, job em
dead-letter, backup/restore vencido e acesso administrativo incomum.

## Recuperação e continuidade

- RPO/RTO aprovados antes de produção;
- backup lógico e físico/PITR conforme ambiente;
- checksum, criptografia, retenção e cópia off-site;
- restore rehearsal recorrente em ambiente isolado;
- inventário de dependências e contatos de incidente;
- runbooks para credencial comprometida, provider fora, banco indisponível,
  corrupção lógica e rollback de migration;
- teste de carga, concorrência e degradação controlada.

## Gates antes de dados reais

- DPO/jurídico aprovou finalidades, bases, avisos, contratos e retenção;
- pentest e threat model revisados;
- segredo e acessos de produção configurados por responsáveis distintos;
- backup/PITR e restore testados;
- observabilidade/alerta/on-call ativos;
- sandbox e homologação reconciliados;
- exportação/DSR/anonimização testadas;
- carga e isolamento aprovados;
- plano de incidente e rollback ensaiados;
- commit e migration exatos aprovados.

## Não executado

Nenhum controle de produção, secret manager, provider, DPA, pentest, RLS,
backup remoto de banco ou deploy foi ativado nesta task.

## Geografia e territórios — CRM-42

- o backfill lê apenas cidade/UF explicitamente persistidas e não usa IP;
- nenhuma coordenada, PII ou payload bruto entra em resposta executiva,
  evidência flexível ou auditoria;
- `INFERENCE` permanece identificada e não substitui `FACT` ou
  `USER_CONFIRMED`;
- grupos com menos de cinco registros são suprimidos sem divulgar a amostra;
- mapa e tabela são locais, sem tiles, geocoder ou telemetria externa;
- publicação, inativação, resolução e backfill exigem permissão server-side,
  workspace e auditoria minimizada;
- geocoding externo exige revisão jurídica, fornecedor aprovado, DPA, retenção,
  orçamento e autorização futura explícita.
## CRM-45 — e-mail

O sender é fixo por workspace; assunto e endereços rejeitam CR/LF/NUL; MIME,
corpo, destinatários, partes, referências e anexos possuem limites. O fluxo
consulta privacidade antes do enqueue e suppressions novamente no worker.
Hard bounce, complaint e unsubscribe geram bloqueio append-only. HTML é
sanitizado e imagens remotas não são carregadas. Segredos permanecem somente
como referências ausentes e nenhum payload foi transmitido.

Ativação externa depende de secret store, domínio/mailbox autorizados,
SPF/DKIM/DMARC reais, webhook assinado do provider, revisão LGPD e homologação.

## CRM-60 — sandbox n8n

- token opaco, curto e rotacionável; somente hash e fingerprint persistem;
- owner humano, escopo mínimo, expiração e kill switch por identidade/workspace;
- HMAC sobre bytes brutos, timestamp, nonce e chave idempotente;
- body/rate limits locais, contrato Zod estrito e causação máxima 4;
- allowlist de eventos/versões e redação antes da serialização;
- propostas consequenciais exigem decisão humana e não executam domínio;
- recibos e versões append-only, correlação e auditoria sem segredo;
- ativação real depende de secret manager, TLS, rede, DPA, retenção, SLO e
  homologação futura explícita.
