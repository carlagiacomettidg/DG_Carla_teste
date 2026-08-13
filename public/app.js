const settingsForm = document.querySelector("#settingsForm");
const saveSettingsBtn = document.querySelector("#saveSettingsBtn");
const ruleForm = document.querySelector("#ruleForm");
const importForm = document.querySelector("#importForm");
const customerForm = document.querySelector("#customerForm");
const rulesTable = document.querySelector("#rulesTable");
const customersTable = document.querySelector("#customersTable");
const simulateBtn = document.querySelector("#simulateBtn");
const simulationResult = document.querySelector("#simulationResult");

let settings = {};
let rules = [];
let customers = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }

  return response.json();
}

function currency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function setFormValues(form, data) {
  [...form.elements].forEach((field) => {
    if (!field.name) return;
    field.value = data[field.name] ?? "";
  });
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function renderSettings() {
  document.querySelector("#wholesaleCdLabel").textContent =
    settings.wholesaleLocationName || settings.wholesaleLocationId || "-";
  document.querySelector("#minimumLabel").textContent =
    `${settings.wholesaleMinimumQuantity || 0} un. / ${currency(settings.wholesaleMinimumAmount)}`;
}

function renderRules() {
  rulesTable.innerHTML = rules
    .map(
      (rule) => `
        <tr>
          <td><strong>${rule.sku}</strong></td>
          <td>${rule.productName || "-"}</td>
          <td>${currency(rule.wholesalePrice)}</td>
          <td>${rule.wholesaleStock || 0}</td>
          <td><span class="pill">${rule.enabled ? "ativo" : "pausado"}</span></td>
          <td><button data-delete="${rule.id}">Remover</button></td>
        </tr>
      `
    )
    .join("");
}

function renderCustomers() {
  customersTable.innerHTML = customers
    .map(
      (customer) => `
        <tr>
          <td><strong>${customer.name || "-"}</strong></td>
          <td>${customer.email || "-"}</td>
          <td>${customer.cnpj || "-"}</td>
          <td>${Number(customer.discountPercent || 0)}%</td>
          <td><span class="pill">${customer.approved ? "aprovado" : "pendente"}</span></td>
          <td>
            <button data-toggle-customer="${customer.id}">
              ${customer.approved ? "Remover acesso" : "Aprovar"}
            </button>
            <button data-delete-customer="${customer.id}">Excluir</button>
          </td>
        </tr>
      `
    )
    .join("");
}

async function load() {
  settings = await api("/api/settings");
  rules = await api("/api/rules");
  customers = await api("/api/wholesale-customers");
  setFormValues(settingsForm, settings);
  renderSettings();
  renderRules();
  renderCustomers();
}

saveSettingsBtn.addEventListener("click", async () => {
  settings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(formToObject(settingsForm))
  });
  renderSettings();
});

ruleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  rules = await api("/api/rules", {
    method: "POST",
    body: JSON.stringify(formToObject(ruleForm))
  });
  ruleForm.reset();
  renderRules();
});

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/rules/import", {
    method: "POST",
    body: new FormData(importForm)
  });
  const result = await response.json();
  if (!response.ok) {
    simulationResult.textContent = JSON.stringify(result, null, 2);
    return;
  }
  rules = result.rules;
  importForm.reset();
  renderRules();
  simulationResult.textContent = JSON.stringify({ imported: result.imported }, null, 2);
});

customerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  customers = await api("/api/wholesale-customers", {
    method: "POST",
    body: JSON.stringify(formToObject(customerForm))
  });
  customerForm.reset();
  renderCustomers();
});

rulesTable.addEventListener("click", async (event) => {
  const id = event.target.dataset.delete;
  if (!id) return;
  rules = await api(`/api/rules/${id}`, { method: "DELETE" });
  renderRules();
});

customersTable.addEventListener("click", async (event) => {
  const toggleId = event.target.dataset.toggleCustomer;
  if (toggleId) {
    const customer = customers.find((item) => item.id === toggleId);
    customers = await api(`/api/wholesale-customers/${toggleId}`, {
      method: "PUT",
      body: JSON.stringify({ approved: !customer.approved })
    });
    renderCustomers();
    return;
  }

  const deleteId = event.target.dataset.deleteCustomer;
  if (deleteId) {
    customers = await api(`/api/wholesale-customers/${deleteId}`, { method: "DELETE" });
    renderCustomers();
  }
});

simulateBtn.addEventListener("click", async () => {
  const firstRule = rules[0] || { sku: "BLUSA001", wholesalePrice: 89.9 };
  const result = await api("/api/simulate-checkout", {
    method: "POST",
    body: JSON.stringify({
      store_id: settings.id || "demo",
      details: {
        event: "location/prioritization",
        action: "prioritization",
        domain: "location",
        timestamp: Date.now()
      },
      products: [
        {
          sku: firstRule.sku,
          price: String(firstRule.wholesalePrice),
          quantity: Number(settings.wholesaleMinimumQuantity || 6),
          variant_id: firstRule.variantId || ""
        }
      ],
      customer: {
        id: 123,
        email: customers[0]?.email || "compras@cliente.com",
        document: customers[0]?.cnpj || "11222333000181",
        tags: ["atacado"]
      },
      totals: {
        subtotal: "1000.00",
        total_discount: "0.00",
        total: "1000.00"
      },
      locations: [
        { id: settings.wholesaleLocationId, name: settings.wholesaleLocationName, priority: 1 }
      ]
    })
  });

  simulationResult.textContent = JSON.stringify(result, null, 2);
});

load().catch((error) => {
  simulationResult.textContent = error.message;
});
