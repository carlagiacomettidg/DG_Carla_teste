import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readDb, updateDb } from "./storage.js";
import {
  buildLocationPrioritizationResponse,
  chooseLocationPriority,
  chooseWholesaleLocationPriority,
  isApprovedWholesaleCustomer,
  isValidCnpj,
  money,
  normalizeDocument,
  normalizeSku
} from "./rules.js";
import { parseSpreadsheetAsync } from "./importer.js";
import {
  buildInstallUrl,
  createCustomer,
  exchangeCodeForToken,
  findCustomerByEmail,
  getCustomer,
  listAllCustomers,
  listAllProducts,
  listLocations,
  registerLocationBusinessRule,
  updateCustomer
} from "./nuvemshop.js";
import { buildTinyWholesalePriceIndex, findTinyPriceList, findTinyPriceLists, getTinyStatus, getTinyStockByDeposit, getTinyWholesaleBySku, getTinyWholesaleBySkuFromPriceLists, listTinyStockUpdates, searchTinyProducts, tinyDefaultStockSince } from "./tiny.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = "2026-09-02-fast-tiny-sync-v1";
const TINY_SYNC_BATCH_SIZE = Math.max(1, Math.min(80, Number(process.env.TINY_SYNC_BATCH_SIZE || 30)));
const TINY_SYNC_ITEM_DELAY_MS = Math.max(0, Math.min(2000, Number(process.env.TINY_SYNC_ITEM_DELAY_MS || 120)));
const TINY_SYNC_MAX_RUNTIME_MS = Math.max(3000, Math.min(25000, Number(process.env.TINY_SYNC_MAX_RUNTIME_MS || 8500)));
const TINY_AUTO_SYNC_INTERVAL_MINUTES = Math.max(5, Math.min(1440, Number(process.env.TINY_AUTO_SYNC_INTERVAL_MINUTES || 15)));
const TINY_PRICE_SYNC_BATCH_SIZE = Math.max(50, Math.min(2000, Number(process.env.TINY_PRICE_SYNC_BATCH_SIZE || 700)));
const TINY_DISCOVERY_BATCH_SIZE = Math.max(0, Math.min(25, Number(process.env.TINY_DISCOVERY_BATCH_SIZE || 12)));
const TINY_SKU_INDEX_BATCH_SIZE = Math.max(0, Math.min(80, Number(process.env.TINY_SKU_INDEX_BATCH_SIZE || 25)));
const allowedCorsOrigins = [
  "https://venusmodas4.lojavirtualnuvem.com.br",
  "https://dg-venus-modas.vercel.app"
];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return "";
  if (allowedCorsOrigins.includes(origin)) return origin;
  try {
    const hostname = new URL(origin).hostname;
    if (hostname.endsWith(".lojavirtualnuvem.com.br")) return origin;
  } catch {
    return "";
  }
  return "";
}

function corsHeaders(req) {
  const origin = getCorsOrigin(req);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
}

function sendJson(req, res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) });
  res.end(JSON.stringify(payload, null, 2));
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sendText(req, res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(req) });
  res.end(text);
}

