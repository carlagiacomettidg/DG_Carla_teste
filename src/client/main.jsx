import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import nexo, { connect, iAmReady } from "@tiendanube/nexo";

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
  const [embeddedStatus, setEmbeddedStatus] = useState(isEmbedded ? "Conectando ao admin" : "Painel web");
  const [embeddedMode, setEmbeddedMode] = useState(isEmbedded ? "loading" : "default");

  const nexoClient = useMemo(
    () =>
      nexo.create({
        clientId: "39172",
        log: false
      }),
    []
  );

  useEffect(() => {
    document.documentElement.classList.toggle("embedded-admin", isEmbedded);

    if (!isEmbedded) return;

    connect(nexoClient)
      .then(() => iAmReady(nexoClient))
      .then(() => {
        setEmbeddedStatus("Incorporado ao admin");
        setEmbeddedMode("ready");
      })
      .catch((error) => {
        console.warn("Falha ao conectar Nexo", error);
        setEmbeddedStatus("Falha no Nexo");
        setEmbeddedMode("warning");
      });
  }, [nexoClient]);

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

  async function addCustomer(event) {
    event.preventDefault();
    const nextCustomers = await api("/api/wholesale-customers", {
      method: "POST",
      body: JSON.stringify(formToObject(event.currentTarget))
    });
    setCustomers(nextCustomers);
    event.currentTarget.reset();
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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">App sob demanda Nuvemshop</p>
          <h1>Modulo atacado por CD</h1>
        </div>
        <div className="top-actions">
          <span className="status-chip" data-mode={embeddedMode}>
            {embeddedStatus}
          </span>
          <button className="primary" onClick={simulateCheckout}>
            Simular checkout
          </button>
        </div>
      </header>

      <section className="status-grid">
        <article>
          <span>CD Atacado</span>
          <strong>{settings.wholesaleLocationName || settings.wholesaleLocationId || "-"}</strong>
        </article>
        <article>
          <span>Pedido minimo</span>
          <strong>
            {settings.wholesaleMinimumQuantity || 0} un. / {currency(settings.wholesaleMinimumAmount)}
          </strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Configuracao geral</h2>
            <p>Defina o CD usado nas vendas de atacado.</p>
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

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Importar tabela de atacado</h2>
            <p>Envie CSV ou XLSX com SKU, preco_atacado e estoque_atacado.</p>
          </div>
        </div>
        <form className="import-form" onSubmit={importRules}>
          <input name="file" type="file" accept=".csv,.xlsx" required />
          <button className="primary" type="submit">
            Importar planilha
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Produtos de atacado</h2>
            <p>O varejo continua no cadastro normal da Nuvemshop.</p>
          </div>
        </div>

        <form className="rule-form" onSubmit={addRule}>
          <input name="sku" placeholder="SKU" required />
          <input name="productName" placeholder="Produto" />
          <input name="wholesalePrice" type="number" step="0.01" placeholder="Preco atacado" required />
          <input name="wholesaleStock" type="number" placeholder="Estoque atacado" />
          <button className="primary" type="submit">
            Adicionar
          </button>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produto</th>
                <th>Preco atacado</th>
                <th>Estoque atacado</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <strong>{rule.sku}</strong>
                  </td>
                  <td>{rule.productName || "-"}</td>
                  <td>{currency(rule.wholesalePrice)}</td>
                  <td>{rule.wholesaleStock || 0}</td>
                  <td>
                    <span className="pill">{rule.enabled ? "ativo" : "pausado"}</span>
                  </td>
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
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Clientes atacado</h2>
            <p>Cliente com CNPJ aprovado acessa a regra de atacado.</p>
          </div>
        </div>

        <form className="customer-form" onSubmit={addCustomer}>
          <input name="name" placeholder="Nome / Razao social" required />
          <input name="email" type="email" placeholder="E-mail" required />
          <input name="cnpj" placeholder="CNPJ" required />
          <input name="discountPercent" type="number" min="0" max="100" step="0.01" placeholder="% desconto extra" />
          <button className="primary" type="submit">
            Aprovar
          </button>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>E-mail</th>
                <th>CNPJ</th>
                <th>Desconto</th>
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
                  <td>{Number(customer.discountPercent || 0)}%</td>
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

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Resultado da simulacao</h2>
            <p>Mostra qual CD seria priorizado com a regra atual.</p>
          </div>
        </div>
        <pre>{message}</pre>
      </section>
    </main>
  );
}

createRoot(document.querySelector("#root")).render(<App />);
