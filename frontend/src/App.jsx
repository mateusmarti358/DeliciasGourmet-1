import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import AddonDialog from "./AddonDialog.jsx";
import CartPage from "./CartPage.jsx";
import { money } from "./parts.jsx";

const HERO = [
  ["hero-1.jpg", "Shawarmas recheados"],
  ["hero-2.jpg", "Churros e crepes com confete e chocolate"],
  ["hero-3.jpg", "Pastéis e mistos quentes"],
];
const SPECIALS = [
  ["especial-1.webp", "Bombons recheados cortados ao meio"],
  ["especial-2.webp", "Copos de sobremesa cremosa com morango"],
  ["especial-3.webp", "Doce de morango vermelho"],
  ["especial-4.webp", "Copos de sobremesa em camadas"],
];

function Hero() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const go = n => setI((n + HERO.length) % HERO.length);
  useEffect(() => {
    if (paused || reduce) return;
    const t = setInterval(() => setI(n => (n + 1) % HERO.length), 5000);
    return () => clearInterval(t);
  }, [paused, reduce]);

  return (
    <section className="hero" id="inicio" aria-roledescription="carrossel" aria-label="Destaques da Delícias Gourmet"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {HERO.map(([f, alt], n) => (
        <img key={f} className={"slide" + (n === i ? " active" : "")} src={`/assets/${f}`} alt={alt} aria-hidden={n !== i} />
      ))}
      <div className="hero-content">
        <h1>Delícias Gourmet</h1>
        <p>Sabores especiais, preparados com carinho.</p>
      </div>
      <button className="hero-arrow prev" aria-label="Slide anterior" onClick={() => go(i - 1)}>‹</button>
      <button className="hero-arrow next" aria-label="Próximo slide" onClick={() => go(i + 1)}>›</button>
      <div className="hero-controls">
        {HERO.map((_, n) => (
          <button key={n} className="dot" aria-label={`Ir para o slide ${n + 1}`} aria-current={n === i ? "true" : undefined} onClick={() => go(n)} />
        ))}
      </div>
    </section>
  );
}

