# Auditoria e saúde do processo

Este módulo implementa a fronteira administrativa da CRM-24. A consulta de
`AuditLog` é paginada, filtrada pelo `workspaceId` do contexto autenticado e
mascara dados sensíveis antes de devolvê-los à interface. O log continua
append-only no PostgreSQL.

`AuditAdministrationService` também executa uma varredura determinística sobre
relações e eventos persistidos. Cada evidência recebe um fingerprint estável em
`ProcessViolation`, com severidade e estado `OPEN`, `ACKNOWLEDGED` ou
`RESOLVED`. Repetir a varredura atualiza somente `lastDetectedAt`; não duplica o
achado. Corrigir um registro exige o serviço normal do respectivo domínio. A
resolução não edita nem apaga a evidência original.

As permissões são separadas:

- `audit.read`: consultar trilha e achados;
- `audit.manage`: executar a varredura, reconhecer e resolver achados.

Administrador e Gestor comercial recebem ambas no seed local. SDR, Closer e
Visualizador não acessam a rota nem as APIs alterando URL ou payload.

A exportação permanece fora do MVP até existir revisão específica de
minimização, mascaramento e autorização.
