# users

Memberships, papéis e autorização RBAC.

`AuthorizationService` combina uma permissão persistida com o escopo
`WORKSPACE`, `TEAM` ou `OWN`, valida novamente o workspace e audita negativas.
Casos de uso administrativos chamam esse serviço antes de ler ou alterar dados.

`Role` é acesso técnico. `TeamMember.function` é função comercial. Essa separação
deve ser preservada em toda evolução do módulo.

A CRM-18 concentra consultas e mutações em
`WorkspaceAdministrationService`. O Administrador gerencia memberships, papéis
e equipes no workspace; o Gestor consulta e redistribui apenas dentro das
próprias equipes. Toda mutação possui prévia, confirmação, autorização no
servidor e auditoria.

Inativação é lógica: revoga sessões e, quando necessário, redistribui leads e
tarefas abertas no mesmo commit, preservando autoria. Pausa afeta somente a
elegibilidade do round-robin. Consulte `docs/ADMINISTRATION.md` para o contrato
completo.
