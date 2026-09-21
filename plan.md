# Catalog Consolidation — Implementation Plan

## 1. Objetivo

Implementar um sistema de consolidação de catálogo que:

- leia produtos recebidos de diferentes sellers a partir de `database.json`;
- utilize `catalog.db` como catálogo consolidado existente;
- evite inserir produtos duplicados em `Product`;
- associe cada produto recebido ao seller em `SellerProduct`;
- preserve o identificador original do produto enviado pelo seller;
- seja seguro contra SQL injection;
- seja idempotente quando o mesmo arquivo for processado novamente;
- tenha testes automatizados e documentação suficiente para explicar as decisões técnicas.

---

## 2. Contexto confirmado

### Arquivos de entrada e destino

- `database.json`: arquivo contendo produtos enviados pelos sellers.
- `catalog.db`: banco SQLite contendo o catálogo consolidado.

### Estado inicial do banco

- Tabela `Product` com 975 produtos.
- Tabela `SellerProduct` sem registros.
- Não foram encontradas duplicidades exatas em `Product`.
- Os primeiros produtos do JSON já existem no catálogo, confirmando que o JSON deve ser importado sobre uma base existente.

### Schema original

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
  ProductId INTEGER
    CONSTRAINT FK_Product_Id REFERENCES Product (Id)
    NOT NULL,
  SellerProductId INTEGER NOT NULL
);
```

---

## 3. Decisões de negócio

### 3.0 Fase 0: análise do dataset antes da implementação

Antes de definir aliases ou executar a importação, será feita uma análise exploratória de `database.json` e do `catalog.db` para medir:

- quantidade de registros e sellers distintos;
- formatos e colisões dos IDs;
- ocorrências de `Brand = null`;
- colisões de `SellerName + SellerProductId`;
- colisões de `normalize(Name) + normalize(Brand)`;
- quantidade de itens já existentes no catálogo;
- pares linguísticos ou variações reais que justifiquem aliases.

Aliases e decisões específicas do dataset não serão definidos por especulação. A aplicação não dependerá dos valores observados nesses arquivos. Os resultados serão registrados no `README.md` e em `docs/DECISIONS.md` apenas como evidência de validação.


### 3.1 Papel do `Product.Id`

`Product.Id` é o identificador interno do produto consolidado e será gerado pelo SQLite.

O campo `Id` recebido no JSON não será utilizado como `Product.Id`.

### 3.2 Papel do `database.json.Id`

O `Id` do JSON representa o identificador do produto no catálogo do seller.

Ele deverá ser preservado em:

```text
SellerProduct.SellerProductId
```

Esse valor será tratado como uma string opaca, independentemente de possuir ou não formato UUID válido.

### 3.3 Identidade do seller

Como o input não possui `SellerId` e o banco não possui uma tabela `Seller`, o seller será identificado pelo campo:

```text
SellerName
```

Não haverá canonicalização automática de nomes de sellers na primeira versão.

Exemplo:

```text
MegaStore
megastore
```

serão considerados valores diferentes até que exista uma regra explícita de canonicalização.

### 3.4 Identidade do produto consolidado

O matching será baseado em uma chave determinística:

```text
matchKey = normalizedName + "\\u0000" + normalizedBrand
```

O separador nulo evita colisões entre pares diferentes, como `("ab", "c")` e `("a", "bc")`.

A categoria será utilizada como informação auxiliar, mas não será uma condição obrigatória de igualdade. Essa decisão permite consolidar produtos com pequenas diferenças de categoria, como:

```text
Photography
Photo
```

A ausência de marca será conservadora: `Brand = null` somente poderá casar com outro `Brand = null`; não será considerada evidência suficiente para casar com uma marca preenchida.

Essa chave é uma aproximação determinística para qualquer catálogo que siga o contrato de entrada, não uma regra específica para os fixtures fornecidos. Em um sistema real, SKU, EAN, GTIN ou outro identificador global seriam preferíveis.


### 3.5 Conflitos de dados

Quando um produto recebido corresponder a um produto já existente:

- o produto existente será reutilizado;
- seus dados não serão sobrescritos;
- uma nova relação com o seller será criada;
- divergências de categoria serão contabilizadas no resumo da execução.

Se duas linhas existentes do catálogo produzirem a mesma chave após normalização, será escolhido deterministicamente o menor `Product.Id`, e a colisão será contabilizada para investigação.

A estratégia de atualização automática do produto canônico ficará fora do escopo inicial.

### 3.6 Colisões de identificadores do seller

`UNIQUE(SellerName, SellerProductId)` será utilizado para garantir idempotência. Porém, essa constraint não deverá mascarar conflitos semânticos dentro do arquivo.

Antes de qualquer escrita, o input será analisado. Se o mesmo par `SellerName + SellerProductId` aparecer associado a dados de produtos diferentes, a importação será rejeitada integralmente. Registros realmente idênticos poderão ser tratados como duplicatas do arquivo.


---

## 4. Ajustes planejados no banco

### 4.1 Alterar `SellerProductId` para `TEXT`

O schema original declara `SellerProductId` como `INTEGER`, porém os IDs do JSON são strings, incluindo valores semelhantes a UUID.

Será criada uma migration para alterar a coluna para:

```sql
SellerProductId TEXT NOT NULL
```

A aplicação não deverá converter esse valor para número nem exigir que ele seja um UUID válido.

### 4.2 Foreign keys

A conexão SQLite deverá executar:

```sql
PRAGMA foreign_keys = ON;
```

A aplicação e os testes deverão verificar que a integridade referencial está ativa.

### 4.3 Unicidade e idempotência

A identidade de uma oferta é:

```text
SellerName + SellerProductId
```

A tabela deverá possuir:

```sql
UNIQUE (SellerName, SellerProductId)
```

A associação será persistida com `INSERT ... ON CONFLICT DO NOTHING`, garantindo idempotência no banco e evitando o padrão mais frágil de `SELECT` seguido de `INSERT`.

O mesmo `SellerProductId` poderá existir para sellers diferentes. Entretanto, uma colisão do mesmo par `SellerName + SellerProductId` com produtos diferentes será detectada antes da transação e causará falha da importação.

### 4.4 Migration protegida

Como `SellerProduct` está vazia no banco fornecido, a alteração para `TEXT` pode recriar a tabela sem copiar dados. Ainda assim, a migration deverá verificar previamente que a tabela está vazia e abortar se encontrar registros.

A migration destrutiva não deverá apagar associações silenciosamente em outro banco.


---

## 5. Estratégia de normalização

A normalização deverá ser determinística, pura e testável. O pipeline será:

1. `null` ou `undefined` resultam em string vazia;
2. aplicar Unicode NFD e remover diacríticos;
3. converter para lowercase;
4. remover aspas simples, duplas, curvas e crases;
5. transformar hífen, barra e underscore em espaço;
6. remover pontuação restante, preservando pontos entre dígitos;
7. colapsar espaços múltiplos;
8. aplicar `trim`;
9. aplicar aliases token a token, somente quando justificados pela Fase 0.

Aspas serão removidas, não substituídas por espaços. Hífens virarão espaços. Portanto, `Wi-Fi` e `WiFi` não serão automaticamente equivalentes; essa é uma limitação documentada.

### Regras

- converter texto para lowercase;
- remover acentos;
- remover espaços no início e no final;
- substituir múltiplos espaços por um único espaço;
- remover aspas equivalentes;
- preservar números e pontos decimais relevantes;
- tratar valores `null` explicitamente;
- aplicar aliases conhecidos apenas quando documentados e cobertos por testes.


### Exemplos

```text
"MacBook Air M2"
"MacBook Air  M2"
```

Resultado:

```text
"macbook air m2"
```

```text
"Câmera Canon EOS R6"
```

Resultado:

```text
"camera canon eos r6"
```

```text
"Tablet iPad Pro 12.9''"
```

Resultado esperado:

```text
"tablet ipad pro 12.9"
```

### Aliases e matching semântico

A primeira versão não dependerá de aliases, traduções ou listas específicas de produtos observados no dataset. A normalização genérica tratará diferenças de formatação, caixa, acentos, espaços e pontuação, mas não tentará traduzir ou inferir equivalência semântica entre idiomas.

Por exemplo, não será assumido automaticamente que `Router` e `Roteador` representam o mesmo produto. Essa inferência exigiria um dicionário de sinônimos, identificador global, matching semântico ou revisão manual, todos sujeitos a falsos positivos.

Como evolução, aliases poderão ser fornecidos externamente, por exemplo em `config/aliases.json`, sem serem embutidos na lógica principal. Cada alias deverá possuir justificativa, teste e versionamento próprios.

Fuzzy matching agressivo não será utilizado inicialmente devido ao risco de falsos positivos.


---

## 6. Generalidade da solução

A aplicação deverá funcionar para qualquer arquivo de entrada e qualquer `catalog.db` que respeitem o contrato documentado. Os arquivos fornecidos pelo desafio são fixtures de validação, não fontes de regras fixas.

Não haverá no código:

- produtos hardcoded;
- sellers hardcoded;
- categorias hardcoded;
- IDs hardcoded;
- aliases obrigatórios derivados apenas deste dataset;
- contagens esperadas fixas para a importação real.

A Fase 0 será uma ferramenta de análise reproduzível. Seus números servirão para validar o comportamento dos fixtures e documentar decisões, mas não serão pré-condições codificadas no importador.

A aplicação deverá aceitar novos sellers, novos produtos, novas categorias, marcas nulas, IDs arbitrários, arquivos vazios ou maiores e catálogos com conteúdo diferente.

## 7. Arquitetura planejada

A aplicação será um processo Node.js executado por CLI.

### Componentes

```text
src/
├── application/
│   └── catalog-importer.ts
├── domain/
│   ├── product.ts
│   └── seller-product.ts
├── input/
│   ├── product-file-reader.ts
│   └── product-input.ts
├── matching/
│   ├── product-matcher.ts
│   └── product-normalizer.ts
├── infrastructure/
│   ├── sqlite-catalog-repository.ts
│   └── sqlite-connection.ts
├── shared/
│   └── errors.ts
└── cli.ts
```

### Responsabilidades

#### `domain`

Representar as entidades e tipos do domínio sem dependência de SQLite ou CLI.

#### `input`

Ler o JSON e validar o formato dos registros recebidos.

#### `matching`

Normalizar os atributos e localizar produtos correspondentes.

#### `infrastructure`

Executar operações persistentes no SQLite utilizando queries parametrizadas.

#### `application`

Orquestrar a importação, transação, matching e geração do resultado.

#### `cli`

Receber argumentos, abrir o banco, executar o caso de uso e exibir o resumo da importação.

---

## 8. Fluxo de importação

1. Ler e validar o arquivo inteiro antes de abrir a transação.
2. Detectar colisões semânticas de `SellerName + SellerProductId`.
3. Carregar os produtos existentes em memória e montar `Map<matchKey, Product>`.
4. Em caso de colisão no catálogo, escolher o menor `Product.Id` e contabilizar o caso.
5. Para cada item:
   - calcular sua `matchKey`;
   - procurar um produto correspondente no índice;
   - se encontrar, reutilizar o `Product.Id`;
   - se não encontrar, inserir `Product` e adicionar imediatamente o novo item ao índice;
   - contabilizar conflito de categoria quando aplicável;
   - inserir `SellerProduct` com `ON CONFLICT DO NOTHING`.
6. Executar todos os writes dentro de uma transação única.
7. Em caso de erro, executar rollback.

Atualizar o índice após cada produto criado é obrigatório para deduplicar itens que colidem dentro do próprio arquivo.

A opção `--dry-run` executará o mesmo fluxo, mas sempre fará rollback ao final. Seus contadores representarão o que seria persistido.


---

## 9. Contrato esperado do input

Cada registro deverá possuir:

```typescript
{
  Id: string;
  SellerName: string;
  Name: string;
  Brand: string | null;
  Category: string | null;
}
```

### Validações

- `Id` deve ser uma string não vazia;
- `SellerName` deve ser uma string não vazia;
- `Name` deve ser uma string não vazia;
- `Brand` pode ser `null`;
- `Category` pode ser `null`;
- o formato do `Id` não será validado como UUID;
- campos desconhecidos poderão ser ignorados ou rejeitados conforme a decisão final do contrato.

---

## 10. Segurança

Todas as queries que utilizarem dados do JSON deverão ser parametrizadas.

Não será permitido construir SQL por concatenação, por exemplo:

```typescript
`INSERT INTO Product (Brand) VALUES ('${brand}')`
```

Será utilizado o mecanismo de parâmetros do driver SQLite escolhido.

O seguinte valor deverá ser armazenado literalmente:

```text
TestBrand'; SELECT 1; --
```

Esse valor não poderá executar SQL adicional.

Também deverão ser consideradas:

- ativação de foreign keys;
- transações;
- validação do arquivo;
- tratamento controlado de erros;
- não exposição de dados sensíveis nos logs.

---

## 11. Stack

### Runtime e linguagem

- Node.js
- TypeScript

### Banco

- SQLite
- Driver SQLite compatível com Node.js

### Testes

- Vitest

### Qualidade de código

- Biome para linting e formatação

### Documentação

- Markdown
- README.md
- Documentação técnica em `docs/`

---

## 12. Scripts planejados

O `package.json` deverá disponibilizar comandos semelhantes a:

```text
npm run dev
npm run build
npm run typecheck
npm run test
npm run test:watch
npm run test:coverage
npm run lint
npm run format
npm run format:check
npm run check
npm run verify
```

O comando `verify` deverá executar, no mínimo:

```text
typecheck
lint
format check
testes
```

---

## 13. Estratégia de testes

### 12.1 Testes unitários

Cobrir:

- lowercase;
- remoção de acentos;
- normalização de espaços;
- normalização de aspas;
- valores nulos;
- aliases;
- geração da chave de matching;
- comparação de produtos.

### 12.2 Testes do parser

Cobrir:

- arquivo JSON válido;
- arquivo vazio;
- JSON inválido;
- registro sem `Id`;
- registro sem `SellerName`;
- registro sem `Name`;
- `Brand` nulo;
- `Category` nula;
- IDs malformados, porém preservados.

### 12.3 Testes de integração com SQLite

Cobrir:

- busca de produto existente;
- inserção de produto novo;
- criação de relação seller-produto;
- preservação do `SellerProductId` como texto;
- foreign keys ativas;
- rollback em caso de erro;
- dados com SQL injection.

### 12.4 Testes de idempotência

Processar o mesmo input duas vezes e garantir:

- nenhum produto duplicado;
- nenhuma associação duplicada;
- contagens estáveis na segunda execução.

### 12.5 Teste de fluxo completo

Executar o importador sobre uma cópia temporária de `catalog.db` e validar:

- quantidade final de produtos;
- quantidade final de relações;
- produtos conhecidos reutilizados;
- produtos novos inseridos;
- sellers associados corretamente.

---

## 14. Documentação obrigatória

### `README.md`

Deverá conter:

- contexto;
- objetivo;
- stack;
- pré-requisitos;
- instalação;
- execução;
- comandos de teste;
- estrutura do projeto;
- estratégia de deduplicação;
- segurança;
- limitações;
- decisões importantes;
- possíveis evoluções.

### `docs/ASSUMPTIONS.md`

Registrar todas as hipóteses adotadas devido às ambiguidades do desafio.

### `docs/ARCHITECTURE.md`

Descrever camadas, responsabilidades, dependências e fluxo de execução.

### `docs/DATA_MODEL.md`

Documentar o schema, o mapeamento entre JSON e SQLite e a decisão sobre os identificadores.

### `docs/DEDUPLICATION.md`

Explicar normalização, matching, aliases, categoria e limitações.

### `docs/SECURITY.md`

Documentar queries parametrizadas, SQL injection, validação, transações e foreign keys.

### `docs/TESTING.md`

Descrever a estratégia de testes e os critérios de aceitação.

### `docs/TRADEOFFS.md`

Registrar alternativas consideradas, como:

- matching exato;
- fuzzy matching;
- embeddings;
- uso obrigatório de categoria;
- uso do ID do seller como produto;
- alteração ou não do schema.

### `docs/LIMITATIONS.md`

Registrar limitações conhecidas e evoluções possíveis.

### `docs/DEVELOPMENT_LOG.md`

Registrar cronologicamente:

- observações;
- decisões;
- validações;
- resultados;
- pendências.

### `docs/PROMPTS.md`

Registrar os prompts utilizados durante o desenvolvimento, incluindo:

> Este documento poderá ser consolidado posteriormente em `docs/AI_USAGE.md`, caso o projeto prefira uma documentação mais enxuta.


- objetivo do prompt;
- prompt utilizado;
- resultado aproveitado;
- alterações feitas após revisão humana;
- sugestões rejeitadas;
- validações executadas.

---

## 15. Fases de implementação

### Fase 0 — Exploração do dataset

- analisar `database.json` e `catalog.db`;
- contar registros e sellers distintos;
- verificar formatos e colisões de IDs;
- detectar `Brand = null`;
- medir colisões da chave de matching;
- identificar variações linguísticas ou semânticas para documentar limitações;
- avaliar colisões e correspondências sem codificar regras específicas do fixture;
- registrar os resultados.

**Verificação:** relatório numérico e decisão documentada para cada comportamento dependente do dataset.

### Fase 1 — Inicialização


- criar `package.json`;
- configurar TypeScript;
- configurar Vitest;
- configurar Biome;
- criar estrutura de diretórios;
- criar `.gitignore`;
- criar README inicial.

### Fase 2 — Modelagem

- criar tipos de domínio;
- definir contrato de input;
- documentar schema;
- criar migration para `SellerProductId TEXT`.

### Fase 3 — Normalização

- implementar normalizador;
- implementar aliases;
- criar testes unitários;
- documentar o algoritmo.

### Fase 4 — Leitura e validação

- implementar leitor do JSON;
- validar o contrato;
- criar testes para inputs inválidos;
- definir política de erro.

### Fase 5 — Persistência

- criar conexão SQLite;
- habilitar foreign keys;
- implementar repository;
- utilizar queries parametrizadas;
- criar operações transacionais.

### Fase 6 — Caso de uso

- implementar o importador;
- integrar leitura, matching e repository;
- implementar idempotência;
- retornar resumo da execução.

### Fase 7 — CLI

- aceitar caminho do JSON;
- aceitar caminho do banco;
- exibir contadores;
- tratar erros de forma clara.

### Fase 8 — Testes de integração

- criar banco temporário;
- executar cenários completos;
- validar rollback;
- validar SQL injection;
- validar idempotência.

### Fase 9 — Validação com dataset real

- criar cópia de `catalog.db`;
- executar o importador;
- comparar contagens;
- verificar produtos conhecidos;
- analisar casos não correspondidos;
- registrar resultados no `DEVELOPMENT_LOG.md`.

### Fase 10 — Revisão final

- executar `npm run verify`;
- revisar README;
- revisar documentação;
- revisar diff;
- verificar ausência de arquivos temporários;
- verificar que o banco original não foi alterado indevidamente;
- registrar limitações e melhorias futuras.

---

## 16. Critérios de aceitação

A solução será considerada concluída quando:

- [ ] a Fase 0 tiver resultados numéricos registrados;
- [ ] colisões semânticas de `SellerName + SellerProductId` forem rejeitadas antes de qualquer escrita;
- [ ] `Brand = null` somente casar com `Brand = null`;
- [ ] nenhum produto, seller, categoria ou alias do fixture estar hardcoded;
- [ ] o índice em memória deduplicar produtos criados durante a mesma execução;


- [ ] o projeto compilar sem erros;
- [ ] o Biome não reportar problemas;
- [ ] todos os testes passarem;
- [ ] `database.json` for lido corretamente;
- [ ] `catalog.db` for utilizado como base existente;
- [ ] produtos existentes não forem duplicados;
- [ ] produtos novos forem inseridos;
- [ ] relações com sellers forem criadas;
- [ ] `SellerProductId` for preservado como texto;
- [ ] o mesmo arquivo puder ser reprocessado sem duplicidade;
- [ ] SQL injection não for executado;
- [ ] foreign keys estiverem habilitadas;
- [ ] erros causarem rollback;
- [ ] README estiver completo;
- [ ] decisões e tradeoffs estiverem documentados;
- [ ] prompts relevantes estiverem registrados;
- [ ] limitações estiverem explicitamente descritas.

---

## 17. Melhorias futuras

As seguintes melhorias não fazem parte da primeira versão, mas devem ser documentadas:

- criar uma tabela `Seller` com identificador interno;
- criar uma tabela de aliases de sellers;
- utilizar SKU, EAN ou GTIN quando disponíveis;
- criar colunas normalizadas persistidas no banco;
- adicionar índices para acelerar o matching;
- adicionar fuzzy matching controlado;
- aceitar aliases externos e versionados por configuração;
- utilizar dicionário de tradução configurável;
- registrar conflitos de atributos em uma tabela própria;
- gerar relatório detalhado de produtos não correspondidos;
- suportar arquivos maiores com processamento em lotes;
- adicionar observabilidade e métricas;
- adicionar uma API HTTP;
- permitir revisão manual de matches ambíguos.

---

## 18. Próximo passo

Criar a estrutura inicial do projeto e os arquivos de configuração:

- `package.json`;
- `tsconfig.json`;
- `vitest.config.ts`;
- `biome.json`;
- `.gitignore`;
- `README.md`;
- `docs/`;
- `src/`;
- `tests/`.

A implementação deverá começar pela normalização e pelos testes unitários, antes da integração com SQLite.