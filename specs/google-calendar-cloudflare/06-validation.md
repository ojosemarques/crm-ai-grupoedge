# Validação

- testes unitários de criptografia e rotação;
- testes do worker Google Calendar e do batch runner;
- lint, typecheck e build Cloudflare;
- diff sem secrets;
- consulta read-only: contagem/status/ciphertext format das cinco contas;
- callback oficial na configuração OAuth;
- execução autenticada do worker e `lastPullAt` avançando sem `lastErrorCode`;
- documentar falhas preexistentes separadamente.

## Resultados locais

- 34 testes direcionados aprovados.
- typecheck aprovado.
- ESLint aprovado.
- `build:vinext` aprovado.
- Node local 24 emitiu aviso de engine; o build remoto usa Node 22.23.4.

