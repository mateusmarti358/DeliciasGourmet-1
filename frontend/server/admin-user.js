// Uso: node server/admin-user.js email@exemplo.com "senha-com-12-ou-mais-caracteres"
import Database from "better-sqlite3";
import { hashPassword } from "./auth.js";
const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 12) { console.error('Uso: node server/admin-user.js email "senha (mínimo 12 caracteres)"'); process.exit(1); }
const db = new Database(process.env.DB_FILE || "data.db");
db.exec("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL)");
db.prepare("INSERT INTO users(email,pass_hash) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET pass_hash=excluded.pass_hash").run(email.toLowerCase(), hashPassword(password));
console.log(`Usuário ${email} salvo.`);
