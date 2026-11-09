# 07 · Expor metas e remuneração com a mesma apuração

## Dependências

Aceite da etapa 06 ou pendência factual isolada e bloqueada.

## Escopo e integração

Nova seção Métricas Metas no Financeiro e leitura em `/ote` via `ote-service.ts`. Período mensal, closers com meta, ACV, falta, rampa, faixas e pendências. Anúncios com coortes, dia, semana, acumulado, taxas, faixa e qualidade.

## Contratos e permissões

Usar o mesmo lançamento em ambos os canais. Meu OTE deriva vendedor da sessão. Financeiro tem visão autorizada. Barra limitada a 100%, percentual real preservado. Separar sem base, parcial e vazio.

## Cenários e aceite

- [ ] Mesma origem, valor e status por lançamento. Testar período, escopos, falsificação de IDs, privacidade, mobile e desktop.

## Migração, reversão e verificação em produção

Leituras compatíveis com legado e sem novas mutações. Smoke autenticado por perfil.

## Progresso local

A leitura compartilhada reúne o plano do mês, ACV realizado e pendente, títulos canônicos e coortes de Anúncios. A seção Métricas Metas exige acesso ao Financeiro e à gestão de comissões. Meu OTE deriva o vendedor da sessão, usa a mesma base e omite referências bancárias, IDs de coortes e evidência privada da rampa. Antes da vigência aplicável, Meu OTE conserva a leitura anterior.

A configuração administrativa recebe mês e evidência de rampa e as três faixas e o bônus de Anúncios. A gravação usa revisão otimista e a mesma trava das rotinas de remuneração. Os oito testes de OTE verificaram equivalência dos títulos, escopo, falsificação de membro, ausência de dados privados e compatibilidade pré-vigência. O build e o cenário Chromium passaram com navegação no Financeiro e leitura de Meu OTE em viewport de 390 px. A homologação autenticada em produção segue pendente.
