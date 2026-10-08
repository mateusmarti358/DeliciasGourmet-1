import express from "express";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { sha, verifyPassword, hashPassword } from "./auth.js";
import { fileURLToPath } from "node:url";

const db = new Database(process.env.DB_FILE || "data.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL, cost_cents INTEGER NOT NULL DEFAULT 0, image TEXT, available INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS addons(id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0, cost_cents INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1, priced INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS product_addons(product_id INTEGER NOT NULL REFERENCES products(id), addon_id INTEGER NOT NULL REFERENCES addons(id), PRIMARY KEY(product_id, addon_id));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'novo', total_cents INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER, name TEXT NOT NULL, qty INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, unit_cost_cents INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS order_item_addons(order_item_id INTEGER NOT NULL REFERENCES order_items(id), name TEXT NOT NULL, price_cents INTEGER NOT NULL, cost_cents INTEGER NOT NULL);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS business_days(weekday INTEGER PRIMARY KEY CHECK(weekday BETWEEN 0 AND 6), open INTEGER NOT NULL DEFAULT 1);
INSERT OR IGNORE INTO business_days(weekday,open) VALUES(0,1),(1,1),(2,1),(3,1),(4,1),(5,1),(6,1);
`);

// Usuário PADRÃO só para testes locais: criado apenas se não existir nenhum usuário e fora de produção.
// Troque antes de publicar: node server/admin-user.js seu@email.com "senha-forte"
if (process.env.NODE_ENV !== "production" && !db.prepare("SELECT COUNT(*) n FROM users").get().n) {
  db.prepare("INSERT INTO users(email,pass_hash) VALUES(?,?)").run("admin@delicias.local", hashPassword("Delicias@2026!"));
  console.warn("[AVISO] Usuário padrão de teste criado (admin@delicias.local). Não use em produção.");
}

// Migração: bancos criados antes da coluna "priced"
if (!db.prepare("PRAGMA table_info(addons)").all().some(c => c.name === "priced")) {
  db.exec("ALTER TABLE addons ADD COLUMN priced INTEGER NOT NULL DEFAULT 1");
  db.exec("UPDATE addons SET priced = 0, available = 1 WHERE price_cents = 0 AND available = 0");
}

// Migração: estoque por produto (NULL = sem controle de estoque)
if (!db.prepare("PRAGMA table_info(products)").all().some(c => c.name === "stock")) {
  db.exec("ALTER TABLE products ADD COLUMN stock INTEGER");
}

// Migração: pedido cancelado após já ter sido produzido (custo vira prejuízo)
if (!db.prepare("PRAGMA table_info(orders)").all().some(c => c.name === "cancel_loss")) {
  db.exec("ALTER TABLE orders ADD COLUMN cancel_loss INTEGER NOT NULL DEFAULT 0");
}

// Seed inicial (só com o banco vazio). Custos ficam em 0 até serem cadastrados.
if (!db.prepare("SELECT COUNT(*) n FROM products").get().n) {
  const seed = [
    ["Shawarma de Carne", "salgados", 27, "shawarma-carne.jpg"], ["Pastéis", "salgados", 8, "pasteis.jpg"],
    ["Misto Quente", "salgados", 6, "misto-quente.jpg"], ["Mini Pizzas", "salgados", 6, "mini-pizzas.jpg"],
    ["Pão de Queijo", "salgados", 3, "pao-de-queijo.jpg"], ["Mini Churros", "doces", 25, "mini-churros.jpg"],
    ["Churros Recheados", "doces", 35, "churros-recheados.jpg"], ["Espetinho Doce", "doces", 22, "espetinho-doce.jpg"],
    ["Churros Especiais", "doces", 28, "churros-especiais.jpg"], ["Crepe Avelã Confete", "doces", 25, "crepe-avela.jpg"],
    ["Crepe Leitinho c/ Bombom", "doces", 35, "crepe-leitinho.jpg"], ["Crepe Dois Amores", "doces", 20, "crepe-dois-amores.jpg"],
    ["Crepe Queijo e Goiabada", "doces", 20, "crepe-goiabada.jpg"],
  ];
  const ins = db.prepare("INSERT INTO products(name,category,price_cents,image,sort) VALUES(?,?,?,?,?)");
  db.transaction(() => seed.forEach(([n, c, p, i], k) => ins.run(n, c, p * 100, i, k)))();
}

// Adicionais do design (Shawarma de Carne). Aparecem no pop-up como "preço a definir" e não podem ser
// escolhidos até você confirmar o valor: `node server/addon.js "Batata extra" 3.50`.
if (!db.prepare("SELECT COUNT(*) n FROM addons").get().n) {
  const shawarma = db.prepare("SELECT id FROM products WHERE name = ?").get("Shawarma de Carne");
  const insA = db.prepare("INSERT INTO addons(name,price_cents,available,priced) VALUES(?,0,1,0)");
  db.transaction(() => {
    for (const n of ["Batata extra", "Alface", "Tomate", "Frango"]) {
      const id = insA.run(n).lastInsertRowid;
      if (shawarma) db.prepare("INSERT INTO product_addons VALUES(?,?)").run(shawarma.id, id);
    }
  })();
}

// Adicionais valem para todos os produtos, exceto Pão de Queijo (aplicado uma única vez por banco).
if (db.pragma("user_version", { simple: true }) < 2) {
  db.exec(`INSERT OR IGNORE INTO product_addons(product_id, addon_id)
    SELECT p.id, a.id FROM products p, addons a
    WHERE p.name <> 'Pão de Queijo' AND a.name IN ('Batata extra','Alface','Tomate','Frango')`);
  db.pragma("user_version = 2");
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

// Cardápio público: só produtos e adicionais disponíveis; nunca expõe custos.
app.get("/api/products", (_req, res) => {
  const addons = db.prepare(`SELECT pa.product_id pid, a.id, a.name, a.price_cents, a.priced FROM product_addons pa JOIN addons a ON a.id = pa.addon_id WHERE a.available = 1`).all();
  const products = db.prepare("SELECT id,name,category,price_cents,image FROM products WHERE available = 1 AND (stock IS NULL OR stock > 0) ORDER BY sort,id").all()
    .map(p => ({ ...p, addons: addons.filter(a => a.pid === p.id).map(({ id, name, price_cents, priced }) => ({ id, name, price_cents, priced })) }));
  res.json(products);
});

const hits = new Map(); // limite simples: 10 pedidos / 10 min por IP
const limited = ip => {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 600000);
  list.push(now); hits.set(ip, list);
  return list.length > 10;
};

// Pedido: o servidor recalcula tudo a partir do banco; o total do navegador é ignorado.
app.post("/api/orders", (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: "Muitas tentativas. Tente novamente em alguns minutos." });
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date())];
  if (!db.prepare("SELECT open FROM business_days WHERE weekday = ?").get(wd)?.open) return res.status(409).json({ error: "Hoje não estamos atendendo. Confira nossos dias de funcionamento." });
  const { customer = {}, items } = req.body || {};
  const name = String(customer.name || "").trim().slice(0, 80);
  const phone = String(customer.phone || "").replace(/\D/g, "");
  if (!name) return res.status(400).json({ error: "Informe seu nome." });
  if (phone.length < 10 || phone.length > 13) return res.status(400).json({ error: "Informe um telefone válido com DDD." });
  if (!Array.isArray(items) || !items.length || items.length > 40) return res.status(400).json({ error: "Carrinho inválido." });

  const getProduct = db.prepare("SELECT * FROM products WHERE id = ? AND available = 1");
  const takeStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL AND stock >= ?");
  const getAddon = db.prepare(`SELECT a.* FROM addons a JOIN product_addons pa ON pa.addon_id = a.id WHERE a.id = ? AND pa.product_id = ? AND a.available = 1 AND a.priced = 1`);
  try {
    const orderId = db.transaction(() => {
      const lines = items.map(it => {
        const qty = Number(it.qty);
        const p = getProduct.get(Number(it.productId));
        if (!p) throw new Error("Um dos produtos não está mais disponível.");
        if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new Error("Quantidade inválida.");
        const addons = [...new Set(it.addonIds || [])].map(id => {
          const a = getAddon.get(Number(id), p.id);
          if (!a) throw new Error(`Adicional indisponível para ${p.name}.`);
          return a;
        });
        return { p, qty, addons, note: String(it.note || "").trim().slice(0, 200) };
      });
      // Estoque: soma por produto, recusa se faltar e baixa dentro da mesma transação.
      const wanted = new Map();
      for (const l of lines) wanted.set(l.p.id, (wanted.get(l.p.id) || 0) + l.qty);
      for (const [pid, qty] of wanted) {
        const p = getProduct.get(pid);
        if (p.stock !== null && p.stock < qty) throw new Error(`Estoque insuficiente para ${p.name}.`);
        if (p.stock !== null) takeStock.run(qty, pid, qty);
      }
      const total = lines.reduce((s, l) => s + l.qty * (l.p.price_cents + l.addons.reduce((x, a) => x + a.price_cents, 0)), 0);
      const id = db.prepare("INSERT INTO orders(customer_name,customer_phone,total_cents) VALUES(?,?,?)").run(name, phone, total).lastInsertRowid;
      for (const l of lines) {
        const itemId = db.prepare("INSERT INTO order_items(order_id,product_id,name,qty,unit_price_cents,unit_cost_cents,note) VALUES(?,?,?,?,?,?,?)")
          .run(id, l.p.id, l.p.name, l.qty, l.p.price_cents, l.p.cost_cents, l.note).lastInsertRowid;
        for (const a of l.addons) db.prepare("INSERT INTO order_item_addons VALUES(?,?,?,?)").run(itemId, a.name, a.price_cents, a.cost_cents);
      }
      return id;
    })();
    const { total_cents } = db.prepare("SELECT total_cents FROM orders WHERE id = ?").get(orderId);
    res.status(201).json({ id: orderId, total_cents });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Painel administrativo ----------
const SESSION_SECONDS = 8 * 3600;
const loginHits = new Map(); // 5 tentativas / 10 min por IP
const loginLimited = ip => {
  const now = Date.now(), list = (loginHits.get(ip) || []).filter(t => now - t < 600000);
  list.push(now); loginHits.set(ip, list);
  return list.length > 5;
};
const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const cookieOpts = `HttpOnly; SameSite=Strict; Path=/${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

app.use("/api/admin", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

app.post("/api/admin/login", (req, res) => {
  if (loginLimited(req.ip)) return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
  const { email = "", password = "" } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).trim().toLowerCase());
  if (!user || !verifyPassword(String(password), user.pass_hash)) return res.status(401).json({ error: "E-mail ou senha incorretos." });
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(sha(token), user.id, Date.now() + SESSION_SECONDS * 1000);
  res.setHeader("Set-Cookie", `sid=${token}; Max-Age=${SESSION_SECONDS}; ${cookieOpts}`);
  res.json({ email: user.email });
});

const auth = (req, res, next) => {
  const t = cookies(req).sid;
  const s = t && db.prepare("SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?").get(sha(t), Date.now());
  if (!s) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
  req.user = s;
  next();
};

app.post("/api/admin/logout", (req, res) => {
  const t = cookies(req).sid;
  if (t) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha(t));
  res.setHeader("Set-Cookie", `sid=; Max-Age=0; ${cookieOpts}`);
  res.json({ ok: true });
});
app.get("/api/admin/me", auth, (req, res) => res.json({ email: req.user.email }));

