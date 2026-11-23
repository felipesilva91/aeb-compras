import React, { useState, useMemo, useEffect } from "react";
import { X, Plus, Trash2, Pencil, Check, Loader2, Search, Store, ImageDown, Download, Share2, MessageCircle } from "lucide-react";
import { dbInsert, dbUpdate, dbDelete } from "./lib/storage";

/* ============================== HELPERS ============================== */

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
function parseNum(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const moneyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function money(v) {
  return moneyFmt.format(Number(v) || 0).replace(/ /g, " ");
}
function qtdFmt(v) {
  const n = Number(v) || 0;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
function hojeBR() {
  return new Date().toLocaleDateString("pt-BR");
}

export const COT_VAZIO = { fornecedores: [], itens: [], cotForns: [], precos: [] };

/* ============================== CÁLCULO ============================== */

export function montarComparativo(pedidoId, cot) {
  const itens = cot.itens.filter((i) => i.pedidoId === pedidoId).sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));
  const forns = cot.cotForns
    .filter((c) => c.pedidoId === pedidoId)
    .map((c) => ({ cf: c, fornecedor: cot.fornecedores.find((f) => f.id === c.fornecedorId) }))
    .filter((x) => x.fornecedor)
    .sort((a, b) => a.fornecedor.nome.localeCompare(b.fornecedor.nome));

  const preco = (itemId, cfId) => {
    const p = cot.precos.find((x) => x.itemId === itemId && x.cotFornId === cfId);
    return p ? Number(p.precoUnitario) : null;
  };

  const menorPorItem = {};
  itens.forEach((it) => {
    const valores = forns.map((f) => preco(it.id, f.cf.id)).filter((v) => v !== null && v > 0);
    menorPorItem[it.id] = valores.length ? Math.min(...valores) : null;
  });

  const colunas = forns.map((f) => {
    let subtotal = 0;
    let faltando = 0;
    itens.forEach((it) => {
      const p = preco(it.id, f.cf.id);
      if (p === null) faltando += 1;
      else subtotal += (Number(it.quantidade) || 0) * p;
    });
    const frete = Number(f.cf.frete) || 0;
    return { ...f, subtotal, frete, total: subtotal + frete, completo: itens.length > 0 && faltando === 0, faltando };
  });

  const completos = colunas.filter((c) => c.completo);
  const menorTotal = completos.length ? Math.min(...completos.map((c) => c.total)) : null;
  const maiorTotal = completos.length ? Math.max(...completos.map((c) => c.total)) : null;
  return { itens, colunas, preco, menorPorItem, menorTotal, maiorTotal, qtdCompletos: completos.length };
}

/* ============================== IMAGEM (CANVAS) ============================== */

