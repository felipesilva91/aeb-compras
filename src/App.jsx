import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Building2, LayoutDashboard, Bell, Plus, X, Clock, AlertTriangle, Truck,
  Search, ChevronRight, Package, LogOut, FileText, MapPin, User as UserIcon,
  Loader2, RefreshCw, Check, CalendarDays, Boxes, Users, KeyRound, ArrowLeft,
  ShieldCheck, UserPlus, Menu, ImagePlus, Pencil, XCircle, RotateCcw, Trash2
} from "lucide-react";

/* ============================== STORAGE HELPERS ============================== */
// localStorage hoje; troque src/lib/storage.js por uma versao Supabase quando estiver pronta.

import { storageGet as safeGet, storageSet as safeSet } from "./lib/storage";

/* ============================== CONSTANTS ============================== */

const STATUS = ["Lançado", "Em Cotação", "Aprovado", "Comprado", "Em Rota de Entrega", "Entregue"];
const STATUS_KEY = {
  "Lançado": "lancado", "Em Cotação": "cotacao", "Aprovado": "aprovado",
  "Comprado": "comprado", "Em Rota de Entrega": "rota", "Entregue": "entregue",
};
const PRIORIDADES = ["Baixa", "Média", "Alta", "Urgente"];
const PRIORIDADE_KEY = { "Baixa": "baixa", "Média": "media", "Alta": "alta", "Urgente": "urgente" };

const DEFAULT_PASSWORD = "aeb123";
const ROLE_LABEL = { compras: "Setor de Compras", dono: "Diretoria", obra: "Equipe de Obra" };
const ROLE_ORDER = ["compras", "dono", "obra"];

const SEED_USERS = [
  { id: "felipe", nome: "Felipe", papel: "compras" },
  { id: "glyffiton", nome: "Glyffiton", papel: "compras" },
  { id: "andre", nome: "André", papel: "dono" },
  { id: "gerson", nome: "Gerson", papel: "dono" },
  { id: "luana", nome: "Luana", papel: "obra" },
  { id: "julia", nome: "Júlia", papel: "obra" },
  { id: "felipe-henrique", nome: "Felipe Henrique", papel: "obra" },
  { id: "bruno", nome: "Bruno", papel: "obra" },
  { id: "jadson", nome: "Jadson", papel: "obra" },
].map((u) => ({ ...u, senha: DEFAULT_PASSWORD, mustReset: true }));

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
const STATUS_JA_COMPRADO = ["Comprado", "Em Rota de Entrega", "Entregue"];

function isAtrasado(p) {
  if (STATUS_JA_COMPRADO.includes(p.status) || p.cancelado) return false;
  if (!p.dataNecessidade) return false;
  return p.dataNecessidade < todayISO();
}
function daysDiff(iso) {
  const d1 = new Date(iso + "T00:00:00");
  const d2 = new Date(todayISO() + "T00:00:00");
  return Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
}

function urgencyScore(p) {
  if (p._atrasado) return 0;
  if (p.prioridade === "Urgente" && p.status !== "Entregue" && !p.cancelado) return 1;
  return 2;
}
function sortByUrgency(list) {
  return list.slice().sort((a, b) => {
    const diff = urgencyScore(a) - urgencyScore(b);
    return diff !== 0 ? diff : b.createdAt - a.createdAt;
  });
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 760;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.62;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length > 550000 && quality > 0.3) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Falha ao carregar imagem"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

/* ============================== ROOT ============================== */