app.get("/api/admin/days", auth, (_req, res) =>
  res.json(db.prepare("SELECT weekday, open FROM business_days ORDER BY weekday").all().map(d => ({ weekday: d.weekday, open: !!d.open }))));
app.put("/api/admin/days/:weekday", auth, (req, res) => {
  const wd = Number(req.params.weekday);
  if (!Number.isInteger(wd) || wd < 0 || wd > 6 || typeof req.body?.open !== "boolean") return res.status(400).json({ error: "Dados inválidos." });
  db.prepare("UPDATE business_days SET open = ? WHERE weekday = ?").run(req.body.open ? 1 : 0, wd);
  res.json({ weekday: wd, open: req.body.open });
});

const brl = v => Number.isInteger(v) && v >= 0 && v <= 10_000_000;

function adminProducts() {
  const sales = new Map(db.prepare(`SELECT oi.product_id pid, SUM(oi.qty) sold, SUM(oi.qty * oi.unit_price_cents) rev, SUM(oi.qty * oi.unit_cost_cents) cost
    FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'concluido' GROUP BY oi.product_id`).all().map(r => [r.pid, r]));
  const extra = new Map(db.prepare(`SELECT oi.product_id pid, SUM(oi.qty * a.price_cents) rev, SUM(oi.qty * a.cost_cents) cost
    FROM order_item_addons a JOIN order_items oi ON oi.id = a.order_item_id JOIN orders o ON o.id = oi.order_id WHERE o.status = 'concluido' GROUP BY oi.product_id`).all().map(r => [r.pid, r]));
  const links = db.prepare("SELECT product_id pid, addon_id aid FROM product_addons").all();
  return db.prepare("SELECT id,name,category,price_cents,cost_cents,image,available,stock FROM products ORDER BY sort,id").all().map(p => {
    const s = sales.get(p.id) || {}, x = extra.get(p.id) || {};
    return {
      ...p, available: !!p.available,
      addonIds: links.filter(l => l.pid === p.id).map(l => l.aid),
      stats: { sold: s.sold || 0, revenue_cents: (s.rev || 0) + (x.rev || 0), cost_cents: (s.cost || 0) + (x.cost || 0) },
    };
  });
}

