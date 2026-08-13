import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const isEmbedded = window.self !== window.top;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

function currency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function App() {
  const [settings, setSettings] = useState({});
  const [rules, setRules] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [message, setMessage] = useState("{}");
  const [query, setQuery] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeView, setActiveView] = useState("products");
  const [embeddedStatus, setEmbeddedStatus] = useState(isEmbedded ? "Conectando ao admin" : "Painel web");
  const [embeddedMode, setEmbeddedMode] = useState(isEmbedded ? "loading" : "default");

  useEffect(() => {
    document.documentElement.classList.toggle("embedded-admin", isEmbedded);

    if (!isEmbedded) return;

    window.parent.postMessage({ type: "app/connected" }, "*");
    window.parent.postMessage({ type: "app/ready" }, "*");

    import("@tiendanube/nexo")
      .then(async (nexoModule) => {
        const nexo = nexoModule.default || nexoModule;
        const nexoClient = nexo.create({
          clientId: "39172",
          log: false
        });

        nexoModule.iAmReady(nexoClient);
        await nexoModule.connect(nexoClient);
        nexoModule.iAmReady(nexoClient);
        setEmbeddedStatus("Incorporado ao admin");
        setEmbeddedMode("ready");
      })
      .catch((error) => {
        console.warn("Falha ao conectar Nexo", error);
        setEmbeddedStatus("Falha no Nexo");
        setEmbeddedMode("warning");
      });
  }, []);

  useEffect(() => {
    Promise.all([api("/api/settings"), api("/api/rules"), api("/api/wholesale-customers")])
      .then(([settingsData, rulesData, customersData]) => {
        setSettings(settingsData);
        setRules(rulesData);
        setCustomers(customersData);
      })
      .catch((error) => setMessage(error.message));
  }, []);

  async function saveSettings(event) {
    event.preventDefault();
    const nextSettings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(formToObject(event.currentTarget))
    });
    setSettings(nextSettings);
    setMessage(JSON.stringify({ saved: true }, null, 2));
  }

  async function addRule(event) {
    event.preventDefault();
    const nextRules = await api("/api/rules", {
      method: "POST",
      body: JSON.stringify(formToObject(event.currentTarget))
    });
    setRules(nextRules);
    event.currentTarget.reset();
  }

  async function importRules(event) {
    event.preventDefault();
    const response = await fetch("/api/rules/import", {
      method: "POST",
      body: new FormData(event.currentTarget)
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(JSON.stringify(result, null, 2));
      return;
    }
    setRules(result.rules);
    event.currentTarget.reset();
    setMessage(JSON.stringify({ imported: result.imported }, null, 2));
  }

  async function deleteRule(id) {
    const nextRules = await api(`/api/rules/${id}`, { method: "DELETE" });
    setRules(nextRules);
  }

  async function syncProducts() {
    setMessage(JSON.stringify({ syncing: true }, null, 2));
    const result = await api("/api/rules/sync-products", { method: "POST" });
    setRules(result.rules);
    setMessage(JSON.stringify({ synced: result.imported }, null, 2));
  }

  async function syncCustomers() {
    setMessage(JSON.stringify({ syncingCustomers: true }, null, 2));
    const result = await api("/api/wholesale-customers/sync", { method: "POST" });
    setCustomers(result.customers);
    setMessage(JSON.stringify({ customersSynced: result.imported }, null, 2));
  }

  async function applyBulkDiscount() {
    const nextRules = await api("/api/rules/bulk-discount", {
      method: "POST",
      body: JSON.stringify({
        discountPercent: Number(discountPercent || 0),
        selectedIds
      })
    });
    setRules(nextRules);
    setMessage(JSON.stringify({ discountApplied: Number(discountPercent || 0), selected: selectedIds.length }, null, 2));
  }

  async function updateRule(id, patch) {
    const nextRules = await api(`/api/rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch)
    });
    setRules(nextRules);
  }

  async function toggleCustomer(customer) {
    const nextCustomers = await api(`/api/wholesale-customers/${customer.id}`, {
      method: "PUT",
      body: JSON.stringify({ approved: !customer.approved })
    });
    setCustomers(nextCustomers);
  }

  async function deleteCustomer(id) {
    const nextCustomers = await api(`/api/wholesale-customers/${id}`, { method: "DELETE" });
    setCustomers(nextCustomers);
  }

  async function simulateCheckout() {
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
        locations: [{ id: settings.wholesaleLocationId, name: settings.wholesaleLocationName, priority: 1 }]
      })
    });
    setMessage(JSON.stringify(result, null, 2));
  }

  const filteredRules = rules.filter((rule) => {
    const search = `${rule.sku} ${rule.productName} ${rule.variantName}`.toLowerCase();
    return search.includes(query.toLowerCase());
  });
  const allFilteredSelected =
    filteredRules.length > 0 && filteredRules.every((rule) => selectedIds.includes(String(rule.id)));

  function toggleSelect(id) {
    const stringId = String(id);
    setSelectedIds((current) =>
      current.includes(stringId) ? current.filter((item) => item !== stringId) : [...current, stringId]
    );
  }

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      setSelectedIds((current) => current.filter((id) => !filteredRules.some((rule) => String(rule.id) === id)));
      return;
    }
    setSelectedIds((current) => Array.from(new Set([...current, ...filteredRules.map((rule) => String(rule.id))])));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">App sob demanda Nuvemshop</p>
          <h1>Produtos em atacado</h1>
        </div>
        <div className="top-actions">
          <span className="status-chip" data-mode={embeddedMode}>
            {embeddedStatus}
          </span>
          <a className="button-link" href="/api/rules/export">
            Exportar
          </a>
          <button onClick={syncProducts}>Sincronizar produtos</button>
          <button className="primary" onClick={simulateCheckout}>
            Testar regra
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Secoes do app">
        <button className={activeView === "products" ? "active" : ""} onClick={() => setActiveView("products")}>
          Produtos
        </button>
        <button className={activeView === "import" ? "active" : ""} onClick={() => setActiveView("import")}>
          Importar e exportar
        </button>
        <button className={activeView === "customers" ? "active" : ""} onClick={() => setActiveView("customers")}>
          Clientes atacado
        </button>
        <button className={activeView === "settings" ? "active" : ""} onClick={() => setActiveView("settings")}>
          Configuracoes
        </button>
      </nav>

      {activeView === "products" && (
        <>
          <section className="summary-strip">
            <article>
              <span>CD atacado</span>
              <strong>{settings.wholesaleLocationName || settings.wholesaleLocationId || "-"}</strong>
            </article>
            <article>
              <span>Pedido minimo</span>
              <strong>
                {settings.wholesaleMinimumQuantity || 0} un. / {currency(settings.wholesaleMinimumAmount)}
              </strong>
            </article>
            <article>
              <span>Aprovacao</span>
              <strong>{settings.wholesaleApprovalMode === "automatic" ? "Automatica por CNPJ" : "Revisao manual"}</strong>
            </article>
          </section>

          <section className="products-section">
            <div className="products-heading">
              <div>
                <h2>Produtos</h2>
                <p>{filteredRules.length} produtos/variacoes</p>
              </div>
              <div className="bulk-box">
                <input
                  value={discountPercent}
                  onChange={(event) => setDiscountPercent(event.target.value)}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="% desconto"
                />
                <button type="button" onClick={applyBulkDiscount}>
                  Aplicar nos selecionados
                </button>
              </div>
            </div>

            <div className="products-toolbar">
              <input
                aria-label="Buscar produtos"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar produtos por nome, SKU ou variacao"
              />
              <button type="button">Filtrar</button>
              <button type="button">Mais novo</button>
            </div>

            <p className="count-line">
              {selectedIds.length > 0
                ? `${selectedIds.length} selecionados. O desconto em massa usa o preco normal como base.`
                : "Os produtos abaixo sao puxados do cadastro real da Nuvemshop. O app adiciona apenas as regras de atacado."}
            </p>

            {filteredRules.length === 0 ? (
              <div className="empty-state">
                <h3>Nenhum produto sincronizado</h3>
                <p>Clique em Sincronizar produtos para carregar os produtos reais da loja.</p>
                <button className="primary" onClick={syncProducts}>
                  Sincronizar produtos
                </button>
              </div>
            ) : (
              <div className="table-wrap">
              <table className="products-table">
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} />
                    </th>
                    <th>Produto</th>
                    <th>SKU</th>
                    <th>Estoque varejo</th>
                    <th>Preco normal</th>
                    <th>Preco atacado</th>
                    <th>Estoque atacado</th>
                    <th>Variacao</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRules.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(String(rule.id))}
                          onChange={() => toggleSelect(rule.id)}
                        />
                      </td>
                      <td>
                        <div className="product-cell">
                          {rule.image ? <img src={rule.image} alt="" /> : <span className="image-empty" />}
                          <strong>{rule.productName || "-"}</strong>
                        </div>
                      </td>
                      <td>
                        <strong>{rule.sku || "-"}</strong>
                      </td>
                      <td>{rule.retailStock || 0}</td>
                      <td>{currency(rule.retailPrice)}</td>
                      <td>
                        <input
                          className="table-input"
                          defaultValue={rule.wholesalePrice || 0}
                          type="number"
                          step="0.01"
                          onBlur={(event) => updateRule(rule.id, { wholesalePrice: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="table-input"
                          defaultValue={rule.wholesaleStock || 0}
                          type="number"
                          onBlur={(event) => updateRule(rule.id, { wholesaleStock: event.target.value })}
                        />
                      </td>
                      <td>{rule.variantName || "-"}</td>
                      <td>
                        <button onClick={() => deleteRule(rule.id)} type="button">
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>
        </>
      )}

      {activeView === "import" && (
        <section className="products-section">
          <div className="panel-title">
            <div>
              <h2>Importar e exportar tabela</h2>
              <p>Atualize preco e estoque de atacado por CSV ou XLSX.</p>
            </div>
            <a className="button-link" href="/api/rules/export">
              Exportar modelo
            </a>
          </div>
          <form className="import-form" onSubmit={importRules}>
            <input name="file" type="file" accept=".csv,.xlsx" required />
            <button className="primary" type="submit">
              Importar planilha
            </button>
          </form>
        </section>
      )}

      {activeView === "customers" && (
        <section className="products-section">
          <div className="panel-title">
            <div>
              <h2>Clientes atacado</h2>
              <p>Clientes reais da Nuvemshop e solicitacoes de acesso atacado.</p>
            </div>
            <button onClick={syncCustomers}>Sincronizar clientes</button>
          </div>

          <div className="notice">
            Link de solicitacao para o cliente: <strong>/cadastro-atacado.html</strong>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>E-mail</th>
                  <th>CNPJ</th>
                  <th>Origem</th>
                  <th>Solicitacao</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.name || "-"}</strong>
                    </td>
                    <td>{customer.email || "-"}</td>
                    <td>{customer.cnpj || "-"}</td>
                    <td>{customer.source === "request" ? "Formulario" : "Nuvemshop"}</td>
                    <td>{customer.requestStatus === "pending" ? "Pendente" : "-"}</td>
                    <td>
                      <span className="pill">{customer.approved ? "aprovado" : "pendente"}</span>
                    </td>
                    <td>
                      <button type="button" onClick={() => toggleCustomer(customer)}>
                        {customer.approved ? "Remover acesso" : "Aprovar"}
                      </button>
                      <button type="button" onClick={() => deleteCustomer(customer.id)}>
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeView === "settings" && (
        <>
          <section className="products-section">
            <div className="panel-title">
              <div>
                <h2>Configuracoes</h2>
                <p>Defina o CD usado nas vendas de atacado e o criterio de aprovacao.</p>
              </div>
            </div>

            <form className="form-grid" onSubmit={saveSettings}>
              <label>
                ID do CD Atacado
                <input name="wholesaleLocationId" defaultValue={settings.wholesaleLocationId || ""} />
              </label>
              <label>
                Nome do CD Atacado
                <input name="wholesaleLocationName" defaultValue={settings.wholesaleLocationName || ""} />
              </label>
              <label>
                Qtd. minima atacado
                <input
                  name="wholesaleMinimumQuantity"
                  type="number"
                  min="0"
                  defaultValue={settings.wholesaleMinimumQuantity || 0}
                />
              </label>
              <label>
                Valor minimo atacado
                <input
                  name="wholesaleMinimumAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={settings.wholesaleMinimumAmount || 0}
                />
              </label>
              <label>
                Aprovacao de atacado
                <select name="wholesaleApprovalMode" defaultValue={settings.wholesaleApprovalMode || "manual"}>
                  <option value="manual">Revisao manual</option>
                  <option value="automatic">Automatico com CNPJ valido</option>
                </select>
              </label>
              <button className="primary" type="submit">
                Salvar
              </button>
            </form>
          </section>

          <section className="products-section">
            <div className="panel-title">
              <div>
                <h2>Resultado do teste</h2>
                <p>Mostra qual CD seria priorizado com a regra atual.</p>
              </div>
            </div>
            <pre>{message}</pre>
          </section>
        </>
      )}
    </main>
  );
}

createRoot(document.querySelector("#root")).render(<App />);
