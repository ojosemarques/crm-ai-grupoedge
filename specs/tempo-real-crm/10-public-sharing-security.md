# 10 — Compartilhamento público e segurança

## Boundary

- Ator autenticado: admin/gestor com `realtime.share.manage` WORKSPACE.
- Ator público: qualquer pessoa em `/tempo` enquanto o acesso estiver ativo no workspace configurado; links antigos de outros workspaces continuam exigindo bearer válido.
- Ativo: métricas agregadas e nomes corporativos do workspace.
- Entrada não confiável: token do fragmento, header Authorization e client IP headers.
- Efeito privilegiado: gerar/rotacionar/revogar; sempre sessão + same-origin + capability.

## Lifecycle

### Endereço fixo da TV

- `REALTIME_PUBLIC_WORKSPACE_SLUG` seleciona um único workspace no servidor. Vazio, workspace inativo ou inexistente negam acesso; query/header/cookie do visitante não escolhem tenant.
- `/tempo` abre sem login, query ou fragmento e consulta `/api/public/tempo`. O tema fica no navegador sem aumentar o link.
- Toda consulta verifica o compartilhamento ativo existente. Revogar interrompe a API imediatamente e remove o placar na próxima atualização; reativar libera o mesmo endereço.
- Gestão permanece autenticada, autorizada e same-origin, com auditoria existente. A API pública não retorna estado de gestão, IDs ou dados de contatos e mantém no-store, noindex, no-referrer e limite de 120 consultas/minuto por cliente.
- No workspace configurado, a geração retorna somente `domínio/tempo`. Outros workspaces conservam o fluxo de bearer abaixo, sem publicar seus dados nesse endereço.

### Compatibilidade com bearer

1. `randomBytes(32).toString("base64url")` gera 256 bits.
2. Browser recebe `https://.../tempo-real-publico#<token>` uma vez.
3. Banco recebe somente `sha256(token)`.
4. Rotação substitui o hash e incrementa revision em transação serializável.
5. Revogação marca timestamp/ator; lookup exige `revokedAt=null`.
6. Nova geração sobre linha revogada substitui hash e limpa revogação.

## Threat model

| Ameaça | Controle | Teste |
|---|---|---|
| token fraco/previsível | CSPRNG 256 bits | tamanho/formato/unicidade |
| token em access log/referrer | fragmento + header; endpoint fixo; no-referrer | URL/API sem token |
| token no app log/erro/audit | handler loga só código; audit sem hash/token | sentinel ausente |
| brute force | formato estrito + rate limit compartilhado | 429 |
| enumeração | 404 uniforme para malformado/desconhecido/revogado | corpo/status iguais |
| cross-workspace | lookup por hash resolve workspace server-side | dois tenants |
| gestão indevida | auth + capability WORKSPACE + same-origin | 401/403 |
| duas rotações | advisory lock + serializable + unique | concorrência |
| revogado em cache | no-store, lookup a cada polling | revogação imediata |
| Proxy amplo | rota pública exata, prefixo semelhante protegido | unitário Proxy |
| shell/admin público | `isPublicShellRoute` só página exata | sem navegação/session |
| PII/IDs | mapper DTO allowlist | snapshot serializado |
| XSS em nome | React escaping; sem HTML bruto | nome malicioso |
| DoS polling | 120/min token-hash+cliente; query limitada a semana | rate/consulta |
| crawler | robots metadata + X-Robots-Tag | headers/HTML |

## DTO público permitido

Workspace name, timezone, períodos, timestamps, quality, totais, meta agregada, nomes/iniciais e métricas agregadas do ranking. Proibidos IDs, e-mail, telefone, role interna, leads/contatos, eventos, permissions, audit, token/hash e nomes de tabelas/providers.

## Risco residual

O caminho `/tempo` é previsível: qualquer pessoa pode ler métricas e nomes corporativos enquanto o compartilhamento estiver ativo. Essa exposição foi autorizada explicitamente pelo usuário. Revogar bloqueia novas leituras, mas não recupera dados já vistos/copiados. Não existe restrição por IP/dispositivo. Um novo acesso público reabre o mesmo endereço, sem invalidar quem já o conhece.
