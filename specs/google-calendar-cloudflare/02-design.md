# Design

## Fluxo

1. O Vercel mantém a chave atual como primária e recebe a nova chave como `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY_NEXT`.
2. Enquanto `NEXT` existir, o runtime lê ciphertexts com a nova chave e faz fallback para a chave atual; toda nova escrita usa `NEXT`.
3. Um processador idempotente do worker recriptografa no máximo uma conta/estado por passo, com guarda de concorrência por `updatedAt`/valor original.
4. Após todos os registros migrarem, o Cloudflare recebe a nova chave como chave primária.
5. O Vercel é atualizado para a mesma chave primária e `NEXT` é removida.

## Segurança

- AES-256-GCM existente permanece inalterado;
- nenhum endpoint novo de exportação ou decriptografia;
- o processador roda apenas no worker interno autenticado;
- valores sensíveis nunca entram em logs ou auditoria;
- atualizações concorrentes não são sobrescritas.

## Rollback

Enquanto `NEXT` existir no Vercel, o runtime aceita ciphertexts novos e antigos. Em falha, manter o Vercel como executor, remover os secrets novos do Cloudflare e não alterar os registros do banco.

