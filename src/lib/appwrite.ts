import { Account, Client, ID, Permission, Query, Role, TablesDB } from "appwrite";

// Public Appwrite config — bundled into the browser, that's expected.
const ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT;
const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID;
export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID ?? "vault";
export const VAULTS_TABLE_ID =
  import.meta.env.VITE_APPWRITE_TABLE_VAULTS ??
  // Back-compat with the old env name used before Appwrite renamed collections → tables.
  import.meta.env.VITE_APPWRITE_COLLECTION_VAULTS ??
  "vaults";

let _client: Client | null = null;
let _account: Account | null = null;
let _tablesDB: TablesDB | null = null;

function ensureConfigured() {
  if (!ENDPOINT || !PROJECT_ID) {
    throw new Error(
      "Appwrite is not configured. Set VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID in .env",
    );
  }
}

export function appwrite() {
  ensureConfigured();
  if (!_client) {
    _client = new Client().setEndpoint(ENDPOINT!).setProject(PROJECT_ID!);
    _account = new Account(_client);
    _tablesDB = new TablesDB(_client);
  }
  return {
    client: _client!,
    account: _account!,
    tablesDB: _tablesDB!,
  };
}

export function isAppwriteConfigured(): boolean {
  return Boolean(ENDPOINT && PROJECT_ID);
}

export { ID, Permission, Query, Role };
