import "dotenv/config";
import { createApp } from "./app.js";
import { openDatabase } from "./db/index.js";
import { syncPanelConnectors } from "./services/panelClient.js";

const port = Number(process.env.PORT || 3012);
const db = openDatabase();
const server = createApp(db).listen(port, "0.0.0.0", () => {
  console.log(`DSDST Kit Studio listening on ${port}`);
  void syncPanelConnectors(db)
    .then((result) => console.log(`Panel catalog synced: ${result.synced} products (${result.unresolved} unresolved)`))
    .catch((error) => console.warn(`Panel catalog unavailable; continuing with cache: ${error instanceof Error ? error.message : "unknown error"}`));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