const parseProduct = (b = {}) => {
  const name = String(b.name ?? "").trim().slice(0, 80);
  const stock = b.stock === null || b.stock === "" ? null : Number(b.stock);
  if (!name) return { error: "Informe o nome do produto." };
  if (!brl(b.price_cents)) return { error: "Informe um preço válido." };
  if (!brl(b.cost_cents)) return { error: "Informe um custo válido." };
  if (stock !== null && !(Number.isInteger(stock) && stock >= 0 && stock <= 99999)) return { error: "O estoque deve ser um número inteiro, ou vazio para não controlar." };
  if (!["salgados", "doces"].includes(b.category)) return { error: "Escolha a categoria." };
  if (typeof b.available !== "boolean") return { error: "Dados inválidos." };
  const addonIds = [...new Set((Array.isArray(b.addonIds) ? b.addonIds : []).map(Number))];
  if (addonIds.some(id => !db.prepare("SELECT 1 FROM addons WHERE id = ?").get(id))) return { error: "Adicional não encontrado." };
  return { v: { name, price_cents: b.price_cents, cost_cents: b.cost_cents, stock, category: b.category, available: b.available ? 1 : 0, addonIds, image: b.image } };
};

const imagesDir = () => [path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/assets"), path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/assets")].find(d => fs.existsSync(d));
const listImages = () => (imagesDir() ? fs.readdirSync(imagesDir()) : []).filter(f => /\.(jpe?g|png|webp)$/i.test(f) && !/^(logo|hero-|food-truck|oferta)/.test(f)).sort();

