# Catalog Consolidation

Importador de catálogo que consolida produtos de múltiplos sellers em um catálogo SQLite existente, evitando duplicidade em `Product` e registrando as ofertas em `SellerProduct`.

## Contexto

O projeto recebe produtos no formato de `database.json` e utiliza `catalog.db` como catálogo consolidado. O mesmo produto pode aparecer em vários sellers com diferenças de caixa, acentos, espaços, aspas ou pontuação.

A solução é genérica: os arquivos fornecidos são fixtures de validação e não existem produtos, sellers, categorias, IDs ou aliases hardcoded no código.

## Stack

- Node.js 22+
- TypeScript
- SQLite
- `better-sqlite3`
- Vitest
- Biome

## Pré-requisitos

- Node.js 18 ou superior;
- npm;
- uma base SQLite compatível com o schema documentado;
- um arquivo de entrada compatível com o contrato abaixo.

## Instalação

```bash
npm install
```

## Contrato de entrada

O input deve ser um array JSON. Cada item possui:

```json
{
  "Id": "seller-product-id",
  "SellerName": "Seller name",
  "Name": "Product name",
  "Brand": "Brand or null",
  "Category": "Category or null"
}
```

`Id` é tratado como string opaca. Não é necessário que tenha formato UUID.

## Schema

O catálogo possui as tabelas:

```sql
CREATE TABLE Product (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Name TEXT NOT NULL,
  Brand TEXT,
  Category TEXT
);

CREATE TABLE SellerProduct (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  SellerName TEXT NOT NULL,
  ProductId INTEGER NOT NULL REFERENCES Product (Id),
  SellerProductId TEXT NOT NULL,
  UNIQUE (SellerName, SellerProductId)
);
```

A tabela `SellerProduct` precisa ser migrada antes da primeira importação caso ainda possua o schema original com `SellerProductId INTEGER`.

## Execução

### 1. Aplicar a migration

Sempre use uma cópia do banco durante testes:

```bash
npm run migrate -- --db ./catalog-copy.db
```

A migration:

- exige o caminho do banco;
- verifica se `SellerProduct` existe;
- aborta se a tabela possuir registros;
- recria a tabela com `SellerProductId TEXT`;
- adiciona `UNIQUE (SellerName, SellerProductId)`.

### 2. Executar em modo de simulação

```bash
npm run import -- \
  --input ./database.json \
  --db ./catalog-copy.db \
  --dry-run \
  --report ./reports/dry-run.json
```

O `--dry-run` executa o matching e produz o resumo, mas faz rollback de todos os writes. Quando `--report` é informado, a aplicação cria o diretório necessário e grava um relatório JSON detalhado, incluindo timestamps, parâmetros, resumo e resultado de cada item.

### 3. Executar a importação

```bash
npm run import -- \
  --input ./database.json \
  --db ./catalog-copy.db
```

O parâmetro `--db` é obrigatório para evitar alteração acidental de um banco padrão.

## Resumo da execução

A CLI imprime no stdout apenas um JSON com o resumo agregado:

O relatório opcional (`--report`) também contém um array `items` com uma entrada por registro processado. Cada item informa `sellerName`, `sellerProductId`, nome, `productId`, ação do produto (`matched`, `created` ou `deduplicated`), ação da oferta (`created` ou `skipped`) e eventual conflito de categoria.

A CLI imprime no stdout um JSON com:

| Campo               | Significado                                                    |
| ------------------- | -------------------------------------------------------------- |
| `read`              | registros lidos e validados                                    |
| `productsMatched`   | itens que reutilizaram produto do catálogo existente           |
| `productsCreated`   | novos produtos inseridos                                       |
| `dedupedWithinFile` | itens que reutilizaram produto criado durante a mesma execução |
| `offersCreated`     | novas ofertas persistidas                                      |
| `offersSkipped`     | ofertas já existentes ou duplicadas                            |
| `categoryConflicts` | matches com categoria divergente                               |
| `dryRun`            | indica se a execução foi revertida                             |

## Estratégia de matching

A chave determinística é:

```text
normalize(Name) + "\u0000" + normalize(Brand)
```

A normalização:

