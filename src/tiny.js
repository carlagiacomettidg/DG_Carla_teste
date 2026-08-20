const TINY_API_BASE = "https://api.tiny.com.br/api2";
const tinyBlockedPattern = /api bloqueada|excedido o numero de acessos|excedido o número de acessos/i;

function clean(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getToken() {
  const token = clean(process.env.TINY_API_TOKEN);
  if (!token) {
    throw new Error("TINY_API_TOKEN nao configurado no Vercel.");
  }
  return token;
}

async function tinyRequest(endpoint, params = {}) {
  const body = new URLSearchParams({
    token: getToken(),
    formato: "JSON",
    ...Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
    )
  });

  const response = await fetch(`${TINY_API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
    },
    body
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Tiny retornou uma resposta invalida em ${endpoint}: ${text.slice(0, 180)}`);
  }

  if (!response.ok) {
    throw new Error(`Tiny HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }

  const retorno = payload.retorno || payload;
  if (String(retorno.status || "").toLowerCase() === "erro") {
    const messages = (retorno.erros || [])
      .map((item) => item?.erro || item?.mensagem || JSON.stringify(item))
      .filter(Boolean)
      .join("; ");
    if (tinyBlockedPattern.test(messages)) {
      const error = new Error("API Bloqueada - Excedido o numero de acessos a API. Aguarde alguns minutos e tente novamente.");
      error.code = "TINY_RATE_LIMIT";
      throw error;
    }
    throw new Error(messages || `Tiny retornou erro em ${endpoint}.`);
  }

  return retorno;
}

function unwrapList(items, key) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => item?.[key] || item).filter(Boolean);
}

export async function findTinyPriceList(name = process.env.TINY_PRICE_LIST_NAME || "Atacado") {
  const target = normalizeName(name);
  const retorno = await tinyRequest("listas.precos.pesquisa.php", { pesquisa: name, pagina: 1 });
  const lists = unwrapList(retorno.registros, "registro");
  const exact = lists.find((item) => normalizeName(item.descricao) === target);
  return exact || lists[0] || null;
}

export async function findTinyPriceLists({
  keyword = process.env.TINY_PRICE_LIST_KEYWORD || process.env.TINY_PRICE_LIST_NAME || "Atacado",
  exactNames = process.env.TINY_PRICE_LIST_NAMES || ""
} = {}) {
  const names = exactNames
    .split(",")
    .map((name) => normalizeName(name))
    .filter(Boolean);
  const target = normalizeName(keyword);
  const search = names[0] || keyword || "Atacado";
  const matches = [];
  const seen = new Set();

  for (let page = 1; page <= 20; page += 1) {
    const retorno = await tinyRequest("listas.precos.pesquisa.php", { pesquisa: search, pagina: page });
    const lists = unwrapList(retorno.registros, "registro");
    if (!lists.length) break;

    lists.forEach((item) => {
      const id = clean(item.id);
      const normalized = normalizeName(item.descricao);
      const exactMatch = names.length > 0 ? names.includes(normalized) : false;
      const keywordMatch = names.length === 0 && normalized.includes(target);

      if ((exactMatch || keywordMatch) && id && !seen.has(id)) {
        seen.add(id);
        matches.push(item);
      }
    });

    const totalPages = Number(retorno.numero_paginas || retorno.total_paginas || 0);
    if (totalPages && page >= totalPages) break;
    if (!totalPages && lists.length < 100) break;
  }

  return matches;
}

export async function findTinyProductBySku(sku) {
  const normalizedSku = clean(sku);
  if (!normalizedSku) throw new Error("SKU nao informado para consulta no Tiny.");

  const retorno = await tinyRequest("produtos.pesquisa.php", {
    pesquisa: normalizedSku,
    pagina: 1,
    situacao: "A"
  });
  const products = unwrapList(retorno.produtos, "produto");
  const exact = products.find((product) => clean(product.codigo).toLowerCase() === normalizedSku.toLowerCase());
  return exact || null;
}

export async function getTinyWholesalePrice({ productId, priceListId }) {
  if (!productId || !priceListId) return null;

  const retorno = await tinyRequest("listas.precos.excecoes.php", {
    idListaPreco: priceListId,
    idProduto: productId,
    pagina: 1
  });
  const records = unwrapList(retorno.registros, "registro");
  const record = records.find((item) => String(item.id_produto || "") === String(productId)) || records[0];
  if (!record) return null;

  const promotional = Number(record.preco_promocional || 0);
  const price = Number(record.preco || 0);
  return promotional > 0 ? promotional : price;
}

export async function getTinyPriceListExceptions(priceList) {
  if (!priceList?.id) return [];

  const records = [];
  for (let page = 1; page <= 100; page += 1) {
    const retorno = await tinyRequest("listas.precos.excecoes.php", {
      idListaPreco: priceList.id,
      pagina: page
    });
    const pageRecords = unwrapList(retorno.registros, "registro");
    records.push(...pageRecords);

    const totalPages = Number(retorno.numero_paginas || retorno.total_paginas || 0);
    if (totalPages && page >= totalPages) break;
    if (!totalPages || !pageRecords.length) break;
  }

  return records;
}

export async function buildTinyWholesalePriceIndex(priceLists) {
  const items = [];
  const seen = new Set();

  for (const priceList of priceLists || []) {
    const records = await getTinyPriceListExceptions(priceList);
    records.forEach((record) => {
      const productId = clean(record.id_produto);
      if (!productId || seen.has(productId)) return;

      const promotional = Number(record.preco_promocional || 0);
      const price = Number(record.preco || 0);
      const wholesalePrice = promotional > 0 ? promotional : price;
      if (wholesalePrice <= 0) return;

      seen.add(productId);
      items.push({
        productId,
        wholesalePrice,
        priceList: {
          id: String(priceList.id || ""),
          name: clean(priceList.descricao),
          adjustmentPercent: Number(priceList.acrescimo_desconto || 0)
        }
      });
    });
  }

  return items;
}

export async function getTinyStockByDeposit({
  productId,
  depositName = process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado"
}) {
  if (!productId) return null;

  const retorno = await tinyRequest("produto.obter.estoque.php", { id: productId });
  const product = retorno.produto || {};
  const deposits = unwrapList(product.depositos, "deposito");
  const target = normalizeName(depositName);
  const deposit = deposits.find((item) => normalizeName(item.nome) === target) || null;
  const stock = deposit ? Number(deposit.saldo || 0) : Number(product.saldo || 0);

  return {
    sku: clean(product.codigo),
    productName: clean(product.nome),
    productId: String(productId || ""),
    totalStock: Number(product.saldo || 0),
    stock,
    deposit,
    deposits
  };
}

export async function getTinyWholesaleBySku({
  sku,
  priceListName = process.env.TINY_PRICE_LIST_NAME || "Atacado",
  depositName = process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado",
  priceList
}) {
  const resolvedPriceList = priceList || (await findTinyPriceList(priceListName));
  if (!resolvedPriceList) {
    throw new Error(`Lista de preco "${priceListName}" nao encontrada no Tiny.`);
  }

  const product = await findTinyProductBySku(sku);
  if (!product) {
    throw new Error(`Produto com SKU "${sku}" nao encontrado no Tiny.`);
  }

  const [price, stockData] = await Promise.all([
    getTinyWholesalePrice({ productId: product.id, priceListId: resolvedPriceList.id }),
    getTinyStockByDeposit({ productId: product.id, depositName })
  ]);

  return {
    sku: clean(product.codigo || sku),
    productId: String(product.id || ""),
    productName: clean(product.nome),
    priceList: {
      id: String(resolvedPriceList.id || ""),
      name: clean(resolvedPriceList.descricao),
      adjustmentPercent: Number(resolvedPriceList.acrescimo_desconto || 0)
    },
    wholesalePrice: Number(price || product.preco || 0),
    wholesaleStock: Number(stockData?.stock || 0),
    stockDeposit: stockData?.deposit
      ? {
          name: clean(stockData.deposit.nome),
          stock: Number(stockData.deposit.saldo || 0),
          ignored: clean(stockData.deposit.desconsiderar)
        }
      : null,
    availableDeposits: stockData?.deposits?.map((deposit) => ({
      name: clean(deposit.nome),
      stock: Number(deposit.saldo || 0),
      ignored: clean(deposit.desconsiderar)
    })) || []
  };
}

export async function getTinyWholesaleBySkuFromPriceLists({
  sku,
  priceLists,
  depositName = process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado"
}) {
  const lists = Array.isArray(priceLists) ? priceLists : [];
  if (!lists.length) {
    throw new Error("Nenhuma lista de preco de atacado encontrada no Tiny.");
  }

  const product = await findTinyProductBySku(sku);
  if (!product) {
    throw new Error(`Produto com SKU "${sku}" nao encontrado no Tiny.`);
  }

  let resolvedPriceList = null;
  let price = 0;

  for (const priceList of lists) {
    const listPrice = await getTinyWholesalePrice({ productId: product.id, priceListId: priceList.id });
    if (Number(listPrice || 0) > 0) {
      resolvedPriceList = priceList;
      price = listPrice;
      break;
    }
  }

  if (!resolvedPriceList) {
    throw new Error(`Preco de atacado para SKU "${sku}" nao encontrado nas listas de atacado do Tiny.`);
  }

  const stockData = await getTinyStockByDeposit({ productId: product.id, depositName });

  return {
    sku: clean(product.codigo || sku),
    productId: String(product.id || ""),
    productName: clean(product.nome),
    priceList: {
      id: String(resolvedPriceList.id || ""),
      name: clean(resolvedPriceList.descricao),
      adjustmentPercent: Number(resolvedPriceList.acrescimo_desconto || 0)
    },
    wholesalePrice: Number(price || 0),
    wholesaleStock: Number(stockData?.stock || 0),
    stockDeposit: stockData?.deposit
      ? {
          name: clean(stockData.deposit.nome),
          stock: Number(stockData.deposit.saldo || 0),
          ignored: clean(stockData.deposit.desconsiderar)
        }
      : null,
    availableDeposits: stockData?.deposits?.map((deposit) => ({
      name: clean(deposit.nome),
      stock: Number(deposit.saldo || 0),
      ignored: clean(deposit.desconsiderar)
    })) || []
  };
}

export async function getTinyStatus() {
  const sku = clean(process.env.TINY_TEST_SKU || "");
  const priceListName = clean(process.env.TINY_PRICE_LIST_NAME || "Atacado");
  const priceListKeyword = clean(process.env.TINY_PRICE_LIST_KEYWORD || priceListName);
  const depositName = clean(process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado");
  const priceList = await findTinyPriceList(priceListName);
  const priceLists = await findTinyPriceLists({ keyword: priceListKeyword });

  return {
    configured: true,
    priceListName,
    priceListKeyword,
    depositName,
    testSku: sku,
    priceList,
    priceLists
  };
}
