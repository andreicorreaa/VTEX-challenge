# Decisions

## A1 — O que é um produto duplicado?

A primeira versão utiliza:

```text
normalize(Name) + "\u0000" + normalize(Brand)
```

A normalização trata caixa, acentos, espaços, aspas, separadores e pontuação. `Category` não participa obrigatoriamente da chave porque pode variar entre sellers.

### Alternativas rejeitadas

- igualdade exata: não consolida variações de formatação;
- fuzzy matching: pode gerar falsos positivos;
- tradução automática: não é determinística e exige conhecimento externo.

A chave é uma aproximação. SKU, EAN, GTIN ou código de fabricante seriam preferíveis em um domínio real.

## A2 — O que representa o `Id` do JSON?

O `Id` do JSON é o identificador do produto no catálogo do seller. Ele é preservado em `SellerProduct.SellerProductId`.

Não é utilizado como `Product.Id`, pois IDs de sellers podem se repetir entre sellers diferentes.

## A3 — Como o seller é identificado?

O seller é identificado pelo valor literal de `SellerName`. Não há tabela `Seller` na versão inicial e não existe canonicalização automática.

Assim, nomes diferentes por capitalização ou grafia podem representar sellers diferentes até que exista uma regra de domínio explícita.

## A4 — `Category` participa do matching?

Não. A categoria é um atributo auxiliar.

Quando o nome e a marca correspondem, o produto canônico existente é reutilizado mesmo que a categoria seja diferente. A divergência é contabilizada em `categoryConflicts`.

## A5 — Qual registro vence em conflito de atributos?

O produto já existente no catálogo vence. Seus dados não são sobrescritos por um seller.

Para produtos novos, os valores da primeira ocorrência são persistidos. O índice em memória é atualizado imediatamente para deduplicar ocorrências posteriores do mesmo arquivo.

## A6 — Como `Brand = null` participa do matching?

A política é conservadora:

```text
null somente casa com null
```

Uma marca ausente não é evidência suficiente para associar o produto a uma marca preenchida.

## A7 — Como a importação é idempotente?

A identidade da oferta é:

```text
SellerName + SellerProductId
```

A tabela `SellerProduct` possui `UNIQUE (SellerName, SellerProductId)` e a aplicação usa `INSERT ... ON CONFLICT DO NOTHING`.

Duplicatas equivalentes após normalização dentro do mesmo input compartilham o mesmo produto consolidado. Se o mesmo seller e ID de origem aparecerem associados a produtos diferentes após normalização, a importação falha antes de qualquer escrita.

## Schema

`SellerProductId` foi alterado de `INTEGER` para `TEXT`. O ID é tratado como string opaca para preservar UUIDs, IDs não padronizados e possíveis zeros à esquerda.

A migration verifica se `SellerProduct` está vazia antes de recriá-la. Isso evita apagar associações existentes acidentalmente.

## Transações e dry-run

Todo o fluxo de escrita ocorre em uma transação única. Erros causam rollback.

`--dry-run` executa o mesmo fluxo e produz o resumo esperado, mas força rollback ao final.

## Foreign keys

`PRAGMA foreign_keys = ON` é executado na conexão da aplicação. Essa configuração é específica de cada conexão SQLite; portanto, uma nova conexão aberta pelo comando `sqlite3` pode exibir `0` sem invalidar a configuração da aplicação.

O repository e os testes verificam a configuração na mesma conexão usada para persistência.

## Generalidade

Nenhum produto, seller, categoria, ID ou alias do fixture é hardcoded. `database.json` e `catalog.db` são usados para validação, não como fonte de regras fixas.

A primeira versão não realiza tradução ou matching semântico entre idiomas. Aliases externos podem ser adicionados futuramente por configuração versionada.