- remove acentos;
- converte para lowercase;
- remove aspas;
- transforma hífen, barra e underscore em espaço;
- remove pontuação não relevante;
- preserva pontos entre dígitos;
- colapsa espaços;
- trata `null` como string vazia.

`Brand = null` somente casa com `Brand = null`.

`Category` não participa obrigatoriamente da chave. Ela é preservada e divergências são contabilizadas.

A aplicação carrega o catálogo em memória e atualiza o índice após cada produto criado. Isso evita duplicação entre itens equivalentes no mesmo arquivo.

A primeira versão não faz tradução, aliases obrigatórios ou fuzzy matching. Matching semântico entre idiomas depende de informação externa, como SKU, EAN, GTIN, aliases versionados ou revisão manual.

## Idempotência

A identidade de uma oferta é:

```text
SellerName + SellerProductId
```

A persistência usa:

```sql
INSERT ... ON CONFLICT (SellerName, SellerProductId) DO NOTHING
```

Assim, reprocessar o mesmo arquivo não cria novas ofertas.

Se o mesmo seller e ID forem associados a produtos diferentes após normalização, a importação falha antes de qualquer escrita para não mascarar um conflito de origem.

## Segurança e integridade

- todas as queries que recebem dados do input são parametrizadas;
- valores como `TestBrand'; SELECT 1; --` são armazenados literalmente;
- foreign keys são habilitadas em cada conexão da aplicação;
- os writes ocorrem em uma transação única;
- falhas causam rollback;
- a migration aborta se encontrar relações existentes;
- o banco original deve ser preservado e testado por meio de cópias.

A configuração `PRAGMA foreign_keys` é específica de cada conexão SQLite. Por isso, ela deve ser ativada pela aplicação em toda conexão, e não apenas por uma ferramenta externa.

## Desenvolvimento

Scripts disponíveis:

```bash
npm run typecheck
npm run lint
npm run format
npm run format:check
npm run check
npm test
npm run test:watch
npm run test:coverage
npm run build
npm run verify
```

`npm run verify` executa typecheck, Biome e testes.

## Testes

A suíte cobre:

- normalização de nomes e marcas;
- acentos, aspas, separadores e números decimais;
- validação do JSON;
- IDs arbitrários;
- foreign keys;
- inserção parametrizada;
- SQL injection;
- rollback;
- idempotência;
- deduplicação dentro do arquivo;
- conflitos de IDs do seller;
- conflitos de categoria;
- `dry-run`.

## Resultado validado com os fixtures

A execução em uma cópia do banco fornecido produziu:

- 269 registros lidos;
- 266 produtos correspondentes ao catálogo;
- 3 produtos novos;
- 268 ofertas criadas;
- 1 oferta duplicada ignorada;
- 1 conflito de categoria;
- 978 produtos no catálogo final;
- 268 relações em `SellerProduct`.

Na segunda execução do mesmo arquivo:

- 0 produtos novos;
- 0 ofertas novas;
- 269 ofertas ignoradas por idempotência.

Todas as 268 relações persistidas possuem `SellerProductId` como `TEXT`.

## Documentação adicional

- [`plan.md`](./plan.md): plano de implementação;
- [`docs/phase-0-analysis.md`](./docs/phase-0-analysis.md): análise reproduzível dos fixtures;
- [`docs/DECISIONS.md`](./docs/DECISIONS.md): ambiguidades e decisões técnicas;
- [`docs/AI_USAGE.md`](./docs/AI_USAGE.md): uso de IA, validações e decisões rejeitadas.

## Limitações conhecidas

- não há canonicalização de `SellerName`;
- não há matching semântico entre idiomas;
- não há SKU, EAN, GTIN ou código global no contrato;
- a chave `Name + Brand` é uma aproximação;
- o índice de matching é mantido em memória;
- o produto canônico não é enriquecido automaticamente por dados de sellers;
- aliases externos ainda não fazem parte da primeira versão.

## Possíveis evoluções

- adicionar identificadores globais de produto;
- criar uma entidade `Seller`;
- aceitar aliases externos versionados;
- registrar conflitos em tabela própria;
- criar revisão manual de matches ambíguos;
- adicionar processamento em lotes para catálogos maiores;
- adicionar métricas e observabilidade.