// Fotos enviadas pelo painel ficam em ./uploads (faça backup dessa pasta) e são servidas em /assets/uploads/...
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
app.use("/assets/uploads", express.static(uploadDir, { maxAge: "7d", setHeaders: r => r.setHeader("X-Content-Type-Options", "nosniff") }));

const sniff = b => {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
};
const validImage = img => typeof img === "string" && (listImages().includes(img)
  || (/^uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(img) && fs.existsSync(path.join(uploadDir, img.slice(8)))));

app.post("/api/admin/uploads", auth, express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "6mb" }), (req, res) => {
  const b = req.body;
  const ext = Buffer.isBuffer(b) && sniff(b);
  if (!ext) return res.status(400).json({ error: "Envie uma foto JPG, PNG ou WebP." });
  const name = crypto.randomBytes(12).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(uploadDir, name), b);
  res.status(201).json({ image: "uploads/" + name });
});

app.get("/api/admin/products", auth, (_req, res) => res.json(adminProducts()));

app.patch("/api/admin/products/:id", auth, (req, res) => {
  if (typeof req.body?.available !== "boolean") return res.status(400).json({ error: "Dados inválidos." });
  const r = db.prepare("UPDATE products SET available = ? WHERE id = ?").run(req.body.available ? 1 : 0, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: "Produto não encontrado." });
  res.json({ id: Number(req.params.id), available: req.body.available });
});

app.post("/api/admin/products", auth, (req, res) => {
  const { v, error } = parseProduct(req.body);
  if (error) return res.status(400).json({ error });
  if (!validImage(v.image)) return res.status(400).json({ error: "Escolha a foto do produto." });
  const id = db.transaction(() => {
    const sort = db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 n FROM products").get().n;
    const id = db.prepare("INSERT INTO products(name,category,price_cents,cost_cents,image,available,stock,sort) VALUES(?,?,?,?,?,?,?,?)")
      .run(v.name, v.category, v.price_cents, v.cost_cents, v.image, v.available, v.stock, sort).lastInsertRowid;
    for (const a of v.addonIds) db.prepare("INSERT INTO product_addons VALUES(?,?)").run(id, a);
    return id;
  })();
  res.status(201).json(adminProducts().find(p => p.id === Number(id)));
});

