(function () {
  const APP_URL = "https://dg-venus-modas.vercel.app";
  const STORE_NAME = "Vênus Modas";
  const SCRIPT_VERSION = "2026-08-18-storefront-diagnostics-v1";
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
      const email = customer.email || customer.customer_email || customer.mail;
      const id = customer.id || customer.customer_id;
      if (email || id) {
        return {
          id: id ? String(id) : "",
          email: email ? String(email).toLowerCase() : ""
        };
      }
    }

    const emailMeta = document.querySelector('meta[name="customer-email"], meta[property="customer:email"]');
    if (emailMeta?.content) {
      return { id: "", email: String(emailMeta.content).toLowerCase() };
    }

    const accountText = [
      document.querySelector(".js-customer-name"),
      document.querySelector("[data-customer-email]"),
      document.querySelector("[data-store='account-name']")
    ].find(Boolean);
    const dataEmail = accountText?.getAttribute?.("data-customer-email");
    if (dataEmail) {
      return { id: "", email: String(dataEmail).toLowerCase() };
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

  function findRuleForElement(element, maps) {
    const closestVariant = element.closest?.("[data-variant-id], [data-variation-id], [data-store*='variant']");
    const variantId = getAttr(closestVariant, ["data-variant-id", "data-variation-id", "data-id"]);
    if (variantId && maps.byVariant.get(variantId)) return maps.byVariant.get(variantId);

    const closestProduct = element.closest?.("[data-product-id], [data-product], [data-item-product-id], [data-store*='product']");
    const productId = getAttr(closestProduct, ["data-product-id", "data-product", "data-item-product-id", "data-id"]);
    if (productId && maps.byProduct.get(productId)) return maps.byProduct.get(productId)[0];

    const skuText = document.querySelector("[data-product-sku], .js-product-sku, .product-sku")?.textContent || "";
    const sku = skuText.replace(/sku:?/i, "").trim().toUpperCase();
    if (sku && maps.bySku.get(sku)) return maps.bySku.get(sku);

    const lsProductId =
      window.LS?.product?.id ||
      window.LS?.product?.product_id ||
      window.product?.id ||
      window.product?.product_id;
    if (lsProductId && maps.byProduct.get(String(lsProductId))) return maps.byProduct.get(String(lsProductId))[0];

    const href = element.closest?.(".js-product-container,.js-item-product,.product-item")?.querySelector?.("a[href]")?.href || location.href;
    if (href) {
      const normalizedHref = String(href).split("?")[0].replace(/\/$/, "");
      const byUrl = maps.byUrl.get(normalizedHref);
      if (byUrl) return byUrl;
    }

    return null;
  }

  function applyWholesalePrices(context) {
    const rules = Array.isArray(context.rules) ? context.rules : [];
    if (!context.wholesale || !rules.length) return;

    const maps = {
      byVariant: new Map(),
      byProduct: new Map(),
      bySku: new Map(),
      byUrl: new Map()
    };

    rules.forEach((rule) => {
      if (rule.variantId) maps.byVariant.set(String(rule.variantId), rule);
      if (rule.sku) maps.bySku.set(String(rule.sku).toUpperCase(), rule);
      if (rule.url) {
        maps.byUrl.set(String(rule.url).split("?")[0].replace(/\/$/, ""), rule);
      }
      if (rule.productId) {
        const key = String(rule.productId);
        const list = maps.byProduct.get(key) || [];
        list.push(rule);
        maps.byProduct.set(key, list);
      }
    });

    const selectors = [
      ".js-price-display",
      ".js-product-price",
      ".js-price",
      ".price",
      "#price_display",
      "[data-store='product-price']",
      "[data-store='product-item-price']"
    ];

    const nodes = Array.from(document.querySelectorAll(selectors.join(",")));
    let applied = 0;
    nodes.forEach((node) => {
      const rule = findRuleForElement(node, maps);
      if (!rule) return;
      node.dataset.dgRetailPrice = node.dataset.dgRetailPrice || node.textContent.trim();
      node.dataset.dgWholesaleApplied = "true";
      node.textContent = moneyBR(rule.wholesalePrice);
      node.classList.add("dg-wholesale-price-applied");
      applied += 1;
    });

    window.DG_WHOLESALE_DEBUG.applied = applied;
    window.DG_WHOLESALE_DEBUG.priceNodes = nodes.length;
    window.DG_WHOLESALE_DEBUG.rules = rules.length;
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
    const customer = getCurrentStorefrontCustomer();
    if (!customer?.email && !customer?.id) {
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
      email: customer.email || ""
    };

    const style = document.createElement("style");
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

    try {
      const params = new URLSearchParams();
      if (customer.email) params.set("email", customer.email);
      if (customer.id) params.set("customerId", customer.id);
      const response = await fetch(`${APP_URL}/api/storefront-wholesale-context?${params.toString()}`);
      const context = await response.json();
      window.DG_WHOLESALE_CONTEXT = context;
      window.DG_WHOLESALE_DEBUG.contextLoaded = true;
      window.DG_WHOLESALE_DEBUG.context = {
        wholesale: context.wholesale === true,
        reason: context.reason || "",
        rules: Array.isArray(context.rules) ? context.rules.length : 0
      };
      applyWholesalePrices(context);

      const rerun = () => window.requestAnimationFrame(() => applyWholesalePrices(context));
      document.addEventListener("change", rerun, true);
      document.addEventListener("click", (event) => {
        if (event.target.closest("select, input, button, .js-product-variants, .js-insta-variant")) rerun();
      }, true);
      const observer = new MutationObserver(() => rerun());
      observer.observe(document.body, { childList: true, subtree: true });
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
