# Administração de usuários, equipes e disponibilidade

## Escopo da CRM-18

A área `/administracao` é a fronteira operacional para administrar identidades
locais, memberships do workspace, papéis, equipes, funções comerciais,
disponibilidade de SDRs e redistribuição de carga. A interface não acessa o
banco: `WorkspaceAdministrationService` valida comandos, autorização e impacto
antes de abrir a transação.

O Administrador enxerga o workspace inteiro e pode criar usuários, editar a
identificação de uma identidade exclusiva desse workspace, mudar papel, manter
equipes, alterar funções comerciais, pausar SDRs, inativar memberships e
redistribuir leads. O Gestor comercial possui uma visão limitada às próprias
equipes e pode pausar SDRs ou redistribuir a carga autorizada; ele não cria
identidades, não muda papéis e não edita equipes. Os demais papéis não acessam a
área por URL direta.

## Conceitos separados

- `User` é a identidade global e contém nome e e-mail.
- `LocalCredential` contém somente o hash versionado da senha local.
- `WorkspaceMember` concede acesso a um workspace e referencia um `Role`.
- `RolePermission` determina permissão técnica e escopo efetivo.
- `TeamMember.function` informa a função comercial dentro de cada equipe.

Mudar a função comercial não concede permissão. Mudar o papel não altera
silenciosamente os vínculos de equipe.

## Ciclo de vida e preservação histórica

Usuários com história comercial não são excluídos. A inativação altera o estado
da membership, revoga suas sessões abertas e preserva `Actor`, atividades,
auditoria e demais referências. A própria conta não pode mudar o próprio papel
nem se inativar, e o último Administrador ativo não pode ser removido.

Se houver leads abertos, a inativação exige um destino explícito: outro SDR
elegível da equipe de roteamento ou a Fila Geral. Leads e todas as tarefas
abertas relacionadas mudam juntos pelo serviço compartilhado de atribuição.
Cada lead recebe evento de timeline e auditoria, e a alteração administrativa
também recebe seu próprio `AuditLog`. Um erro em qualquer item reverte estado,
sessões e redistribuições no mesmo commit.

Reuniões futuras e oportunidades abertas são exibidas na prévia de impacto, mas
permanecem vinculadas para tratamento explícito por seus fluxos próprios. Isso
evita que uma inativação reescreva silenciosamente compromissos ou histórico de
vendas.

## Disponibilidade e distribuição

Pausar o recebimento não inativa a conta nem redistribui a carteira existente.
O round-robin da CRM-06 consulta a membership, o status da identidade, a função
`SDR` e `leadReceivingPausedAt`; por isso usuários inativos ou pausados não
recebem novas entradas. Retomar o recebimento recoloca o SDR no conjunto
elegível sem alterar o cursor artificialmente.

A redistribuição em lote é autorizada contra a membership de origem e o escopo
das equipes do Gestor. O destino é revalidado para cada lead contra a equipe da
fila de roteamento. A Fila Geral é sempre uma atribuição operacional explícita,
nunca um responsável nulo.

## Confirmação, concorrência e auditoria

Toda mutação possui duas etapas:

1. `POST /api/administracao/workspace` valida e calcula o impacto persistido;
2. `PATCH /api/administracao/workspace` exige `confirmed: true` e aplica a
   alteração.

Edições usam `updatedAt` como revisão otimista e advisory locks por recurso. Uma
confirmação baseada em informação obsoleta retorna conflito em vez de
sobrescrever a alteração mais recente. Criação de usuário gera o hash antes da
transação; senha, hash e token nunca aparecem na resposta nem no `AuditLog`.

Os indicadores da tela são calculados no PostgreSQL: usuários ativos/inativos,
SDRs pausados, leads abertos, leads na Fila Geral e, por membro, tarefas abertas,
reuniões futuras e oportunidades abertas. O universo consultado respeita o
mesmo escopo aplicado às ações.

## Limites desta task

Não há recuperação ou troca de senha, convite por e-mail, SSO, exclusão física,
redistribuição automática de reuniões/oportunidades, dashboard ou exportação.
Esses itens exigem tasks próprias. Nenhuma integração externa foi adicionada.
