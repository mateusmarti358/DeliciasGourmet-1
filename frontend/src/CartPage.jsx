import { useState } from "react";
import { Link } from "react-router-dom";
import { money, Pills, Notes } from "./parts.jsx";

export default function CartPage({ lines, setLines, byId, onSent }) {
  const [form, setForm] = useState({ name: "", phone: "" });
  const [state, setState] = useState({ busy: false, error: "", done: null });
  const unit = l => byId[l.id].price_cents + byId[l.id].addons.filter(a => l.addons.includes(a.id)).reduce((s, a) => s + a.price_cents, 0);
  const total = lines.reduce((s, l) => s + unit(l) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const patch = (key, fn) => setLines(ls => ls.flatMap(l => (l.key === key ? fn(l) : [l])));

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, error: "", done: null });
    try {
      const r = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: form, items: lines.map(l => ({ productId: l.id, qty: l.qty, addonIds: l.addons, note: l.note })) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Não foi possível enviar o pedido.");
      setState({ busy: false, error: "", done: data });
      onSent();
    } catch (err) {
      setState({ busy: false, error: err.message, done: null });
    }
  }

  return (
    <main className="container cart-page">
      <div className="cart-panel">
        <h1 className="cart-title">
          <span className="cart-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8H18a1 1 0 0 0 1-.8L20.6 8H6" /></svg>
            {count > 0 && <span className="badge">{count}</span>}
          </span>
          Meu carrinho
        </h1>

        {state.done ? (
          <>
            <p className="success" role="status">Pedido #{state.done.id} recebido! Total: {money(state.done.total_cents)}.</p>
            <Link className="button" to="/#cardapio">Voltar ao cardápio</Link>
          </>
        ) : lines.length === 0 ? (
          <>
            <p>Seu carrinho está vazio.</p>
            <Link className="button" to="/#cardapio">Ver cardápio</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            {lines.map(l => (
              <div className="cart-item" key={l.key}>
                <div className="cart-line">
                  <div className="item-head">
                    <img className="thumb" src={`/assets/${byId[l.id].image}`} alt="" />
                    <div><strong>{byId[l.id].name}</strong><div>Preço: {money(unit(l))}</div></div>
                  </div>
                  <div className="quantity">
                    <button type="button" aria-label={`Diminuir quantidade de ${byId[l.id].name}`} onClick={() => patch(l.key, x => (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []))}>−</button>
                    <span aria-live="polite">{l.qty}</span>
                    <button type="button" aria-label={`Aumentar quantidade de ${byId[l.id].name}`} disabled={l.qty >= 50} onClick={() => patch(l.key, x => [{ ...x, qty: x.qty + 1 }])}>+</button>
                  </div>
                  <strong>{money(unit(l) * l.qty)}</strong>
                </div>
                <Pills addons={byId[l.id].addons} selected={l.addons}
                  onToggle={id => patch(l.key, x => [{ ...x, addons: x.addons.includes(id) ? x.addons.filter(a => a !== id) : [...x.addons, id] }])} />
                <Notes id={`note-${l.key}`} value={l.note} onChange={v => patch(l.key, x => [{ ...x, note: v }])} />
                <p><button type="button" className="link-btn" onClick={() => patch(l.key, () => [])}>Remover item</button></p>
              </div>
            ))}
            <p className="total">Total: {money(total)}</p>
            <label className="field">Nome
              <input required autoComplete="name" maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">Telefone com DDD
              <input required type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </label>
            {state.error && <p className="error" role="alert">{state.error}</p>}
            <p><button className="button" disabled={state.busy}>{state.busy ? "Enviando..." : "Finalizar pedido"}</button></p>
          </form>
        )}
      </div>
    </main>
  );
}
