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
  exchangeCodeForToken,
  listLocations,
  registerLocationBusinessRule
} from "./nuvemshop.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = Number(process.env.PORT || 3000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
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
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const content = await fs.readFile(resolved);
    const ext = path.extname(resolved);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function isRoute(req, method, pathname) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return req.method === method && url.pathname === pathname;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (isRoute(req, "GET", "/health")) {
    return sendJson(res, 200, { ok: true, app: "venos-nuvemshop-app" });
  }

  if (isRoute(req, "GET", "/auth/install")) {
    return sendJson(res, 200, {
      installUrl: buildInstallUrl(),
      note: "Abra esta URL para iniciar o OAuth no Portal de Parceiros/Nuvemshop."
    });
  }

  if (isRoute(req, "GET", "/auth/callback")) {
    const code = url.searchParams.get("code");
    if (!code) return sendText(res, 400, "Codigo OAuth ausente.");

    try {
      const token = await exchangeCodeForToken(code);
      await updateDb((db) => {
        db.store.id = String(token.user_id || token.store_id || db.store.id || "");
        db.store.accessToken = token.access_token || "";
        db.installs.push({ id: randomUUID(), installedAt: new Date().toISOString(), token });
        return db;
      });
      return sendText(res, 200, "App instalado. Pode fechar esta janela.");
    } catch (error) {
      return sendText(res, 500, error.message);
    }
  }

  if (isRoute(req, "GET", "/api/settings")) {
    const db = await readDb();
    const safeStore = { ...db.store, accessToken: db.store.accessToken ? "configured" : "" };
    return sendJson(res, 200, safeStore);
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
    return sendJson(res, 200, safeStore);
  }

  if (isRoute(req, "GET", "/api/rules")) {
    const db = await readDb();
    return sendJson(res, 200, db.rules);
  }

  if (isRoute(req, "POST", "/api/rules/import")) {
    const raw = await parseRawBody(req);
    const file = parseMultipartFile(raw, req.headers["content-type"] || "");
    if (!file) return sendJson(res, 400, { error: "Arquivo nao encontrado no upload." });

    const importedRules = await parseSpreadsheetAsync(file.buffer, file.filename);
    if (!importedRules.length) {
      return sendJson(res, 400, { error: "Nenhum SKU encontrado na planilha." });
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

    return sendJson(res, 200, {
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
    return sendJson(res, 201, next.rules);
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
    return sendJson(res, 200, next.rules);
  }

  if (ruleMatch && req.method === "DELETE") {
    const id = ruleMatch[1];
    const next = await updateDb((db) => {
      db.rules = db.rules.filter((rule) => rule.id !== id);
      return db;
    });
    return sendJson(res, 200, next.rules);
  }

  if (isRoute(req, "POST", "/api/simulate-checkout")) {
    const cart = await parseBody(req);
    const db = await readDb();
    const decision = chooseWholesaleLocationPriority({
      cart,
      store: db.store,
      rules: db.rules,
      customers: db.wholesaleCustomers
    });
    return sendJson(res, 200, buildLocationPrioritizationResponse(decision));
  }

  if (isRoute(req, "POST", "/business-rules/location-prioritization")) {
    const cart = await parseBody(req);
    const db = await readDb();
    const decision = chooseWholesaleLocationPriority({
      cart,
      store: db.store,
      rules: db.rules,
      customers: db.wholesaleCustomers
    });
    return sendJson(res, 200, buildLocationPrioritizationResponse(decision));
  }

  if (isRoute(req, "GET", "/api/wholesale-customers")) {
    const db = await readDb();
    return sendJson(res, 200, db.wholesaleCustomers || []);
  }

  if (isRoute(req, "POST", "/api/wholesale-customers")) {
    const body = await parseBody(req);
    const cnpj = normalizeDocument(body.cnpj);
    if (!isValidCnpj(cnpj)) {
      return sendJson(res, 400, { error: "CNPJ invalido." });
    }

    const next = await updateDb((db) => {
      db.wholesaleCustomers ||= [];
      const existing = db.wholesaleCustomers.find((customer) => normalizeDocument(customer.cnpj) === cnpj);
      if (existing) {
        Object.assign(existing, {
          name: body.name || existing.name,
          email: body.email || existing.email,
          approved: body.approved ?? existing.approved,
          discountPercent: Number(body.discountPercent ?? existing.discountPercent ?? 0)
        });
      } else {
        db.wholesaleCustomers.unshift({
          id: randomUUID(),
          name: String(body.name || ""),
          email: String(body.email || ""),
          cnpj,
          approved: body.approved !== false,
          discountPercent: Number(body.discountPercent || 0),
          createdAt: new Date().toISOString()
        });
      }
      return db;
    });
    return sendJson(res, 201, next.wholesaleCustomers);
  }

  const customerMatch = url.pathname.match(/^\/api\/wholesale-customers\/([^/]+)$/);
  if (customerMatch && req.method === "PUT") {
    const body = await parseBody(req);
    const id = customerMatch[1];
    const next = await updateDb((db) => {
      db.wholesaleCustomers ||= [];
      db.wholesaleCustomers = db.wholesaleCustomers.map((customer) =>
        customer.id === id
          ? {
              ...customer,
              ...body,
              discountPercent: Number(body.discountPercent ?? customer.discountPercent ?? 0)
            }
          : customer
      );
      return db;
    });
    return sendJson(res, 200, next.wholesaleCustomers);
  }

  if (customerMatch && req.method === "DELETE") {
    const id = customerMatch[1];
    const next = await updateDb((db) => {
      db.wholesaleCustomers ||= [];
      db.wholesaleCustomers = db.wholesaleCustomers.filter((customer) => customer.id !== id);
      return db;
    });
    return sendJson(res, 200, next.wholesaleCustomers);
  }

  if (isRoute(req, "POST", "/api/register-business-rule")) {
    const db = await readDb();
    const publicUrl = process.env.PUBLIC_APP_URL;
    if (!publicUrl || !db.store.id || !db.store.accessToken) {
      return sendJson(res, 400, {
        error: "Configure PUBLIC_APP_URL, store id e access token antes de registrar o callback."
      });
    }
    const callbackUrl = `${publicUrl.replace(/\/$/, "")}/business-rules/location-prioritization`;
    await registerLocationBusinessRule({
      storeId: db.store.id,
      accessToken: db.store.accessToken,
      callbackUrl
    });
    return sendJson(res, 200, { ok: true, callbackUrl });
  }

  if (isRoute(req, "GET", "/api/locations/sync")) {
    const db = await readDb();
    if (!db.store.id || !db.store.accessToken) {
      return sendJson(res, 400, { error: "Loja ainda nao conectada via OAuth." });
    }
    const locations = await listLocations({
      storeId: db.store.id,
      accessToken: db.store.accessToken
    });
    return sendJson(res, 200, locations);
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleApi(req, res);
    if (handled !== null) return;
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Venos Nuvemshop App rodando em http://localhost:${PORT}`);
});
