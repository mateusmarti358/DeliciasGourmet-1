import { useEffect, useMemo, useState } from "react";

import { api, money } from "./api.js";
import Produtos from "./Produtos.jsx";
import Pedidos from "./Pedidos.jsx";
import Administrativo from "./Administrativo.jsx";

const fold = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const DAYS = [["SEG", 1, "Segunda-feira"], ["TER", 2, "Terça-feira"], ["QUA", 3, "Quarta-feira"], ["QUI", 4, "Quinta-feira"], ["SEX", 5, "Sexta-feira"], ["SAB", 6, "Sábado"], ["DOM", 0, "Domingo"]];
const TABS = ["Pedidos", "Empresa", "Produtos", "Administrativo"];

function Login({ onLogin }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [state, setState] = useState({ busy: false, error: "" });
  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, error: "" });
    try { onLogin(await api("/login", { method: "POST", body: form })); }
    catch (err) { setState({ busy: false, error: err.message }); }
  }
  return (
    <main className="login">
      <form onSubmit={submit}>
        <img src="/assets/logo.png" alt="Delícias Gourmet" />
        <h1>Entrar no gerenciamento</h1>
        <label>E-mail<input type="email" required autoComplete="username" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
        <label>Senha<input type="password" required autoComplete="current-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
        {state.error && <p className="error" role="alert">{state.error}</p>}
        <button className="primary" disabled={state.busy}>{state.busy ? "Entrando..." : "Entrar"}</button>
      </form>
    </main>
  );
}

function Empresa({ onAuthError }) {
  const [days, setDays] = useState(null);
  const [products, setProducts] = useState(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const fail = e => (e.status === 401 ? onAuthError() : setError(e.message));

  useEffect(() => {
    Promise.all([api("/days"), api("/products")]).then(([d, p]) => { setDays(d); setProducts(p); }).catch(fail);
  }, []);

  const toggleDay = async wd => {
    const open = !days.find(d => d.weekday === wd).open;
    setError("");
    setDays(ds => ds.map(d => (d.weekday === wd ? { ...d, open } : d)));
    try { await api(`/days/${wd}`, { method: "PUT", body: { open } }); }
    catch (e) { setDays(ds => ds.map(d => (d.weekday === wd ? { ...d, open: !open } : d))); fail(e); }
  };
  const toggleProduct = async id => {
    const available = !products.find(p => p.id === id).available;
    setError("");
    setProducts(ps => ps.map(p => (p.id === id ? { ...p, available } : p)));
    try { await api(`/products/${id}`, { method: "PATCH", body: { available } }); }
    catch (e) { setProducts(ps => ps.map(p => (p.id === id ? { ...p, available: !available } : p))); fail(e); }
  };

  const shown = useMemo(() => (products || []).filter(p => fold(p.name).includes(fold(q.trim()))), [products, q]);

  return (
    <>
      <h1 className="title">Gerenciamento Delícias Gourmet</h1>
      <h2 className="section-title" id="disp">Disponibilidade</h2>
      <div className="days" role="group" aria-labelledby="disp">
        {DAYS.map(([short, wd, full]) => {
          const open = days?.find(d => d.weekday === wd)?.open;
          return <button key={wd} className="day" aria-pressed={!!open} aria-label={`${full}: ${open ? "aberto" : "fechado"}`} disabled={!days} onClick={() => toggleDay(wd)}>{short}</button>;
        })}
      </div>
      <p className="hint">Dias em vinho são dias de atendimento. Pedidos só são aceitos nesses dias.</p>

      <div className="search">
        <input type="search" aria-label="Pesquisar produtos" placeholder="Pesquisar produtos" value={q} onChange={e => setQ(e.target.value)} />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M16 16l5 5" /></svg>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <section className="panel" aria-label="Produtos" aria-live="polite">
        {!products ? <p className="muted">Carregando...</p> : shown.length === 0 ? <p className="muted">Nenhum produto encontrado.</p> : (
          <ul>
            {shown.map(p => (
              <li key={p.id}>
                <img src={`/assets/${p.image}`} alt="" />
                <div className="info"><strong>{p.name}</strong><span>{money(p.price_cents)}</span></div>
                <label className="switch">
                  <input type="checkbox" role="switch" checked={p.available} onChange={() => toggleProduct(p.id)} />
                  <span>{p.available ? "Disponível" : "Indisponível"}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function Admin() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState("Empresa");
  useEffect(() => { api("/me").then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <p className="muted pad">Carregando...</p>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <>
      <header className="bar">
        <a className="brand" href="/" aria-label="Delícias Gourmet: voltar para a página inicial"><img src="/assets/logo.png" alt="" /></a>
        <nav aria-label="Áreas do gerenciamento">
          {TABS.map(t => <button key={t} aria-current={t === tab ? "page" : undefined} onClick={() => setTab(t)}>{t}</button>)}
          <button onClick={async () => { await api("/logout", { method: "POST" }).catch(() => {}); setUser(null); }}>Sair</button>
        </nav>
      </header>
      <main className={"wrap" + (tab === "Administrativo" ? " wide" : "")}>
        {tab === "Empresa" ? <Empresa onAuthError={() => setUser(null)} /> : tab === "Produtos" ? <Produtos onAuthError={() => setUser(null)} /> : tab === "Pedidos" ? <Pedidos onAuthError={() => setUser(null)} /> : tab === "Administrativo" ? <Administrativo onAuthError={() => setUser(null)} /> : (
          <><h1 className="title">{tab}</h1><p className="muted">Esta área ainda será desenvolvida.</p></>
        )}
      </main>
    </>
  );
}
