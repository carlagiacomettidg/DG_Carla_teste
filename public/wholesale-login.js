(function () {
  const APP_URL = "https://dg-venus-modas.vercel.app";
  const STORE_NAME = "Vênus Modas";
  const SCRIPT_VERSION = "2026-09-03-storefront-tiny-stability-v1";
  window.DG_WHOLESALE_LOGIN_VERSION = SCRIPT_VERSION;
  window.DG_WHOLESALE_DEBUG = {
    version: SCRIPT_VERSION,
    loadedAt: new Date().toISOString(),
    attempts: 0,
    customerFound: false,
    contextLoaded: false,
    applied: 0,
    lastReason: "script_loaded"
  };

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
      return;
    }
    fn();
  }

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizePath(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      return url.pathname.replace(/\/+$/, "");
    } catch {
      return String(value || "").split("?")[0].replace(/\/+$/, "");
    }
  }

  function saveWholesaleEmail(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) return;
    try {
      window.localStorage.setItem("DG_WHOLESALE_EMAIL", cleanEmail);
      window.sessionStorage.setItem("DG_WHOLESALE_EMAIL", cleanEmail);
    } catch {
      // Storage can be blocked by the browser; the storefront still works when Nuvemshop exposes the customer.
    }
  }

  function getStoredWholesaleEmail() {
    try {
      return (
        window.sessionStorage.getItem("DG_WHOLESALE_EMAIL") ||
        window.localStorage.getItem("DG_WHOLESALE_EMAIL") ||
        ""
      ).trim().toLowerCase();
    } catch {
      return "";
    }
  }

  function getGreetingCustomerName() {
    const selectors = [
      ".js-customer-name",
      "[data-store='account-name']",
      ".account-name",
      ".customer-name",
      "header",
      ".header",
      ".js-account-container"
    ];
    for (const selector of selectors) {
      const text = document.querySelector(selector)?.textContent || "";
      const match = text.match(/ol[áa],?\s*([^!\n\r]+)/i);
      if (match?.[1]) {
        return match[1].replace(/\b(sair|minha conta|meus pedidos)\b/gi, "").trim();
      }
    }
    const bodyText = document.body.textContent.slice(0, 3000);
    const match = bodyText.match(/ol[áa],?\s*([^!\n\r]{2,80})/i);
    return match?.[1] ? match[1].replace(/\b(sair|minha conta|meus pedidos)\b/gi, "").trim() : "";
  }

  async function findCustomerEmailInAccountPages() {
    const paths = ["/account/", "/account/addresses/", "/account/profile/"];
    for (const path of paths) {
      try {
        const response = await fetch(path, { credentials: "same-origin" });
        if (!response.ok) continue;
        const html = await response.text();
        const match = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (match?.[0]) {
          const email = match[0].toLowerCase();
          saveWholesaleEmail(email);
          return email;
        }
      } catch {
        // Some themes can block account subpages; other detection paths still apply.
      }
    }
    return "";
  }

  function formatCnpj(value) {
    const digits = onlyDigits(value).slice(0, 14);
    return digits
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }

  function findLoginForm() {
    const passwordInput = document.querySelector('input[type="password"]');
    if (passwordInput) return passwordInput.closest("form");
    const emailInput = document.querySelector('input[type="email"], input[name*="email" i]');
    return emailInput ? emailInput.closest("form") : document.querySelector("form");
  }

  function isAccountPage() {
    return /\/account\/register\/?$/.test(window.location.pathname);
  }

  function isLoginPage() {
    return /\/account\/login\/?$/.test(window.location.pathname);
  }

  function createField(label, name, type, placeholder, required) {
    const wrap = document.createElement("label");
    wrap.className = "dg-wholesale-field";
    wrap.innerHTML = `
      <span>${label}</span>
      <input type="${type}" name="${name}" placeholder="${placeholder || ""}" ${required ? "required" : ""}>
    `;
    return wrap;
  }

  function createCheckbox(label, name) {
    const wrap = document.createElement("label");
    wrap.className = "dg-wholesale-check is-full";
    wrap.innerHTML = `
      <input type="checkbox" name="${name}">
      <span>${label}</span>
    `;
    return wrap;
  }

  function renderResult({ panel, approved, loginAvailable, activationMessage, customer }) {
    const customerId = customer?.id ? `Cliente Nuvemshop #${customer.id}` : "Cadastro enviado para a Nuvemshop";
    const title = approved ? "Cadastro atacado recebido" : "Solicitação enviada";
    const text = approved
      ? "Seu cadastro foi salvo na Nuvemshop e marcado como cliente de atacado."
      : "Recebemos seus dados. A loja vai revisar o cadastro e liberar o acesso aos preços de atacado.";
    const action = loginAvailable
      ? `<button class="dg-wholesale-submit dg-wholesale-access" type="button">Acessar minha conta</button>`
      : `<button class="dg-wholesale-submit dg-wholesale-access" type="button">Ir para o login da loja</button>`;
    const root = panel.closest(".dg-wholesale-login");
    const switcher = root?.querySelector(".dg-wholesale-switch");
    if (switcher) switcher.hidden = true;
    root?.classList.add("has-result");

    panel.innerHTML = `
      <div class="dg-wholesale-result ${approved ? "is-approved" : "is-pending"}">
        <div class="dg-wholesale-result-icon">${approved ? "✓" : "!"}</div>
        <h2>${title}</h2>
        <p>${text}</p>
        <p class="dg-wholesale-result-help"><strong>${customerId}</strong></p>
        ${action}
        <p class="dg-wholesale-result-help">
          ${activationMessage || (loginAvailable
            ? "Use o e-mail e a senha cadastrados para entrar."
            : "Se o login ainda não entrar de primeira, use Esqueci minha senha ou aguarde o e-mail de ativação da Nuvemshop.")}
        </p>
      </div>
    `;

    const accessButton = panel.querySelector(".dg-wholesale-access");
    if (accessButton) {
      accessButton.addEventListener("click", () => {
        window.location.href = "/account/login/";
      });
    }

    const newButton = panel.querySelector(".dg-wholesale-new");
    if (newButton) {
      newButton.addEventListener("click", () => window.location.reload());
    }

    window.setTimeout(() => {
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function setMessage(box, type, text) {
    box.className = `dg-wholesale-message ${type ? `is-${type}` : ""}`;
    box.textContent = text || "";
    box.hidden = !text;
    if (text) box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function getCurrentStorefrontCustomer() {
    const candidates = [
      window.LS && window.LS.customer,
      window.Nuvemshop && window.Nuvemshop.customer,
      window.TiendaNube && window.TiendaNube.customer,
      window.tiendaNube && window.tiendaNube.customer,
      window.Store && window.Store.customer,
      window.customer,
      window.currentCustomer,
      window.current_customer,
      window.loggedCustomer
    ].filter(Boolean);

    for (const customer of candidates) {
      const email = customer.email || customer.customer_email || customer.mail || customer.email_address;
      const id = customer.id || customer.customer_id || customer.customerId;
      if (email || id) {
        return {
          id: id ? String(id) : "",
          email: email ? String(email).toLowerCase() : "",
          source: "storefront_customer"
        };
      }
    }

    const globalEmail =
      window.customer_email ||
      window.customerEmail ||
      window.currentCustomerEmail ||
      window.LS?.customer_email ||
      window.LS?.customerEmail;
    if (globalEmail) {
      return { id: "", email: String(globalEmail).toLowerCase(), source: "storefront_email" };
    }

    const emailMeta = document.querySelector('meta[name="customer-email"], meta[property="customer:email"]');
    if (emailMeta?.content) {
      return { id: "", email: String(emailMeta.content).toLowerCase(), source: "meta_customer_email" };
    }

    const accountText = [
      document.querySelector(".js-customer-name"),
      document.querySelector("[data-customer-email]"),
      document.querySelector("[data-store='account-name']")
    ].find(Boolean);
    const dataEmail = accountText?.getAttribute?.("data-customer-email");
    if (dataEmail) {
      return { id: "", email: String(dataEmail).toLowerCase(), source: "data_customer_email" };
    }

    const loggedInSignals = [
      'a[href*="/account/logout"]',
      'a[href*="/account"]',
      'form[action*="/account/logout"]',
      ".js-customer-logout",
      ".js-customer-name",
      "[data-store='account-name']",
      "[data-customer-id]"
    ];
    const hasLoggedInSignal = loggedInSignals.some((selector) => document.querySelector(selector));
    const headerText = normalizeText(document.body.textContent.slice(0, 2500));
    const loginTextVisible =
      headerText.includes("login / cadastre-se") ||
      headerText.includes("login/cadastre-se") ||
      headerText.includes("iniciar sessao") ||
      headerText.includes("criar uma conta");
    const looksLoggedIn =
      hasLoggedInSignal ||
      (headerText.includes("ola,") && headerText.includes("sair")) ||
      (headerText.includes("olá,") && headerText.includes("sair")) ||
      (headerText.includes("minha conta") && !loginTextVisible);

    window.DG_WHOLESALE_DEBUG.loggedInDetected = looksLoggedIn;

    const storedEmail = getStoredWholesaleEmail();
    if (storedEmail && (looksLoggedIn || !loginTextVisible)) {
      window.DG_WHOLESALE_DEBUG.fallbackEmailUsed = true;
      return { id: "", email: storedEmail, source: looksLoggedIn ? "stored_wholesale_email" : "stored_wholesale_email_no_public_customer" };
    }

    const greetingName = looksLoggedIn ? getGreetingCustomerName() : "";
    if (greetingName) {
      window.DG_WHOLESALE_DEBUG.fallbackNameUsed = true;
      return { id: "", email: "", name: greetingName, source: "storefront_greeting_name" };
    }

    return null;
  }

  function moneyBR(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  function getAttr(element, names) {
    for (const name of names) {
      const value = element?.getAttribute?.(name);
      if (value) return String(value);
    }
    return "";
  }

  function addRuleToList(map, key, rule) {
    if (!key) return;
    const cleanKey = String(key);
    const list = map.get(cleanKey) || [];
    list.push(rule);
    map.set(cleanKey, list);
  }

  function getSkuFromText(value) {
    return String(value || "").replace(/sku:?/i, "").trim().toUpperCase();
  }

  function getSelectedVariantTokens() {
    const selectors = [
      "select option:checked",
      "input[type='radio']:checked + label",
      "input[type='radio']:checked",
      ".js-insta-variant.selected",
      ".js-insta-variant.active",
      ".selected[data-option]",
      ".active[data-option]",
      "[aria-pressed='true']",
      ".btn-variant.selected",
      ".variant.selected"
    ];
    const tokens = [];
    document.querySelectorAll(selectors.join(",")).forEach((node) => {
      const value =
        node.getAttribute?.("data-option") ||
        node.getAttribute?.("data-value") ||
        node.getAttribute?.("value") ||
        node.textContent;
      const normalized = normalizeText(value);
      if (!normalized) return;
      if (["selecione", "comprar", "adicionar", "0", "1"].includes(normalized)) return;
      if (!tokens.includes(normalized)) tokens.push(normalized);
    });
    window.DG_WHOLESALE_DEBUG.selectedVariantTokens = tokens;
    return tokens;
  }

  function chooseRuleForSelectedVariant(rules) {
    if (!Array.isArray(rules) || !rules.length) return null;
    const tokens = getSelectedVariantTokens();
    if (!tokens.length) return rules[0];
    return (
      rules.find((rule) => {
        const variantName = normalizeText(rule.variantName);
        if (!variantName) return false;
        return tokens.every((token) => variantName.includes(token) || token.includes(variantName));
      }) || rules[0]
    );
  }

  function chooseRuleForProductCard(rules) {
    if (!Array.isArray(rules) || !rules.length) return null;
    return rules
      .slice()
      .sort((a, b) => {
        const aStock = Number(a.wholesaleStock || 0) > 0 ? 0 : 1;
        const bStock = Number(b.wholesaleStock || 0) > 0 ? 0 : 1;
        if (aStock !== bStock) return aStock - bStock;
        return Number(a.wholesalePrice || 0) - Number(b.wholesalePrice || 0);
      })[0];
  }

  function findProductCard(element) {
    const selectors = [
      ".js-product-container",
      ".js-item-product",
      ".product-item",
      ".product-card",
      ".item-product",
      ".grid-item",
      ".col-product",
      "[data-product-id]",
      "[data-product]",
      "[data-item-product-id]",
      "[data-store='product-item']",
      "[data-store='product-card']"
    ];
    const pricePattern = /price|preco|valor/i;
    let current = element;
    while (current && current !== document.body) {
      if (current.matches?.(selectors.join(","))) {
        const marker = `${current.id || ""} ${current.className || ""} ${current.getAttribute?.("data-store") || ""}`;
        const hasProductLink = Boolean(current.querySelector?.("a[href*='/produtos/']"));
        const hasTitle = Boolean(getProductCardTitle(current));
        if (!pricePattern.test(marker) || hasProductLink || hasTitle) {
          return current;
        }
      }
      current = current.parentElement;
    }
    return null;
  }

  function getProductCardTitle(card) {
    if (!card) return "";
    const selectors = [
      ".js-item-name",
      ".js-product-name",
      ".product-name",
      ".item-name",
      ".product-title",
      ".js-item-title",
      ".item-title",
      "[data-store='product-item-name']",
      "[data-store='product-name']",
      "h2",
      "h3",
      "h4",
      "a[title]",
      "a[href*='/produtos/']"
    ];
    for (const selector of selectors) {
      const node = card.querySelector?.(selector);
      const value = node?.getAttribute?.("title") || node?.textContent || "";
      const normalized = normalizeText(value);
      if (normalized && !normalized.includes("comprar") && !normalized.includes("ver produto")) {
        return value;
      }
    }
    return "";
  }

  function getCurrentProductRule(maps) {
    const selectedVariantId =
      window.LS?.selectedVariant?.id ||
      window.LS?.product?.selectedVariant?.id ||
      window.selectedVariant?.id ||
      document.querySelector("[name='variation_id'], [name='variant_id'], [data-selected-variant-id]")?.value ||
      document.querySelector("[data-selected-variant-id]")?.getAttribute("data-selected-variant-id");
    if (selectedVariantId && maps.byVariant.get(String(selectedVariantId))) {
      return maps.byVariant.get(String(selectedVariantId));
    }

    const skuText = document.querySelector("[data-product-sku], .js-product-sku, .product-sku")?.textContent || "";
    const sku = getSkuFromText(skuText);
    if (sku && maps.bySku.get(sku)) return maps.bySku.get(sku);

    const productIds = [
      window.LS?.product?.id,
      window.LS?.product?.product_id,
      window.product?.id,
      window.product?.product_id,
      document.querySelector("[data-product-id]")?.getAttribute("data-product-id")
    ].filter(Boolean).map(String);
    for (const productId of productIds) {
      const rules = maps.byProduct.get(productId);
      if (rules?.length) return chooseRuleForSelectedVariant(rules);
    }

    const title =
      document.querySelector("h1.js-product-name, h1.product-name, h1")?.textContent ||
      document.querySelector("meta[property='og:title']")?.content ||
      "";
    const byName = maps.byProductName.get(normalizeText(title));
    if (byName?.length) return chooseRuleForSelectedVariant(byName);

    const byPath = maps.byUrl.get(normalizePath(window.location.href));
    if (byPath) return byPath;

    return null;
  }

  function findRuleForElement(element, maps) {
    const closestVariant = element.closest?.("[data-variant-id], [data-variation-id], [data-store*='variant']");
    const variantId = getAttr(closestVariant, ["data-variant-id", "data-variation-id", "data-id"]);
    if (variantId && maps.byVariant.get(variantId)) return maps.byVariant.get(variantId);

    const closestProduct = findProductCard(element);
    const productId = getAttr(closestProduct, ["data-product-id", "data-product", "data-item-product-id", "data-id"]);
    if (productId && maps.byProduct.get(productId)) return chooseRuleForProductCard(maps.byProduct.get(productId));

    const skuText = document.querySelector("[data-product-sku], .js-product-sku, .product-sku")?.textContent || "";
    const sku = getSkuFromText(skuText);
    if (sku && maps.bySku.get(sku)) return maps.bySku.get(sku);

    const cardTitle = getProductCardTitle(closestProduct);
    const byCardName = maps.byProductName.get(normalizeText(cardTitle));
    if (byCardName?.length) return chooseRuleForProductCard(byCardName);

    const href = closestProduct?.querySelector?.("a[href*='/produtos/']")?.href || closestProduct?.querySelector?.("a[href]")?.href || location.href;
    if (href) {
      const normalizedHref = normalizePath(href);
      const byUrl = maps.byUrl.get(normalizedHref);
      if (byUrl) return byUrl;
    }

    return getCurrentProductRule(maps);
  }

  function applyWholesalePrices(context) {
    const rules = [
      ...(Array.isArray(context.rules) ? context.rules : []),
      ...(Array.isArray(context.products) ? context.products : [])
    ];
    if (!context.wholesale || !rules.length) return;

    const maps = {
      byVariant: new Map(),
      byProduct: new Map(),
      bySku: new Map(),
      byUrl: new Map(),
      byProductName: new Map()
    };

    rules.forEach((rule) => {
      if (rule.variantId) maps.byVariant.set(String(rule.variantId), rule);
      if (rule.sku) maps.bySku.set(String(rule.sku).toUpperCase(), rule);
      if (rule.url) {
        maps.byUrl.set(normalizePath(rule.url), rule);
      }
      if (rule.productId) {
        addRuleToList(maps.byProduct, rule.productId, rule);
      }
      if (rule.productName) addRuleToList(maps.byProductName, normalizeText(rule.productName), rule);
    });

    const selectors = [
      ".js-price-display",
      ".js-product-price",
      ".js-price",
      ".product-price",
      ".price-current",
      ".current-price",
      ".sale-price",
      ".product-detail-price",
      ".js-product-detail-price",
      ".price",
      "#price_display",
      "[id='price_display']",
      "[data-store='product-price']",
      "[data-store='product-price-current']",
      "[data-store='price']",
      "[data-component='price']",
      "[data-store='product-item-price']"
    ];

    const nodes = Array.from(document.querySelectorAll(selectors.join(",")))
      .filter((node) => !/compare|old|list-price|price-compare/i.test(`${node.id} ${node.className}`));
    let applied = 0;
    const matched = [];
    nodes.forEach((node) => {
      const rule = findRuleForElement(node, maps);
      if (!rule) return;
      node.dataset.dgRetailPrice = node.dataset.dgRetailPrice || node.textContent.trim();
      node.dataset.dgWholesaleApplied = "true";
      node.textContent = moneyBR(rule.wholesalePrice);
      node.classList.add("dg-wholesale-price-applied");
      matched.push({
        productId: rule.productId || "",
        variantId: rule.variantId || "",
        sku: rule.sku || "",
        productName: rule.productName || "",
        variantName: rule.variantName || "",
        wholesalePrice: rule.wholesalePrice
      });
      applied += 1;
    });

    window.DG_WHOLESALE_DEBUG.applied = applied;
    window.DG_WHOLESALE_DEBUG.priceNodes = nodes.length;
    window.DG_WHOLESALE_DEBUG.rules = rules.length;
    window.DG_WHOLESALE_DEBUG.matchedRules = matched.slice(0, 8);
    window.DG_WHOLESALE_DEBUG.lastReason = applied ? "prices_applied" : "no_matching_price_nodes";

    if (applied && !document.querySelector("[data-dg-wholesale-banner]")) {
      const banner = document.createElement("div");
      banner.setAttribute("data-dg-wholesale-banner", "true");
      banner.className = "dg-wholesale-banner";
      banner.textContent = "Preço de atacado aplicado para sua conta.";
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 4200);
    }
  }

  async function initStorefrontWholesalePrices(attempt = 0) {
    if (window.DG_WHOLESALE_DEBUG?.contextLoaded && window.DG_WHOLESALE_DEBUG?.applied > 0) return;
    window.DG_WHOLESALE_DEBUG.attempts = attempt + 1;
    let customer = getCurrentStorefrontCustomer();
    if (!customer?.email && !customer?.id) {
      const accountEmail = await findCustomerEmailInAccountPages();
      if (accountEmail) {
        customer = { id: "", email: accountEmail, source: "account_page_email" };
        window.DG_WHOLESALE_DEBUG.accountPageEmailUsed = true;
      }
    }
    if (!customer?.email && !customer?.id && !customer?.name) {
      window.DG_WHOLESALE_DEBUG.customerFound = false;
      window.DG_WHOLESALE_DEBUG.lastReason = "customer_not_found_in_storefront";
      if (attempt < 60) {
        window.setTimeout(() => initStorefrontWholesalePrices(attempt + 1), 500);
      }
      return;
    }

    window.DG_WHOLESALE_DEBUG.customerFound = true;
    window.DG_WHOLESALE_DEBUG.customer = {
      id: customer.id || "",
      email: customer.email || "",
      name: customer.name || "",
      source: customer.source || ""
    };

    if (!document.querySelector("[data-dg-wholesale-price-style]")) {
      const style = document.createElement("style");
      style.setAttribute("data-dg-wholesale-price-style", "true");
      style.textContent = `
        .dg-wholesale-price-applied {
          color: #0050d8 !important;
          font-weight: 700 !important;
        }
        .dg-wholesale-banner {
          position: fixed;
          left: 50%;
          bottom: 22px;
          z-index: 999999;
          transform: translateX(-50%);
          max-width: calc(100vw - 32px);
          border: 1px solid #bfdbfe;
          border-radius: 8px;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 12px 16px;
          font: 600 13px/1.35 Poppins, Arial, sans-serif;
          box-shadow: 0 12px 28px rgba(15, 23, 42, .12);
        }
      `;
      document.head.appendChild(style);
    }

    try {
      const params = new URLSearchParams();
      if (customer.email) params.set("email", customer.email);
      if (customer.id) params.set("customerId", customer.id);
      if (customer.name) params.set("customerName", customer.name);
      const response = await fetch(`${APP_URL}/api/storefront-wholesale-context?${params.toString()}`, {
        cache: "no-store"
      });
      const context = await response.json();
      window.DG_WHOLESALE_CONTEXT = context;
      window.DG_WHOLESALE_DEBUG.contextLoaded = true;
      window.DG_WHOLESALE_DEBUG.context = {
        wholesale: context.wholesale === true,
        reason: context.reason || "",
        rules: Array.isArray(context.rules) ? context.rules.length : 0
      };
      applyWholesalePrices(context);

      let applyTimer = 0;
      const rerun = () => {
        window.clearTimeout(applyTimer);
        applyTimer = window.setTimeout(() => applyWholesalePrices(context), 120);
      };
      if (!window.DG_WHOLESALE_PRICE_OBSERVER_READY) {
        window.DG_WHOLESALE_PRICE_OBSERVER_READY = true;
        document.addEventListener("change", rerun, true);
        document.addEventListener("click", (event) => {
          if (event.target.closest("select, input, button, .js-product-variants, .js-insta-variant, [data-option]")) rerun();
        }, true);
        const observer = new MutationObserver(() => rerun());
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } catch (error) {
      window.DG_WHOLESALE_DEBUG.lastReason = "context_request_failed";
      window.DG_WHOLESALE_DEBUG.error = error.message || String(error);
      console.warn("Não foi possível aplicar preços de atacado.", error);
    }
  }

  function formatTechnicalError({ status, data, error }) {
    const detail = data?.error || data?.message || error?.message || "Erro desconhecido.";
    const requestId = data?.requestId ? ` Código: ${data.requestId}.` : "";
    return `Não foi possível concluir o cadastro. Status: ${status || "sem resposta"}. Motivo: ${detail}.${requestId}`;
  }

  ready(function () {
    initStorefrontWholesalePrices();
    window.addEventListener("load", () => initStorefrontWholesalePrices());
    window.addEventListener("focus", () => initStorefrontWholesalePrices());
    document.addEventListener("click", () => initStorefrontWholesalePrices(), true);

    if (isLoginPage()) {
      const loginForm = findLoginForm();
      loginForm?.addEventListener("submit", () => {
        const email = loginForm.querySelector('input[type="email"], input[name*="email" i]')?.value;
        saveWholesaleEmail(email);
      });
    }

    if (!isAccountPage()) return;
    if (document.querySelector("[data-dg-wholesale-login]")) return;

    const loginForm = findLoginForm();
    if (!loginForm) return;

    const style = document.createElement("style");
    style.textContent = `
      .dg-wholesale-login {
        width: 100%;
        max-width: 650px;
        margin: 0 0 24px;
        font-family: Poppins, Arial, sans-serif;
      }
      .dg-wholesale-login.has-result {
        margin-left: auto;
        margin-right: auto;
      }
      .dg-wholesale-switch {
        display: inline-grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        padding: 4px;
        border: 1px solid #d9dfe7;
        border-radius: 8px;
        background: #f6f7f9;
        margin: 0 0 18px;
      }
      .dg-wholesale-switch button {
        min-height: 40px;
        border: 0;
        border-radius: 6px;
        padding: 0 20px;
        background: transparent;
        color: #303846;
        font: 600 14px/1 Poppins, Arial, sans-serif;
        cursor: pointer;
        transition: background .16s ease, color .16s ease, box-shadow .16s ease;
      }
      .dg-wholesale-switch button:hover {
        background: #ffffff;
      }
      .dg-wholesale-switch button.is-active {
        background: #0050d8;
        color: #ffffff;
        box-shadow: 0 1px 2px rgba(21, 25, 34, .12);
      }
      .dg-wholesale-panel {
        display: none;
        border: 1px solid #d9dfe7;
        border-radius: 8px;
        background: #ffffff;
        padding: 22px;
        margin: 0 0 22px;
      }
      .dg-wholesale-panel.is-open {
        display: block;
      }
      .dg-wholesale-panel h2 {
        margin: 0 0 6px;
        color: #151922;
        font: 700 24px/1.2 Poppins, Arial, sans-serif;
      }
      .dg-wholesale-panel p {
        margin: 0 0 18px;
        color: #5f6b7a;
        font-size: 14px;
      }
      .dg-wholesale-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .dg-wholesale-field {
        display: grid;
        gap: 7px;
        color: #303846;
        font: 500 13px/1.2 Poppins, Arial, sans-serif;
      }
      .dg-wholesale-field.is-full {
        grid-column: 1 / -1;
      }
      .dg-wholesale-field input {
        width: 100%;
        min-height: 44px;
        border: 1px solid #cfd7e3;
        border-radius: 6px;
        background: #fff;
        color: #151922;
        padding: 0 13px;
        font: 400 14px/1 Poppins, Arial, sans-serif;
        outline: none;
      }
      .dg-wholesale-field input:focus {
        border-color: #0050d8;
        box-shadow: 0 0 0 3px rgba(0, 80, 216, .12);
      }
      .dg-wholesale-check {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #303846;
        font: 500 13px/1.35 Poppins, Arial, sans-serif;
      }
      .dg-wholesale-check input {
        width: 16px;
        height: 16px;
        accent-color: #0050d8;
      }
      .dg-wholesale-submit {
        width: 100%;
        min-height: 46px;
        margin-top: 16px;
        border: 1px solid #0050d8;
        border-radius: 6px;
        background: #0050d8;
        color: #fff;
        font: 700 15px/1 Poppins, Arial, sans-serif;
        cursor: pointer;
        transition: background .16s ease, transform .08s ease, opacity .16s ease;
      }
      .dg-wholesale-submit:hover {
        background: #003fa8;
      }
      .dg-wholesale-submit:active {
        transform: translateY(1px);
      }
      .dg-wholesale-submit:disabled {
        cursor: not-allowed;
        opacity: .68;
      }
      .dg-wholesale-message {
        margin-top: 14px;
        border-radius: 6px;
        padding: 12px 14px;
        font: 600 13px/1.45 Poppins, Arial, sans-serif;
      }
      .dg-wholesale-message.is-success {
        color: #075e54;
        background: #e8f8f4;
        border: 1px solid #b8e4d8;
      }
      .dg-wholesale-message.is-error {
        color: #9b1c1c;
        background: #fff1f1;
        border: 1px solid #f4c7c7;
      }
      .dg-wholesale-note {
        margin-top: 12px;
        color: #5f6b7a;
        font-size: 12px;
      }
      .dg-wholesale-result {
        display: grid;
        justify-items: center;
        gap: 12px;
        text-align: center;
        padding: 18px 8px;
      }
      .dg-wholesale-result-icon {
        display: inline-grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 999px;
        font: 800 20px/1 Poppins, Arial, sans-serif;
      }
      .dg-wholesale-result.is-approved .dg-wholesale-result-icon {
        color: #075e54;
        background: #e8f8f4;
        border: 1px solid #b8e4d8;
      }
      .dg-wholesale-result.is-pending .dg-wholesale-result-icon {
        color: #8a5a00;
        background: #fff6dd;
        border: 1px solid #f1d58a;
      }
      .dg-wholesale-result .dg-wholesale-submit {
        width: auto;
        min-width: 260px;
        margin-top: 4px;
      }
      .dg-wholesale-result-help {
        margin: 0;
        color: #5f6b7a;
        font: 600 13px/1.45 Poppins, Arial, sans-serif;
      }
      @media (max-width: 680px) {
        .dg-wholesale-grid {
          grid-template-columns: 1fr;
        }
        .dg-wholesale-switch {
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);

    const root = document.createElement("section");
    root.className = "dg-wholesale-login";
    root.setAttribute("data-dg-wholesale-login", "true");
    root.setAttribute("data-dg-version", SCRIPT_VERSION);

    const switcher = document.createElement("div");
    switcher.className = "dg-wholesale-switch";
    switcher.innerHTML = `
      <button type="button" class="is-active" data-dg-mode="retail">Varejo</button>
      <button type="button" data-dg-mode="wholesale">Atacado</button>
    `;

    const panel = document.createElement("form");
    panel.className = "dg-wholesale-panel";
    panel.innerHTML = `
      <h2>Solicitar acesso ao atacado</h2>
      <p>Preencha os dados da empresa. A ${STORE_NAME} vai liberar os preços de atacado conforme a regra da loja.</p>
      <div class="dg-wholesale-grid"></div>
      <button class="dg-wholesale-submit" type="submit">Enviar solicitação</button>
      <div class="dg-wholesale-message" hidden></div>
      <div class="dg-wholesale-note">Depois da aprovação, acesse sua conta da loja para visualizar as condições de atacado.</div>
    `;

    const grid = panel.querySelector(".dg-wholesale-grid");
    const companyField = createField("Razão social", "companyName", "text", "Nome da empresa", true);
    const nameField = createField("Nome do responsável", "name", "text", "Seu nome", true);
    const emailField = createField("E-mail", "email", "email", "email@empresa.com.br", true);
    const phoneField = createField("Telefone", "phone", "tel", "(00) 00000-0000", false);
    const cnpjField = createField("CNPJ", "cnpj", "text", "00.000.000/0000-00", true);
    const birthdateField = createField("Data de nascimento", "birthdate", "date", "", false);
    const passwordField = createField("Senha", "password", "password", "Crie uma senha", true);
    const confirmPasswordField = createField("Confirmar senha", "passwordConfirmation", "password", "Repita a senha", true);
    const zipcodeField = createField("CEP", "zipcode", "text", "00000-000", true);
    const addressField = createField("Endereço", "address", "text", "Rua / Avenida", true);
    const numberField = createField("Número", "number", "text", "123", true);
    const complementField = createField("Complemento", "complement", "text", "Sala, loja, bloco", false);
    const localityField = createField("Bairro", "locality", "text", "Bairro", true);
    const cityField = createField("Cidade", "city", "text", "Cidade", true);
    const provinceField = createField("Estado", "province", "text", "UF", true);
    const marketingField = createCheckbox("Aceito receber novidades e campanhas por e-mail.", "acceptsMarketing");
    cnpjField.classList.add("is-full");
    addressField.classList.add("is-full");
    grid.append(
      companyField,
      nameField,
      emailField,
      phoneField,
      cnpjField,
      birthdateField,
      passwordField,
      confirmPasswordField,
      zipcodeField,
      addressField,
      numberField,
      complementField,
      localityField,
      cityField,
      provinceField,
      marketingField
    );

    loginForm.parentNode.insertBefore(root, loginForm);
    root.append(switcher, panel);

    const buttons = Array.from(switcher.querySelectorAll("button"));
    function setMode(mode) {
      buttons.forEach((button) => button.classList.toggle("is-active", button.dataset.dgMode === mode));
      panel.classList.toggle("is-open", mode === "wholesale");
      loginForm.style.display = mode === "wholesale" ? "none" : "";
    }

    switcher.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-dg-mode]");
      if (!button) return;
      setMode(button.dataset.dgMode);
    });

    const cnpjInput = panel.querySelector('input[name="cnpj"]');
    cnpjInput.addEventListener("input", () => {
      cnpjInput.value = formatCnpj(cnpjInput.value);
    });

    panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = panel.querySelector(".dg-wholesale-submit");
      const message = panel.querySelector(".dg-wholesale-message");
      const formData = new FormData(panel);
      const payload = Object.fromEntries(formData.entries());
      payload.cnpj = onlyDigits(payload.cnpj);

      if (payload.cnpj.length !== 14) {
        setMessage(message, "error", "Confira o CNPJ. Ele precisa ter 14 números.");
        return;
      }
      if (String(payload.password || "").length < 6) {
        setMessage(message, "error", "Crie uma senha com pelo menos 6 caracteres.");
        return;
      }
      if (payload.password !== payload.passwordConfirmation) {
        setMessage(message, "error", "A confirmação de senha precisa ser igual à senha.");
        return;
      }
      submit.disabled = true;
      submit.textContent = "Enviando...";
      setMessage(message, "", "");

      try {
        const response = await fetch(`${APP_URL}/api/wholesale-requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw Object.assign(new Error(data.error || "Não foi possível enviar o cadastro."), {
            status: response.status,
            data
          });
        }
        saveWholesaleEmail(payload.email);
        renderResult({
          panel,
          approved: data.approved !== false,
          loginAvailable: data.loginAvailable === true,
          activationMessage: data.activationMessage || "",
          customer: data.customer || null
        });
      } catch (error) {
        setMessage(message, "error", formatTechnicalError({ status: error.status, data: error.data, error }));
      } finally {
        submit.disabled = false;
        submit.textContent = "Enviar solicitação";
      }
    });
  });
})();