app.put("/api/admin/products/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM products WHERE id = ?").get(id)) return res.status(404).json({ error: "Produto não encontrado." });
  const { v, error } = parseProduct(req.body);
  if (error) return res.status(400).json({ error });
  const cur = db.prepare("SELECT image FROM products WHERE id = ?").get(id).image;
  const image = v.image && v.image !== cur ? v.image : cur;
  if (image !== cur && !validImage(image)) return res.status(400).json({ error: "Escolha uma foto válida." });
  db.transaction(() => {
    db.prepare("UPDATE products SET name=?, category=?, price_cents=?, cost_cents=?, available=?, stock=?, image=? WHERE id=?")
      .run(v.name, v.category, v.price_cents, v.cost_cents, v.available, v.stock, image, id);
    db.prepare("DELETE FROM product_addons WHERE product_id = ?").run(id);
    for (const a of v.addonIds) db.prepare("INSERT INTO product_addons VALUES(?,?)").run(id, a);
  })();
  res.json(adminProducts().find(p => p.id === id));
});

// Adicionais (compartilhados entre produtos; cada produto escolhe quais oferece)
const addonOut = a => ({ id: a.id, name: a.name, price_cents: a.price_cents, priced: !!a.priced });
app.get("/api/admin/addons", auth, (_req, res) =>
  res.json(db.prepare("SELECT id,name,price_cents,priced FROM addons ORDER BY id").all().map(addonOut)));
app.post("/api/admin/addons", auth, (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Informe o nome do adicional." });
  if (!brl(req.body?.price_cents)) return res.status(400).json({ error: "Informe um valor válido." });
  if (db.prepare("SELECT 1 FROM addons WHERE lower(name) = lower(?)").get(name)) return res.status(409).json({ error: "Já existe um adicional com esse nome." });
  const id = db.prepare("INSERT INTO addons(name,price_cents,available,priced) VALUES(?,?,1,1)").run(name, req.body.price_cents).lastInsertRowid;
  res.status(201).json(addonOut(db.prepare("SELECT * FROM addons WHERE id = ?").get(id)));
});
app.patch("/api/admin/addons/:id", auth, (req, res) => {
  if (!brl(req.body?.price_cents)) return res.status(400).json({ error: "Informe um valor válido." });
  const r = db.prepare("UPDATE addons SET price_cents = ?, priced = 1 WHERE id = ?").run(req.body.price_cents, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: "Adicional não encontrado." });
  res.json(addonOut(db.prepare("SELECT * FROM addons WHERE id = ?").get(Number(req.params.id))));
});
app.delete("/api/admin/addons/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const r = db.transaction(() => {
    db.prepare("DELETE FROM product_addons WHERE addon_id = ?").run(id);
    return db.prepare("DELETE FROM addons WHERE id = ?").run(id);
  })();
  if (!r.changes) return res.status(404).json({ error: "Adicional não encontrado." });
  res.json({ id });
});

// Pedidos: "novo" = a produzir, "concluido" = finalizado, "cancelado" = cancelado (cancel_loss = já havia sido produzido).
const ORDER_VIEWS = { open: "novo", done: "concluido", canceled: "cancelado" };
app.get("/api/admin/orders", auth, (req, res) => {
  const view = ORDER_VIEWS[req.query.status] ? req.query.status : "open";
  const orders = db.prepare(`SELECT id, customer_name, customer_phone, status, total_cents, cancel_loss, created_at FROM orders
    WHERE status = ? ORDER BY id ${view === "open" ? "ASC" : "DESC"} LIMIT 100`).all(ORDER_VIEWS[view]);
  const counts = Object.fromEntries(db.prepare("SELECT status, COUNT(*) n FROM orders GROUP BY status").all().map(r => [r.status, r.n]));
  let items = [], addons = [];
  if (orders.length) {
    const marks = orders.map(() => "?").join(",");
    items = db.prepare(`SELECT oi.id, oi.order_id, oi.name, oi.qty, oi.unit_price_cents, oi.note, p.image
      FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (${marks}) ORDER BY oi.id`).all(...orders.map(o => o.id));
    if (items.length) addons = db.prepare(`SELECT order_item_id, name, price_cents FROM order_item_addons WHERE order_item_id IN (${items.map(() => "?").join(",")})`).all(...items.map(i => i.id));
  }
  res.json({
    counts: { open: counts.novo || 0, done: counts.concluido || 0, canceled: counts.cancelado || 0 },
    orders: orders.map(o => ({
      ...o, cancel_loss: !!o.cancel_loss, created_at: o.created_at.replace(" ", "T") + "Z",
      items: items.filter(i => i.order_id === o.id).map(({ order_id, ...i }) => ({ ...i, addons: addons.filter(a => a.order_item_id === i.id).map(({ name, price_cents }) => ({ name, price_cents })) })),
    })),
  });
});

