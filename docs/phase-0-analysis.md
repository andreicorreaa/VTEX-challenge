# Phase 0 — Dataset Analysis

## Objetivo

Analisar os arquivos fornecidos pelo desafio antes da implementação, validar as hipóteses do plano e identificar casos-limite sem transformar o fixture em regra fixa da aplicação.

A análise foi executada com:

- `database.json` como entrada de produtos dos sellers;
- `catalog.db` como catálogo consolidado;
- normalização genérica;
- nenhum alias de tradução;
- nenhuma alteração no banco.

## Resumo do dataset

| Métrica                                        | Resultado |
| ---------------------------------------------- | --------: |
| Registros em `database.json`                   |       269 |
| Sellers distintos                              |        20 |
| Nomes distintos                                |       265 |
| Registros com `Brand = null`                   |         3 |
| IDs distintos                                  |       255 |
| IDs globais repetidos                          |        14 |
| Pares `SellerName + SellerProductId` repetidos |         1 |
| Chaves de matching distintas no input          |       201 |
| Grupos de chaves de matching repetidas         |        64 |
| Registros extras por repetição de chave        |        68 |
| Produtos em `Product`                          |       975 |
| Relações em `SellerProduct`                    |         0 |
| Registros correspondentes ao catálogo          |       266 |
| Registros sem correspondência                  |         3 |
| Conflitos de categoria                         |         1 |

## Formato dos IDs

| Formato                  | Quantidade |
| ------------------------ | ---------: |
| UUID-like (`8-4-4-4-12`) |        266 |
| String não padronizada   |          3 |

O campo `Id` recebido do seller não será validado como UUID. Ele será tratado como uma string opaca e preservado em `SellerProduct.SellerProductId`.

Essa decisão é necessária porque:

- existem IDs fora do formato UUID;
- o mesmo ID pode aparecer para sellers diferentes;
- IDs numéricos podem possuir zeros à esquerda;
- o ID do seller não representa o `Product.Id` global.

## Duplicidade de IDs

Foram encontrados 14 IDs repetidos globalmente. Esses casos ocorrem entre sellers diferentes e confirmam que `SellerProductId` não pode ser uma chave global.

A identidade da oferta será:

```text
SellerName + SellerProductId
```

Foi encontrada uma repetição da combinação completa:

```text
SellerName = GardenStore
SellerProductId = e5e5e5e5-f6f6-4a7a-b8b8-c9c9c9c9c9c9
```

As duas ocorrências possuem o mesmo seller e o mesmo ID de origem. Os nomes diferem apenas por acentuação:

```text
Câmera Canon EOS R6
Camera Canon EOS R6
```

Após a normalização, ambos resultam em:

```text
camera canon eos r6
```

Esse caso será tratado como duplicata equivalente do input:

- uma única relação será persistida;
- a ocorrência adicional será ignorada pelo `UNIQUE`;
- a importação não será abortada.

A comparação de duplicatas usa os campos normalizados. Conteúdo divergente após a normalização continuará sendo rejeitado. Caso o mesmo par `SellerName + SellerProductId` apareça associado a produtos diferentes, a importação deverá falhar antes de qualquer escrita.

## Chave de matching

A análise utilizou:

```text
normalize(Name) + "\u0000" + normalize(Brand)
```

Após a normalização:

- foram encontradas 201 chaves distintas;
- 64 grupos de chaves apareceram mais de uma vez;
- houve 68 registros extras causados por repetição de chave.

Isso confirma que a aplicação precisa atualizar o índice em memória imediatamente após criar um novo produto. Caso contrário, dois itens equivalentes dentro do mesmo arquivo poderiam gerar dois produtos em `Product`.

## Correspondência com o catálogo

Com normalização genérica e sem aliases, foram encontradas 266 correspondências e 3 registros sem correspondência.

### Registros sem correspondência

| Nome                            | Marca                      | Seller        | Motivo                                          |
| ------------------------------- | -------------------------- | ------------- | ----------------------------------------------- |
| `Roteador WiFi 6 TP-Link`       | `TP-Link`                  | `FootwearHub` | Variação semântica entre idiomas                |
| `Processador AMD Ryzen 9 7950X` | `AMD`                      | `SuperMart`   | Variação semântica entre idiomas                |
| `Security Test Product`         | `TestBrand'; SELECT 1; --` | `MegaStore`   | Produto novo; valor usado no teste de segurança |

Os dois primeiros possuem equivalentes em inglês no catálogo:

- `Router WiFi 6 TP-Link`;
- `Processor AMD Ryzen 9 7950X`.

A normalização genérica não fará tradução automática. A primeira versão não terá aliases embutidos específicos do fixture.

Essa decisão mantém a solução:

- determinística;
- genérica;
- independente dos produtos fornecidos;
- protegida contra falsos positivos de tradução.

Aliases poderão ser adicionados futuramente por configuração externa e versionada, caso o domínio forneça esse conhecimento.

## Marcas nulas

Existem 3 registros com `Brand = null`. Não foram encontradas colisões entre eles usando a chave de matching.

A regra adotada será:

```text
Brand = null somente casa com Brand = null
```

Uma marca ausente não será considerada evidência suficiente para associar o produto a uma marca preenchida.

## Conflitos de categoria

Foi encontrado um conflito:

| Produto               | Categoria recebida | Categoria no catálogo | `Product.Id` |
| --------------------- | ------------------ | --------------------- | -----------: |
| `Camera Canon EOS R6` | `Photo`            | `Photography`         |           18 |

Isso confirma que `Category` não deve ser parte obrigatória da chave de matching.

A categoria será:

- preservada no produto novo;
- mantida inalterada no produto canônico existente;
- comparada para gerar métricas de conflito;
- incapaz de impedir um match por si só.

## Decisões confirmadas

1. `database.json` é o input dos sellers.
2. `catalog.db` é o catálogo consolidado existente.
3. `Product.Id` é gerado pelo catálogo e não será reutilizado a partir do JSON.
4. `SellerProductId` será armazenado como `TEXT`.
5. A identidade da oferta será `SellerName + SellerProductId`.
6. A chave de matching será baseada em nome e marca normalizados.
7. `Category` será atributo auxiliar, não requisito obrigatório.
8. `Brand = null` somente casará com `Brand = null`.
9. Duplicatas equivalentes após normalização no input serão ignoradas de forma idempotente; colisões divergentes após normalização serão rejeitadas.
10. Colisões semânticas de `SellerName + SellerProductId` serão rejeitadas antes da escrita.
11. Não haverá produtos, sellers, categorias ou aliases hardcoded.
12. Matching semântico entre idiomas ficará documentado como limitação.
13. A solução deverá funcionar com outros arquivos de entrada e outros catálogos compatíveis com o contrato.

## Limitações identificadas

A chave `Name + Brand` é uma aproximação porque o input não fornece identificadores globais como:

- SKU;
- EAN;
- GTIN;
- código de fabricante;
- identificador global do produto.

Consequentemente, a primeira versão não resolverá de forma geral:

- traduções entre idiomas;
- sinônimos desconhecidos;
- descrições semanticamente equivalentes;
- produtos com nomes muito diferentes;
- possíveis falsos positivos em nomes genéricos.

Esses casos podem ser tratados futuramente com identificadores confiáveis, aliases externos, matching assistido ou revisão manual.

## Conclusão

A Fase 0 confirma que a estratégia inicial deve ser baseada em normalização genérica, índice em memória, persistência idempotente e métricas explícitas de conflito.

Os valores observados neste relatório servem para validar o fixture. Eles não serão usados como regras fixas ou contagens esperadas no código de produção.
