# auth

Autenticação local e construção do contexto confiável da requisição.

- `domain`: política e hash `scrypt` de senha, erros públicos seguros;
- `application`: login, validação, logout e atores técnicos;
- `http`: cookie opaco, metadados, origem e guardas para API/página;
- `proxy.ts`: somente checagem otimista de presença do cookie.

O serviço persiste apenas o hash do token de sessão. A autorização definitiva
sempre ocorre no servidor e o contexto de workspace nunca deve ser montado a
partir do payload do cliente.
