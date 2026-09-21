# Catalog Consolidation — Plano de Implementação

## 0. Contexto do desafio

Marketplace recebe catálogos de múltiplos sellers. O mesmo produto pode ser
vendido por vários sellers, com pequenas variações na descrição. Objetivo:
consolidar sem duplicar em `Product`, registrando a oferta em `SellerProduct`.

Diretrizes explícitas do enunciado que guiam este plano:

- **"Demonstrar domínio do problema é mais importante que escalabilidade."**
  → simplicidade e clareza acima de abstração.
- **"O desafio contém ambiguidades intencionais."**
  → cada ambiguidade vira uma premissa declarada em `docs/DECISIONS.md`.
- **"Você pode alterar o banco se julgar necessário."**
  → alterações de schema são permitidas, desde que justificadas.
- **Fase síncrona cobrará justificativa das decisões e do uso de IA.**
  → registrar o *porquê*, não o *o quê*.

Prazo: 48h. Orçamento sugerido: ~8h de trabalho efetivo.

---

## 1. Ambiguidades identificadas e resolução adotada

| # | Ambiguidade | Decisão v1 | Alternativa rejeitada |
|---|---|---|---|
| A1 | O que é "produto duplicado"? | `normalize(Name) + normalize(Brand)` | Igualdade exata (não consolida nada); fuzzy (falsos positivos) |
| A2 | `Id` do JSON é `Product.Id`? | Não. É o ID do produto **no catálogo do seller** → `SellerProduct.SellerProductId` | Usar como PK de `Product` (quebra com IDs repetidos entre sellers) |
| A3 | Como identificar o seller? | Por `SellerName` literal | Criar tabela `Seller` (fora de escopo v1) |
| A4 | `Category` participa do matching? | Não. É auxiliar; divergência é contabilizada | Exigir igualdade (impede consolidar `Photography`/`Photo`) |
| A5 | Qual registro vence em conflito de dados? | O já existente. Nada é sobrescrito | Last-write-wins (perde dado canônico sem critério) |
| A6 | `Brand = null` casa com marca preenchida? | **Definir na Fase 0** com base no dataset. Default: não casa | — |
| A7 | Reprocessar o arquivo duplica? | Não. Idempotente via `UNIQUE(SellerName, SellerProductId)` | Checagem só na aplicação (mais frágil) |

---

## 2. Decisões técnicas centrais

### 2.1 Chave de matching

```
matchKey(p) = `${normalize(p.Name)}\u0000${normalize(p.Brand ?? "")}`
```

- `\u0000` como separador evita colisão entre `("ab", "c")` e `("a", "bc")`.
- Brand ausente cai em bucket próprio (decisão A6, revisável na Fase 0).

### 2.2 Índice em memória, não query-por-item

`Product` tem 975 linhas. Carregar tudo uma vez e montar
`Map<matchKey, productId>` resolve o matching em O(1) e — ponto crítico —
**permite deduplicar itens dentro do próprio arquivo**: todo produto inserido
é imediatamente adicionado ao índice.

Sem isso, dois itens do JSON que normalizam para a mesma chave e não existem
no banco gerariam dois `Product` novos. Este é o bug mais provável da tarefa.

**Empate:** se duas linhas existentes colidirem na mesma chave após
normalização, vence o **menor `Product.Id`** (determinístico) e o caso é
contabilizado no relatório.

### 2.3 Idempotência no banco, não na aplicação

```sql
UNIQUE (SellerName, SellerProductId)
```

com `INSERT ... ON CONFLICT DO NOTHING`. Mais forte e mais simples que
`SELECT` seguido de `INSERT`. A chave natural é `(SellerName, SellerProductId)`
— `ProductId` não faz parte da identidade da oferta.

Implicação aceita: um seller não pode apontar o mesmo `SellerProductId` para
dois produtos distintos. Correto por definição.

### 2.4 Migration `SellerProductId INTEGER → TEXT`

Justificativa precisa: SQLite usa **afinidade de tipo**, não tipagem rígida.
Com afinidade `INTEGER`, um `Id` como `"550e8400-..."` é gravado como TEXT sem
erro, mas um `Id` puramente numérico (`"01234"`) seria **coagido a número**,
perdendo zeros à esquerda e produzindo tipos inconsistentes na mesma coluna.
`TEXT` torna o armazenamento previsível.

Como `SellerProduct` está **vazia**, a migration é `DROP TABLE` + `CREATE TABLE`
— sem rebuild nem cópia de dados.

