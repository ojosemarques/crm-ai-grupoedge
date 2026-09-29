# Módulos do monólito

Cada diretório representa um limite de negócio. Componentes e rotas chamam casos
de uso; casos de uso aplicam regras e acessam persistência por interfaces. O
módulo `leads` possui o serviço de entrada da CRM-05 e a distribuição/SLA da
CRM-06, ainda sem tela ou adaptador de canal; os demais módulos comerciais
continuam como fronteiras preparadas.

Dependências entre módulos devem ser explícitas. Código compartilhado só pertence
a `shared/core` quando não expressa uma regra exclusiva de um módulo.
