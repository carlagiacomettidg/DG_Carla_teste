import React, { Component, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Database, Download, FileUp, MapPin, Package, RefreshCw, Save, Settings, Upload, Users } from "lucide-react";

if (typeof window !== "undefined" && !window.global) {
  window.global = window;
}

const isEmbedded = window.self !== window.top;
let getAdminSessionToken = null;

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="shell">
          <div className="admin-feedback">
            Não foi possível carregar esta tela. Atualize a página e tente novamente.
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(await getAdminHeaders())
  };
  const response = await fetch(path, {
    headers,
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      throw new Error(data.error || text);
    } catch (error) {
      if (error.message && error.message !== text) throw error;
      throw new Error(text);
    }
  }

  return response.json();
}

async function getAdminHeaders(extraHeaders = {}) {
  if (!isEmbedded) return extraHeaders;
  if (!getAdminSessionToken) {
    throw new Error("Aguardando conexão segura com o painel da Nuvemshop.");
  }
  const token = await getAdminSessionToken();
  return {
    ...extraHeaders,
    Authorization: `Bearer ${token}`
  };
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
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeView, setActiveView] = useState("products");
  const [importFileName, setImportFileName] = useState("");
  const [locations, setLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [visibleRuleCount, setVisibleRuleCount] = useState(80);
  const [tinyLoading, setTinyLoading] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("embedded-admin", isEmbedded);

    if (!isEmbedded) return;

    import("@tiendanube/nexo")
      .then(async (nexoModule) => {
        const nexo = nexoModule.default || nexoModule;
        const nexoClient = nexo.create({
          clientId: "39172",
          log: false
        });

        nexoModule.iAmReady(nexoClient);
        await nexoModule.connect(nexoClient, 10000);
        getAdminSessionToken = () => nexoModule.getSessionToken(nexoClient);
        nexoModule.iAmReady(nexoClient);
        setAdminReady(true);
      })
      .catch((error) => {
        setAdminAuthError("Não foi possível validar o acesso pelo painel da Nuvemshop. Atualize a página dentro do admin e tente novamente.");
        console.warn("Falha ao conectar Nexo", error);
      });
  }, []);

  useEffect(() => {
    if (!isEmbedded || !adminReady) return;
    Promise.all([api("/api/settings"), api("/api/rules")])
      .then(([settingsData, rulesData]) => {
        setSettings(settingsData);
        setRules(rulesData);
      })
      .catch((error) => setNotice(error.message));
  }, [adminReady]);

  useEffect(() => {
    setVisibleRuleCount(80);
  }, [query, rules.length]);

  useEffect(() => {
    if (activeView !== "customers" || customersLoaded || customersLoading) return;
    loadWholesaleCustomers();
  }, [activeView, customersLoaded, customersLoading]);

  async function loadWholesaleCustomers() {
    setCustomersLoading(true);
    try {
      const customersData = await api("/api/wholesale-customers");
      setCustomers(customersData);
      setCustomersLoaded(true);
    } catch (error) {
      setNotice(error.message || "Não foi possível carregar os clientes de atacado.");
    } finally {
      setCustomersLoading(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const nextSettings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(formToObject(event.currentTarget))
    });
    setSettings(nextSettings);
    setNotice("Configurações salvas com sucesso.");
  }

  async function updateApprovalMode(wholesaleApprovalMode) {
    const nextSettings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...settings,
        wholesaleApprovalMode
      })
    });
    setSettings(nextSettings);
    setNotice(
      wholesaleApprovalMode === "automatic"
        ? "Cadastro automático por CNPJ ativado."
        : "Aprovação manual pelo painel ativada."
    );
  }

  async function syncLocations() {
    setLocationsLoading(true);
    setNotice("Buscando centros de distribuição da Nuvemshop...");

    try {
      const nextLocations = await api("/api/locations/sync");
      const list = Array.isArray(nextLocations) ? nextLocations : [];
      setLocations(list);
      setSettings((current) => {
        const currentLocation = list.find((item) => String(item.id || "") === String(current.wholesaleLocationId || ""));
        if (!currentLocation) return current;
        return {
          ...current,
          wholesaleLocationName: String(currentLocation.name || current.wholesaleLocationName || ""),
          wholesaleLocationAddress: String(currentLocation.address || current.wholesaleLocationAddress || "")
        };
      });
      setNotice(
        list.length
          ? `${list.length} centros de distribuição encontrados.`
          : "Nenhum centro de distribuição foi retornado pela API da Nuvemshop."
      );
    } catch (error) {
      setNotice(error.message || "Não foi possível buscar os centros de distribuição.");
    } finally {
      setLocationsLoading(false);
    }
  }

  function selectWholesaleLocation(event) {
    const id = String(event.target.value || "");
    const location = locations.find((item) => String(item.id || "") === id);
    setSettings((current) => ({
      ...current,
      wholesaleLocationId: id,
      wholesaleLocationName: String(location?.name || current.wholesaleLocationName || ""),
      wholesaleLocationAddress: String(location?.address || current.wholesaleLocationAddress || "")
    }));
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
      headers: await getAdminHeaders(),
      body: new FormData(event.currentTarget)
    });
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.error || "Não foi possível importar a planilha.");
      return;
    }
    setRules(result.rules);
    event.currentTarget.reset();
    setImportFileName("");
    setNotice(`${result.imported} itens importados com sucesso.`);
  }

  async function exportRules() {
    try {
      const response = await fetch("/api/rules/export", {
        headers: await getAdminHeaders()
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tabela-atacado-venos.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(error.message || "Não foi possível exportar a tabela.");
    }
  }

  async function deleteRule(id) {
    const nextRules = await api(`/api/rules/${id}`, { method: "DELETE" });
    setRules(nextRules);
  }

  async function syncProducts() {
    setNotice("Sincronizando produtos da Nuvemshop...");
    const result = await api("/api/rules/sync-products", { method: "POST" });
    setRules(result.rules);
    setNotice(`${result.imported} produtos/variações sincronizados.`);
  }

  async function syncTinyRules() {
    setTinyLoading(true);
    setNotice("Conferindo SKUs da Nuvemshop no Tiny...");
    try {
      const result = await api("/api/tiny/sync-rules", { method: "POST", body: JSON.stringify({}) });
      setRules(result.rules);
      setNotice(
        `Tiny sincronizado: ${result.updatedRules} variações atualizadas em ${result.checkedSkus} SKUs conferidos usando ${result.priceLists?.length || 0} listas de atacado. ${result.notFound?.length || 0} SKUs não encontrados no Tiny.`
      );
    } catch (error) {
      setNotice(error.message || "Não foi possível sincronizar o Tiny.");
    } finally {
      setTinyLoading(false);
    }
  }

  async function syncCustomers() {
    setNotice("Sincronizando clientes da Nuvemshop...");
    setCustomersLoading(true);
    try {
      const result = await api("/api/wholesale-customers/sync", { method: "POST" });
      setCustomers(result.customers);
      setCustomersLoaded(true);
      setNotice(`${result.imported} clientes sincronizados.`);
    } catch (error) {
      setNotice(error.message || "Não foi possível sincronizar os clientes.");
    } finally {
      setCustomersLoading(false);
    }
  }

  async function applyBulkDiscount() {
    if (!discountPercent) {
      setNotice("Informe uma porcentagem de desconto antes de aplicar.");
      return;
    }

    const selectedCount = selectedIds.length;
    setBulkLoading(true);
    setNotice(`Aplicando desconto em ${selectedCount || "todos os"} itens...`);

    try {
      const nextRules = await api("/api/rules/bulk-discount", {
        method: "POST",
        body: JSON.stringify({
          discountPercent: Number(discountPercent || 0),
          selectedIds
        })
      });
      setRules(nextRules);
      setNotice(`Desconto de ${Number(discountPercent || 0)}% aplicado em ${selectedCount || nextRules.length} itens.`);
    } catch (error) {
      setNotice(error.message || "Não foi possível aplicar o desconto.");
    } finally {
      setBulkLoading(false);
    }
  }

  function patchRuleLocal(id, patch) {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
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
    setNotice("Teste executado com sucesso.");
  }

  const filteredRules = useMemo(() => rules.filter((rule) => {
    const search = `${rule.sku} ${rule.productName} ${rule.variantName}`.toLowerCase();
    return search.includes(query.toLowerCase());
  }), [rules, query]);
  const allFilteredSelected = useMemo(
    () => filteredRules.length > 0 && filteredRules.every((rule) => selectedIds.includes(String(rule.id))),
    [filteredRules, selectedIds]
  );
  const visibleRules = useMemo(
    () => filteredRules.slice(0, visibleRuleCount),
    [filteredRules, visibleRuleCount]
  );
  const storeConnected = Boolean(settings.id && settings.accessToken === "configured");

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

  if (!isEmbedded) {
    return (
      <main className="shell private-shell">
        <section className="private-panel">
          <h1>Painel restrito</h1>
          <p>As configurações de atacado só podem ser acessadas dentro do painel administrativo da Nuvemshop.</p>
        </section>
      </main>
    );
  }

  if (!adminReady) {
    return (
      <main className="shell private-shell">
        <section className="private-panel">
          <h1>Validando acesso</h1>
          <p>{adminAuthError || "Conectando com segurança ao painel da Nuvemshop..."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">App sob demanda Nuvemshop</p>
          <h1>Produtos em atacado</h1>
        </div>
        <div className="top-actions">
          <button type="button" onClick={exportRules}>
            <Download size={16} />
            Exportar
          </button>
          <button onClick={syncProducts}>
            <RefreshCw size={16} />
            Sincronizar produtos
          </button>
          <button onClick={syncTinyRules} disabled={tinyLoading}>
            <Database size={16} />
            {tinyLoading ? "Sincronizando..." : "Sincronizar Tiny"}
          </button>
        </div>
      </header>

      {notice && <div className="admin-feedback">{notice}</div>}

      {!storeConnected && (
        <section className="connection-banner">
          <div>
            <h2>Conecte a loja Vênus Modas</h2>
            <p>Para sincronizar produtos, clientes e centros de distribuição, autorize o app na Nuvemshop.</p>
          </div>
          <a className="button-link primary-link" href="/auth/start" target="_blank" rel="noreferrer">
            Conectar loja
          </a>
        </section>
      )}

      <nav className="tabs" aria-label="Seções do app">
        <button type="button" className={activeView === "products" ? "active" : ""} onClick={() => setActiveView("products")}>
          <Package size={16} />
          Produtos
        </button>
        <button type="button" className={activeView === "import" ? "active" : ""} onClick={() => setActiveView("import")}>
          <FileUp size={16} />
          Importar e exportar
        </button>
        <button type="button" className={activeView === "customers" ? "active" : ""} onClick={() => setActiveView("customers")}>
          <Users size={16} />
          Clientes atacado
        </button>
        <button type="button" className={activeView === "settings" ? "active" : ""} onClick={() => setActiveView("settings")}>
          <Settings size={16} />
          Configurações
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
              <span>Pedido mínimo</span>
              <strong>
                {settings.wholesaleMinimumQuantity || 0} un. / {currency(settings.wholesaleMinimumAmount)}
              </strong>
            </article>
            <article>
              <span>Aprovação</span>
              <strong>{settings.wholesaleApprovalMode === "automatic" ? "Automática por CNPJ" : "Revisão manual"}</strong>
            </article>
          </section>

          <section className="products-section">
            <div className="products-heading">
              <div>
                <h2>Produtos</h2>
                <p>
                  Mostrando {visibleRules.length} de {filteredRules.length} produtos/variações
                </p>
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
                <button type="button" onClick={applyBulkDiscount} disabled={bulkLoading}>
                  {bulkLoading ? "Aplicando..." : "Aplicar nos selecionados"}
                </button>
              </div>
            </div>

            <div className="products-toolbar">
              <input
                aria-label="Buscar produtos"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar produtos por nome, SKU ou variação"
              />
              <button type="button">Filtrar</button>
              <button type="button">Mais novo</button>
            </div>

            <p className="count-line">
              {selectedIds.length > 0
                ? `${selectedIds.length} selecionados. O desconto em massa usa o preço normal como base.`
                : "Os produtos abaixo s?o puxados do cadastro real da Nuvemshop. O app adiciona apenas as regras de atacado."}
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
                    <th>Preço normal</th>
                    <th>Preço atacado</th>
                    <th>Estoque atacado</th>
                    <th>Variação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRules.map((rule) => (
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
                          value={rule.wholesalePrice ?? 0}
                          type="number"
                          step="0.01"
                          onChange={(event) => patchRuleLocal(rule.id, { wholesalePrice: event.target.value })}
                          onBlur={(event) => updateRule(rule.id, { wholesalePrice: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="table-input"
                          value={rule.wholesaleStock ?? 0}
                          type="number"
                          onChange={(event) => patchRuleLocal(rule.id, { wholesaleStock: event.target.value })}
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
              {visibleRules.length < filteredRules.length && (
                <div className="table-load-more">
                  <button type="button" onClick={() => setVisibleRuleCount((current) => current + 80)}>
                    Carregar mais produtos
                  </button>
                </div>
              )}
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
              <p>Atualize preço e estoque de atacado por CSV ou XLSX.</p>
            </div>
            <button type="button" onClick={exportRules}>
              <Download size={16} />
              Exportar modelo
            </button>
          </div>
          <form className="import-form" onSubmit={importRules}>
            <label className="file-picker">
              <span className="file-picker-button">
                <span className="file-icon" aria-hidden="true" />
                Escolher arquivo
              </span>
              <span className="file-picker-name">{importFileName || "Nenhum arquivo selecionado"}</span>
              <input
                name="file"
                type="file"
                accept=".csv,.xlsx"
                required
                onChange={(event) => setImportFileName(event.target.files?.[0]?.name || "")}
              />
            </label>
            <button className="primary" type="submit">
              <Upload size={16} />
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
              <p>Clientes reais da Nuvemshop e solicitações de acesso ao atacado.</p>
            </div>
            <button type="button" onClick={syncCustomers} disabled={customersLoading}>
              <RefreshCw size={16} />
              {customersLoading ? "Sincronizando..." : "Sincronizar clientes"}
            </button>
          </div>

          <div className="notice">
            Link de solicitação para o cliente: <strong>/cadastro-atacado.html</strong>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>E-mail</th>
                  <th>CNPJ</th>
                  <th>Origem</th>
                  <th>Solicitação</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customersLoading && (
                  <tr>
                    <td colSpan="7">Carregando clientes de atacado...</td>
                  </tr>
                )}
                {!customersLoading && customers.length === 0 && (
                  <tr>
                    <td colSpan="7">Nenhum cliente de atacado encontrado.</td>
                  </tr>
                )}
                {!customersLoading && customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.name || "-"}</strong>
                    </td>
                    <td>{customer.email || "-"}</td>
                    <td>{customer.cnpj || "-"}</td>
                    <td>{customer.source === "request" ? "Formulário" : "Nuvemshop"}</td>
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
                <h2>Configurações</h2>
                <p>Defina o CD usado nas vendas de atacado e o critério de aprovação.</p>
              </div>
              <button type="button" onClick={syncLocations} disabled={locationsLoading}>
                <RefreshCw size={16} />
                {locationsLoading ? "Buscando..." : "Atualizar CDs"}
              </button>
            </div>

            <form className="form-grid" onSubmit={saveSettings}>
              <label className="wide-field">
                CD de atacado
                <select name="wholesaleLocationId" value={settings.wholesaleLocationId || ""} onChange={selectWholesaleLocation}>
                  <option value="">Selecione o centro de distribuição</option>
                  {settings.wholesaleLocationId && !locations.some((location) => String(location.id || "") === String(settings.wholesaleLocationId)) && (
                    <option value={String(settings.wholesaleLocationId)}>
                      {settings.wholesaleLocationName || `CD ${settings.wholesaleLocationId}`}
                    </option>
                  )}
                  {locations.map((location) => (
                    <option key={String(location.id)} value={String(location.id)}>
                      {String(location.address || "")
                        ? `${String(location.name || `CD ${location.id}`)} - ${String(location.address)}`
                        : String(location.name || `CD ${location.id}`)}
                    </option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="wholesaleLocationName" value={settings.wholesaleLocationName || ""} />
              <input type="hidden" name="wholesaleLocationAddress" value={settings.wholesaleLocationAddress || ""} />
              <label>
                CD selecionado
                <div className="readonly-field">
                  <MapPin size={16} />
                  <span>
                    {settings.wholesaleLocationName || settings.wholesaleLocationId || "Nenhum CD selecionado"}
                    {settings.wholesaleLocationAddress ? ` - ${settings.wholesaleLocationAddress}` : ""}
                  </span>
                </div>
              </label>
              <label>
                Qtd. mínima atacado
                <input
                  name="wholesaleMinimumQuantity"
                  type="number"
                  min="0"
                  defaultValue={settings.wholesaleMinimumQuantity || 0}
                />
              </label>
              <label>
                Valor mínimo atacado
                <input
                  name="wholesaleMinimumAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={settings.wholesaleMinimumAmount || 0}
                />
              </label>
              <label>
                Aprovação de atacado
                <select name="wholesaleApprovalMode" defaultValue={settings.wholesaleApprovalMode || "manual"}>
                  <option value="manual">Revisão manual</option>
                  <option value="automatic">Automático com CNPJ válido</option>
                </select>
              </label>
              <button className="primary" type="submit">
                <Save size={16} />
                Salvar
              </button>
            </form>
          </section>

        </>
      )}
    </main>
  );
}

createRoot(document.querySelector("#root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
