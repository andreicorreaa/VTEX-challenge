# AI Usage

## Objetivo

A IA foi utilizada como ferramenta de apoio à análise, planejamento, implementação incremental e revisão. As decisões finais foram verificadas contra o dataset, o schema SQLite e os resultados dos testes.

## Prompt: análise inicial do banco

### Objetivo

Entender o papel de `database.json`, `catalog.db`, `Product` e `SellerProduct`.

### Resultado aproveitado

- `catalog.db` foi tratado como catálogo consolidado existente;
- `database.json` foi tratado como input dos sellers;
- `Product.Id` foi separado do identificador do seller;
- `SellerProductId` foi identificado como texto opaco.

### Validação humana

Foram executadas consultas SQLite para confirmar contagens, schema, produtos existentes e ausência de relações iniciais.

## Prompt: revisão do plano de implementação

### Objetivo

Comparar um plano inicial com uma segunda proposta mais enxuta e identificar overengineering, ambiguidades e riscos.

### Resultado aproveitado

- adoção de uma Fase 0 baseada em evidências;
- uso de índice em memória para matching;
- deduplicação dentro do próprio arquivo;
- idempotência garantida por constraint no banco;
- validação do input antes da transação;
- uso obrigatório de `--db`;
- suporte a `--dry-run`.

### Sugestões rejeitadas ou ajustadas

- arquitetura com muitas camadas para um importador pequeno;
- documentação excessivamente fragmentada;
- aliases de tradução embutidos derivados apenas do fixture;
- fuzzy matching sem evidência suficiente;
- uso de `SellerProductId` como chave global.

## Prompt: análise genérica do dataset

### Objetivo

Verificar se as regras propostas funcionavam além de alguns produtos conhecidos.

### Resultado aproveitado

A análise reproduzível encontrou:

- 269 registros;
- 20 sellers;
- 266 correspondências por normalização genérica;
- 3 registros sem correspondência;
- 1 conflito de categoria;
- IDs globais repetidos;
- uma repetição de seller e ID equivalente após normalização.

### Decisão resultante

Os fixtures são dados de validação, não regras do código. Não foram adicionados produtos, sellers, categorias ou aliases hardcoded.

## Prompt: revisão de segurança

### Objetivo

Verificar SQL injection, foreign keys, transações e preservação do banco original.

### Resultado aproveitado

- uso de `better-sqlite3` com queries parametrizadas;
- `PRAGMA foreign_keys = ON` em toda conexão da aplicação;
- migration protegida contra tabela `SellerProduct` não vazia;
- transação única para writes;
- teste com valor `TestBrand'; SELECT 1; --`;
- validação em cópia temporária do banco.

## Correções realizadas após validação

Durante a implementação, os testes encontraram e motivaram correções em:

- preservação de pontos decimais no normalizador;
- remoção genérica de diacríticos;
- mensagem detalhada de erro do reader;
- uso de arquivos temporários nos testes SQLite;
- contagem de deduplicação dentro do arquivo;
- rollback do `--dry-run`;
- ordenação e formatação dos imports pelo Biome.

Também foi investigada uma divergência de encoding exibida por uma ferramenta Python. A leitura direta via Node confirmou que o arquivo estava em UTF-8 e que `Câmera` e `Camera` eram equivalentes após normalização.

## Validações finais

A solução foi validada com:

- `npm run typecheck`;
- `npm run check`;
- `npm test`;
- 27 testes automatizados;
- migration em cópia temporária;
- dry-run em cópia temporária;
- importação real em cópia temporária;
- reprocessamento do mesmo arquivo;
- verificação de `SellerProductId` como `TEXT`;
- verificação de rollback;
- verificação de SQL injection;
- confirmação de que o banco original permaneceu inalterado.

## Limitação

Os prompts completos e o histórico de interação podem conter contexto específico da sessão. Este documento registra as decisões e os resultados relevantes para auditoria técnica, não pretende substituir revisão do código e dos testes.