export default function App() {
  const [loading, setLoading] = useState(true);
  const [sessionUserId, setSessionUserId] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [obras, setObras] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const pollRef = useRef(null);

  const loadShared = useCallback(async () => {
    const [u, o, p, n] = await Promise.all([
      safeGet("usuarios", true),
      safeGet("obras", true),
      safeGet("pedidos", true),
      safeGet("notifications", true),
    ]);
    let usersList = u;
    if (!usersList || usersList.length === 0) {
      usersList = SEED_USERS;
      await safeSet("usuarios", usersList, true);
    }
    setUsuarios(usersList);
    setObras(o || []);
    setPedidos(p || []);
    setNotifications(n || []);
    return usersList;
  }, []);

  useEffect(() => {
    (async () => {
      const sid = await safeGet("sessao-usuario-id", false);
      const usersList = await loadShared();
      if (sid && usersList.some((u) => u.id === sid)) setSessionUserId(sid);
      setLoading(false);
    })();
  }, [loadShared]);

  useEffect(() => {
    pollRef.current = setInterval(() => { loadShared(); }, 20000);
    return () => clearInterval(pollRef.current);
  }, [loadShared]);

  async function persistUsuarios(next) {
    setUsuarios(next);
    await safeSet("usuarios", next, true);
  }

  async function handleLogin(userId) {
    await safeSet("sessao-usuario-id", userId, false);
    setSessionUserId(userId);
  }
  async function handleLogout() {
    await safeSet("sessao-usuario-id", "", false);
    setSessionUserId(null);
  }

  const profile = usuarios.find((u) => u.id === sessionUserId) || null;

  if (loading) {
    return (
      <div className="aeb-root">
        <div className="aeb-loading"><Loader2 className="spin" size={26} /><span>Carregando painel de compras…</span></div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="aeb-root">
        <LoginFlow usuarios={usuarios} onPersistUsuarios={persistUsuarios} onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="aeb-root">
      <Workspace
        profile={profile}
        usuarios={usuarios}
        obras={obras}
        pedidos={pedidos}
        notifications={notifications}
        setObras={setObras}
        setPedidos={setPedidos}
        setNotifications={setNotifications}
        onPersistUsuarios={persistUsuarios}
        onRefresh={loadShared}
        onLogout={handleLogout}
      />
    </div>
  );
}

/* ============================== LOGO / BRAND MARK ============================== */

function BrandBackdrop() {
  return (
    <div className="brand-backdrop" aria-hidden="true">
      <div className="backdrop-split" />
      <svg className="backdrop-ring ring-1" viewBox="0 0 60 60"><circle cx="30" cy="30" r="24" /></svg>
      <svg className="backdrop-ring ring-2" viewBox="0 0 60 60"><circle cx="30" cy="30" r="24" /></svg>
      <svg className="backdrop-ring ring-3" viewBox="0 0 60 60"><circle cx="30" cy="30" r="24" /></svg>
      <div className="backdrop-bars bars-1"><i /><i /><i /><i /></div>
      <div className="backdrop-bars bars-2"><i /><i /><i /><i /></div>
      <div className="backdrop-dots"><i /><i /><i /></div>
    </div>
  );
}

/* ============================== LOGIN FLOW ============================== */

function LoginFlow({ usuarios, onPersistUsuarios, onLogin }) {
  const [step, setStep] = useState("pick");
  const [selected, setSelected] = useState(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmaSenha, setConfirmaSenha] = useState("");
  const [resetErro, setResetErro] = useState("");

  function pickUser(u) {
    setSelected(u);
    setSenha("");
    setErro("");
    setStep("password");
  }

  function submitSenha() {
    if (!senha) return;
    if (senha !== selected.senha) {
      setErro("Senha incorreta. Tente novamente.");
      return;
    }
    if (selected.mustReset) {
      setStep("reset");
    } else {
      onLogin(selected.id);
    }
  }

  async function submitReset() {
    if (novaSenha.length < 4) { setResetErro("Use pelo menos 4 caracteres."); return; }
    if (novaSenha !== confirmaSenha) { setResetErro("As senhas não coincidem."); return; }
    const next = usuarios.map((u) => (u.id === selected.id ? { ...u, senha: novaSenha, mustReset: false } : u));
    await onPersistUsuarios(next);
    onLogin(selected.id);
  }

  const grouped = ROLE_ORDER.map((papel) => ({
    papel,
    lista: usuarios.filter((u) => u.papel === papel).sort((a, b) => a.nome.localeCompare(b.nome)),
  })).filter((g) => g.lista.length > 0);

  return (
    <div className="login-screen">
      <BrandBackdrop />
      <div className="login-card">
        <img src="/logo-full.png" alt="Alencar & Bezerra Engenharia" className="brand-logo-full" />

        {step === "pick" && (
          <>
            <h1>Quem é você?</h1>
            <p className="login-hint">Selecione seu nome para entrar no painel de compras.</p>
            {grouped.map((g) => (
              <div key={g.papel} className="user-pick-group">
                <span className="user-pick-label">{ROLE_LABEL[g.papel]}</span>
                <div className="user-pick-grid">
                  {g.lista.map((u) => (
                    <button key={u.id} className="user-pick-card" onClick={() => pickUser(u)}>
                      <span className={`user-avatar role-${u.papel}`}>{u.nome.trim().charAt(0).toUpperCase()}</span>
                      <span className="user-pick-name">{u.nome}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {step === "password" && selected && (
          <>
            <button className="back-link" onClick={() => setStep("pick")}><ArrowLeft size={14} /> Voltar</button>
            <div className="password-who">
              <span className={`user-avatar lg role-${selected.papel}`}>{selected.nome.trim().charAt(0).toUpperCase()}</span>
              <div>
                <strong>{selected.nome}</strong>
                <span>{ROLE_LABEL[selected.papel]}</span>
              </div>
            </div>
            <div className="field">
              <label>Senha</label>
              <input
                type="password" autoFocus value={senha}
                onChange={(e) => { setSenha(e.target.value); setErro(""); }}
                onKeyDown={(e) => e.key === "Enter" && submitSenha()}
                placeholder="Digite sua senha"
              />
              {erro && <span className="field-error">{erro}</span>}
            </div>
            <button className="btn btn-primary btn-block" disabled={!senha} onClick={submitSenha}>
              Entrar <ChevronRight size={16} />
            </button>
            <p className="login-footnote">Primeiro acesso? Use a senha padrão informada pelo setor de compras. Esqueceu a senha? Peça para alguém da Diretoria ou do setor de Compras redefinir em "Usuários".</p>
          </>
        )}

        {step === "reset" && selected && (
          <>
            <div className="password-who">
              <span className={`user-avatar lg role-${selected.papel}`}>{selected.nome.trim().charAt(0).toUpperCase()}</span>
              <div>
                <strong>{selected.nome}</strong>
                <span>Primeiro acesso — crie sua senha</span>
              </div>
            </div>
            <div className="field">
              <label>Nova senha</label>
              <input type="password" autoFocus value={novaSenha} onChange={(e) => { setNovaSenha(e.target.value); setResetErro(""); }} placeholder="Mínimo de 4 caracteres" />
            </div>
            <div className="field">
              <label>Confirmar senha</label>
              <input
                type="password" value={confirmaSenha}
                onChange={(e) => { setConfirmaSenha(e.target.value); setResetErro(""); }}
                onKeyDown={(e) => e.key === "Enter" && submitReset()}
                placeholder="Repita a nova senha"
              />
              {resetErro && <span className="field-error">{resetErro}</span>}
            </div>
            <button className="btn btn-primary btn-block" onClick={submitReset}>
              <Check size={16} /> Salvar e entrar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================== WORKSPACE ============================== */

function Workspace({ profile, usuarios, obras, pedidos, notifications, setObras, setPedidos, setNotifications, onPersistUsuarios, onRefresh, onLogout }) {
  const [view, setView] = useState({ type: "dashboard" });
  const [dashFilter, setDashFilter] = useState(null);
  const [modal, setModal] = useState(null);
  const [showNotif, setShowNotif] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const canManageObras = profile.papel === "compras";
  const canUpdateStatus = profile.papel === "compras" || profile.papel === "obra";
  const canCreatePedido = profile.papel === "compras" || profile.papel === "obra";
  const canManageUsers = profile.papel === "compras" || profile.papel === "dono";

  const myNotifs = useMemo(
    () => notifications.filter((n) => n.userName === profile.nome).sort((a, b) => b.timestamp - a.timestamp),
    [notifications, profile.nome]
  );
  const unreadCount = myNotifs.filter((n) => !n.read).length;
  const obraById = useCallback((id) => obras.find((o) => o.id === id), [obras]);

  async function persistObras(next) { setObras(next); setSaving(true); await safeSet("obras", next, true); setSaving(false); }
  async function persistPedidos(next) { setPedidos(next); setSaving(true); await safeSet("pedidos", next, true); setSaving(false); }
  async function persistNotifications(next) { setNotifications(next); await safeSet("notifications", next, true); }

  async function createObra({ nome, cliente, endereco, responsavelCompras, perfilCliente }) {
    const codigo = `OBRA-${String(obras.length + 1).padStart(3, "0")}`;
    const nova = { id: uid(), codigo, nome, cliente, endereco, responsavelCompras: responsavelCompras || null, perfilCliente: perfilCliente || null, createdAt: Date.now() };
    await persistObras([...obras, nova]);
    setModal(null);
    setView({ type: "obra", id: nova.id });
  }

  async function createPedido({ obraId, titulo, material, dataNecessidade, prioridade, fotoUrl }) {
    const codigo = `#${String(pedidos.length + 1).padStart(4, "0")}`;
    const novo = {
      id: uid(), codigo, obraId, titulo, material, fotoUrl: fotoUrl || null,
      dataLancamento: todayISO(), dataNecessidade, prioridade, status: "Lançado",
      lancadoPor: profile.nome, createdAt: Date.now(),
      historico: [{ status: "Lançado", em: Date.now(), por: profile.nome }],
      comentarios: [],
    };
    await persistPedidos([...pedidos, novo]);
    setModal(null);
  }

  async function updateStatus(pedidoId, novoStatus) {
    const pedido = pedidos.find((p) => p.id === pedidoId);
    if (!pedido || pedido.status === novoStatus) return;
    const next = pedidos.map((p) =>
      p.id === pedidoId
        ? { ...p, status: novoStatus, historico: [...(p.historico || []), { status: novoStatus, em: Date.now(), por: profile.nome }] }
        : p
    );
    await persistPedidos(next);
    const obraDoPedido = obraById(pedido.obraId);
    const notif = {
      id: uid(), userName: pedido.lancadoPor, pedidoId, obraId: pedido.obraId,
      message: `${pedido.titulo} — obra ${obraDoPedido?.nome || "—"}: ${novoStatus}`,
      timestamp: Date.now(), read: false,
    };
    await persistNotifications([...notifications, notif]);
  }

  async function markAllRead() {
    const next = notifications.map((n) => (n.userName === profile.nome ? { ...n, read: true } : n));
    await persistNotifications(next);
  }

  async function resetUserPassword(userId) {
    const next = usuarios.map((u) => (u.id === userId ? { ...u, senha: DEFAULT_PASSWORD, mustReset: true } : u));
    await onPersistUsuarios(next);
  }
  async function addUser({ nome, papel }) {
    const novo = { id: uid(), nome, papel, senha: DEFAULT_PASSWORD, mustReset: true };
    await onPersistUsuarios([...usuarios, novo]);
  }

  async function changeOwnPassword(senhaAtual, novaSenha) {
    if (senhaAtual !== profile.senha) return { ok: false, erro: "Senha atual incorreta." };
    const next = usuarios.map((u) => (u.id === profile.id ? { ...u, senha: novaSenha, mustReset: false } : u));
    await onPersistUsuarios(next);
    return { ok: true };
  }

  async function updateObra(obraId, { nome, cliente, endereco, responsavelCompras, perfilCliente }) {
    const next = obras.map((o) => (o.id === obraId ? { ...o, nome, cliente, endereco, responsavelCompras: responsavelCompras || null, perfilCliente: perfilCliente || null } : o));
    await persistObras(next);
    setModal(null);
  }

  async function updatePedido(pedidoId, { titulo, material, dataNecessidade, prioridade, fotoUrl }) {
    const next = pedidos.map((p) =>
      p.id === pedidoId
        ? {
            ...p, titulo, material, dataNecessidade, prioridade, fotoUrl: fotoUrl ?? p.fotoUrl,
            historico: [...(p.historico || []), { status: "Dados do pedido atualizados", em: Date.now(), por: profile.nome }],
          }
        : p
    );
    await persistPedidos(next);
    setModal(null);
  }

  async function setPedidoCancelado(pedidoId, cancelado) {
    const next = pedidos.map((p) =>
      p.id === pedidoId
        ? {
            ...p, cancelado,
            historico: [...(p.historico || []), { status: cancelado ? "Pedido cancelado" : "Pedido reaberto", em: Date.now(), por: profile.nome }],
          }
        : p
    );
    await persistPedidos(next);
  }

  async function deletePedido(pedidoId) {
    await persistPedidos(pedidos.filter((p) => p.id !== pedidoId));
    await persistNotifications(notifications.filter((n) => n.pedidoId !== pedidoId));
    setModal(null);
  }

  async function addComentario(pedidoId, texto) {
    const pedido = pedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;
    const comentario = { id: uid(), texto, por: profile.nome, em: Date.now() };
    const next = pedidos.map((p) => (p.id === pedidoId ? { ...p, comentarios: [...(p.comentarios || []), comentario] } : p));
    await persistPedidos(next);

    const obraDoPedido = obraById(pedido.obraId);
    const destinatarios = new Set();
    if (pedido.lancadoPor !== profile.nome) destinatarios.add(pedido.lancadoPor);
    if (obraDoPedido?.responsavelCompras && obraDoPedido.responsavelCompras !== profile.nome) destinatarios.add(obraDoPedido.responsavelCompras);

    if (destinatarios.size > 0) {
      const novasNotifs = [...destinatarios].map((userName) => ({
        id: uid(), userName, pedidoId, obraId: pedido.obraId,
        message: `${profile.nome} comentou em "${pedido.titulo}" — obra ${obraDoPedido?.nome || "—"}`,
        timestamp: Date.now(), read: false,
      }));
      await persistNotifications([...notifications, ...novasNotifs]);
    }
  }

  const withComputed = (list) => list.map((p) => ({ ...p, _atrasado: isAtrasado(p) }));

  const dashboardPedidos = useMemo(() => {
    let list = withComputed(pedidos);
    if (dashFilter === "atrasadas") list = list.filter((p) => p._atrasado);
    if (dashFilter === "urgentes") list = list.filter((p) => p.prioridade === "Urgente" && p.status !== "Entregue" && !p.cancelado);
    if (dashFilter === "cotacao") list = list.filter((p) => p.status === "Em Cotação" && !p.cancelado);
    if (dashFilter === "rota") list = list.filter((p) => p.status === "Em Rota de Entrega" && !p.cancelado);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((p) => p.titulo.toLowerCase().includes(s) || p.material.toLowerCase().includes(s) || p.codigo.toLowerCase().includes(s));
    }
    return sortByUrgency(list);
  }, [pedidos, dashFilter, search]);

  const kpis = useMemo(() => {
    const comp = withComputed(pedidos);
    return {
      atrasadas: comp.filter((p) => p._atrasado).length,
      urgentes: comp.filter((p) => p.prioridade === "Urgente" && p.status !== "Entregue" && !p.cancelado).length,
      cotacao: comp.filter((p) => p.status === "Em Cotação" && !p.cancelado).length,
      rota: comp.filter((p) => p.status === "Em Rota de Entrega" && !p.cancelado).length,
    };
  }, [pedidos]);

  const pedidosCountByObra = useMemo(() => {
    const map = {};
    pedidos
      .filter((p) => !p.cancelado && !STATUS_JA_COMPRADO.includes(p.status))
      .forEach((p) => { map[p.obraId] = (map[p.obraId] || 0) + 1; });
    return map;
  }, [pedidos]);

  return (
    <div className="app-shell">
      <MobileTopBar onOpenMenu={() => setMobileNavOpen(true)} />
      {mobileNavOpen && <div className="sidebar-backdrop show" onClick={() => setMobileNavOpen(false)} />}
      <Sidebar
        profile={profile} obras={obras} view={view}
        setView={(v) => { setView(v); setDashFilter(null); setMobileNavOpen(false); }}
        canManageObras={canManageObras} canManageUsers={canManageUsers}
        onNovaObra={() => { setModal({ type: "novaObra" }); setMobileNavOpen(false); }}
        onLogout={onLogout}
        onTrocarSenha={() => { setModal({ type: "trocarSenha" }); setMobileNavOpen(false); }}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        pedidosCountByObra={pedidosCountByObra}
      />

      <main className="main">
        <TopBar
          title={view.type === "dashboard" ? "Painel Geral" : view.type === "usuarios" ? "Usuários" : obraById(view.id)?.nome || "Obra"}
          subtitle={view.type === "dashboard" ? "Visão consolidada de todas as obras" : view.type === "usuarios" ? "Contas de acesso da equipe" : obraById(view.id)?.codigo}
          search={search} setSearch={setSearch} saving={saving} unreadCount={unreadCount}
          showNotif={showNotif} setShowNotif={setShowNotif} myNotifs={myNotifs} onMarkAllRead={markAllRead}
          onRefresh={onRefresh}
          showSearch={view.type !== "usuarios"}
          onNovoPedido={canCreatePedido && view.type !== "usuarios" ? () => setModal({ type: "novoPedido", obraId: view.type === "obra" ? view.id : null }) : null}
        />

        <div className="content">
          {view.type === "dashboard" && (
            <Dashboard
              kpis={kpis} dashFilter={dashFilter} setDashFilter={setDashFilter}
              pedidos={dashboardPedidos} obraById={obraById}
              onOpenPedido={(id) => setModal({ type: "pedidoDetail", id })}
              obras={obras} onNovaObra={() => setModal({ type: "novaObra" })} canManageObras={canManageObras}
            />
          )}
          {view.type === "obra" && (
            <ObraPage
              obra={obraById(view.id)}
              pedidos={sortByUrgency(withComputed(pedidos.filter((p) => p.obraId === view.id)))}
              onOpenPedido={(id) => setModal({ type: "pedidoDetail", id })}
              onNovoPedido={canCreatePedido ? () => setModal({ type: "novoPedido", obraId: view.id }) : null}
              onEditarObra={canManageObras ? () => setModal({ type: "editarObra", obraId: view.id }) : null}
            />
          )}
          {view.type === "usuarios" && canManageUsers && (
            <UsersPanel usuarios={usuarios} currentUserId={profile.id} onReset={resetUserPassword} onAddUser={addUser} />
          )}
        </div>
      </main>

      {modal?.type === "novaObra" && <NovaObraModal usuarios={usuarios} onClose={() => setModal(null)} onCreate={createObra} />}
      {modal?.type === "editarObra" && (
        <EditarObraModal obra={obraById(modal.obraId)} usuarios={usuarios} onClose={() => setModal(null)} onSave={(dados) => updateObra(modal.obraId, dados)} />
      )}
      {modal?.type === "trocarSenha" && (
        <TrocarSenhaModal onClose={() => setModal(null)} onSave={changeOwnPassword} />
      )}
      {modal?.type === "novoPedido" && (
        <NovoPedidoModal obras={obras} defaultObraId={modal.obraId} profile={profile} onClose={() => setModal(null)} onCreate={createPedido} />
      )}
      {modal?.type === "editarPedido" && (
        <EditarPedidoModal pedido={pedidos.find((p) => p.id === modal.id)} onClose={() => setModal(null)} onSave={(dados) => updatePedido(modal.id, dados)} />
      )}
      {modal?.type === "pedidoDetail" && (
        <PedidoDetailModal
          pedido={pedidos.find((p) => p.id === modal.id)}
          obra={obraById(pedidos.find((p) => p.id === modal.id)?.obraId)}
          canUpdateStatus={canUpdateStatus}
          canEditar={(() => {
            const p = pedidos.find((x) => x.id === modal.id);
            return !!p && (p.lancadoPor === profile.nome || canManageObras);
          })()}
          canExcluir={canManageObras}
          onClose={() => setModal(null)}
          onUpdateStatus={(s) => updateStatus(modal.id, s)}
          onEditar={() => setModal({ type: "editarPedido", id: modal.id })}
          onCancelar={() => setPedidoCancelado(modal.id, true)}
          onReabrir={() => setPedidoCancelado(modal.id, false)}
          onExcluir={() => deletePedido(modal.id)}
          onAddComentario={(texto) => addComentario(modal.id, texto)}
        />
      )}
    </div>
  );
}

/* ============================== SIDEBAR ============================== */

function MobileTopBar({ onOpenMenu }) {
  return (
    <div className="mobile-topbar">
      <button className="mobile-menu-btn" onClick={onOpenMenu} title="Abrir menu"><Menu size={20} /></button>
      <img src="/logo-mark.png" alt="Alencar & Bezerra Engenharia" className="brand-mark-img brand-mark-sm" />
      <span className="mobile-topbar-text">Núcleo de Compras</span>
    </div>
  );
}

function Sidebar({ profile, obras, view, setView, canManageObras, canManageUsers, onNovaObra, onLogout, onTrocarSenha, mobileOpen, onCloseMobile, pedidosCountByObra }) {
  return (
    <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
      <div className="sidebar-logo">
        <img src="/logo-mark.png" alt="Alencar & Bezerra Engenharia" className="brand-mark-img brand-mark-sm" />
        <div className="sidebar-logo-text"><strong>Alencar &amp; Bezerra</strong><span>Núcleo de Compras</span></div>
        <button className="sidebar-close-btn" onClick={onCloseMobile} title="Fechar menu"><X size={18} /></button>
      </div>

      <nav className="sidebar-nav">
        <button className={"nav-item" + (view.type === "dashboard" ? " active" : "")} onClick={() => setView({ type: "dashboard" })}>
          <LayoutDashboard size={17} /> Painel Geral
        </button>
        {canManageUsers && (
          <button className={"nav-item" + (view.type === "usuarios" ? " active" : "")} onClick={() => setView({ type: "usuarios" })}>
            <Users size={17} /> Usuários
          </button>
        )}

        <div className="nav-section-label">
          <span>Obras</span>
          {canManageObras && <button className="nav-add-btn" title="Nova obra" onClick={onNovaObra}><Plus size={14} /></button>}
        </div>

        <div className="sidebar-obras-list">
          {obras.length === 0 && <p className="sidebar-empty">Nenhuma obra cadastrada ainda.</p>}
          {obras.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map((o) => {
            const qtd = pedidosCountByObra?.[o.id] || 0;
            return (
              <button key={o.id} className={"obra-nav-item" + (view.type === "obra" && view.id === o.id ? " active" : "")} onClick={() => setView({ type: "obra", id: o.id })}>
                <Building2 size={15} /><span className="obra-nav-name">{o.nome}</span>
                {qtd > 0 && <span className="obra-count-badge">{qtd}</span>}
                <ChevronRight size={14} className="chev" />
              </button>
            );
          })}
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="user-chip">
          <div className={"user-avatar role-" + profile.papel}>{profile.nome.trim().charAt(0).toUpperCase()}</div>
          <div className="user-chip-text"><strong>{profile.nome}</strong><span>{ROLE_LABEL[profile.papel]}</span></div>
        </div>
        <div className="sidebar-footer-actions">
          <button className="icon-btn" title="Trocar minha senha" onClick={onTrocarSenha}><KeyRound size={16} /></button>
          <button className="icon-btn" title="Sair" onClick={onLogout}><LogOut size={16} /></button>
        </div>
      </div>
    </aside>
  );
}

/* ============================== TOP BAR ============================== */

function TopBar({ title, subtitle, search, setSearch, saving, unreadCount, showNotif, setShowNotif, myNotifs, onMarkAllRead, onRefresh, onNovoPedido, showSearch }) {
  return (
    <header className="topbar">
      <div className="topbar-title"><h1>{title}</h1>{subtitle && <span className="topbar-subtitle">{subtitle}</span>}</div>
      <div className="topbar-actions">
        {showSearch && (
          <div className="search-box">
            <Search size={15} />
            <input placeholder="Buscar por título, material ou nº do pedido" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {saving && <span className="saving-pill"><Loader2 size={13} className="spin" /> salvando…</span>}
        <button className="icon-btn" title="Atualizar" onClick={onRefresh}><RefreshCw size={16} /></button>
        <div className="notif-wrap">
          <button className="icon-btn" title="Notificações" onClick={() => setShowNotif((v) => !v)}>
            <Bell size={16} />
            {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
          </button>
          {showNotif && (
            <>
              <div className="notif-backdrop" onClick={() => setShowNotif(false)} />
              <div className="notif-dropdown">
                <div className="notif-dropdown-head">
                  <strong>Notificações</strong>
                  {unreadCount > 0 && <button className="link-btn" onClick={onMarkAllRead}>Marcar todas como lidas</button>}
                  <button className="notif-close-btn" onClick={() => setShowNotif(false)}><X size={16} /></button>
                </div>
                <div className="notif-list">
                  {myNotifs.length === 0 && <div className="notif-empty"><Bell size={20} /><span>Nenhuma notificação por aqui ainda.</span></div>}
                  {myNotifs.slice(0, 25).map((n) => (
                    <div key={n.id} className={"notif-item" + (n.read ? "" : " unread")}>
                      <div className="notif-dot" />
                      <div><p>{n.message}</p><span>{new Date(n.timestamp).toLocaleString("pt-BR")}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        {onNovoPedido && <button className="btn btn-primary" onClick={onNovoPedido}><Plus size={16} /> Novo Pedido</button>}
      </div>
    </header>
  );
}

/* ============================== DASHBOARD ============================== */

function Dashboard({ kpis, dashFilter, setDashFilter, pedidos, obraById, onOpenPedido, obras, onNovaObra, canManageObras }) {
  return (
    <>
      <div className="kpi-grid">
        <KpiCard icon={<AlertTriangle size={18} />} label="Compras Atrasadas" value={kpis.atrasadas} tone="red" active={dashFilter === "atrasadas"} onClick={() => setDashFilter(dashFilter === "atrasadas" ? null : "atrasadas")} />
        <KpiCard icon={<Boxes size={18} />} label="Urgentes" value={kpis.urgentes} tone="amber" active={dashFilter === "urgentes"} onClick={() => setDashFilter(dashFilter === "urgentes" ? null : "urgentes")} />
        <KpiCard icon={<Search size={18} />} label="Em Cotação" value={kpis.cotacao} tone="blue" active={dashFilter === "cotacao"} onClick={() => setDashFilter(dashFilter === "cotacao" ? null : "cotacao")} />
        <KpiCard icon={<Truck size={18} />} label="Rota de Entrega" value={kpis.rota} tone="green" active={dashFilter === "rota"} onClick={() => setDashFilter(dashFilter === "rota" ? null : "rota")} />
      </div>

      {obras.length === 0 ? (
        <EmptyState icon={<Building2 size={26} />} title="Nenhuma obra cadastrada" text={canManageObras ? "Cadastre a primeira obra para começar a receber pedidos." : "Peça ao setor de compras para cadastrar a obra antes de lançar pedidos."} action={canManageObras && <button className="btn btn-primary" onClick={onNovaObra}><Plus size={16} /> Nova Obra</button>} />
      ) : pedidos.length === 0 ? (
        <EmptyState icon={<Package size={26} />} title="Nenhum pedido encontrado" text="Ajuste os filtros ou lance um novo pedido de compra." />
      ) : (
        <div className="tickets-grid">
          {pedidos.map((p) => <TicketCard key={p.id} pedido={p} obra={obraById(p.obraId)} onClick={() => onOpenPedido(p.id)} showObra />)}
        </div>
      )}
    </>
  );
}

function KpiCard({ icon, label, value, tone, active, onClick }) {
  return (
    <button className={`kpi-card tone-${tone}` + (active ? " active" : "")} onClick={onClick}>
      <div className={`kpi-icon tone-${tone}`}>{icon}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </button>
  );
}

/* ============================== OBRA PAGE ============================== */

function ObraPage({ obra, pedidos, onOpenPedido, onNovoPedido, onEditarObra }) {
  if (!obra) return <EmptyState icon={<Building2 size={26} />} title="Obra não encontrada" text="Selecione uma obra no menu lateral." />;
  const total = pedidos.length;
  const atrasados = pedidos.filter((p) => p._atrasado).length;
  const andamento = pedidos.filter((p) => p.status !== "Entregue" && !p.cancelado).length;
  const entregues = pedidos.filter((p) => p.status === "Entregue").length;

  return (
    <>
      <div className="obra-header-card">
        <div className="obra-header-top">
          <div>
            <span className="obra-header-code">{obra.codigo}</span>
            <h2 className="obra-header-title">
              {obra.nome}
              {onEditarObra && (
                <button className="obra-edit-btn" title="Editar obra" onClick={onEditarObra}><Pencil size={14} /></button>
              )}
            </h2>
            <div className="obra-header-meta">
              {obra.cliente && <span><UserIcon size={14} /> {obra.cliente}</span>}
              {obra.endereco && <span><MapPin size={14} /> {obra.endereco}</span>}
              {obra.responsavelCompras && <span className="obra-responsavel-tag"><ShieldCheck size={14} /> Responsável: {obra.responsavelCompras}</span>}
            </div>
          </div>
          {onNovoPedido && <button className="btn btn-primary" onClick={onNovoPedido}><Plus size={16} /> Novo Pedido</button>}
        </div>
        <div className="obra-stats-row">
          <div className="obra-stat"><strong>{total}</strong><span>Pedidos no total</span></div>
          <div className="obra-stat"><strong>{andamento}</strong><span>Em andamento</span></div>
          <div className="obra-stat tone-red"><strong>{atrasados}</strong><span>Atrasados</span></div>
          <div className="obra-stat tone-green"><strong>{entregues}</strong><span>Entregues</span></div>
        </div>
        {obra.perfilCliente && (
          <div className="obra-perfil-cliente">
            <span className="detail-label"><ShieldCheck size={12} /> Perfil do cliente</span>
            <p>{obra.perfilCliente}</p>
          </div>
        )}
      </div>

      {pedidos.length === 0 ? (
        <EmptyState icon={<Package size={26} />} title="Nenhum pedido lançado nesta obra" text="Assim que o material começar a faltar, lance o pedido por aqui." action={onNovoPedido && <button className="btn btn-primary" onClick={onNovoPedido}><Plus size={16} /> Lançar primeiro pedido</button>} />
      ) : (
        <div className="tickets-grid">
          {pedidos.map((p) => <TicketCard key={p.id} pedido={p} onClick={() => onOpenPedido(p.id)} />)}
        </div>
      )}
    </>
  );
}

/* ============================== TICKET CARD ============================== */

function TicketCard({ pedido, obra, onClick, showObra }) {
  const sKey = STATUS_KEY[pedido.status];
  const pKey = PRIORIDADE_KEY[pedido.prioridade];
  const dd = daysDiff(pedido.dataNecessidade);
  return (
    <button className={"ticket" + (pedido._atrasado ? " is-late" : "") + (pedido.cancelado ? " is-cancelled" : "")} onClick={onClick}>
      <div className="ticket-perf" />
      <div className="ticket-body">
        <div className="ticket-top">
          <span className="ticket-code">{pedido.codigo}</span>
          <span className={`stamp stamp-${pKey}`}>{pedido.prioridade}</span>
        </div>
        {showObra && obra && <span className="ticket-obra-tag"><Building2 size={12} /> {obra.nome}</span>}
        <div className="ticket-main-row">
          {pedido.fotoUrl && <img className="ticket-thumb" src={pedido.fotoUrl} alt="" />}
          <div className="ticket-text">
            <h4 className="ticket-title">{pedido.titulo}</h4>
            <p className="ticket-material">{pedido.material}</p>
          </div>
        </div>
        <div className="ticket-meta">
          <span><Clock size={13} /> Lançado {formatDate(pedido.dataLancamento)}</span>
          <span>
            <CalendarDays size={13} /> Necessário {formatDate(pedido.dataNecessidade)}
            {pedido.status !== "Entregue" && !pedido.cancelado && <em className={dd < 0 ? "neg" : dd <= 2 ? "warn" : ""}> ({dd === 0 ? "hoje" : dd > 0 ? `em ${dd}d` : `${Math.abs(dd)}d atraso`})</em>}
          </span>
        </div>
        <div className="ticket-footer">
          <span className="ticket-user"><UserIcon size={13} /> {pedido.lancadoPor}</span>
          {pedido.cancelado ? <span className="status-pill status-cancelado">Cancelado</span> : <span className={`status-pill status-${sKey}`}>{pedido.status}</span>}
        </div>
        {pedido._atrasado && !pedido.cancelado && <div className="atraso-flag">ATRASADO</div>}
      </div>
    </button>
  );
}

function EmptyState({ icon, title, text, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

/* ============================== USERS PANEL ============================== */

function UsersPanel({ usuarios, currentUserId, onReset, onAddUser }) {
  const [confirmId, setConfirmId] = useState(null);
  const [doneMsg, setDoneMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoPapel, setNovoPapel] = useState("obra");

  function handleReset(u) {
    onReset(u.id);
    setConfirmId(null);
    setDoneMsg(`Senha de ${u.nome} redefinida para "${DEFAULT_PASSWORD}". Peça para a pessoa entrar e criar uma senha nova.`);
    setTimeout(() => setDoneMsg(""), 6000);
  }

  return (
    <div className="users-panel">
      <div className="users-panel-head">
        <p className="users-panel-hint"><ShieldCheck size={15} /> Cada pessoa tem seu próprio login. Só quem esqueceu a senha precisa de um reset — no próximo acesso ela cria uma senha nova.</p>
        <button className="btn btn-secondary" onClick={() => setShowAdd((v) => !v)}><UserPlus size={16} /> Adicionar membro</button>
      </div>

      {doneMsg && <div className="users-toast">{doneMsg}</div>}

      {showAdd && (
        <div className="add-user-row">
          <input placeholder="Nome da pessoa" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
          <select value={novoPapel} onChange={(e) => setNovoPapel(e.target.value)}>
            <option value="obra">Equipe de obra</option>
            <option value="compras">Setor de compras</option>
            <option value="dono">Diretoria</option>
          </select>
          <button className="btn btn-primary" disabled={!novoNome.trim()} onClick={() => { onAddUser({ nome: novoNome.trim(), papel: novoPapel }); setNovoNome(""); setShowAdd(false); }}>
            <Check size={15} /> Criar
          </button>
        </div>
      )}

      {ROLE_ORDER.map((papel) => {
        const lista = usuarios.filter((u) => u.papel === papel).sort((a, b) => a.nome.localeCompare(b.nome));
        if (lista.length === 0) return null;
        return (
          <div key={papel} className="users-group">
            <span className="users-group-label">{ROLE_LABEL[papel]}</span>
            <div className="users-list">
              {lista.map((u) => (
                <div key={u.id} className="user-row">
                  <span className={"user-avatar role-" + u.papel}>{u.nome.trim().charAt(0).toUpperCase()}</span>
                  <div className="user-row-info">
                    <strong>{u.nome}{u.id === currentUserId && <em> (você)</em>}</strong>
                    <span>{u.mustReset ? "Aguardando primeiro acesso" : "Acesso ativo"}</span>
                  </div>
                  {confirmId === u.id ? (
                    <div className="confirm-inline">
                      <span>Redefinir senha?</span>
                      <button className="btn btn-secondary sm" onClick={() => setConfirmId(null)}>Não</button>
                      <button className="btn btn-primary sm" onClick={() => handleReset(u)}>Sim</button>
                    </div>
                  ) : (
                    <button className="btn btn-secondary sm" onClick={() => setConfirmId(u.id)}><KeyRound size={13} /> Resetar senha</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================== MODAL SHELL ============================== */

function ModalShell({ title, subtitle, onClose, children, width }) {
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

/* ============================== NOVA OBRA MODAL ============================== */

function NovaObraModal({ usuarios, onClose, onCreate }) {
  const [nome, setNome] = useState("");
  const [cliente, setCliente] = useState("");
  const [endereco, setEndereco] = useState("");
  const [responsavelCompras, setResponsavelCompras] = useState("");
  const [perfilCliente, setPerfilCliente] = useState("");
  const equipeCompras = usuarios.filter((u) => u.papel === "compras");
  return (
    <ModalShell title="Nova Obra" subtitle="Cadastre uma obra para começar a receber pedidos" onClose={onClose}>
      <div className="modal-body">
        <div className="field"><label>Nome da obra</label><input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Residencial Alto da Serra" /></div>
        <div className="field"><label>Cliente</label><input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Ex: Paulo e Vanessa" /></div>
        <div className="field"><label>Endereço / local</label><input value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Ex: Crato - CE" /></div>
        <div className="field">
          <label>Responsável (compras)</label>
          <select value={responsavelCompras} onChange={(e) => setResponsavelCompras(e.target.value)}>
            <option value="">Sem responsável definido</option>
            {equipeCompras.map((u) => <option key={u.id} value={u.nome}>{u.nome}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Perfil do cliente (opcional)</label>
          <textarea rows={3} value={perfilCliente} onChange={(e) => setPerfilCliente(e.target.value)} placeholder="Ex: Cliente exigente com prazos, prefere contato por WhatsApp, já pediu prioridade em entregas antes..." />
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!nome.trim()} onClick={() => onCreate({ nome: nome.trim(), cliente: cliente.trim(), endereco: endereco.trim(), responsavelCompras, perfilCliente: perfilCliente.trim() })}><Check size={16} /> Criar Obra</button>
      </div>
    </ModalShell>
  );
}

/* ============================== EDITAR OBRA MODAL ============================== */

function EditarObraModal({ obra, usuarios, onClose, onSave }) {
  const [nome, setNome] = useState(obra?.nome || "");
  const [cliente, setCliente] = useState(obra?.cliente || "");
  const [endereco, setEndereco] = useState(obra?.endereco || "");
  const [responsavelCompras, setResponsavelCompras] = useState(obra?.responsavelCompras || "");
  const [perfilCliente, setPerfilCliente] = useState(obra?.perfilCliente || "");
  const equipeCompras = usuarios.filter((u) => u.papel === "compras");
  if (!obra) return null;
  return (
    <ModalShell title="Editar Obra" subtitle={obra.codigo} onClose={onClose}>
      <div className="modal-body">
        <div className="field"><label>Nome da obra</label><input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} /></div>
        <div className="field"><label>Cliente</label><input value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
        <div className="field"><label>Endereço / local</label><input value={endereco} onChange={(e) => setEndereco(e.target.value)} /></div>
        <div className="field">
          <label>Responsável (compras)</label>
          <select value={responsavelCompras} onChange={(e) => setResponsavelCompras(e.target.value)}>
            <option value="">Sem responsável definido</option>
            {equipeCompras.map((u) => <option key={u.id} value={u.nome}>{u.nome}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Perfil do cliente (opcional)</label>
          <textarea rows={3} value={perfilCliente} onChange={(e) => setPerfilCliente(e.target.value)} placeholder="Ex: Cliente exigente com prazos, prefere contato por WhatsApp, já pediu prioridade em entregas antes..." />
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!nome.trim()} onClick={() => onSave({ nome: nome.trim(), cliente: cliente.trim(), endereco: endereco.trim(), responsavelCompras, perfilCliente: perfilCliente.trim() })}><Check size={16} /> Salvar alterações</button>
      </div>
    </ModalShell>
  );
}

/* ============================== NOVO PEDIDO MODAL ============================== */

function NovoPedidoModal({ obras, defaultObraId, profile, onClose, onCreate }) {
  const [obraId, setObraId] = useState(defaultObraId || (obras[0]?.id ?? ""));
  const [titulo, setTitulo] = useState("");
  const [material, setMaterial] = useState("");
  const [dataNecessidade, setDataNecessidade] = useState(todayISO());
  const [prioridade, setPrioridade] = useState("Média");
  const [foto, setFoto] = useState(null);
  const [fotoErro, setFotoErro] = useState("");
  const [fotoLoading, setFotoLoading] = useState(false);
  const fileInputRef = useRef(null);
  const canSave = obraId && titulo.trim() && material.trim() && dataNecessidade;

  async function handleFotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setFotoErro("Selecione um arquivo de imagem."); return; }
    setFotoLoading(true);
    setFotoErro("");
    try {
      const compressed = await compressImage(file);
      setFoto(compressed);
    } catch (err) {
      setFotoErro("Não foi possível carregar essa imagem. Tente outra foto.");
    }
    setFotoLoading(false);
    e.target.value = "";
  }

  return (
    <ModalShell title="Novo Pedido de Compra" subtitle="Registre o material que está faltando na obra" onClose={onClose}>
      <div className="modal-body">
        {!defaultObraId && (
          <div className="field">
            <label>Obra</label>
            <select value={obraId} onChange={(e) => setObraId(e.target.value)}>
              <option value="" disabled>Selecione a obra</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </div>
        )}
        <div className="field"><label>Título do pedido</label><input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Cimento para laje" /></div>
        <div className="field"><label>Material</label><textarea rows={2} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex: 40 sacos de cimento CP-II, 50kg" /></div>
        <div className="field-row">
          <div className="field"><label>Data de lançamento</label><input className="readonly-field" value={formatDate(todayISO())} disabled /></div>
          <div className="field"><label>Necessário até</label><input type="date" value={dataNecessidade} onChange={(e) => setDataNecessidade(e.target.value)} /></div>
        </div>
        <div className="field">
          <label>Prioridade</label>
          <div className="priority-select">
            {PRIORIDADES.map((p) => (
              <button type="button" key={p} className={`priority-chip priority-${PRIORIDADE_KEY[p]}` + (prioridade === p ? " active" : "")} onClick={() => setPrioridade(p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Foto de referência (opcional)</label>
          {foto ? (
            <div className="photo-preview">
              <img src={foto} alt="Referência do material" />
              <button type="button" className="photo-remove" onClick={() => setFoto(null)} title="Remover foto"><X size={14} /></button>
            </div>
          ) : (
            <button type="button" className="photo-upload-btn" onClick={() => fileInputRef.current?.click()} disabled={fotoLoading}>
              {fotoLoading ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}
              {fotoLoading ? "Carregando foto…" : "Adicionar foto do produto"}
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFotoChange} />
          {fotoErro && <span className="field-error">{fotoErro}</span>}
        </div>
        <div className="field"><label>Lançado por</label><input className="readonly-field" value={profile.nome} disabled /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!canSave} onClick={() => onCreate({ obraId, titulo: titulo.trim(), material: material.trim(), dataNecessidade, prioridade, fotoUrl: foto })}><Check size={16} /> Lançar Pedido</button>
      </div>
    </ModalShell>
  );
}

/* ============================== EDITAR PEDIDO MODAL ============================== */

function EditarPedidoModal({ pedido, onClose, onSave }) {
  const [titulo, setTitulo] = useState(pedido?.titulo || "");
  const [material, setMaterial] = useState(pedido?.material || "");
  const [dataNecessidade, setDataNecessidade] = useState(pedido?.dataNecessidade || todayISO());
  const [prioridade, setPrioridade] = useState(pedido?.prioridade || "Média");
  const [foto, setFoto] = useState(pedido?.fotoUrl || null);
  const [fotoErro, setFotoErro] = useState("");
  const [fotoLoading, setFotoLoading] = useState(false);
  const fileInputRef = useRef(null);
  if (!pedido) return null;
  const canSave = titulo.trim() && material.trim() && dataNecessidade;

  async function handleFotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setFotoErro("Selecione um arquivo de imagem."); return; }
    setFotoLoading(true);
    setFotoErro("");
    try {
      const compressed = await compressImage(file);
      setFoto(compressed);
    } catch (err) {
      setFotoErro("Não foi possível carregar essa imagem. Tente outra foto.");
    }
    setFotoLoading(false);
    e.target.value = "";
  }

  return (
    <ModalShell title="Editar Pedido" subtitle={pedido.codigo} onClose={onClose}>
      <div className="modal-body">
        <div className="field"><label>Título do pedido</label><input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
        <div className="field"><label>Material</label><textarea rows={2} value={material} onChange={(e) => setMaterial(e.target.value)} /></div>
        <div className="field-row">
          <div className="field"><label>Data de lançamento</label><input className="readonly-field" value={formatDate(pedido.dataLancamento)} disabled /></div>
          <div className="field"><label>Necessário até</label><input type="date" value={dataNecessidade} onChange={(e) => setDataNecessidade(e.target.value)} /></div>
        </div>
        <div className="field">
          <label>Prioridade</label>
          <div className="priority-select">
            {PRIORIDADES.map((p) => (
              <button type="button" key={p} className={`priority-chip priority-${PRIORIDADE_KEY[p]}` + (prioridade === p ? " active" : "")} onClick={() => setPrioridade(p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Foto de referência (opcional)</label>
          {foto ? (
            <div className="photo-preview">
              <img src={foto} alt="Referência do material" />
              <button type="button" className="photo-remove" onClick={() => setFoto(null)} title="Remover foto"><X size={14} /></button>
            </div>
          ) : (
            <button type="button" className="photo-upload-btn" onClick={() => fileInputRef.current?.click()} disabled={fotoLoading}>
              {fotoLoading ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}
              {fotoLoading ? "Carregando foto…" : "Adicionar foto do produto"}
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFotoChange} />
          {fotoErro && <span className="field-error">{fotoErro}</span>}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!canSave} onClick={() => onSave({ titulo: titulo.trim(), material: material.trim(), dataNecessidade, prioridade, fotoUrl: foto })}><Check size={16} /> Salvar alterações</button>
      </div>
    </ModalShell>
  );
}

/* ============================== TROCAR SENHA MODAL ============================== */

function TrocarSenhaModal({ onClose, onSave }) {
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmaSenha, setConfirmaSenha] = useState("");
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  async function handleSalvar() {
    if (novaSenha.length < 4) { setErro("Use pelo menos 4 caracteres."); return; }
    if (novaSenha !== confirmaSenha) { setErro("As senhas novas não coincidem."); return; }
    const res = await onSave(senhaAtual, novaSenha);
    if (!res.ok) { setErro(res.erro); return; }
    setSucesso(true);
    setTimeout(onClose, 1200);
  }

  return (
    <ModalShell title="Trocar minha senha" onClose={onClose}>
      <div className="modal-body">
        {sucesso ? (
          <div className="users-toast">Senha atualizada com sucesso!</div>
        ) : (
          <>
            <div className="field"><label>Senha atual</label><input autoFocus type="password" value={senhaAtual} onChange={(e) => { setSenhaAtual(e.target.value); setErro(""); }} /></div>
            <div className="field"><label>Nova senha</label><input type="password" value={novaSenha} onChange={(e) => { setNovaSenha(e.target.value); setErro(""); }} placeholder="Mínimo de 4 caracteres" /></div>
            <div className="field">
              <label>Confirmar nova senha</label>
              <input type="password" value={confirmaSenha} onChange={(e) => { setConfirmaSenha(e.target.value); setErro(""); }} onKeyDown={(e) => e.key === "Enter" && handleSalvar()} />
              {erro && <span className="field-error">{erro}</span>}
            </div>
          </>
        )}
      </div>
      {!sucesso && (
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={!senhaAtual || !novaSenha || !confirmaSenha} onClick={handleSalvar}><Check size={16} /> Salvar nova senha</button>
        </div>
      )}
    </ModalShell>
  );
}

/* ============================== PEDIDO DETAIL MODAL ============================== */

function PedidoDetailModal({ pedido, obra, canUpdateStatus, canEditar, canExcluir, onClose, onUpdateStatus, onEditar, onCancelar, onReabrir, onExcluir, onAddComentario }) {
  const [confirmCancelar, setConfirmCancelar] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  const [novoComentario, setNovoComentario] = useState("");
  if (!pedido) return null;
  const currentIndex = STATUS.indexOf(pedido.status);
  const atrasado = isAtrasado(pedido);
  const stepperTravado = !canUpdateStatus || pedido.cancelado;
  const encerrado = pedido.status === "Entregue" || pedido.cancelado;

  function enviarComentario() {
    if (!novoComentario.trim()) return;
    onAddComentario(novoComentario.trim());
    setNovoComentario("");
  }

  return (
    <ModalShell title={pedido.titulo} subtitle={`${pedido.codigo} · ${obra?.nome || ""}`} onClose={onClose} width="640px">
      <div className="modal-body">
        {pedido.cancelado && <div className="cancelado-banner"><XCircle size={15} /> Este pedido foi cancelado.</div>}

        {canEditar && (
          <div className="detail-actions">
            {!pedido.cancelado && <button className="btn btn-secondary sm" onClick={onEditar}><Pencil size={13} /> Editar pedido</button>}
            {pedido.cancelado ? (
              <button className="btn btn-secondary sm" onClick={onReabrir}><RotateCcw size={13} /> Reabrir pedido</button>
            ) : confirmCancelar ? (
              <span className="confirm-inline">
                <span>Cancelar este pedido?</span>
                <button className="btn btn-secondary sm" onClick={() => setConfirmCancelar(false)}>Não</button>
                <button className="btn btn-danger sm" onClick={() => { onCancelar(); setConfirmCancelar(false); }}>Sim, cancelar</button>
              </span>
            ) : (
              <button className="btn btn-danger-outline sm" onClick={() => setConfirmCancelar(true)}><XCircle size={13} /> Cancelar pedido</button>
            )}
          </div>
        )}

        {canExcluir && encerrado && (
          <div className="detail-actions detail-actions-excluir">
            {confirmExcluir ? (
              <span className="confirm-inline">
                <span>Excluir este pedido para sempre? Não tem como desfazer.</span>
                <button className="btn btn-secondary sm" onClick={() => setConfirmExcluir(false)}>Não</button>
                <button className="btn btn-danger sm" onClick={onExcluir}>Sim, excluir</button>
              </span>
            ) : (
              <button className="btn btn-danger-outline sm" onClick={() => setConfirmExcluir(true)}><Trash2 size={13} /> Excluir pedido</button>
            )}
          </div>
        )}

        {pedido.fotoUrl && (
          <div className="detail-photo">
            <img src={pedido.fotoUrl} alt="Foto de referência do material" />
          </div>
        )}
        <div className="detail-material-block">
          <span className="detail-label">Material</span>
          <p className="detail-material-text">{pedido.material}</p>
        </div>
        <div className="detail-grid">
          <div><span className="detail-label">Prioridade</span><p><span className={`stamp stamp-${PRIORIDADE_KEY[pedido.prioridade]} inline`}>{pedido.prioridade}</span></p></div>
          <div><span className="detail-label">Lançado por</span><p>{pedido.lancadoPor}</p></div>
          <div><span className="detail-label">Data de lançamento</span><p>{formatDate(pedido.dataLancamento)}</p></div>
          <div><span className="detail-label">Necessário até</span><p className={atrasado ? "text-red" : ""}>{formatDate(pedido.dataNecessidade)} {atrasado && "· ATRASADO"}</p></div>
        </div>

        <span className="detail-label">Status da compra</span>
        <div className="stepper">
          {STATUS.map((s, i) => (
            <div key={s} className="step-wrap">
              <button
                className={"step" + (i < currentIndex ? " done" : "") + (i === currentIndex ? " active" : "") + (stepperTravado ? " locked" : "")}
                disabled={stepperTravado}
                onClick={() => onUpdateStatus(s)}
                title={stepperTravado ? (pedido.cancelado ? "Reabra o pedido para alterar o status" : "Apenas o setor de compras ou a equipe de obra podem atualizar") : `Marcar como "${s}"`}
              >
                <span className="step-dot">{i < currentIndex ? <Check size={12} /> : i + 1}</span>
                <span className="step-label">{s}</span>
              </button>
              {i < STATUS.length - 1 && <div className={"step-line" + (i < currentIndex ? " done" : "")} />}
            </div>
          ))}
        </div>
        {!canUpdateStatus && !pedido.cancelado && <p className="stepper-hint">Apenas o setor de compras ou a equipe de obra podem atualizar o status. Você recebe um aviso a cada mudança.</p>}

        <div className="comentarios-block">
          <span className="detail-label">Comentários</span>
          {(pedido.comentarios || []).length === 0 && <p className="comentarios-empty">Nenhum comentário ainda.</p>}
          {(pedido.comentarios || []).length > 0 && (
            <ul className="comentarios-list">
              {pedido.comentarios.slice().reverse().map((c) => (
                <li key={c.id}>
                  <div className="comentario-head"><strong>{c.por}</strong><span>{new Date(c.em).toLocaleString("pt-BR")}</span></div>
                  <p>{c.texto}</p>
                </li>
              ))}
            </ul>
          )}
          {canEditar && (
            <div className="comentario-form">
              <textarea
                rows={2} placeholder="Escreva uma observação sobre este pedido…"
                value={novoComentario} onChange={(e) => setNovoComentario(e.target.value)}
              />
              <button className="btn btn-secondary sm" disabled={!novoComentario.trim()} onClick={enviarComentario}>Comentar</button>
            </div>
          )}
        </div>

        {pedido.historico?.length > 0 && (
          <div className="historico">
            <span className="detail-label">Histórico</span>
            <ul>
              {pedido.historico.slice().reverse().map((h, i) => (
                <li key={i}><FileText size={12} /> {h.status} — {new Date(h.em).toLocaleString("pt-BR")} ({h.por})</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