// Transições permitidas: novo -> concluido | cancelado; concluido -> novo; cancelado -> novo.
// Cancelar devolve o estoque, exceto quando o pedido já foi produzido (loss = true): aí o custo vira prejuízo.
app.patch("/api/admin/orders/:id", auth, (req, res) => {
  const { status, loss } = req.body || {};
  const id = Number(req.params.id);
  if (!["novo", "concluido", "cancelado"].includes(status) || !Number.isInteger(id)) return res.status(400).json({ error: "Dados inválidos." });
  const fail = (code, msg) => Object.assign(new Error(msg), { http: code });
  try {
    db.transaction(() => {
      const o = db.prepare("SELECT status, cancel_loss FROM orders WHERE id = ?").get(id);
      if (!o) throw fail(404, "Pedido não encontrado.");
      if (!({ novo: ["concluido", "cancelado"], concluido: ["novo"], cancelado: ["novo"] }[o.status] || []).includes(status)) throw fail(409, "Esse pedido não pode mudar para esse status.");
      const items = db.prepare("SELECT product_id, qty FROM order_items WHERE order_id = ?").all(id);
      if (status === "cancelado") {
        if (loss !== true) for (const i of items) if (i.product_id) db.prepare("UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL").run(i.qty, i.product_id);
        db.prepare("UPDATE orders SET status = 'cancelado', cancel_loss = ? WHERE id = ?").run(loss === true ? 1 : 0, id);
      } else {
        if (o.status === "cancelado" && !o.cancel_loss) {
          for (const i of items) {
            const p = i.product_id && db.prepare("SELECT name, stock FROM products WHERE id = ?").get(i.product_id);
            if (!p || p.stock === null) continue;
            if (p.stock < i.qty) throw fail(409, `Estoque insuficiente para reabrir: ${p.name}.`);
            db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(i.qty, i.product_id);
          }
        }
        db.prepare("UPDATE orders SET status = ?, cancel_loss = 0 WHERE id = ?").run(status, id);
      }
    })();
    res.json({ id, status });
  } catch (e) {
    res.status(e.http || 500).json({ error: e.http ? e.message : "Erro inesperado." });
  }
});

// Administrativo: só pedidos concluídos, mais cancelados que já tinham sido produzidos (prejuízo).
app.get("/api/admin/sales", auth, (_req, res) => {
  const pick = "SELECT id FROM orders WHERE status = 'concluido' OR (status = 'cancelado' AND cancel_loss = 1) ORDER BY id DESC LIMIT 5000";
  const orders = db.prepare(`SELECT id, customer_name, customer_phone, status, created_at FROM orders WHERE id IN (${pick}) ORDER BY id DESC`).all();
  const items = db.prepare(`SELECT oi.id, oi.order_id, oi.name, oi.qty, oi.unit_price_cents, oi.unit_cost_cents, oi.note, p.category
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (${pick}) ORDER BY oi.id`).all();
  const adds = db.prepare(`SELECT order_item_id, name, price_cents, cost_cents FROM order_item_addons
    WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN (${pick}))`).all();
  const addsBy = new Map(), itemsBy = new Map();
  for (const a of adds) (addsBy.get(a.order_item_id) || addsBy.set(a.order_item_id, []).get(a.order_item_id)).push({ name: a.name, price_cents: a.price_cents, cost_cents: a.cost_cents });
  for (const i of items) {
    const { order_id, ...rest } = i;
    (itemsBy.get(order_id) || itemsBy.set(order_id, []).get(order_id)).push({ ...rest, category: i.category || "doces", addons: addsBy.get(i.id) || [] });
  }
  res.json({ orders: orders.map(o => ({ ...o, created_at: o.created_at.replace(" ", "T") + "Z", items: itemsBy.get(o.id) || [] })) });
});

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist");
app.use(express.static(dist));
app.get(["/admin", "/admin/*"], (_req, res) => { res.set("X-Robots-Tag", "noindex"); res.sendFile(path.join(dist, "admin.html")); });
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(process.env.PORT || 3001, () => console.log("API em http://localhost:" + (process.env.PORT || 3001)));