function base64UrlDecode(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function verifyNexoSessionToken(req) {
  const secret = cleanString(process.env.NUVEMSHOP_CLIENT_SECRET);
  if (!secret) {
    throw new Error("NUVEMSHOP_CLIENT_SECRET nao configurado para validar o painel.");
  }

  const authorization = cleanString(req.headers.authorization);
  const token = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new Error("Token de sessao do painel ausente.");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token de sessao do painel invalido.");

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(base64UrlDecode(headerPart).toString("utf8"));
  if (header.alg !== "HS256") throw new Error("Assinatura do token do painel nao suportada.");

  const expectedSignature = base64UrlEncode(createHmac("sha256", secret).update(`${headerPart}.${payloadPart}`).digest());
  const received = Buffer.from(signaturePart);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Assinatura do token do painel invalida.");
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
  if (payload.exp && Number(payload.exp) * 1000 < Date.now()) {
    throw new Error("Token de sessao do painel expirado.");
  }

  return payload;
}

function isPublicRoute(req, pathname) {
  if (req.method === "GET" && ["/health", "/app-version", "/api/public-config", "/auth/install", "/auth/start", "/auth/callback"].includes(pathname)) {
    return true;
  }
  if (req.method === "POST" && ["/webhooks/store-redact", "/webhooks/customers-redact", "/webhooks/customers-data-request"].includes(pathname)) {
    return true;
  }
  if (req.method === "GET" && pathname === "/api/storefront-wholesale-context") return true;
  if (req.method === "GET" && pathname === "/api/cron/tiny-sync") return true;
  if (req.method === "GET" && pathname === "/api/tiny/debug-sku") return true;
  if (req.method === "POST" && pathname === "/api/wholesale-requests") return true;
  return false;
}

function requireAdminApi(req, res, pathname) {
  if (!pathname.startsWith("/api/")) return true;
  if (isPublicRoute(req, pathname)) return true;

  try {
    req.adminSession = verifyNexoSessionToken(req);
    return true;
  } catch (error) {
    sendJson(req, res, 401, {
      error: "Acesso restrito ao painel da Nuvemshop.",
      detail: error.message
    });
    return false;
  }
}

function sendCsv(res, filename, rows) {
  const headers = [
    "product_id",
    "variant_id",
    "sku",
    "produto",
    "variacao",
    "preco_varejo",
    "preco_atacado",
    "estoque_atacado"
  ];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    headers.join(";"),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(";"))
  ].join("\n");

  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`
  });
  res.end(`\uFEFF${csv}`);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function parseRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseMultipartFile(buffer, contentType) {
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) return null;

  const raw = buffer.toString("binary");
  const parts = raw.split(`--${boundary}`);
  const filePart = parts.find((part) => part.includes("filename="));
  if (!filePart) return null;

  const [rawHeaders, ...bodyParts] = filePart.split("\r\n\r\n");
  const filename = rawHeaders.match(/filename="([^"]+)"/)?.[1] || "import.xlsx";
  const body = bodyParts.join("\r\n\r\n").replace(/\r\n--$/, "").replace(/\r\n$/, "");

  return {
    filename,
    buffer: Buffer.from(body, "binary")
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname =
    url.pathname === "/"
      ? "/index.html"
      : url.pathname === "/cadastro-atacado"
        ? "/cadastro-atacado.html"
        : url.pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    return sendText(req, res, 403, "Forbidden");
  }

  try {
    const content = await fs.readFile(resolved);
    const ext = path.extname(resolved);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(content);
  } catch {
    sendText(req, res, 404, "Not found");
  }
}

function isRoute(req, method, pathname) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return req.method === method && url.pathname === pathname;
}

function normalizeLocation(location) {
  const clean = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return "";
    return String(value).trim();
  };
  const localized = (value) => {
    if (typeof value === "string") return clean(value);
    if (!value || typeof value !== "object") return "";
    return (
      clean(value.pt_BR) ||
      clean(value.pt) ||
      clean(value.en_US) ||
      clean(value.en) ||
      clean(value.es_AR) ||
      clean(value.es_MX) ||
      clean(value.es_CL) ||
      clean(value.es_CO) ||
      clean(value.es) ||
      clean(value["*"])
    );
  };
  const address =
    typeof location.address === "object" && location.address !== null
      ? [
          location.address.street,
          location.address.number,
          location.address.locality,
          location.address.city,
          location.address.province,
          location.address.state,
          location.address.zipcode || location.address.postal_code
        ]
      : [location.address];
  const addressParts = [
    ...address,
    location.street,
    location.number,
    location.floor,
    location.locality,
    location.city,
    location.province,
    location.state,
    location.zipcode || location.postal_code
  ].map(clean).filter(Boolean);

  return {
    id: clean(location.id),
    name: localized(location.name) || localized(location.description) || clean(location.code) || `CD ${clean(location.id)}`,
    address: addressParts.join(", "),
    raw: location
  };
}

function sameStore(store, storeId) {
  return String(store?.id || "") === String(storeId || "");
}

function cleanString(value) {
  return String(value || "").trim();
}

function normalizeComparable(value) {
  return cleanString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildWholesaleAddress(body) {
  return {
    zipcode: cleanString(body.zipcode),
    address: cleanString(body.address),
    number: cleanString(body.number),
    floor: cleanString(body.complement),
    locality: cleanString(body.locality),
    city: cleanString(body.city),
    province: cleanString(body.province),
    country: "BR",
    phone: cleanString(body.phone)
  };
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== "")
  );
}

function buildWholesaleCustomerPayload({ body, email, cnpj, address, requestStatus, password = "", includeAccess = false }) {
  return compactObject({
    name: cleanString(body.name || body.companyName),
    email,
    phone: cleanString(body.phone),
    identification: cnpj,
    password: includeAccess ? password : undefined,
    send_email_invite: includeAccess ? true : undefined,
    addresses: [compactObject(address)],
    extra: compactObject({
      tipo_cliente: "atacado",
      wholesale: "true",
      cnpj,
      company_name: cleanString(body.companyName),
      razao_social: cleanString(body.companyName),
      birthdate: cleanString(body.birthdate),
      data_nascimento: cleanString(body.birthdate),
      aprovacao_atacado: requestStatus,
      accepts_marketing: body.acceptsMarketing === true || body.acceptsMarketing === "on" ? "true" : "false"
    })
  });
}

function customerExtra(customer) {
  return customer?.extra && typeof customer.extra === "object" ? customer.extra : {};
}

function isWholesaleNuvemshopCustomer(customer) {
  const extra = customerExtra(customer);
  return (
    String(extra.tipo_cliente || "").toLowerCase() === "atacado" ||
    String(extra.wholesale || "").toLowerCase() === "true" ||
    String(extra.aprovacao_atacado || "").toLowerCase() === "approved" ||
    String(extra.aprovacao_atacado || "").toLowerCase() === "pending"
  );
}

function mapNuvemshopWholesaleCustomer(customer) {
  const extra = customerExtra(customer);
  const requestStatus = String(extra.aprovacao_atacado || "pending");
  return {
    id: String(customer.id),
    nuvemshopCustomerId: String(customer.id),
    name: cleanString(customer.name),
    companyName: cleanString(extra.company_name || extra.razao_social),
    email: cleanString(customer.email),
    phone: cleanString(customer.phone),
    cnpj: normalizeDocument(customer.identification || extra.cnpj || ""),
    birthdate: cleanString(extra.birthdate || extra.data_nascimento),
    acceptsMarketing: String(extra.accepts_marketing || "").toLowerCase() === "true",
    requestStatus,
    approved: requestStatus === "approved",
    active: customer.active === true,
    discountPercent: Number(extra.discount_percent || 0),
    totalOrders: Number(customer.total_orders || 0),
    totalSpent: money(customer.total_spent || 0),
    source: "nuvemshop",
    createdAt: customer.created_at || new Date().toISOString()
  };
}

function mapStorefrontRule(rule) {
  return {
    productId: String(rule.productId || ""),
    variantId: String(rule.variantId || ""),
    sku: normalizeSku(rule.sku),
    productName: cleanString(rule.productName),
    variantName: cleanString(rule.variantName),
    url: cleanString(rule.productUrl || rule.url),
    wholesalePrice: money(rule.wholesalePrice),
    wholesaleStock: Number(rule.wholesaleStock || 0)
  };
}

async function listNuvemshopWholesaleCustomers(db) {
  if (!db.store?.id || !db.store?.accessToken) {
    return [];
  }
  const customers = await listAllCustomers({
    storeId: db.store.id,
    accessToken: db.store.accessToken
  });
  return customers.filter(isWholesaleNuvemshopCustomer).map(mapNuvemshopWholesaleCustomer);
}

function tinySyncStatus(job = null) {
  if (!job) {
    return {
      status: "idle",
      totalItems: 0,
      processedItems: 0,
      remainingItems: 0,
      updatedRulesTotal: 0,
      skippedItemsTotal: 0,
      errorsTotal: 0,
      notFoundTotal: 0,
      lastMessage: "Nenhuma sincronizacao do Tiny em andamento."
    };
  }

  const totalItems = Array.isArray(job.items) ? job.items.length : Number(job.totalItems || 0);
  const processedItems = Math.min(Number(job.cursor || 0), totalItems);
  const startedAtMs = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  const elapsedMinutes = startedAtMs ? Math.max(0, (Date.now() - startedAtMs) / 60000) : 0;
  const itemsPerMinute = elapsedMinutes > 0 ? Math.round((processedItems / elapsedMinutes) * 10) / 10 : 0;
  const estimatedMinutesRemaining = itemsPerMinute > 0
    ? Math.ceil(Math.max(0, totalItems - processedItems) / itemsPerMinute)
    : 0;
  return {
    status: job.status || "queued",
    totalItems,
    processedItems,
    remainingItems: Math.max(0, totalItems - processedItems),
    itemsPerMinute,
    estimatedMinutesRemaining,
    updatedRulesTotal: Number(job.updatedRulesTotal || 0),
    updatedPricesTotal: Number(job.updatedPricesTotal || 0),
    updatedStocksTotal: Number(job.updatedStocksTotal || 0),
    discoveredLinksTotal: Number(job.discoveredLinksTotal || 0),
    skuSearchTotal: Array.isArray(job.skuSearchKeys) ? job.skuSearchKeys.length : 0,
    skuSearchProcessed: Number(job.skuSearchCursor || 0),
    skuSearchRemaining: Math.max(
      0,
      (Array.isArray(job.skuSearchKeys) ? job.skuSearchKeys.length : 0) - Number(job.skuSearchCursor || 0)
    ),
    skippedItemsTotal: Number(job.skippedItemsTotal || 0),
    errorsTotal: Array.isArray(job.errors) ? job.errors.length : 0,
    notFoundTotal: Array.isArray(job.notFound) ? job.notFound.length : 0,
    priceListKeyword: job.priceListKeyword || "",
    depositName: job.depositName || "",
    startedAt: job.startedAt || "",
    updatedAt: job.updatedAt || "",
    finishedAt: job.finishedAt || "",
    rateLimitedUntil: job.rateLimitedUntil || "",
    lastMessage: job.lastMessage || ""
  };
}

function shouldAutoStartTinySync(job = null) {
  if (!job) return true;
  if (["queued", "processing", "rate_limited"].includes(String(job.status || ""))) return false;
  const finishedAtMs = job.finishedAt ? new Date(job.finishedAt).getTime() : 0;
  const updatedAtMs = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
  const lastRunMs = Math.max(finishedAtMs, updatedAtMs);
  if (!lastRunMs) return true;
  return Date.now() - lastRunMs >= TINY_AUTO_SYNC_INTERVAL_MINUTES * 60 * 1000;
}

function tinySkuSearchKey(sku) {
  const value = normalizeSku(sku);
  if (!value) return "";
  const base = value.split(/[-_/.\s]/).find(Boolean) || value;
  if (base.length >= 3) return base;
  return value.slice(0, 6);
}

async function startTinySyncJob({ restart = false } = {}) {
  const current = await readDb();
  const currentJob = current.tinySyncJob;
  if (
    currentJob &&
    !restart &&
    ["queued", "processing", "rate_limited"].includes(String(currentJob.status || ""))
  ) {
    return { status: tinySyncStatus(currentJob), rules: current.rules || [] };
  }

  const rulesWithSku = (current.rules || []).filter((rule) => normalizeSku(rule.sku));
  if (!rulesWithSku.length) {
    throw new Error("Nenhum SKU da Nuvemshop encontrado no app. Clique primeiro em Sincronizar produtos.");
  }

  const priceListKeyword = process.env.TINY_PRICE_LIST_KEYWORD || process.env.TINY_PRICE_LIST_NAME || "Atacado";
  const depositName = process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado";
  const priceLists = await findTinyPriceLists({ keyword: priceListKeyword });
  if (!priceLists.length) {
    throw new Error(`Nenhuma lista de preco contendo "${priceListKeyword}" foi encontrada no Tiny.`);
  }

  const items = await buildTinyWholesalePriceIndex(priceLists);
  const skuSearchKeys = Array.from(
    new Set(
      rulesWithSku
        .filter((rule) => !rule.tinyProductId)
        .map((rule) => tinySkuSearchKey(rule.sku))
        .filter(Boolean)
    )
  );
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    status: items.length ? "queued" : "done",
    priceListKeyword,
    depositName,
    priceLists: priceLists.map((list) => ({
      id: String(list.id || ""),
      name: String(list.descricao || ""),
      adjustmentPercent: Number(list.acrescimo_desconto || 0)
    })),
    items,
    skuSearchKeys,
    skuSearchCursor: 0,
    cursor: 0,
    totalItems: items.length,
    updatedRulesTotal: 0,
    updatedPricesTotal: 0,
    updatedStocksTotal: 0,
    discoveredLinksTotal: 0,
    skippedItemsTotal: 0,
    errors: [],
    notFound: [],
    stockSince: current.tinyStockUpdatesSince || tinyDefaultStockSince(),
    startedAt: now,
    updatedAt: now,
    finishedAt: items.length ? "" : now,
    lastMessage: items.length
      ? `Fila criada com ${items.length} itens de preco do Tiny.`
      : "Nenhum item de preco foi encontrado nas listas de atacado do Tiny."
  };

  const next = await updateDb((state) => {
    state.tinySyncJob = job;
    state.tinySyncCursor = 0;
    return state;
  });

  return { status: tinySyncStatus(next.tinySyncJob), rules: next.rules || [] };
}

async function processTinySyncJobBatch() {
  const db = await readDb();
  const job = db.tinySyncJob;
  if (!job || !Array.isArray(job.items)) {
    return { status: tinySyncStatus(null), rules: db.rules || [] };
  }

  const nowMs = Date.now();
  if (job.rateLimitedUntil && new Date(job.rateLimitedUntil).getTime() > nowMs) {
    return { status: tinySyncStatus(job), rules: db.rules || [] };
  }

  if (job.status === "done") {
    return { status: tinySyncStatus(job), rules: db.rules || [] };
  }

  const rulesWithSku = (db.rules || []).filter((rule) => normalizeSku(rule.sku));
  const bySku = new Map();
  const byTinyProductId = new Map();
  rulesWithSku.forEach((rule) => {
    const sku = normalizeSku(rule.sku);
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(rule.id);
    if (rule.tinyProductId) {
      const tinyProductId = String(rule.tinyProductId);
      if (!byTinyProductId.has(tinyProductId)) byTinyProductId.set(tinyProductId, []);
      byTinyProductId.get(tinyProductId).push(rule.id);
    }
  });

  const allItems = job.items;
  const currentCursor = Math.max(0, Math.min(Number(job.cursor || 0), allItems.length));
  const batchItems = allItems.slice(currentCursor, currentCursor + TINY_PRICE_SYNC_BATCH_SIZE);
  const skuSearchKeys = Array.isArray(job.skuSearchKeys)
    ? job.skuSearchKeys
    : Array.from(
        new Set(
          rulesWithSku
            .filter((rule) => !rule.tinyProductId)
            .map((rule) => tinySkuSearchKey(rule.sku))
            .filter(Boolean)
        )
      );
  const skuSearchCursor = Math.max(0, Math.min(Number(job.skuSearchCursor || 0), skuSearchKeys.length));
  const skuSearchBatch = skuSearchKeys.slice(skuSearchCursor, skuSearchCursor + TINY_SKU_INDEX_BATCH_SIZE);
  const startedAtMs = Date.now();
  const priceUpdatesByRuleId = new Map();
  const skuLinksByRuleId = new Map();
  const batchErrors = [];
  const batchNotFound = [];
  let stoppedByRateLimit = false;
  let skippedItems = 0;
  let processedItems = 0;
  let discoveredLinks = 0;
  let processedSkuSearchKeys = 0;

  for (const searchKey of skuSearchBatch) {
    if (processedSkuSearchKeys > 0 && Date.now() - startedAtMs >= TINY_SYNC_MAX_RUNTIME_MS) {
      break;
    }

    try {
      const products = await searchTinyProducts({ search: searchKey, maxPages: 2 });
      products.forEach((product) => {
        const sku = normalizeSku(product.sku);
        const skuRuleIds = sku ? bySku.get(sku) || [] : [];
        skuRuleIds.forEach((ruleId) => {
          const tinyProductId = String(product.id || "");
          skuLinksByRuleId.set(ruleId, {
            productId: tinyProductId,
            productName: product.name || "",
            sku
          });
          if (tinyProductId) {
            if (!byTinyProductId.has(tinyProductId)) byTinyProductId.set(tinyProductId, []);
            if (!byTinyProductId.get(tinyProductId).includes(ruleId)) {
              byTinyProductId.get(tinyProductId).push(ruleId);
            }
          }
        });
      });
      processedSkuSearchKeys += 1;
    } catch (error) {
      const message = error.message || "";
      if (error.code === "TINY_RATE_LIMIT" || message.toLowerCase().includes("api bloqueada")) {
        stoppedByRateLimit = true;
        batchErrors.push({ scope: "sku_index", searchKey, error: message });
        break;
      }
      batchErrors.push({ scope: "sku_index", searchKey, error: message });
      processedSkuSearchKeys += 1;
    }
  }

  const nextSkuSearchCursor = Math.min(skuSearchKeys.length, skuSearchCursor + processedSkuSearchKeys);
  const skuIndexDone = nextSkuSearchCursor >= skuSearchKeys.length;

  for (const item of skuIndexDone ? batchItems : []) {
    if (stoppedByRateLimit) break;
    if (processedItems > 0 && Date.now() - startedAtMs >= TINY_SYNC_MAX_RUNTIME_MS) {
      break;
    }

    try {
      const linkedRuleIds = byTinyProductId.get(String(item.productId || "")) || [];
      if (linkedRuleIds.length) {
        linkedRuleIds.forEach((ruleId) => {
          priceUpdatesByRuleId.set(ruleId, {
            productId: String(item.productId || ""),
            priceList: item.priceList,
            wholesalePrice: Number(item.wholesalePrice || 0)
          });
        });
        processedItems += 1;
        continue;
      }

      if (discoveredLinks >= TINY_DISCOVERY_BATCH_SIZE) {
        skippedItems += 1;
        processedItems += 1;
        continue;
      }

      if (TINY_SYNC_ITEM_DELAY_MS > 0) await wait(TINY_SYNC_ITEM_DELAY_MS);
      const stockData = await getTinyStockByDeposit({ productId: item.productId, depositName: job.depositName });
      const sku = normalizeSku(stockData?.sku);
      const skuRuleIds = sku ? bySku.get(sku) || [] : [];
      if (!sku || !skuRuleIds.length) {
        skippedItems += 1;
        processedItems += 1;
        continue;
      }
      skuRuleIds.forEach((ruleId) => {
        priceUpdatesByRuleId.set(ruleId, {
          sku,
          productId: String(item.productId || ""),
          productName: stockData?.productName || "",
          priceList: item.priceList,
          wholesalePrice: Number(item.wholesalePrice || 0),
          wholesaleStock: Number(stockData?.stock || 0),
          stockDeposit: stockData?.deposit
            ? {
                name: cleanString(stockData.deposit.nome),
                stock: Number(stockData.stock || 0),
                ignored: cleanString(stockData.deposit.desconsiderar)
              }
            : null
        });
      });
      discoveredLinks += 1;
      processedItems += 1;
    } catch (error) {
      const message = error.message || "";
      if (error.code === "TINY_RATE_LIMIT" || message.toLowerCase().includes("api bloqueada")) {
        stoppedByRateLimit = true;
        batchErrors.push({ productId: item.productId, error: message });
        break;
      }
      if (message.includes("nao encontrado no Tiny")) {
        batchNotFound.push(item.productId);
      } else {
        batchErrors.push({ productId: item.productId, error: message });
      }
      processedItems += 1;
    }
  }

  const nextCursor = currentCursor + processedItems >= allItems.length ? allItems.length : currentCursor + processedItems;
  const finished = !stoppedByRateLimit && skuIndexDone && nextCursor >= allItems.length;
  const rateLimitedUntil = stoppedByRateLimit ? new Date(Date.now() + 2 * 60 * 1000).toISOString() : "";
  const updatedAt = new Date().toISOString();
  let stockSync = { updates: [], processedAt: job.stockSince || tinyDefaultStockSince(), error: "" };
  if (!stoppedByRateLimit && skuIndexDone) {
    try {
      stockSync = await listTinyStockUpdates({
        dataAlteracao: job.stockSince || db.tinyStockUpdatesSince || tinyDefaultStockSince(),
        depositName: job.depositName,
        maxPages: 5
      });
    } catch (error) {
      stockSync = {
        updates: [],
        processedAt: job.stockSince || db.tinyStockUpdatesSince || tinyDefaultStockSince(),
        error: error.message || String(error)
      };
    }
  }

  const next = await updateDb((state) => {
    let updatedRules = 0;
    let updatedPrices = 0;
    let updatedStocks = 0;
    const stockBySku = new Map();
    const stockByTinyProductId = new Map();
    (stockSync.updates || []).forEach((item) => {
      if (item.sku) stockBySku.set(normalizeSku(item.sku), item);
      if (item.productId) stockByTinyProductId.set(String(item.productId), item);
    });

    state.rules = (state.rules || []).map((rule) => {
      const priceUpdate = priceUpdatesByRuleId.get(rule.id);
      const skuLink = skuLinksByRuleId.get(rule.id);
      const stockUpdate =
        stockByTinyProductId.get(String(skuLink?.productId || rule.tinyProductId || "")) ||
        stockBySku.get(normalizeSku(rule.sku));
      if (!priceUpdate && !stockUpdate && !skuLink) return rule;

      if (priceUpdate || stockUpdate) updatedRules += 1;
      if (priceUpdate) updatedPrices += 1;
      if (stockUpdate) updatedStocks += 1;
      if (skuLink) discoveredLinks += 1;
      return {
        ...rule,
        productName: rule.productName || priceUpdate?.productName || stockUpdate?.productName || skuLink?.productName || "",
        wholesalePrice: priceUpdate ? money(priceUpdate.wholesalePrice) : rule.wholesalePrice,
        wholesaleStock: stockUpdate ? Number(stockUpdate.stock || 0) : priceUpdate?.wholesaleStock !== undefined ? Number(priceUpdate.wholesaleStock || 0) : Number(rule.wholesaleStock || 0),
        tinyProductId: priceUpdate?.productId || stockUpdate?.productId || skuLink?.productId || rule.tinyProductId || "",
        tinyPriceListId: priceUpdate?.priceList?.id || rule.tinyPriceListId || "",
        tinyPriceListName: priceUpdate?.priceList?.name || rule.tinyPriceListName || "",
        tinyStockDepositName: stockUpdate?.stockDeposit?.name || priceUpdate?.stockDeposit?.name || rule.tinyStockDepositName || job.depositName,
        tinySyncedAt: updatedAt,
        enabled: rule.enabled !== false
      };
    });

    state.tinyStockUpdatesSince = stockSync.error ? state.tinyStockUpdatesSince || job.stockSince : stockSync.processedAt;
    state.tinySyncJob = {
      ...job,
      status: stoppedByRateLimit ? "rate_limited" : finished ? "done" : "processing",
      skuSearchKeys,
      cursor: nextCursor,
      skuSearchCursor: nextSkuSearchCursor,
      updatedRulesTotal: Number(job.updatedRulesTotal || 0) + updatedRules,
      updatedPricesTotal: Number(job.updatedPricesTotal || 0) + updatedPrices,
      updatedStocksTotal: Number(job.updatedStocksTotal || 0) + updatedStocks,
      discoveredLinksTotal: Number(job.discoveredLinksTotal || 0) + discoveredLinks,
      skippedItemsTotal: Number(job.skippedItemsTotal || 0) + skippedItems,
      errors: [...(job.errors || []), ...batchErrors, ...(stockSync.error ? [{ scope: "stock_updates", error: stockSync.error }] : [])].slice(-100),
      notFound: [...(job.notFound || []), ...batchNotFound].slice(-100),
      updatedAt,
      finishedAt: finished ? updatedAt : "",
      rateLimitedUntil,
      stockSince: state.tinyStockUpdatesSince,
      lastMessage: stoppedByRateLimit
        ? "Tiny bloqueou temporariamente a API. A sincronizacao vai continuar automaticamente depois da pausa."
        : finished
          ? "Sincronizacao do Tiny finalizada."
          : skuIndexDone
            ? `Lote rapido processado. Faltam ${Math.max(0, allItems.length - nextCursor)} itens de preco.`
            : `Indexando vinculos por SKU. Faltam ${Math.max(0, skuSearchKeys.length - nextSkuSearchCursor)} grupos de SKU.`
    };

    return state;
  });

  return { status: tinySyncStatus(next.tinySyncJob), rules: next.rules || [] };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!requireAdminApi(req, res, url.pathname)) return true;

  if (isRoute(req, "GET", "/health")) {
    return sendJson(req, res, 200, { ok: true, app: "venos-nuvemshop-app", version: APP_VERSION });
  }

  if (isRoute(req, "GET", "/app-version")) {
    return sendJson(req, res, 200, { version: APP_VERSION });
  }

  if (isRoute(req, "GET", "/api/public-config")) {
    return sendJson(req, res, 200, {
      clientId: process.env.NUVEMSHOP_CLIENT_ID || "39172",
      embedded: true
    });
  }

  if (isRoute(req, "GET", "/auth/install")) {
    return sendJson(req, res, 200, {
      installUrl: buildInstallUrl(),
      note: "Abra esta URL para iniciar o OAuth no Portal de Parceiros/Nuvemshop."
    });
  }

  if (isRoute(req, "GET", "/auth/start")) {
    res.writeHead(302, { Location: buildInstallUrl() });
    return res.end();
  }

  if (isRoute(req, "POST", "/webhooks/store-redact")) {
    const body = await parseBody(req);
    await updateDb((db) => {
      if (!sameStore(db.store, body.store_id)) return db;
      db.store = {
        ...db.store,
        id: "",
        accessToken: "",
        retailLocationId: "",
        wholesaleLocationId: "",
        wholesaleLocationAddress: ""
      };
      db.rules = [];
      db.wholesaleCustomers = [];
      db.installs = [];
      return db;
    });
    return sendJson(req, res, 200, { ok: true });
  }

  if (isRoute(req, "POST", "/webhooks/customers-redact")) {
    const body = await parseBody(req);
    const customer = body.customer || {};
    const email = String(customer.email || "").toLowerCase();
    const cnpj = normalizeDocument(customer.identification || customer.cnpj || "");
    const id = String(customer.id || "");

    await updateDb((db) => {
      if (!sameStore(db.store, body.store_id)) return db;
      db.wholesaleCustomers = (db.wholesaleCustomers || []).filter((item) => {
        if (id && String(item.nuvemshopCustomerId || "") === id) return false;
        if (email && String(item.email || "").toLowerCase() === email) return false;
        if (cnpj && normalizeDocument(item.cnpj) === cnpj) return false;
        return true;
      });
      return db;
    });
    return sendJson(req, res, 200, { ok: true });
  }

  if (isRoute(req, "POST", "/webhooks/customers-data-request")) {
    const body = await parseBody(req);
    await updateDb((db) => {
      db.dataRequests ||= [];
      db.dataRequests.unshift({
        id: randomUUID(),
        receivedAt: new Date().toISOString(),
        payload: body
      });
      db.dataRequests = db.dataRequests.slice(0, 100);
      return db;
    });
    return sendJson(req, res, 200, { ok: true });
  }

  if (isRoute(req, "GET", "/auth/callback")) {
    const code = url.searchParams.get("code");
    if (!code) return sendText(req, res, 400, "Codigo OAuth ausente.");

    try {
      const token = await exchangeCodeForToken(code);
      await updateDb((db) => {
        db.store.id = String(token.user_id || token.store_id || db.store.id || "");
        db.store.accessToken = token.access_token || "";
        db.installs.push({ id: randomUUID(), installedAt: new Date().toISOString(), token });
        return db;
      });
      return sendText(req, res, 200, "App conectado. Pode fechar esta janela e voltar para o painel.");
    } catch (error) {
      return sendText(req, res, 500, error.message);
    }
  }

  if (isRoute(req, "GET", "/api/settings")) {
    const db = await readDb();
    const safeStore = { ...db.store, accessToken: db.store.accessToken ? "configured" : "" };
    return sendJson(req, res, 200, safeStore);
  }

  if (isRoute(req, "PUT", "/api/settings")) {
    const body = await parseBody(req);
    const next = await updateDb((db) => {
      db.store = {
        ...db.store,
        ...body,
        wholesaleMinimumQuantity: Number(body.wholesaleMinimumQuantity || 0),
        wholesaleMinimumAmount: money(body.wholesaleMinimumAmount)
      };
      return db;
    });
    const safeStore = { ...next.store, accessToken: next.store.accessToken ? "configured" : "" };
    return sendJson(req, res, 200, safeStore);
  }

  if (isRoute(req, "GET", "/api/rules")) {
    const db = await readDb();
    return sendJson(req, res, 200, db.rules);
  }

  if (isRoute(req, "GET", "/api/tiny/status")) {
    try {
      const status = await getTinyStatus();
      return sendJson(req, res, 200, status);
    } catch (error) {
      return sendJson(req, res, 400, { configured: false, error: error.message });
    }
  }

  if (isRoute(req, "GET", "/api/tiny/debug-sku")) {
    const cronSecret = cleanString(process.env.CRON_SECRET);
    const authorization = cleanString(req.headers.authorization);
    const querySecret = cleanString(url.searchParams.get("secret"));
    if (cronSecret && authorization !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return sendJson(req, res, 401, { error: "Diagnostico nao autorizado." });
    }

    const sku = normalizeSku(url.searchParams.get("sku") || process.env.TINY_TEST_SKU || "");
    if (!sku) {
      return sendJson(req, res, 400, { error: "Informe um SKU para diagnosticar." });
    }

    try {
      const priceListKeyword = process.env.TINY_PRICE_LIST_KEYWORD || process.env.TINY_PRICE_LIST_NAME || "Atacado";
      const depositName = process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado";
      const priceLists = await findTinyPriceLists({ keyword: priceListKeyword });
      const tinyProduct = await getTinyWholesaleBySkuFromPriceLists({ sku, priceLists, depositName });
      const db = await readDb();
      const matchingRules = (db.rules || []).filter((rule) => normalizeSku(rule.sku) === normalizeSku(tinyProduct.sku));
      return sendJson(req, res, 200, {
        ok: true,
        sku,
        priceListKeyword,
        depositName,
        tinyProduct,
        matchingRules
      });
    } catch (error) {
      return sendJson(req, res, 400, { ok: false, sku, error: error.message });
    }
  }

  if (isRoute(req, "POST", "/api/tiny/sync-sku")) {
    const body = await parseBody(req);
    const sku = normalizeSku(body.sku || process.env.TINY_TEST_SKU || "");
    if (!sku) {
      return sendJson(req, res, 400, { error: "Informe um SKU ou configure TINY_TEST_SKU no Vercel." });
    }

    try {
      const tinyProduct = await getTinyWholesaleBySku({ sku });
      const next = await updateDb((db) => {
        const current = (db.rules || []).find((rule) => normalizeSku(rule.sku) === normalizeSku(tinyProduct.sku));

        if (current) {
          Object.assign(current, {
            sku: normalizeSku(tinyProduct.sku),
            productName: current.productName || tinyProduct.productName,
            wholesalePrice: money(tinyProduct.wholesalePrice),
            wholesaleStock: Number(tinyProduct.wholesaleStock || 0),
            tinyProductId: tinyProduct.productId,
            tinyPriceListId: tinyProduct.priceList.id,
            tinyPriceListName: tinyProduct.priceList.name,
            tinyStockDepositName: tinyProduct.stockDeposit?.name || process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado",
            tinySyncedAt: new Date().toISOString(),
            enabled: current.enabled !== false
          });
        } else {
          db.rules ||= [];
          db.rules.unshift({
            id: randomUUID(),
            sku: normalizeSku(tinyProduct.sku),
            productName: tinyProduct.productName,
            variantName: "",
            retailPrice: 0,
            retailStock: 0,
            wholesalePrice: money(tinyProduct.wholesalePrice),
            wholesaleStock: Number(tinyProduct.wholesaleStock || 0),
            tinyProductId: tinyProduct.productId,
            tinyPriceListId: tinyProduct.priceList.id,
            tinyPriceListName: tinyProduct.priceList.name,
            tinyStockDepositName: tinyProduct.stockDeposit?.name || process.env.TINY_STOCK_DEPOSIT_NAME || "Atacado",
            tinySyncedAt: new Date().toISOString(),
            enabled: true
          });
        }

        return db;
      });

      return sendJson(req, res, 200, {
        ok: true,
        tinyProduct,
        rules: next.rules
      });
    } catch (error) {
      return sendJson(req, res, 400, { error: error.message });
    }
  }

  if (isRoute(req, "GET", "/api/tiny/sync-rules/status")) {
    try {
      const db = await readDb();
      return sendJson(req, res, 200, { ok: true, status: tinySyncStatus(db.tinySyncJob || null) });
    } catch (error) {
      return sendJson(req, res, 400, { error: error.message });
    }
  }

  if (isRoute(req, "POST", "/api/tiny/sync-rules/start")) {
    try {
      const body = await parseBody(req);
      const result = await startTinySyncJob({ restart: body.restart !== false });
      return sendJson(req, res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(req, res, 400, { error: error.message });
    }
  }

  if (isRoute(req, "POST", "/api/tiny/sync-rules/process") || isRoute(req, "POST", "/api/tiny/sync-rules")) {
    try {
      const db = await readDb();
      if (!db.tinySyncJob) {
        await startTinySyncJob({ restart: true });
      }
      const result = await processTinySyncJobBatch();
      return sendJson(req, res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(req, res, 400, { error: error.message });
    }
  }

  if (isRoute(req, "GET", "/api/cron/tiny-sync")) {
    const cronSecret = cleanString(process.env.CRON_SECRET);
    const authorization = cleanString(req.headers.authorization);
    const querySecret = cleanString(url.searchParams.get("secret"));
    if (cronSecret && authorization !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return sendJson(req, res, 401, { error: "Cron nao autorizado." });
    }

    try {
      const db = await readDb();
      if (shouldAutoStartTinySync(db.tinySyncJob || null)) {
        await startTinySyncJob({ restart: true });
      }
      const result = await processTinySyncJobBatch();
      return sendJson(req, res, 200, { ok: true, ...result, rules: undefined });
    } catch (error) {
      return sendJson(req, res, 400, { error: error.message });
    }
  }

  if (isRoute(req, "GET", "/api/storefront-wholesale-context")) {
    const db = await readDb();
    const email = cleanString(url.searchParams.get("email")).toLowerCase();
    const customerId = cleanString(url.searchParams.get("customerId"));
    const customerName = cleanString(url.searchParams.get("customerName"));

    if (!db.store?.id || !db.store?.accessToken) {
      return sendJson(req, res, 200, { wholesale: false, reason: "store_not_connected" });
    }

    let customer = null;
    try {
      if (customerId) {
        try {
          customer = await getCustomer({
            storeId: db.store.id,
            accessToken: db.store.accessToken,
            customerId
          });
        } catch (error) {
          if (!email) throw error;
        }
      }
      if (!customer && email) {
        customer = await findCustomerByEmail({
          storeId: db.store.id,
          accessToken: db.store.accessToken,
          email
        });
      }
      if (!customer && customerName) {
        const targetName = normalizeComparable(customerName);
        const targetParts = targetName.split(" ").filter((part) => part.length > 1);
        const customers = await listAllCustomers({
          storeId: db.store.id,
          accessToken: db.store.accessToken
        });
        const wholesaleMatches = customers.filter((item) => {
          if (!isWholesaleNuvemshopCustomer(item)) return false;
          const name = normalizeComparable(item.name);
          if (!name || !targetName) return false;
          if (name === targetName || name.startsWith(`${targetName} `)) return true;
          return targetParts.length > 0 && targetParts.every((part) => name.includes(part));
        });
        if (wholesaleMatches.length >= 1) {
          customer = wholesaleMatches
            .slice()
            .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
          req.customerNameFallbackMatches = wholesaleMatches.length;
        }
      }
    } catch (error) {
      return sendJson(req, res, 200, {
        wholesale: false,
        reason: "customer_lookup_failed",
        error: error.message
      });
    }

    if (!customer) {
      return sendJson(req, res, 200, { wholesale: false, reason: "customer_not_found" });
    }

    const mappedCustomer = mapNuvemshopWholesaleCustomer(customer);
    const approved = isApprovedWholesaleCustomer(
      [mappedCustomer],
      {
        id: customer.id,
        email: customer.email,
        document: customer.identification || customerExtra(customer).cnpj,
        extra: customerExtra(customer)
      },
      db.store.wholesaleApprovalMode
    );

    if (!approved) {
      return sendJson(req, res, 200, {
        wholesale: false,
        reason: "customer_without_wholesale_access",
        customer: mappedCustomer
      });
    }

    return sendJson(req, res, 200, {
      wholesale: true,
      customer: mappedCustomer,
      customerNameFallbackMatches: req.customerNameFallbackMatches || 0,
      settings: {
        minimumQuantity: Number(db.store.wholesaleMinimumQuantity || 0),
        minimumAmount: money(db.store.wholesaleMinimumAmount || 0),
        wholesaleLocationId: cleanString(db.store.wholesaleLocationId),
        wholesaleLocationName: cleanString(db.store.wholesaleLocationName)
      },
      rules: (db.rules || [])
        .filter((rule) => rule.enabled !== false && Number(rule.wholesalePrice || 0) > 0)
        .map(mapStorefrontRule)
    });
  }

  if (isRoute(req, "POST", "/api/rules/sync-products")) {
    const db = await readDb();
    if (!db.store.id || !db.store.accessToken) {
      return sendJson(req, res, 400, { error: "Loja ainda não conectada. Clique em Conectar loja e autorize o app na Nuvemshop." });
    }

    const products = await listAllProducts({
      storeId: db.store.id,
      accessToken: db.store.accessToken
    });

    const flattened = products.flatMap((product) => {
      const productName = product.name?.pt || product.name?.es || product.name?.en || "";
      const image = product.images?.[0]?.src || "";
      const productUrl = product.canonical_url || product.url || product.permalink || "";
      return (product.variants || []).map((variant) => ({
        productId: String(product.id),
        variantId: String(variant.id),
        sku: normalizeSku(variant.sku),
        productName,
        productUrl,
        variantName: (variant.values || [])
          .map((value) => value.pt || value.es || value.en || "")
          .filter(Boolean)
          .join(" / "),
        image,
        retailPrice: money(variant.price),
        wholesalePrice: money(variant.promotional_price || variant.price),
        retailStock: Number(variant.stock || 0),
        wholesaleStock: 0,
        enabled: true
      }));
    });

    const next = await updateDb((state) => {
      const byVariant = new Map((state.rules || []).map((rule) => [String(rule.variantId || rule.sku), rule]));
      flattened.forEach((item) => {
        const key = String(item.variantId || item.sku);
        const current = byVariant.get(key);
        if (current) {
          Object.assign(current, {
            productId: item.productId,
            variantId: item.variantId,
            sku: item.sku || current.sku,
            productName: item.productName || current.productName,
            productUrl: item.productUrl || current.productUrl || "",
            variantName: item.variantName,
            image: item.image,
            retailPrice: item.retailPrice,
            retailStock: item.retailStock,
            wholesalePrice: current.wholesalePrice || item.wholesalePrice,
            wholesaleStock: current.wholesaleStock ?? item.wholesaleStock,
            enabled: current.enabled !== false
          });
        } else {
          state.rules.push({ id: randomUUID(), ...item });
        }
      });
      return state;
    });

    return sendJson(req, res, 200, {
      imported: flattened.length,
      rules: next.rules
    });
  }

  if (isRoute(req, "POST", "/api/rules/bulk-discount")) {
    const body = await parseBody(req);
    const discountPercent = Number(body.discountPercent || 0);
    const selectedIds = Array.isArray(body.selectedIds) ? body.selectedIds.map(String) : [];
    const applyToAll = body.applyToAll === true || selectedIds.length === 0;

    const next = await updateDb((db) => {
      db.rules = db.rules.map((rule) => {
        if (!applyToAll && !selectedIds.includes(String(rule.id))) return rule;
        const basePrice = Number(rule.retailPrice || rule.wholesalePrice || 0);
        return {
          ...rule,
          wholesalePrice: money(basePrice * (1 - discountPercent / 100))
        };
      });
      return db;
    });

    return sendJson(req, res, 200, next.rules);
  }

  if (isRoute(req, "GET", "/api/rules/export")) {
    const db = await readDb();
    const rows = (db.rules || []).map((rule) => ({
      product_id: rule.productId || "",
      variant_id: rule.variantId || "",
      sku: rule.sku || "",
      produto: rule.productName || "",
      variacao: rule.variantName || "",
      preco_varejo: rule.retailPrice || "",
      preco_atacado: rule.wholesalePrice || "",
      estoque_atacado: rule.wholesaleStock || ""
    }));
    return sendCsv(res, "tabela-atacado-venos.csv", rows);
  }

  if (isRoute(req, "POST", "/api/rules/import")) {
    const raw = await parseRawBody(req);
    const file = parseMultipartFile(raw, req.headers["content-type"] || "");
    if (!file) return sendJson(req, res, 400, { error: "Arquivo nao encontrado no upload." });

    const importedRules = await parseSpreadsheetAsync(file.buffer, file.filename);
    if (!importedRules.length) {
      return sendJson(req, res, 400, { error: "Nenhum SKU encontrado na planilha." });
    }

    const next = await updateDb((db) => {
      const bySku = new Map(db.rules.map((rule) => [normalizeSku(rule.sku), rule]));
      importedRules.forEach((imported) => {
        const current = bySku.get(imported.sku);
        if (current) {
          Object.assign(current, {
            ...imported,
            id: current.id,
            retailPrice: current.retailPrice || 0,
            retailStock: current.retailStock || 0
          });
        } else {
          db.rules.push({
            id: randomUUID(),
            retailPrice: 0,
            retailStock: 0,
            ...imported
          });
        }
      });
      return db;
    });

    return sendJson(req, res, 200, {
      imported: importedRules.length,
      rules: next.rules
    });
  }

  if (isRoute(req, "POST", "/api/rules")) {
    const body = await parseBody(req);
    const next = await updateDb((db) => {
      db.rules.unshift({
        id: randomUUID(),
        sku: normalizeSku(body.sku),
        variantId: String(body.variantId || ""),
        productName: String(body.productName || ""),
        retailPrice: money(body.retailPrice),
        wholesalePrice: money(body.wholesalePrice),
        retailStock: Number(body.retailStock || 0),
        wholesaleStock: Number(body.wholesaleStock || 0),
        enabled: body.enabled !== false
      });
      return db;
    });
    return sendJson(req, res, 201, next.rules);
  }

  const ruleMatch = url.pathname.match(/^\/api\/rules\/([^/]+)$/);
  if (ruleMatch && req.method === "PUT") {
    const body = await parseBody(req);
    const id = ruleMatch[1];
    const next = await updateDb((db) => {
      db.rules = db.rules.map((rule) =>
        rule.id === id
          ? {
              ...rule,
              ...body,
              sku: normalizeSku(body.sku ?? rule.sku),
              retailPrice: money(body.retailPrice ?? rule.retailPrice),
              wholesalePrice: money(body.wholesalePrice ?? rule.wholesalePrice),
              retailStock: Number(body.retailStock ?? rule.retailStock),
              wholesaleStock: Number(body.wholesaleStock ?? rule.wholesaleStock)
            }
          : rule
      );
      return db;
    });
    return sendJson(req, res, 200, next.rules);
  }

  if (ruleMatch && req.method === "DELETE") {
    const id = ruleMatch[1];
    const next = await updateDb((db) => {
      db.rules = db.rules.filter((rule) => rule.id !== id);
      return db;
    });
    return sendJson(req, res, 200, next.rules);
  }

  if (isRoute(req, "POST", "/api/simulate-checkout")) {
    const cart = await parseBody(req);
    const db = await readDb();
    const customers = await listNuvemshopWholesaleCustomers(db);
    const decision = chooseWholesaleLocationPriority({
      cart,
      store: db.store,
      rules: db.rules,
      customers
    });
    return sendJson(req, res, 200, buildLocationPrioritizationResponse(decision));
  }

  if (isRoute(req, "POST", "/business-rules/location-prioritization")) {
    const cart = await parseBody(req);
    const db = await readDb();
    const customers = await listNuvemshopWholesaleCustomers(db);
    const decision = chooseWholesaleLocationPriority({
      cart,
      store: db.store,
      rules: db.rules,
      customers
    });
    return sendJson(req, res, 200, buildLocationPrioritizationResponse(decision));
  }

  if (isRoute(req, "GET", "/api/wholesale-customers")) {
    const db = await readDb();
    return sendJson(req, res, 200, await listNuvemshopWholesaleCustomers(db));
  }

  if (isRoute(req, "POST", "/api/wholesale-customers/sync")) {
    const db = await readDb();
    if (!db.store.id || !db.store.accessToken) {
      return sendJson(req, res, 400, { error: "Loja ainda não conectada. Clique em Conectar loja e autorize o app na Nuvemshop." });
    }

    const customers = await listNuvemshopWholesaleCustomers(db);
    return sendJson(req, res, 200, {
      imported: customers.length,
      customers
    });
  }

  if (isRoute(req, "POST", "/api/wholesale-customers")) {
    const body = await parseBody(req);
    const cnpj = normalizeDocument(body.cnpj);
    if (!isValidCnpj(cnpj)) {
      return sendJson(req, res, 400, { error: "CNPJ invalido." });
    }

    const db = await readDb();
    if (!db.store.id || !db.store.accessToken) {
      return sendJson(req, res, 400, { error: "Loja ainda não conectada. Autorize o app na Nuvemshop." });
    }
    const email = cleanString(body.email).toLowerCase();
    const existingCustomer = email
      ? await findCustomerByEmail({ storeId: db.store.id, accessToken: db.store.accessToken, email })
      : null;
    const requestStatus = body.approved === false ? "pending" : "approved";
    const customerPayload = buildWholesaleCustomerPayload({
      body,
      email,
      cnpj,
      address: buildWholesaleAddress(body),
      requestStatus
    });
    if (existingCustomer) {
      await updateCustomer({
        storeId: db.store.id,
        accessToken: db.store.accessToken,
        customerId: existingCustomer.id,
        customer: customerPayload
      });
    } else {
      await createCustomer({ storeId: db.store.id, accessToken: db.store.accessToken, customer: customerPayload });
    }
    return sendJson(req, res, 201, await listNuvemshopWholesaleCustomers(db));
  }

  if (isRoute(req, "POST", "/api/wholesale-requests")) {
    const body = await parseBody(req);
    const cnpj = normalizeDocument(body.cnpj);
    if (!isValidCnpj(cnpj)) {
      return sendJson(req, res, 400, { error: "CNPJ invalido." });
    }
    const email = cleanString(body.email).toLowerCase();
    const address = buildWholesaleAddress(body);
    const dbBefore = await readDb();
    const automaticApproval = dbBefore.store?.wholesaleApprovalMode === "automatic";
    const requestStatus = automaticApproval ? "approved" : "pending";
    let nuvemshopCustomer = null;
    let customerCreateError = "";
    let activationMessage = "";
    let existingInactiveCustomer = false;

    if (!dbBefore.store?.id || !dbBefore.store?.accessToken) {
      return sendJson(req, res, 400, { error: "Loja ainda não conectada. Autorize o app na Nuvemshop." });
    }
    const password = cleanString(body.password);
    if (!email || !password) {
      return sendJson(req, res, 400, { error: "Informe e-mail e senha para criar a conta na loja." });
    }

    if (email) {
      try {
        const existingCustomer = await findCustomerByEmail({
          storeId: dbBefore.store.id,
          accessToken: dbBefore.store.accessToken,
          email
        });
        const customerPayload = buildWholesaleCustomerPayload({
          body,
          email,
          cnpj,
          address,
          requestStatus,
          password,
          includeAccess: !existingCustomer
        });
        if (existingCustomer) {
          const existingExtra = customerExtra(existingCustomer);
          const wasWholesale = isWholesaleNuvemshopCustomer(existingCustomer);
          nuvemshopCustomer = await updateCustomer({
            storeId: dbBefore.store.id,
            accessToken: dbBefore.store.accessToken,
            customerId: existingCustomer.id,
            customer: customerPayload
          });
          if (!existingCustomer.active && !wasWholesale && !existingExtra.tipo_cliente) {
            existingInactiveCustomer = true;
            customerCreateError =
              "Este e-mail já existe na Nuvemshop, mas ainda não tem senha ativa. Remova esse cliente na Nuvemshop ou use outro e-mail para criar o acesso de atacado.";
          }
        } else {
          try {
            nuvemshopCustomer = await createCustomer({
              storeId: dbBefore.store.id,
              accessToken: dbBefore.store.accessToken,
              customer: customerPayload
            });
          } catch (error) {
            const message = String(error.message || "");
            const rejectedAccessFields = message.includes("send_email_invite") || message.includes("password");
            if (!rejectedAccessFields) throw error;
            activationMessage =
              "A Nuvemshop criou o cliente, mas rejeitou criar senha pelo app. O acesso precisa ser ativado pela recuperação de senha/convite da própria Nuvemshop.";
            nuvemshopCustomer = await createCustomer({
              storeId: dbBefore.store.id,
              accessToken: dbBefore.store.accessToken,
              customer: buildWholesaleCustomerPayload({
                body,
                email,
                cnpj,
                address,
                requestStatus,
                includeAccess: false
              })
            });
          }
        }
      } catch (error) {
        customerCreateError = error.message;
      }
    }

    if (customerCreateError) {
      return sendJson(req, res, existingInactiveCustomer ? 409 : 502, {
        ok: false,
        error: `Não foi possível criar o cliente na Nuvemshop: ${customerCreateError}`,
        approved: false,
        customerCreateError,
        customers: await listNuvemshopWholesaleCustomers(dbBefore)
      });
    }

    return sendJson(req, res, 201, {
      ok: true,
      approved: automaticApproval,
      loginAvailable: nuvemshopCustomer?.active === true,
      activationMessage,
      customerCreateError,
      customer: nuvemshopCustomer,
      customers: await listNuvemshopWholesaleCustomers(dbBefore)
    });
  }

  const customerMatch = url.pathname.match(/^\/api\/wholesale-customers\/([^/]+)$/);
  if (customerMatch && req.method === "PUT") {
    const body = await parseBody(req);
    const id = customerMatch[1];
    const db = await readDb();
    if (!db.store.id || !db.store.accessToken) {
      return sendJson(req, res, 400, { error: "Loja ainda não conectada. Autorize o app na Nuvemshop." });
    }
    const customer = await getCustomer({ storeId: db.store.id, accessToken: db.store.accessToken, customerId: id });
    const extra = {
      ...customerExtra(customer),
      tipo_cliente: "atacado",
      wholesale: "true",
      aprovacao_atacado: body.approved === false ? "pending" : "approved",
      discount_percent: String(Number(body.discountPercent ?? customerExtra(customer).discount_percent ?? 0))
    };
    await updateCustomer({
      storeId: db.store.id,
      accessToken: db.store.accessToken,
      customerId: id,
      customer: { extra }
    });
    return sendJson(req, res, 200, await listNuvemshopWholesaleCustomers(db));
  }

  if (customerMatch && req.method === "DELETE") {
    const id = customerMatch[1];
    const db = await readDb();
    if (!db.store.id || !db.store.accessToken) {
      return sendJson(req, res, 400, { error: "Loja ainda não conectada. Autorize o app na Nuvemshop." });
    }
    const customer = await getCustomer({ storeId: db.store.id, accessToken: db.store.accessToken, customerId: id });
    const extra = {
      ...customerExtra(customer),
      tipo_cliente: "",
      wholesale: "false",
      aprovacao_atacado: "removed"
    };
    await updateCustomer({
      storeId: db.store.id,
      accessToken: db.store.accessToken,
      customerId: id,
      customer: { extra }
    });
    return sendJson(req, res, 200, await listNuvemshopWholesaleCustomers(db));
  }

  if (isRoute(req, "POST", "/api/register-business-rule")) {
    const db = await readDb();
    const publicUrl = process.env.PUBLIC_APP_URL;
    if (!publicUrl || !db.store.id || !db.store.accessToken) {
      return sendJson(req, res, 400, {
        error: "Configure PUBLIC_APP_URL, store id e access token antes de registrar o callback."
      });
    }
    const callbackUrl = `${publicUrl.replace(/\/$/, "")}/business-rules/location-prioritization`;
    await registerLocationBusinessRule({
      storeId: db.store.id,
      accessToken: db.store.accessToken,
      callbackUrl
    });
    return sendJson(req, res, 200, { ok: true, callbackUrl });
  }

  if (isRoute(req, "GET", "/api/locations/sync")) {
    const db = await readDb();
    if (!db.store.id || !db.store.accessToken) {
      return sendJson(req, res, 400, { error: "Loja ainda não conectada. Clique em Conectar loja e autorize o app na Nuvemshop." });
    }
    const locations = await listLocations({
      storeId: db.store.id,
      accessToken: db.store.accessToken
    });
    return sendJson(req, res, 200, Array.isArray(locations) ? locations.map(normalizeLocation) : []);
  }

  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }
    const handled = await handleApi(req, res);
    if (handled !== null) return;
    await serveStatic(req, res);
  } catch (error) {
    sendJson(req, res, 500, { error: error.message });
  }
}

if (!process.env.VERCEL) {
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`Venos Nuvemshop App rodando em http://localhost:${PORT}`);
  });
}

