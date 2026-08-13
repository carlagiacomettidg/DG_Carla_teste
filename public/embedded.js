const status = document.querySelector("#embeddedStatus");
const isEmbedded = window.self !== window.top;

function setStatus(text, mode = "default") {
  if (!status) return;
  status.textContent = text;
  status.dataset.mode = mode;
}

document.documentElement.classList.toggle("embedded-admin", isEmbedded);

if (!isEmbedded) {
  setStatus("Painel web");
} else {
  setStatus("Conectando ao admin", "loading");

  try {
    const configResponse = await fetch("/api/public-config");
    const config = await configResponse.json();
    const [{ default: nexo }, helpers] = await Promise.all([
      import("https://esm.sh/@tiendanube/nexo"),
      import("https://esm.sh/@tiendanube/nexo/helpers")
    ]);

    const nexoClient = nexo.create({
      clientId: String(config.clientId || "39172"),
      log: false
    });

    await helpers.connect(nexoClient);
    await helpers.iAmReady(nexoClient);
    setStatus("Incorporado ao admin", "ready");
    window.nuvemshopNexo = nexoClient;
  } catch (error) {
    console.warn("Nexo nao conectado", error);
    setStatus("Admin sem Nexo", "warning");
  }
}
