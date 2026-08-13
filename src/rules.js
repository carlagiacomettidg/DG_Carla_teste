export function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

export function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function getLineSku(line) {
  return normalizeSku(line?.sku || line?.variant?.sku || line?.product?.sku);
}

export function getLineVariantId(line) {
  return String(line?.variant_id || line?.variantId || line?.variant?.id || "");
}

export function findRuleForLine(rules, line) {
  const sku = getLineSku(line);
  const variantId = getLineVariantId(line);

  return rules.find((rule) => {
    if (!rule.enabled) return false;
    if (rule.variantId && variantId && String(rule.variantId) === variantId) return true;
    return normalizeSku(rule.sku) === sku;
  });
}

export function normalizeDocument(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isValidCnpj(value) {
  const cnpj = normalizeDocument(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;

  const calc = (base, weights) => {
    const sum = weights.reduce((acc, weight, index) => acc + Number(base[index]) * weight, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const first = calc(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

export function isApprovedWholesaleCustomer(customers, customer = {}, approvalMode = "manual") {
  const id = String(customer.id || "");
  const email = String(customer.email || "").toLowerCase();
  const document = normalizeDocument(customer.document || customer.cnpj || customer.extra?.cnpj);

  if (approvalMode === "automatic" && isValidCnpj(document)) {
    return true;
  }

  return customers.some((item) => {
    if (!item.approved) return false;
    if (id && String(item.nuvemshopCustomerId || item.id) === id) return true;
    if (email && String(item.email || "").toLowerCase() === email) return true;
    if (document && normalizeDocument(item.cnpj) === document) return true;
    return false;
  });
}

export function detectSegment({ cart, store, rules }) {
  const products = Array.isArray(cart.products) ? cart.products : [];
  const customer = cart.customer || {};
  const minimumQuantity = Number(store.wholesaleMinimumQuantity || 0);
  const minimumAmount = Number(store.wholesaleMinimumAmount || 0);
  const totalQuantity = products.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const total = Number(cart?.totals?.total || cart?.totals?.subtotal || 0);

  const customerMarkedWholesale =
    customer.type === "wholesale" ||
    customer.segment === "wholesale" ||
    customer.tags?.includes?.("atacado") ||
    customer.tags?.includes?.("wholesale");

  const allLinesHaveWholesaleRule =
    products.length > 0 && products.every((line) => Boolean(findRuleForLine(rules, line)));

  const meetsMinimum =
    (minimumQuantity > 0 && totalQuantity >= minimumQuantity) ||
    (minimumAmount > 0 && total >= minimumAmount);

  if (customerMarkedWholesale) return "wholesale";
  if (allLinesHaveWholesaleRule && meetsMinimum) return "wholesale";
  return "retail";
}

export function detectWholesaleSegment({ cart, rules, customers = [], approvalMode = "manual" }) {
  const products = Array.isArray(cart.products) ? cart.products : [];
  const customer = cart.customer || {};
  const allLinesHaveWholesaleRule =
    products.length > 0 && products.every((line) => Boolean(findRuleForLine(rules, line)));

  const customerHasAccess =
    isApprovedWholesaleCustomer(customers, customer, approvalMode) ||
    customer.type === "wholesale" ||
    customer.segment === "wholesale" ||
    customer.tags?.includes?.("atacado") ||
    customer.tags?.includes?.("wholesale");

  return customerHasAccess && allLinesHaveWholesaleRule ? "wholesale" : "retail";
}

export function chooseLocationPriority({ cart, store, rules }) {
  const segment = detectSegment({ cart, store, rules });
  const retailLocationId = store.retailLocationId;
  const wholesaleLocationId = store.wholesaleLocationId;

  if (!retailLocationId && !wholesaleLocationId) {
    return { segment, locations: [] };
  }

  const locations =
    segment === "wholesale"
      ? [
          { id: wholesaleLocationId, priority: 0 },
          { id: retailLocationId, priority: 1 }
        ]
      : [
          { id: retailLocationId, priority: 0 },
          { id: wholesaleLocationId, priority: 1 }
        ];

  return {
    segment,
    locations: locations.filter((location) => Boolean(location.id))
  };
}

export function chooseWholesaleLocationPriority({ cart, store, rules, customers }) {
  const segment = detectWholesaleSegment({
    cart,
    rules,
    customers,
    approvalMode: store.wholesaleApprovalMode
  });
  const wholesaleLocationId = store.wholesaleLocationId;

  if (segment !== "wholesale" || !wholesaleLocationId) {
    return { segment, locations: [] };
  }

  return {
    segment,
    locations: [{ id: wholesaleLocationId, priority: 0 }]
  };
}

export function buildLocationPrioritizationResponse(decision) {
  return {
    command: "location_prioritization",
    detail: {
      location_prioritization: decision.locations
    },
    meta: {
      segment: decision.segment
    }
  };
}
