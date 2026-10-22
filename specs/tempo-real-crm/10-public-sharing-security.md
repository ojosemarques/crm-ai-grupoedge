# 10 — Compartilhamento público e segurança

## Boundary

- Ator autenticado: admin/gestor com `realtime.share.manage` WORKSPACE.
- Ator público: qualquer pessoa com bearer válido.
- Ativo: métricas agregadas e nomes corporativos do workspace.
- Entrada não confiável: token do fragmento, header Authorization e client IP headers.
- Efeito privilegiado: gerar/rotacionar/revogar; sempre sessão + same-origin + capability.

## Lifecycle

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

Qualquer pessoa que receba ou fotografe o link pode ler o placar até revogação. A UI autenticada deve exibir essa advertência; não existe restrição por IP/dispositivo nesta versão.