function carregarImagem(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function ajustarTexto(ctx, texto, larguraMax) {
  let t = String(texto || "");
  if (ctx.measureText(t).width <= larguraMax) return t;
  while (t.length > 1 && ctx.measureText(t + "…").width > larguraMax) t = t.slice(0, -1);
  return t + "…";
}

function quebrarLinhas(ctx, texto, larguraMax, maxLinhas) {
  const palavras = String(texto || "").split(/\s+/);
  const linhas = [];
  let atual = "";
  palavras.forEach((p) => {
    const teste = atual ? `${atual} ${p}` : p;
    if (ctx.measureText(teste).width <= larguraMax || !atual) atual = teste;
    else { linhas.push(atual); atual = p; }
  });
  if (atual) linhas.push(atual);
  if (linhas.length > maxLinhas) {
    const cortadas = linhas.slice(0, maxLinhas);
    cortadas[maxLinhas - 1] = ajustarTexto(ctx, cortadas[maxLinhas - 1] + "…", larguraMax);
    return cortadas;
  }
  return linhas;
}

export async function gerarImagemComparativo({ pedido, obra, comp }) {
  const { itens, colunas, preco, menorPorItem, menorTotal, maiorTotal } = comp;
  const n = Math.max(colunas.length, 1);
  const x0 = 40;
  const cw0 = 420;
  const cw1 = 130;
  const fw = 300;
  const W = Math.max(1200, x0 * 2 + cw0 + cw1 + n * fw);
  const rh = 78;
  const headerH = 60;
  const rodapeLinhas = 4;
  const temResumo = comp.qtdCompletos >= 2;
  const H = 210 + headerH + itens.length * rh + rodapeLinhas * 52 + (temResumo ? 110 : 70);
  const S = 2;

  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";
  const FONT = "Arial, Helvetica, sans-serif";
  const f = (size, bold) => `${bold ? "bold " : ""}${size}px ${FONT}`;
  const txt = (t, x, y, { size = 20, bold = false, color = "#000", align = "left" } = {}) => {
    ctx.font = f(size, bold);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(t, x, y);
  };

  const logo = await carregarImagem("/logo-full.png");
  if (logo) {
    const escala = Math.min(260 / logo.width, 110 / logo.height);
    ctx.drawImage(logo, x0, 30, logo.width * escala, logo.height * escala);
  }
  txt("COMPARATIVO DE PREÇOS", W - x0, 58, { size: 34, bold: true, align: "right" });
  txt(ajustarTexto(ctx, obra?.nome || "", 800), W - x0, 100, { size: 24, align: "right" });
  ctx.font = f(20, false);
  txt(ajustarTexto(ctx, `Pedido ${pedido.codigo || ""} · ${pedido.titulo || ""}`, 800), W - x0, 134, { size: 20, align: "right" });
  txt(`Emitido em ${hojeBR()}`, W - x0, 162, { size: 18, align: "right" });
  ctx.fillStyle = "#000";
  ctx.fillRect(x0, 188, W - 2 * x0, 3);

  let y = 210;
  ctx.fillStyle = "#000";
  ctx.fillRect(x0, y, W - 2 * x0, headerH);
  txt("Item", x0 + 14, y + 30, { size: 22, bold: true, color: "#fff" });
  txt("Qtd", x0 + cw0 + cw1 / 2, y + 30, { size: 22, bold: true, color: "#fff", align: "center" });
  colunas.forEach((c, i) => {
    const cx = x0 + cw0 + cw1 + i * fw + fw / 2;
    ctx.font = f(21, true);
    txt(ajustarTexto(ctx, c.fornecedor.nome, fw - 20), cx, y + 22, { size: 21, bold: true, color: "#fff", align: "center" });
    if (c.fornecedor.telefone) txt(c.fornecedor.telefone, cx, y + 45, { size: 15, color: "#fff", align: "center" });
  });
  y += headerH;

  itens.forEach((it) => {
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y + rh); ctx.lineTo(W - x0, y + rh); ctx.stroke();
    ctx.font = f(21, false);
    const linhas = quebrarLinhas(ctx, it.descricao, cw0 - 28, 2);
    const baseY = y + rh / 2 - ((linhas.length - 1) * 13);
    linhas.forEach((l, k) => txt(l, x0 + 14, baseY + k * 26, { size: 21 }));
    txt(`${qtdFmt(it.quantidade)} ${it.unidade || ""}`.trim(), x0 + cw0 + cw1 / 2, y + rh / 2, { size: 20, align: "center" });
    colunas.forEach((c, i) => {
      const cx0 = x0 + cw0 + cw1 + i * fw;
      const p = preco(it.id, c.cf.id);
      if (p === null) {
        txt("—", cx0 + fw / 2, y + rh / 2, { size: 22, align: "center" });
        return;
      }
      const menor = menorPorItem[it.id] !== null && p === menorPorItem[it.id] && colunas.length > 1;
      if (menor) { ctx.fillStyle = "#000"; ctx.fillRect(cx0 + 14, y + 8, fw - 28, rh - 16); }
      const cor = menor ? "#fff" : "#000";
      txt(`${money(p)}${it.unidade ? " /" + it.unidade : ""}`, cx0 + fw / 2, y + 28, { size: 21, bold: true, color: cor, align: "center" });
      txt(`total ${money((Number(it.quantidade) || 0) * p)}`, cx0 + fw / 2, y + 54, { size: 16, color: cor, align: "center" });
    });
    y += rh;
  });
  if (itens.length === 0) {
    txt("Nenhum item lançado.", x0 + 14, y + 30, { size: 20 });
    y += 60;
  }

  ctx.fillStyle = "#000";
  ctx.fillRect(x0, y - 1, W - 2 * x0, 3);

  const linhaRodape = (label, valores, { bold = false, destaque = (i) => false } = {}) => {
    txt(label, x0 + 14, y + 26, { size: 21, bold: true });
    valores.forEach((v, i) => {
      const cx0 = x0 + cw0 + cw1 + i * fw;
      let cor = "#000";
      if (destaque(i)) { ctx.fillStyle = "#000"; ctx.fillRect(cx0 + 14, y + 6, fw - 28, 40); cor = "#fff"; }
      txt(v, cx0 + fw / 2, y + 26, { size: bold ? 23 : 21, bold, color: cor, align: "center" });
    });
    y += 52;
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(W - x0, y); ctx.stroke();
  };
  linhaRodape("Subtotal", colunas.map((c) => money(c.subtotal)));
  linhaRodape("Frete", colunas.map((c) => (c.frete > 0 ? money(c.frete) : "Grátis")));
  linhaRodape("Prazo de entrega", colunas.map((c) => c.cf.prazo || "—"));
  linhaRodape("TOTAL", colunas.map((c) => (c.completo ? money(c.total) : "faltam preços")), {
    bold: true,
    destaque: (i) => colunas[i].completo && menorTotal !== null && colunas[i].total === menorTotal && colunas.length > 1,
  });
  ctx.fillStyle = "#000";
  ctx.fillRect(x0, y + 1, W - 2 * x0, 3);
  y += 28;

  if (temResumo) {
    const melhor = colunas.find((c) => c.completo && c.total === menorTotal);
    txt(`Menor total: ${melhor.fornecedor.nome} (${money(menorTotal)}). Economia de ${money(maiorTotal - menorTotal)} em relação ao mais caro.`, x0, y + 8, { size: 21, bold: true });
    txt("Fundo preto = menor preço.", x0, y + 42, { size: 17 });
  } else {
    txt("Fundo preto = menor preço.", x0, y + 8, { size: 17 });
  }

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/* ============================== MODAL BASE ============================== */

function Shell({ title, subtitle, onClose, children, width }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined}>
        <div className="modal-header">
          <div><h3>{title}</h3>{subtitle && <span>{subtitle}</span>}</div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ============================== FORNECEDORES ============================== */

export async function salvarFornecedor(setCot, dados, id) {
  const limpo = {
    nome: dados.nome.trim(),
    telefone: dados.telefone.trim() || null,
    categoria: dados.categoria.trim() || null,
    cidade: dados.cidade.trim() || null,
    observacao: dados.observacao.trim() || null,
  };
  if (id) {
    await dbUpdate("fornecedores", id, limpo);
    setCot((c) => ({ ...c, fornecedores: c.fornecedores.map((f) => (f.id === id ? { ...f, ...limpo } : f)) }));
    return id;
  }
  const novo = { id: uid(), ...limpo };
  await dbInsert("fornecedores", novo);
  setCot((c) => ({ ...c, fornecedores: [...c.fornecedores, novo] }));
  return novo.id;
}

function FornecedorFormModal({ fornecedor, onClose, onSave }) {
  const [nome, setNome] = useState(fornecedor?.nome || "");
  const [telefone, setTelefone] = useState(fornecedor?.telefone || "");
  const [categoria, setCategoria] = useState(fornecedor?.categoria || "");
  const [cidade, setCidade] = useState(fornecedor?.cidade || "");
  const [observacao, setObservacao] = useState(fornecedor?.observacao || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    setSalvando(true);
    setErro("");
    try {
      await onSave({ nome, telefone, categoria, cidade, observacao });
      onClose();
    } catch (e) {
      console.error("Erro ao salvar fornecedor", e);
      setErro("Não foi possível salvar. Confira a conexão e tente de novo.");
      setSalvando(false);
    }
  }

  return (
    <Shell title={fornecedor ? "Editar Fornecedor" : "Novo Fornecedor"} onClose={onClose}>
      <div className="modal-body">
        <div className="field"><label>Nome</label><input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Depósito Central" /></div>
        <div className="field-row">
          <div className="field"><label>Telefone / WhatsApp</label><input inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(88) 99999-0000" /></div>
          <div className="field"><label>Cidade</label><input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex: Crato" /></div>
        </div>
        <div className="field"><label>O que vende (opcional)</label><input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex: Material básico, elétrica, hidráulica" /></div>
        <div className="field"><label>Observação (opcional)</label><input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex: entrega no mesmo dia, aceita Pix" /></div>
        {erro && <span className="field-error">{erro}</span>}
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!nome.trim() || salvando} onClick={salvar}>
          {salvando ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {fornecedor ? "Salvar alterações" : "Cadastrar"}
        </button>
      </div>
    </Shell>
  );
}

export function FornecedoresPage({ cot, setCot }) {
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [erro, setErro] = useState("");

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return cot.fornecedores
      .filter((f) => !q || [f.nome, f.categoria, f.cidade, f.telefone].some((v) => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [cot.fornecedores, busca]);

  async function excluir(id) {
    setErro("");
    try {
      await dbDelete("fornecedores", id);
      setCot((c) => {
        const cfIds = c.cotForns.filter((x) => x.fornecedorId === id).map((x) => x.id);
        return {
          ...c,
          fornecedores: c.fornecedores.filter((f) => f.id !== id),
          cotForns: c.cotForns.filter((x) => x.fornecedorId !== id),
          precos: c.precos.filter((p) => !cfIds.includes(p.cotFornId)),
        };
      });
      setConfirmId(null);
    } catch (e) {
      console.error(e);
      setErro("Não foi possível excluir.");
    }
  }

  return (
    <div className="cot-page">
      <div className="cot-toolbar">
        <div className="cot-search">
          <Search size={15} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, cidade ou material…" />
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ type: "novo" })}><Plus size={16} /> Novo fornecedor</button>
      </div>
      {erro && <span className="field-error">{erro}</span>}
      {lista.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Store size={26} /></div>
          <h3>{cot.fornecedores.length === 0 ? "Nenhum fornecedor cadastrado" : "Nada encontrado"}</h3>
          <p>{cot.fornecedores.length === 0 ? "Cadastre os fornecedores para montar os comparativos de preço nos pedidos." : "Tente outra busca."}</p>
        </div>
      ) : (
        <div className="cot-list">
          {lista.map((f) => {
            const digitos = String(f.telefone || "").replace(/\D/g, "");
            return (
              <div key={f.id} className="cot-forn-row">
                <div className="cot-forn-info">
                  <strong>{f.nome}</strong>
                  <span className="cot-forn-meta">
                    {[f.categoria, f.cidade].filter(Boolean).join(" · ")}
                  </span>
                  {f.telefone && <span className="cot-forn-meta">{f.telefone}</span>}
                  {f.observacao && <span className="cot-forn-meta">{f.observacao}</span>}
                </div>
                <div className="cot-forn-actions">
                  {digitos.length >= 10 && (
                    <a className="btn btn-secondary sm" href={`https://wa.me/${digitos.length <= 11 ? "55" + digitos : digitos}`} target="_blank" rel="noreferrer" title="Abrir WhatsApp"><MessageCircle size={14} /></a>
                  )}
                  <button className="btn btn-secondary sm" title="Editar" onClick={() => setModal({ type: "editar", fornecedor: f })}><Pencil size={14} /></button>
                  {confirmId === f.id ? (
                    <div className="confirm-inline">
                      <span>Excluir?</span>
                      <button className="btn btn-secondary sm" onClick={() => setConfirmId(null)}>Não</button>
                      <button className="btn btn-danger sm" onClick={() => excluir(f.id)}>Sim</button>
                    </div>
                  ) : (
                    <button className="btn btn-secondary sm" title="Excluir" onClick={() => setConfirmId(f.id)}><Trash2 size={14} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {modal?.type === "novo" && <FornecedorFormModal onClose={() => setModal(null)} onSave={(d) => salvarFornecedor(setCot, d)} />}
      {modal?.type === "editar" && <FornecedorFormModal fornecedor={modal.fornecedor} onClose={() => setModal(null)} onSave={(d) => salvarFornecedor(setCot, d, modal.fornecedor.id)} />}
    </div>
  );
}

/* ============================== COTAÇÃO DO PEDIDO ============================== */

function CampoSalvo({ value, onSave, placeholder, inputMode, className, align }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input
      className={className}
      style={align ? { textAlign: align } : undefined}
      inputMode={inputMode}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (String(v) !== String(value ?? "")) onSave(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

function itensDoMaterial(material) {
  return String(material || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-•*·]+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean)
    .map((linha) => {
      const m = linha.match(/^(\d+(?:[.,]\d+)?)\s*(?:x\s+|un\.?\s+|unid\.?\s+)?(.+)$/i);
      if (m && m[2]) return { descricao: m[2].trim(), quantidade: Number(m[1].replace(",", ".")) || 1, unidade: "un" };
      return { descricao: linha, quantidade: 1, unidade: "un" };
    });
}

export function CotacaoModal({ pedido, obra, cot, setCot, onClose }) {
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const [novoItem, setNovoItem] = useState({ descricao: "", quantidade: "", unidade: "un" });
  const [fornSel, setFornSel] = useState("");
  const [modalForn, setModalForn] = useState(false);
  const [preview, setPreview] = useState(null);
  const [gerando, setGerando] = useState(false);

  const comp = useMemo(() => montarComparativo(pedido.id, cot), [pedido.id, cot]);
  const jaNaCotacao = new Set(cot.cotForns.filter((c) => c.pedidoId === pedido.id).map((c) => c.fornecedorId));
  const disponiveis = cot.fornecedores.filter((f) => !jaNaCotacao.has(f.id)).sort((a, b) => a.nome.localeCompare(b.nome));

  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  async function run(fn) {
    setErro("");
    setBusy(true);
    try { await fn(); }
    catch (e) {
      console.error("Erro nas cotações", e);
      setErro("Não foi possível salvar. Confira a conexão e se o SQL de cotações foi rodado no Supabase.");
    } finally { setBusy(false); }
  }

  const addItens = (lista) => run(async () => {
    const base = Date.now();
    const novos = lista.map((it, i) => ({ id: uid(), pedidoId: pedido.id, descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidade || "un", ordem: base + i }));
    for (const n of novos) await dbInsert("cotacao_itens", n);
    setCot((c) => ({ ...c, itens: [...c.itens, ...novos] }));
  });

  const adicionarItemManual = () => {
    const q = parseNum(novoItem.quantidade);
    if (!novoItem.descricao.trim() || !q || q <= 0) return;
    addItens([{ descricao: novoItem.descricao.trim(), quantidade: q, unidade: novoItem.unidade.trim() || "un" }]).then(() => setNovoItem({ descricao: "", quantidade: "", unidade: novoItem.unidade }));
  };

  const salvarItem = (id, patch) => run(async () => {
    await dbUpdate("cotacao_itens", id, patch);
    setCot((c) => ({ ...c, itens: c.itens.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  });

  const removerItem = (id) => run(async () => {
    await dbDelete("cotacao_itens", id);
    setCot((c) => ({ ...c, itens: c.itens.filter((i) => i.id !== id), precos: c.precos.filter((p) => p.itemId !== id) }));
  });

  const adicionarFornecedor = () => {
    if (!fornSel) return;
    run(async () => {
      const novo = { id: uid(), pedidoId: pedido.id, fornecedorId: fornSel, frete: 0, prazo: null };
      await dbInsert("cotacao_fornecedores", novo);
      setCot((c) => ({ ...c, cotForns: [...c.cotForns, novo] }));
      setFornSel("");
    });
  };

  const salvarCotForn = (id, patch) => run(async () => {
    await dbUpdate("cotacao_fornecedores", id, patch);
    setCot((c) => ({ ...c, cotForns: c.cotForns.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  });

  const removerCotForn = (id) => run(async () => {
    await dbDelete("cotacao_fornecedores", id);
    setCot((c) => ({ ...c, cotForns: c.cotForns.filter((x) => x.id !== id), precos: c.precos.filter((p) => p.cotFornId !== id) }));
  });

  const salvarPreco = (item, cf, texto) => run(async () => {
    const valor = parseNum(texto);
    const existente = cot.precos.find((p) => p.itemId === item.id && p.cotFornId === cf.id);
    if (valor === null || valor < 0) {
      if (existente) {
        await dbDelete("cotacao_precos", existente.id);
        setCot((c) => ({ ...c, precos: c.precos.filter((p) => p.id !== existente.id) }));
      }
      return;
    }
    if (existente) {
      await dbUpdate("cotacao_precos", existente.id, { precoUnitario: valor });
      setCot((c) => ({ ...c, precos: c.precos.map((p) => (p.id === existente.id ? { ...p, precoUnitario: valor } : p)) }));
    } else {
      const novo = { id: uid(), pedidoId: pedido.id, itemId: item.id, cotFornId: cf.id, precoUnitario: valor };
      await dbInsert("cotacao_precos", novo);
      setCot((c) => ({ ...c, precos: [...c.precos, novo] }));
    }
  });

  async function gerarImagem() {
    setGerando(true);
    setErro("");
    try {
      const blob = await gerarImagemComparativo({ pedido, obra, comp });
      if (!blob) throw new Error("sem imagem");
      if (preview?.url) URL.revokeObjectURL(preview.url);
      setPreview({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      console.error(e);
      setErro("Não foi possível gerar a imagem.");
    } finally { setGerando(false); }
  }

  const nomeArquivo = `comparativo-${String(pedido.codigo || "pedido").replace(/[^\w-]+/g, "")}.png`;
  async function compartilhar() {
    if (!preview) return;
    const arquivo = new File([preview.blob], nomeArquivo, { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [arquivo] })) await navigator.share({ files: [arquivo], title: "Comparativo de preços" });
      else setErro("Seu navegador não compartilha direto. Use Baixar e envie pelo WhatsApp.");
    } catch (e) { /* cancelado */ }
  }

  const podeImagem = comp.itens.length > 0 && comp.colunas.length > 0;

  return (
    <>
      <Shell title="Comparativo de preços" subtitle={`${pedido.codigo || ""} · ${pedido.titulo || ""}${obra ? " · " + obra.nome : ""}`} onClose={onClose} width="980px">
        <div className="modal-body">
          <span className="detail-label">1. Itens a cotar</span>
          {comp.itens.length === 0 && (
            <div className="cot-vazio">
              <p>Nenhum item ainda.</p>
              {itensDoMaterial(pedido.material).length > 0 && (
                <button className="btn btn-secondary sm" disabled={busy} onClick={() => addItens(itensDoMaterial(pedido.material))}>Puxar itens do material do pedido</button>
              )}
            </div>
          )}
          {comp.itens.map((it) => (
            <div key={it.id} className="cot-item-row">
              <CampoSalvo className="cot-in-desc" value={it.descricao} onSave={(v) => v.trim() && salvarItem(it.id, { descricao: v.trim() })} />
              <CampoSalvo className="cot-in-qtd" inputMode="decimal" value={qtdFmt(it.quantidade)} align="right" onSave={(v) => { const q = parseNum(v); if (q && q > 0) salvarItem(it.id, { quantidade: q }); }} />
              <CampoSalvo className="cot-in-un" value={it.unidade} onSave={(v) => salvarItem(it.id, { unidade: v.trim() || "un" })} />
              <button className="btn btn-secondary sm" title="Remover item" onClick={() => removerItem(it.id)}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="cot-item-row cot-item-add">
            <input className="cot-in-desc" placeholder="Novo item (ex: Cimento CP II 50 kg)" value={novoItem.descricao} onChange={(e) => setNovoItem({ ...novoItem, descricao: e.target.value })} onKeyDown={(e) => e.key === "Enter" && adicionarItemManual()} />
            <input className="cot-in-qtd" inputMode="decimal" placeholder="Qtd" style={{ textAlign: "right" }} value={novoItem.quantidade} onChange={(e) => setNovoItem({ ...novoItem, quantidade: e.target.value })} onKeyDown={(e) => e.key === "Enter" && adicionarItemManual()} />
            <input className="cot-in-un" placeholder="un" value={novoItem.unidade} onChange={(e) => setNovoItem({ ...novoItem, unidade: e.target.value })} />
            <button className="btn btn-primary sm" disabled={busy} onClick={adicionarItemManual}><Plus size={14} /></button>
          </div>

          <span className="detail-label" style={{ marginTop: 18, display: "block" }}>2. Fornecedores desta cotação</span>
          <div className="cot-forn-add">
            {cot.fornecedores.length === 0 ? (
              <span className="cot-muted">Nenhum fornecedor cadastrado ainda.</span>
            ) : (
              <>
                <select value={fornSel} onChange={(e) => setFornSel(e.target.value)}>
                  <option value="">Escolha um fornecedor…</option>
                  {disponiveis.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.cidade ? ` (${f.cidade})` : ""}</option>)}
                </select>
                <button className="btn btn-secondary sm" disabled={!fornSel || busy} onClick={adicionarFornecedor}><Plus size={14} /> Adicionar</button>
              </>
            )}
            <button className="btn btn-secondary sm" onClick={() => setModalForn(true)}><Store size={14} /> Cadastrar novo</button>
          </div>

          {comp.itens.length > 0 && comp.colunas.length > 0 && (
            <>
              <span className="detail-label" style={{ marginTop: 18, display: "block" }}>3. Preços (valor unitário)</span>
              <div className="cot-grid-wrap">
                <table className="cot-grid">
                  <thead>
                    <tr>
                      <th className="cot-th-item">Item</th>
                      <th className="cot-th-qtd">Qtd</th>
                      {comp.colunas.map((c) => (
                        <th key={c.cf.id}>
                          <div className="cot-th-forn">
                            <span>{c.fornecedor.nome}</span>
                            <button title="Tirar da cotação" onClick={() => removerCotForn(c.cf.id)}><X size={13} /></button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comp.itens.map((it) => (
                      <tr key={it.id}>
                        <td className="cot-td-item">{it.descricao}</td>
                        <td className="cot-td-qtd">{qtdFmt(it.quantidade)} {it.unidade}</td>
                        {comp.colunas.map((c) => {
                          const p = comp.preco(it.id, c.cf.id);
                          const menor = p !== null && comp.menorPorItem[it.id] === p && comp.colunas.length > 1;
                          return (
                            <td key={c.cf.id} className={menor ? "cot-menor" : ""}>
                              <CampoSalvo className="cot-in-preco" inputMode="decimal" align="right" placeholder="0,00" value={p === null ? "" : String(p).replace(".", ",")} onSave={(v) => salvarPreco(it, c.cf, v)} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="cot-foot">
                      <td colSpan={2}>Subtotal</td>
                      {comp.colunas.map((c) => <td key={c.cf.id} className="cot-num">{money(c.subtotal)}</td>)}
                    </tr>
                    <tr className="cot-foot">
                      <td colSpan={2}>Frete</td>
                      {comp.colunas.map((c) => (
                        <td key={c.cf.id}>
                          <CampoSalvo className="cot-in-preco" inputMode="decimal" align="right" placeholder="0,00" value={c.frete ? String(c.frete).replace(".", ",") : ""} onSave={(v) => salvarCotForn(c.cf.id, { frete: parseNum(v) || 0 })} />
                        </td>
                      ))}
                    </tr>
                    <tr className="cot-foot">
                      <td colSpan={2}>Prazo de entrega</td>
                      {comp.colunas.map((c) => (
                        <td key={c.cf.id}>
                          <CampoSalvo className="cot-in-preco" align="right" placeholder="Ex: 3 dias" value={c.cf.prazo || ""} onSave={(v) => salvarCotForn(c.cf.id, { prazo: v.trim() || null })} />
                        </td>
                      ))}
                    </tr>
                    <tr className="cot-foot cot-total">
                      <td colSpan={2}>TOTAL</td>
                      {comp.colunas.map((c) => (
                        <td key={c.cf.id} className={"cot-num" + (c.completo && comp.menorTotal === c.total && comp.colunas.length > 1 ? " cot-menor" : "")}>
                          {c.completo ? money(c.total) : <span className="cot-muted">faltam {c.faltando}</span>}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
          {erro && <span className="field-error">{erro}</span>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Fechar</button>
          <button className="btn btn-primary" disabled={!podeImagem || gerando} onClick={gerarImagem}>
            {gerando ? <Loader2 size={16} className="spin" /> : <ImageDown size={16} />} Gerar imagem
          </button>
        </div>
      </Shell>

      {modalForn && <FornecedorFormModal onClose={() => setModalForn(false)} onSave={(d) => salvarFornecedor(setCot, d)} />}

      {preview && (
        <Shell title="Imagem do comparativo" onClose={() => setPreview(null)} width="1100px">
          <div className="modal-body">
            <img src={preview.url} alt="Comparativo de preços" style={{ width: "100%", height: "auto", border: "1px solid #DEE2E8" }} />
            {erro && <span className="field-error">{erro}</span>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setPreview(null)}>Voltar</button>
            {typeof navigator !== "undefined" && navigator.share && (
              <button className="btn btn-secondary" onClick={compartilhar}><Share2 size={16} /> Compartilhar</button>
            )}
            <a className="btn btn-primary" href={preview.url} download={nomeArquivo}><Download size={16} /> Baixar PNG</a>
          </div>
        </Shell>
      )}
    </>
  );
}
