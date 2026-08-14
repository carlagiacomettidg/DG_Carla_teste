const API_BASE = "https://api.nuvemshop.com.br/v1";
const AUTH_BASE = "https://www.nuvemshop.com.br/apps";

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

export function buildInstallUrl() {
  const clientId = env("NUVEMSHOP_CLIENT_ID");
  const redirectUri = env("NUVEMSHOP_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code"
  });

  return `${AUTH_BASE}/${clientId}/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const response = await fetch("https://www.nuvemshop.com.br/apps/authorize/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env("NUVEMSHOP_CLIENT_ID"),
      client_secret: env("NUVEMSHOP_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code
    })
  });

  if (!response.ok) {
    throw new Error(`Falha no OAuth Nuvemshop: ${response.status}`);
  }

  return response.json();
}

export async function nuvemshopRequest({ storeId, accessToken, path, method = "GET", body, timeoutMs = 15000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${API_BASE}/${storeId}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Authentication": `bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": env("NUVEMSHOP_USER_AGENT", "VenosModasApp/0.1")
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Nuvemshop API demorou para responder em ${path}. Tente novamente em alguns instantes.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401) {
      throw new Error("Token de acesso da Nuvemshop inválido. Reinstale ou autorize novamente o app na loja Vênus Modas.");
    }
    if (response.status === 403 && text.includes("read_locations")) {
      throw new Error("O app não tem permissão para ler centros de distribuição. Ative o escopo read_locations no Portal de Parceiros da Nuvemshop e reinstale o app.");
    }
    throw new Error(`Nuvemshop API ${response.status}: ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export function registerLocationBusinessRule({ storeId, accessToken, callbackUrl }) {
  return nuvemshopRequest({
    storeId,
    accessToken,
    path: "/business_rules/integrations/location",
    method: "PUT",
    body: {
      url: callbackUrl,
      event: "location/prioritization"
    }
  });
}

export function listLocations({ storeId, accessToken }) {
  return nuvemshopRequest({
    storeId,
    accessToken,
    path: "/locations"
  });
}

export async function listAllProducts({ storeId, accessToken }) {
  const products = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const batch = await nuvemshopRequest({
      storeId,
      accessToken,
      path: `/products?page=${page}&per_page=${perPage}&fields=id,name,variants,images,visibility,published`
    });

    if (!Array.isArray(batch) || batch.length === 0) break;
    products.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return products;
}

export async function listAllCustomers({ storeId, accessToken }) {
  const customers = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const batch = await nuvemshopRequest({
      storeId,
      accessToken,
      path: `/customers?page=${page}&per_page=${perPage}&fields=id,name,email,identification,phone,total_spent,total_orders,last_order_id,created_at`
    });

    if (!Array.isArray(batch) || batch.length === 0) break;
    customers.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return customers;
}

export async function findCustomerByEmail({ storeId, accessToken, email }) {
  if (!email) return null;
  const customers = await nuvemshopRequest({
    storeId,
    accessToken,
    path: `/customers?email=${encodeURIComponent(email)}&per_page=1`
  });
  return Array.isArray(customers) ? customers[0] || null : null;
}

export function createCustomer({ storeId, accessToken, customer }) {
  return nuvemshopRequest({
    storeId,
    accessToken,
    path: "/customers",
    method: "POST",
    body: customer
  });
}

export function updateCustomer({ storeId, accessToken, customerId, customer }) {
  return nuvemshopRequest({
    storeId,
    accessToken,
    path: `/customers/${customerId}`,
    method: "PUT",
    body: customer
  });
}

export function updateVariantInventory({ storeId, accessToken, productId, variantId, inventoryLevels }) {
  return nuvemshopRequest({
    storeId,
    accessToken,
    path: `/products/${productId}/variants/${variantId}`,
    method: "PUT",
    body: {
      inventory_levels: inventoryLevels
    }
  });
}
