import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";

const DATA_DIR = path.resolve("data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const STATE_ID = "main";
const DATABASE_URL = process.env.DATABASE_URL;

let pool;

const initialState = {
  store: {
    id: "",
    name: "Vênus Modas",
    accessToken: "",
    retailLocationId: "",
    wholesaleLocationId: "",
    retailLocationName: "CD Varejo",
    wholesaleLocationName: "CD Atacado",
    wholesaleMinimumQuantity: 6,
    wholesaleMinimumAmount: 0,
    wholesaleApprovalMode: "manual"
  },
  rules: [],
  wholesaleCustomers: [],
  installs: []
};

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

async function ensurePostgresDb() {
  const db = getPool();
  if (!db) return;

  await db.query(`
    create table if not exists app_state (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  await db.query(
    `
      insert into app_state (id, data)
      values ($1, $2::jsonb)
      on conflict (id) do nothing
    `,
    [STATE_ID, JSON.stringify(initialState)]
  );
}

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(initialState, null, 2));
  }
}

function mergeWithInitialState(db) {
  const rules = (db.rules || initialState.rules).filter((rule) => {
    if (rule.id === "rule-demo-blusa") return false;
    if (String(rule.productName || "").toLowerCase().includes("demo")) return false;
    return true;
  });
  const wholesaleCustomers = (db.wholesaleCustomers || initialState.wholesaleCustomers).filter((customer) => {
    if (customer.id === "customer-demo") return false;
    if (String(customer.name || "").toLowerCase().includes("demo")) return false;
    return true;
  });

  return {
    ...initialState,
    ...db,
    store: {
      ...initialState.store,
      ...(db.store || {})
    },
    rules,
    wholesaleCustomers,
    installs: db.installs || []
  };
}

export async function readDb() {
  const postgres = getPool();
  if (postgres) {
    await ensurePostgresDb();
    const result = await postgres.query("select data from app_state where id = $1", [STATE_ID]);
    return mergeWithInitialState(result.rows[0]?.data || initialState);
  }

  await ensureDb();
  const raw = await fs.readFile(DB_PATH, "utf8");
  const db = JSON.parse(raw);
  return mergeWithInitialState(db);
}

export async function writeDb(nextState) {
  const postgres = getPool();
  if (postgres) {
    await ensurePostgresDb();
    await postgres.query(
      `
        update app_state
        set data = $2::jsonb,
            updated_at = now()
        where id = $1
      `,
      [STATE_ID, JSON.stringify(nextState)]
    );
    return nextState;
  }

  await ensureDb();
  await fs.writeFile(DB_PATH, JSON.stringify(nextState, null, 2));
  return nextState;
}

export async function updateDb(updater) {
  const db = await readDb();
  const next = await updater(db);
  return writeDb(next);
}
