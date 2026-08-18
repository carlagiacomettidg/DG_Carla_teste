const TINY_API_BASE = "https://api.tiny.com.br/api2";

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
  return exact || products[0] || null;
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
    totalStock: Number(product.saldo || 0),
    stock,
    deposit,
    deposits
  };
}

export async function getTinyWholesaleBySku({
  sku,
  priceListName = process.env.TINY_PRICE_LIST_NAME || "Atacado",
  depositName = process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado"
}) {
  const priceList = await findTinyPriceList(priceListName);
  if (!priceList) {
    throw new Error(`Lista de preco "${priceListName}" nao encontrada no Tiny.`);
  }

  const product = await findTinyProductBySku(sku);
  if (!product) {
    throw new Error(`Produto com SKU "${sku}" nao encontrado no Tiny.`);
  }

  const [price, stockData] = await Promise.all([
    getTinyWholesalePrice({ productId: product.id, priceListId: priceList.id }),
    getTinyStockByDeposit({ productId: product.id, depositName })
  ]);

  return {
    sku: clean(product.codigo || sku),
    productId: String(product.id || ""),
    productName: clean(product.nome),
    priceList: {
      id: String(priceList.id || ""),
      name: clean(priceList.descricao),
      adjustmentPercent: Number(priceList.acrescimo_desconto || 0)
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

export async function getTinyStatus() {
  const sku = clean(process.env.TINY_TEST_SKU || "");
  const priceListName = clean(process.env.TINY_PRICE_LIST_NAME || "Atacado");
  const depositName = clean(process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado");
  const priceList = await findTinyPriceList(priceListName);

  return {
    configured: true,
    priceListName,
    depositName,
    testSku: sku,
    priceList
  };
}
