import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const initialState = {
  store: {
    id: "",
    name: "Venos Modas",
    accessToken: "",
    retailLocationId: "",
    wholesaleLocationId: "",
    retailLocationName: "CD Varejo",
    wholesaleLocationName: "CD Atacado",
    wholesaleMinimumQuantity: 6,
    wholesaleMinimumAmount: 0,
    wholesaleApprovalMode: "manual"
  },
  rules: [
    {
      id: "rule-demo-blusa",
      sku: "BLUSA001",
      variantId: "",
      productName: "Blusa demo",
      retailPrice: 129.9,
      wholesalePrice: 89.9,
      retailStock: 30,
      wholesaleStock: 120,
      enabled: true
    }
  ],
  wholesaleCustomers: [
    {
      id: "customer-demo",
      name: "Cliente atacado demo",
      email: "compras@cliente.com",
      cnpj: "11222333000181",
      approved: true,
      discountPercent: 0,
      createdAt: new Date().toISOString()
    }
  ],
  installs: []
};

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(initialState, null, 2));
  }
}

export async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_PATH, "utf8");
  const db = JSON.parse(raw);
  return {
    ...initialState,
    ...db,
    store: {
      ...initialState.store,
      ...(db.store || {})
    },
    rules: db.rules || initialState.rules,
    wholesaleCustomers: db.wholesaleCustomers || initialState.wholesaleCustomers,
    installs: db.installs || []
  };
}

export async function writeDb(nextState) {
  await ensureDb();
  await fs.writeFile(DB_PATH, JSON.stringify(nextState, null, 2));
  return nextState;
}

export async function updateDb(updater) {
  const db = await readDb();
  const next = await updater(db);
  return writeDb(next);
}
