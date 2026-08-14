import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readDb, updateDb } from "./storage.js";
import {
  buildLocationPrioritizationResponse,
  chooseLocationPriority,
  chooseWholesaleLocationPriority,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = "2026-08-13-store-login-wholesale-v1";
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
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function sendJson(req, res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(req, res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(req) });
  res.end(text);
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

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

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
      return (product.variants || []).map((variant) => ({
        productId: String(product.id),
        variantId: String(variant.id),
        sku: normalizeSku(variant.sku),
        productName,
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