function Menu({ products, onAdd }) {
  return ["salgados", "doces"].map(cat => (
    <div key={cat}>
      <h3 className="category">{cat === "salgados" ? "Salgados" : "Doces"}</h3>
      <div className="grid">
        {products.filter(p => p.category === cat).map(p => (
          <article className="product" key={p.id}>
            <img src={`/assets/${p.image}`} alt={p.name} loading="lazy" />
            <div className="product-content">
              <h4>{p.name}</h4>
              <div className="product-bottom">
                <strong>{money(p.price_cents)}</strong>
                <button className="button" onClick={() => onAdd(p.id)} aria-label={`Adicionar ${p.name} ao carrinho`}>ADICIONAR</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  ));
}

// Carrossel central: a cada passo tudo desliza para a direita e a foto da esquerda assume o centro.
function Specials() {
  const n = SPECIALS.length;
  const [active, setActive] = useState(0);
  const [shifting, setShifting] = useState(false);
  const [paused, setPaused] = useState(false);
  const reduce = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    if (paused || reduce) return;
    const t = setInterval(() => setShifting(true), 3500);
    return () => clearInterval(t);
  }, [paused, reduce]);

  useEffect(() => {
    if (!shifting) return;
    const t = setTimeout(() => { setActive(x => (x - 1 + n) % n); setShifting(false); }, 750);
    return () => clearTimeout(t);
  }, [shifting, n]);

  const slots = [-2, -1, 0, 1, 2].map(o => SPECIALS[(active + o + 2 * n) % n]);
  const center = shifting ? 1 : 2;

  return (
    <div className="sp-wrap" role="group" aria-roledescription="carrossel" aria-label="Produtos especiais"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="sp-window">
        <div className={"sp-track" + (shifting ? " shifting" : "")}>
          {slots.map(([f, alt], i) => (
            <img key={i} className={"sp-slot" + (i === center ? " center" : "")} src={`/assets/${f}`} alt={alt} aria-hidden={i === 0 || i === 4} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Home({ products, loadError, onPick }) {
  return (
    <main>
      <Hero />
        <section className="section container" id="cardapio">
          <h2>Cardápio</h2>
          {loadError ? <p className="error" role="alert">Não foi possível carregar o cardápio. Tente novamente em instantes.</p> : <Menu products={products} onAdd={onPick} />}
        </section>

        <section className="section specials">
          <div className="container">
            <h2>Especiais</h2>
            <Specials />
            <p>Produtos que são vendidos periodicamente.</p>
          </div>
        </section>

        <section className="section container about" id="sobre">
          <div>
            <h2>Sobre Nós</h2>
            <p>A Delícias Gourmet iniciou a sua trajetória nas feiras do produtor, oferecendo doces e salgados confecionados com dedicação e elevada qualidade. Em 2016, a marca deu um grande passo com a aquisição do seu primeiro food truck, levando os seus produtos a eventos em Toledo e várias cidades da região, como Cascavel, Palotina e Marechal Cândido Rondon.</p>
            <p>Após uma pausa no final de 2019 e uma passagem pelo Mato Grosso a partir de 2020, a Delícias Gourmet retomou as suas atividades com o food truck em 2025, estabelecendo-se num ponto fixo no Biopark.</p>
            <p>Atualmente, oferecemos uma ampla variedade de produtos preparados na hora: shawarmas, crepes franceses, churros, pastéis, cafés e diversos doces, além de novidades constantes lançadas especialmente para os nossos clientes.</p>
          </div>
          <img src="/assets/food-truck.png" alt="Food truck da Delícias Gourmet" />
        </section>
    </main>
  );
}

function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) requestAnimationFrame(() => document.querySelector(hash)?.scrollIntoView());
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  const [products, setProducts] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [lines, setLines] = useState([]);
  const [picking, setPicking] = useState(null);
  const [toast, setToast] = useState("");
  const key = useRef(1);
  const byId = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  useEffect(() => {
    fetch("/api/products").then(r => (r.ok ? r.json() : Promise.reject())).then(setProducts).catch(() => setLoadError(true));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const add = (id, addons = [], note = "") => {
    const k = key.current++;
    const sig = [...addons].sort().join();
    setLines(ls => {
      const same = ls.find(l => l.id === id && [...l.addons].sort().join() === sig && l.note === note);
      return same ? ls.map(l => (l === same ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { key: k, id, qty: 1, addons, note }];
    });
    setToast("Produto adicionado ao carrinho.");
  };
  const onPick = id => (byId[id].addons.length ? setPicking(byId[id]) : add(id));
  const count = lines.reduce((s, l) => s + l.qty, 0);

  return (
    <>
      <ScrollManager />
      <header>
        <div className="container navigation">
          <Link className="brand" to="/"><img src="/assets/logo.png" alt="Delícias Gourmet" /></Link>
          <nav aria-label="Navegação principal">
            <Link to="/#inicio">Início</Link>
            <Link to="/#cardapio">Cardápio</Link>
            <Link to="/#sobre">Sobre Nós</Link>
            <Link to="/#contato">Contato</Link>
            <Link className="button gold" to="/carrinho">Carrinho ({count})</Link>
          </nav>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Home products={products} loadError={loadError} onPick={onPick} />} />
        <Route path="/carrinho" element={<CartPage lines={lines} setLines={setLines} byId={byId} onSent={() => setLines([])} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <footer id="contato">
        <div className="container">
          <span className="brand">Delícias Gourmet</span>
          <p>Biopark — Toledo e região</p>
          <p>Contato e WhatsApp: inserir os dados oficiais da empresa.</p>
        </div>
      </footer>

      {picking && (
        <AddonDialog key={picking.id} product={picking} onClose={() => setPicking(null)} onConfirm={(addons, note) => add(picking.id, addons, note)} />
      )}
      <div className="status" role="status" aria-live="polite">{toast}</div>
    </>
  );
}