```sql
DROP TABLE IF EXISTS SellerProduct;

CREATE TABLE SellerProduct (
  Id              INTEGER PRIMARY KEY AUTOINCREMENT,
  SellerName      TEXT NOT NULL,
  ProductId       INTEGER NOT NULL REFERENCES Product (Id),
  SellerProductId TEXT NOT NULL,
  UNIQUE (SellerName, SellerProductId)
);
```

`Product` permanece intocada.

### 2.5 Driver: `better-sqlite3`

Síncrono (código linear, sem `async` desnecessário), estável, `prepare()` com
parâmetros nomeados, transações via `db.transaction()`.
Alternativa `node:sqlite` (builtin, zero deps) é atraente mas ainda
experimental — tradeoff registrado em `DECISIONS.md`.

### 2.6 Política de erro: fail-fast antes de escrever

Valida-se **o arquivo inteiro** antes de abrir transação. Qualquer registro
inválido → aborta com relatório de erros e **zero escritas**. Import parcial
de catálogo é pior que import nenhum.

### 2.7 Proteção do banco original

`--db` é **argumento obrigatório** (sem default para `catalog.db`).
Flag `--dry-run` executa tudo e faz rollback — custa 2 linhas com
`better-sqlite3` e permite inspecionar o resultado antes de commitar.

---

## 3. Normalização

Determinística, pura, sem dependências. Pipeline:

~~~
1. null/undefined            → ""
2. NFD + remover diacríticos → "câmera" → "camera" 3. lowercase 4. remover ' " ’ “ ” ` (drop, sem espaço) → 12.9'' vira 12.9 5. - / _ → espaço (Wi-Fi e Wi Fi convergem) 6. remover pontuação restante exceto . entre dígitos → preserva 12.9, 2.4ghz 7. colapsar espaços múltiplos → um espaço 8. trim 9. aplicar aliases token a token


**Regra 4 vs 6 explicitada** porque o plano anterior era contraditório:
aspas são **removidas**, não normalizadas; hífen vira **espaço**.
`Wi-Fi`/`WiFi` **não** convergem (aceito como limitação — vira alias se o
dataset exigir).

### Aliases

`Map<string, string>` aplicado por token, derivado da Fase 0:

