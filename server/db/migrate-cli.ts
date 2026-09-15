import "dotenv/config";
import { openDatabase } from "./index.js";

const db = openDatabase();
console.log("Kit Studio migrations are up to date.");
db.close();
