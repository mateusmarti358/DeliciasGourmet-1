// Uso: node server/addon.js "Batata extra" 3.50 [custo]
import Database from "better-sqlite3";
const [name, price, cost = "0"] = process.argv.slice(2);
if (!name || isNaN(Number(price.replace(",", ".")))) { console.error('Uso: node server/addon.js "Nome" preço [custo]'); process.exit(1); }
const cents = v => Math.round(Number(String(v).replace(",", ".")) * 100);
const db = new Database(process.env.DB_FILE || "data.db");
const r = db.prepare("UPDATE addons SET price_cents=?, cost_cents=?, available=1, priced=1 WHERE name=?").run(cents(price), cents(cost), name);
console.log(r.changes ? `"${name}" ativado por R$ ${price}.` : `Adicional "${name}" não encontrado.`);
