import "dotenv/config";
import { createApp } from "./app.js";
import { openDatabase } from "./db/index.js";

const port = Number(process.env.PORT || 3012);
const db = openDatabase();
const server = createApp(db).listen(port, "0.0.0.0", () => console.log(`DSDST Kit Studio listening on ${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