```ts
const ALIASES = new Map([
  ["router", "roteador"],
  ["processor", "processador"],
  // ... preenchido após análise do dataset
]);

Honestidade sobre o que isso é: um dicionário PT↔EN ad-hoc, ajustado ao dataset do desafio. Não é solução geral de tradução. Documentado como tal em docs/DECISIONS.md — fingir generalidade seria pior que assumir o hack.

Por isso a Fase 0 vem antes da normalização: escrever aliases sem olhar o dataset é adivinhação.

4. Estrutura

Apply
src/
├── normalize.ts     # normalize(), matchKey(), ALIASES   — puro
├── reader.ts        # lê + valida database.json          — puro (recebe string)
├── repository.ts    # todo o SQL, parametrizado
├── importer.ts      # orquestra: índice, matching, resumo
└── cli.ts           # args, saída, exit codes

migrations/001_seller_product_text.sql
tests/
docs/
Cinco arquivos, ~400 linhas. Camadas domain//application//infrastructure/ foram descartadas: para este volume de código, hexagonal é cerimônia que esconde a lógica em vez de revelá-la. A separação que importa — funções puras (normalize, reader) testáveis sem banco — está preservada.

5. Contrato e resumo da execução

Apply
type ProductInput = {
  Id: string;          // não vazio; formato livre, NÃO validado como UUID
  SellerName: string;  // não vazio
  Name: string;        // não vazio
  Brand: string | null;
  Category: string | null;
};

type ImportSummary = {
  read: number;
  productsMatched: number;   // reaproveitou Product existente do banco
  productsCreated: number;
  dedupedWithinFile: number; // casou com item criado nesta mesma execução
  offersCreated: number;
  offersSkipped: number;     // ON CONFLICT — já existia (idempotência)
  categoryConflicts: number; // matched mas Category divergente
};
categoryConflicts é o que demonstra que a decisão A4 foi medida, não suposta. É o número que eu levo para a entrevista.

6. Segurança
db.prepare(...) com placeholders em 100% das queries que tocam dados do JSON. Nenhuma interpolação de string em SQL.
Teste explícito: inserir Brand = "TestBrand'; DROP TABLE Product; --", verificar que o valor é lido byte a byte igual e que Product sobreviveu.
PRAGMA foreign_keys = ON em toda conexão (é OFF por padrão no SQLite)
teste que confirma via PRAGMA foreign_keys e via INSERT com ProductId inexistente falhando.
Transação única envolvendo todos os writes; rollback em qualquer exceção.
7. Fases

Apply
0. Explorar database.json
   → contar registros, sellers distintos, formatos de Id, colisões
     nome+marca, ocorrências de Brand null, pares PT/EN reais
   verify: relatório numérico + lista de aliases fundamentada + decisão A6

1. Setup (package.json, tsconfig, vitest, biome) + migration
   verify: FK on, SellerProductId TEXT, UNIQUE aplicada, Product intacta

2. normalize.ts + testes unitários
   verify: casos reais da Fase 0 passam; aspas/hífen/acento/null cobertos

3. reader.ts + validação
   verify: JSON inválido, vazio, campos faltando → erro antes de qualquer write

4. repository.ts + importer.ts
   verify: índice em memória, dedup intra-arquivo, ON CONFLICT DO NOTHING

5. cli.ts (--input, --db obrigatório, --dry-run)
   verify: roda sobre cópia, imprime ImportSummary, exit code correto

6. Testes de integração
   verify: 2ª execução → offersCreated = 0; SQL injection; rollback; FK

7. Docs
8. Critérios de aceitação
Verificáveis, com números fixados ao final da Fase 0:

[ ] npm run verify limpo (typecheck + biome + testes)
[ ] N registros lidos → X matched, Y created, Z ofertas
[ ] 2ª execução idêntica: productsCreated = 0, offersCreated = 0
[ ] SellerProductId persistido como TEXT (typeof() = 'text' em 100%)
[ ] payload de SQL injection armazenado literalmente; schema intacto
[ ] PRAGMA foreign_keys = 1; FK violada → erro
[ ] erro no meio do import → nenhuma linha escrita
[ ] catalog.db original não modificado (hash antes/depois)
[ ] docs/DECISIONS.md cobre A1–A7 com justificativa e alternativa rejeitada
9. Documentação (enxuta)
Arquivo	Conteúdo
README.md	contexto, como rodar, resultado da execução real, estratégia de dedup, limitações
docs/DECISIONS.md	ambiguidades A1–A7, decisão, alternativas rejeitadas, tradeoffs
docs/AI_USAGE.md	onde IA ajudou, o que foi rejeitado e por quê, o que foi corrigido na revisão
Três arquivos, não onze. Os 11 documentos do plano anterior gerariam mais linhas de markdown que de código — sinal de teatro, não de domínio. AI_USAGE.md permanece porque as guidelines dizem que o uso de IA será avaliado: o valor está em mostrar julgamento crítico (o que foi rejeitado), não em colar prompts.

10. Limitações conhecidas (declarar, não esconder)
MegaStore ≠ megastore — sem canonicalização de seller na v1.
Sem fuzzy matching: "MacBook Air M2" vs "Macbook Air (M2)" consolidam (pontuação removida), mas "MacBook Air 13" vs "MacBook Air" não.
Aliases são ad-hoc do dataset, não tradução geral.
Tudo em memória: adequado a ~1k produtos, não a milhões.
Produto canônico nunca é enriquecido com dados melhores de um seller.
Sem SKU/EAN/GTIN no input — seriam a chave correta se existissem.
11. Primeiro passo
Fase 0: analisar database.json antes de escrever qualquer código de produção. Script descartável que responde:

Quantos registros? Quantos sellers distintos?
Formato dos Id: todos UUID? algum puramente numérico? (valida §2.4)
Quantos Brand null? Eles colidem com produtos de marca? (decide A6)
Quantas colisões de matchKey dentro do arquivo? (dimensiona §2.2)
Quais pares PT/EN reais existem? (preenche ALIASES)
Quantos itens já existem no catalog.db?
Sem essas respostas, normalização e aliases são chute.


Apply

**Principais mudanças vs. o plano original:** Fase 0 de análise do dataset promovida a primeiro passo (aliases e decisão sobre `Brand null` dependem dela); índice em memória com dedup intra-arquivo explicitado (era o furo mais provável); chave de idempotência corrigida para `(SellerName, SellerProductId)` com `UNIQUE` no banco; regras de pontuação desambiguadas; 6 camadas → 5 arquivos; 11 docs → 3; justificativa da migration reescrita sobre afinidade de tipo do SQLite.

Quer que eu comece pelo script da Fase 0?