import React, { useState, useEffect, useMemo, useCallback } from "react";
import { jsPDF } from "jspdf";
import {
  BarChart3, FileDown, RefreshCw, Loader2, AlertTriangle, AlertCircle, CheckCircle2,
  XCircle, Timer, Truck, Package, Hourglass, ClipboardList, Archive
} from "lucide-react";
import { storageGet } from "./lib/storage";

/* ============================================================
   ANÁLISE DE COMPRAS
   Indicadores, gráficos e relatório em PDF sobre prazo, urgência
   e pendências dos pedidos. Usa os pedidos ativos mais os pedidos
   já excluídos (guardados na tabela pedidos_excluidos), para que
   apagar um pedido não apague o histórico do relatório.
   ============================================================ */

const PRAZO_MINIMO = 5;
const DIA_MS = 24 * 60 * 60 * 1000;
const ETAPAS = ["Lançado", "Em Cotação", "Aprovação do Cliente", "Aprovado", "Comprado", "Em Rota de Entrega", "Entregue"];
const ETAPAS_JA_COMPRADO = ["Comprado", "Em Rota de Entrega", "Entregue"];
const PRIORIDADES = ["Baixa", "Média", "Alta", "Urgente"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/* ---------- helpers ---------- */

const pad = (n) => String(n).padStart(2, "0");

export function isoLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDiasISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoLocal(d.getTime());
}
export function businessDaysBetween(fromISO, toISO) {
  const start = new Date(fromISO + "T00:00:00");
  const end = new Date(toISO + "T00:00:00");
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    const dia = cur.getDay();
    if (dia !== 0 && dia !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
function media(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function arred(n) { return n === null || n === undefined ? null : Math.round(n * 10) / 10; }
function fmtNum(n) { return n === null || n === undefined ? "-" : String(n).replace(".", ","); }
function fmtData(iso) {
  if (!iso) return "-";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function fmtDataMs(ms) { return ms ? fmtData(isoLocal(ms)) : "-"; }
function plural(n, s, p) { return n === 1 ? s : p; }
function mesLabel(chave) {
  const [y, m] = chave.split("-");
  return `${MESES[Number(m) - 1]}/${y.slice(2)}`;
}

/* ---------- monta a lista única (ativos + excluídos) ---------- */

export function montarRegistros(pedidos, excluidos, obras) {
  const obraPorId = new Map(obras.map((o) => [o.id, o]));
  const vistos = new Set();
  const saida = [];
  const adicionar = (p, excluido) => {
    if (!p || vistos.has(p.id)) return;
    vistos.add(p.id);
    const obra = obraPorId.get(p.obraId);
    saida.push({
      id: p.id,
      codigo: p.codigo || "",
      titulo: p.titulo || "",
      obraId: p.obraId || "sem-obra",
      obraNome: (obra && obra.nome) || p.obraNome || "Obra removida",
      solicitante: p.lancadoPor || "Não informado",
      prioridade: p.prioridade || "",
      status: p.status || "",
      dataLancamento: p.dataLancamento || null,
      dataNecessidade: p.dataNecessidade || null,
      justificativa: p.justificativaUrgencia || "",
      cancelado: !!p.cancelado,
      pendente: !!p.pendente,
      historico: Array.isArray(p.historico) ? p.historico : [],
      excluido,
      excluidoPor: p.excluidoPor || null,
      excluidoEm: p.excluidoEm || null,
    });
  };
  pedidos.forEach((p) => adicionar(p, false));
  excluidos.forEach((p) => adicionar(p, true));
  return saida;
}

function enriquecer(r) {
  const hist = r.historico;
  const primeiro = {};
  hist.forEach((h) => {
    if (ETAPAS.includes(h.status) && primeiro[h.status] === undefined) primeiro[h.status] = h.em;
  });
  const lancadoEm = primeiro["Lançado"] !== undefined ? primeiro["Lançado"] : hist[0] ? hist[0].em : null;
  const diasPorEtapa = {};
  ETAPAS.slice(1).forEach((etapa) => {
    if (lancadoEm == null || primeiro[etapa] === undefined) { diasPorEtapa[etapa] = null; return; }
    diasPorEtapa[etapa] = Math.max(0, (primeiro[etapa] - lancadoEm) / DIA_MS);
  });

  const pendencias = [];
  hist.forEach((h) => {
    const s = h.status || "";
    if (s.startsWith("Pedido marcado como pendência")) {
      const motivo = s.replace(/^Pedido marcado como pendência:?\s*/, "").trim();
      pendencias.push({ em: h.em, por: h.por || "-", motivo: motivo || "Sem motivo informado", resolvidaEm: null });
    } else if (s === "Pendência resolvida") {
      const aberta = [...pendencias].reverse().find((p) => p.resolvidaEm === null);
      if (aberta) aberta.resolvidaEm = h.em;
    }
  });

  const diasUteisPrazo = r.dataLancamento && r.dataNecessidade ? businessDaysBetween(r.dataLancamento, r.dataNecessidade) : null;
  const entregueEm = primeiro["Entregue"];
  return {
    ...r,
    diasUteisPrazo,
    prazoCurto: diasUteisPrazo !== null && diasUteisPrazo < PRAZO_MINIMO,
    urgente: r.prioridade === "Urgente",
    diasPorEtapa,
    pendencias,
    entregueAtrasado: entregueEm !== undefined && r.dataNecessidade ? isoLocal(entregueEm) > r.dataNecessidade : null,
  };
}

function agrupar(regs, chaveFn, nomeFn) {
  const mapa = new Map();
  regs.forEach((r) => {
    const k = chaveFn(r);
    if (!mapa.has(k)) mapa.set(k, { chave: k, nome: nomeFn(r), total: 0, prazoCurto: 0, urgentes: 0, pendencias: 0, pedidosComPendencia: 0 });
    const g = mapa.get(k);
    g.total++;
    if (r.prazoCurto) g.prazoCurto++;
    if (r.urgente) g.urgentes++;
    g.pendencias += r.pendencias.length;
    if (r.pendencias.length) g.pedidosComPendencia++;
  });
  return [...mapa.values()].map((g) => ({ ...g, pctPrazoCurto: pct(g.prazoCurto, g.total) }));
}

function listarMeses(chaves) {
  if (!chaves.length) return [];
  const ord = [...chaves].sort();
  let [y, m] = ord[0].split("-").map(Number);
  const [yf, mf] = ord[ord.length - 1].split("-").map(Number);
  const saida = [];
  while (y < yf || (y === yf && m <= mf)) {
    saida.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return saida;
}

/* ---------- cálculo principal ---------- */

export function calcularAnalise({ pedidos = [], excluidos = [], obras = [], inicio = null, fim = null, obraId = "", hojeISO } = {}) {
  const hoje = hojeISO || isoLocal(Date.now());
  const regs = montarRegistros(pedidos, excluidos, obras)
    .map(enriquecer)
    .filter((r) => {
      if (obraId && r.obraId !== obraId) return false;
      if (inicio && (!r.dataLancamento || r.dataLancamento < inicio)) return false;
      if (fim && (!r.dataLancamento || r.dataLancamento > fim)) return false;
      return true;
    });

  const total = regs.length;
  const urgentes = regs.filter((r) => r.urgente);
  const curtos = regs.filter((r) => r.prazoCurto);
  const curtosComJust = curtos.filter((r) => r.justificativa.trim());
  const cancelados = regs.filter((r) => r.cancelado);
  const excl = regs.filter((r) => r.excluido);
  const eventos = regs.flatMap((r) => r.pendencias.map((p) => ({ ...p, registro: r })));
  const comPend = regs.filter((r) => r.pendencias.length > 0);
  const abertas = regs.filter((r) => r.pendente && !r.cancelado && !r.excluido);
  const duracoes = eventos.filter((e) => e.resolvidaEm !== null).map((e) => Math.max(0, (e.resolvidaEm - e.em) / DIA_MS));
  const atrasadosAgora = regs.filter(
    (r) => !r.excluido && !r.cancelado && !ETAPAS_JA_COMPRADO.includes(r.status) && r.dataNecessidade && r.dataNecessidade < hoje
  );

  const tempos = ETAPAS.slice(1)
    .map((etapa) => {
      const vals = regs.map((r) => r.diasPorEtapa[etapa]).filter((v) => v !== null);
      return { etapa, media: arred(media(vals)), n: vals.length };
    })
    .filter((t) => t.n > 0);
  const tempoCompra = tempos.find((t) => t.etapa === "Comprado") || { media: null, n: 0 };

  const entregues = regs.filter((r) => r.entregueAtrasado !== null);
  const entreguesAtrasadas = entregues.filter((r) => r.entregueAtrasado);

  const prazos = regs.map((r) => r.diasUteisPrazo).filter((v) => v !== null);
  const faixas = [
    { label: "0 a 1 dia útil", min: 0, max: 1, abaixo: true },
    { label: "2 dias úteis", min: 2, max: 2, abaixo: true },
    { label: "3 dias úteis", min: 3, max: 3, abaixo: true },
    { label: "4 dias úteis", min: 4, max: 4, abaixo: true },
    { label: "5 a 9 dias úteis", min: 5, max: 9, abaixo: false },
    { label: "10 dias úteis ou mais", min: 10, max: Infinity, abaixo: false },
  ];
  const porPrazo = faixas.map((f) => ({
    label: f.label,
    abaixo: f.abaixo,
    qtd: regs.filter((r) => r.diasUteisPrazo !== null && r.diasUteisPrazo >= f.min && r.diasUteisPrazo <= f.max).length,
  }));

  const chavesMes = regs.filter((r) => r.dataLancamento).map((r) => r.dataLancamento.slice(0, 7));
  let meses = listarMeses(chavesMes);
  const mesesLimitados = meses.length > 12;
  if (mesesLimitados) meses = meses.slice(-12);
  const porMes = meses.map((chave) => {
    const doMes = regs.filter((r) => r.dataLancamento && r.dataLancamento.startsWith(chave));
    return {
      chave,
      label: mesLabel(chave),
      total: doMes.length,
      prazoCurto: doMes.filter((r) => r.prazoCurto).length,
      urgentes: doMes.filter((r) => r.urgente).length,
      pendencias: doMes.reduce((s, r) => s + r.pendencias.length, 0),
    };
  });

  const porObra = agrupar(regs, (r) => r.obraId, (r) => r.obraNome);
  const porSolicitante = agrupar(regs, (r) => r.solicitante, (r) => r.solicitante);
  const porPrioridade = PRIORIDADES.map((p) => ({ label: p, qtd: regs.filter((r) => r.prioridade === p).length }));
  const contagemStatus = {};
  regs.forEach((r) => {
    const k = r.cancelado ? "Cancelado" : r.status || "Sem status";
    contagemStatus[k] = (contagemStatus[k] || 0) + 1;
  });
  const porStatus = [...ETAPAS, "Cancelado"]
    .filter((s) => contagemStatus[s])
    .map((s) => ({ label: s, qtd: contagemStatus[s] }));

  const listaPrazoCurto = curtos
    .slice()
    .sort((a, b) => (b.dataLancamento || "").localeCompare(a.dataLancamento || ""))
    .map((r) => ({
      id: r.id, data: r.dataLancamento, codigo: r.codigo, titulo: r.titulo, obra: r.obraNome,
      solicitante: r.solicitante, diasUteis: r.diasUteisPrazo, prioridade: r.prioridade,
      justificativa: r.justificativa.trim(), excluido: r.excluido,
    }));

  const listaPendencias = eventos
    .slice()
    .sort((a, b) => b.em - a.em)
    .map((e) => ({
      em: e.em, codigo: e.registro.codigo, titulo: e.registro.titulo, obra: e.registro.obraNome,
      por: e.por, motivo: e.motivo, resolvida: e.resolvidaEm !== null,
      duracaoDias: e.resolvidaEm !== null ? arred(Math.max(0, (e.resolvidaEm - e.em) / DIA_MS)) : null,
      excluido: e.registro.excluido,
    }));

  const analise = {
    vazio: total === 0,
    total,
    ativos: total - excl.length,
    excluidos: excl.length,
    cancelados: cancelados.length,
    urgentes: { qtd: urgentes.length, pct: pct(urgentes.length, total) },
    prazoCurto: {
      qtd: curtos.length,
      pct: pct(curtos.length, total),
      comJustificativa: curtosComJust.length,
      semJustificativa: curtos.length - curtosComJust.length,
    },
    pendencias: {
      eventos: eventos.length,
      pedidos: comPend.length,
      abertas: abertas.length,
      duracaoMedia: arred(media(duracoes)),
      resolvidas: duracoes.length,
    },
    atrasadosAgora: atrasadosAgora.length,
    prazoMedio: arred(media(prazos)),
    compra: { media: tempoCompra.media, n: tempoCompra.n },
    entregas: { total: entregues.length, atrasadas: entreguesAtrasadas.length, pct: pct(entreguesAtrasadas.length, entregues.length) },
    tempos, porPrazo, porMes, mesesLimitados, porObra, porSolicitante, porPrioridade, porStatus,
    listaPrazoCurto, listaPendencias,
  };
  analise.destaques = gerarDestaques(analise);
  return analise;
}

/* ---------- destaques em texto ---------- */

export function gerarDestaques(a) {
  if (a.vazio) return ["Nenhum pedido encontrado no período e na obra selecionados."];
  const d = [];
  d.push(
    `${a.prazoCurto.qtd} de ${a.total} ${plural(a.total, "pedido", "pedidos")} (${fmtNum(a.prazoCurto.pct)}%) ${plural(a.prazoCurto.qtd, "foi lançado", "foram lançados")} com menos de ${PRAZO_MINIMO} dias úteis de prazo.`
  );
  if (a.prazoCurto.qtd > 0) {
    d.push(
      `Entre eles, ${a.prazoCurto.comJustificativa} ${plural(a.prazoCurto.comJustificativa, "tem", "têm")} justificativa registrada e ${a.prazoCurto.semJustificativa} ${plural(a.prazoCurto.semJustificativa, "não tem", "não têm")} (em geral, pedidos anteriores à regra de justificativa).`
    );
    const obraTop = a.porObra.slice().sort((x, y) => y.prazoCurto - x.prazoCurto || y.total - x.total)[0];
    if (obraTop && obraTop.prazoCurto > 0) {
      d.push(`A obra com mais pedidos de prazo curto é ${obraTop.nome}: ${obraTop.prazoCurto} de ${obraTop.total} (${fmtNum(obraTop.pctPrazoCurto)}% dos pedidos dela).`);
    }
    const solTop = a.porSolicitante.slice().sort((x, y) => y.prazoCurto - x.prazoCurto || y.total - x.total)[0];
    if (solTop && solTop.prazoCurto > 0) {
      d.push(`Quem mais lançou pedidos de prazo curto: ${solTop.nome}, com ${solTop.prazoCurto} de ${solTop.total} ${plural(solTop.total, "pedido", "pedidos")} (${fmtNum(solTop.pctPrazoCurto)}%).`);
    }
    const mesTop = a.porMes.slice().sort((x, y) => y.prazoCurto - x.prazoCurto)[0];
    if (mesTop && mesTop.prazoCurto > 0 && a.porMes.length > 1) {
      d.push(`O mês com mais pedidos de prazo curto foi ${mesTop.label}, com ${mesTop.prazoCurto}.`);
    }
  }
  d.push(`${a.urgentes.qtd} ${plural(a.urgentes.qtd, "pedido foi marcado", "pedidos foram marcados")} com prioridade Urgente (${fmtNum(a.urgentes.pct)}% do total).`);
  if (a.prazoMedio !== null) d.push(`O prazo médio pedido pela obra é de ${fmtNum(a.prazoMedio)} dias úteis.`);
  if (a.pendencias.eventos > 0) {
    let t = `Foram registradas ${a.pendencias.eventos} ${plural(a.pendencias.eventos, "pendência", "pendências")} em ${a.pendencias.pedidos} ${plural(a.pendencias.pedidos, "pedido", "pedidos")}; ${a.pendencias.abertas} ${plural(a.pendencias.abertas, "segue aberta", "seguem abertas")} hoje.`;
    if (a.pendencias.duracaoMedia !== null) t += ` As resolvidas levaram em média ${fmtNum(a.pendencias.duracaoMedia)} dias.`;
    d.push(t);
    const obraPend = a.porObra.slice().sort((x, y) => y.pendencias - x.pendencias)[0];
    if (obraPend && obraPend.pendencias > 0) d.push(`A obra com mais pendências é ${obraPend.nome}, com ${obraPend.pendencias}.`);
  } else {
    d.push("Nenhuma pendência registrada no período.");
  }
  if (a.compra.media !== null) d.push(`Do lançamento até a compra, o tempo médio é de ${fmtNum(a.compra.media)} dias (${a.compra.n} ${plural(a.compra.n, "pedido", "pedidos")}).`);
  if (a.entregas.total > 0) d.push(`${fmtNum(a.entregas.pct)}% dos pedidos entregues chegaram depois da data necessária (${a.entregas.atrasadas} de ${a.entregas.total}).`);
  if (a.atrasadosAgora > 0) d.push(`Hoje há ${a.atrasadosAgora} ${plural(a.atrasadosAgora, "pedido atrasado", "pedidos atrasados")} ainda sem compra.`);
  if (a.excluidos > 0) d.push(`${a.excluidos} ${plural(a.excluidos, "pedido analisado já foi excluído", "pedidos analisados já foram excluídos")} do sistema e continua${a.excluidos === 1 ? "" : "m"} contando no relatório.`);
  return d;
}

/* ---------- exporta helpers de formatação para as outras partes ---------- */
export const _internos = { fmtNum, fmtData, fmtDataMs, plural, addDiasISO, pct, PRIORIDADES, ETAPAS, PRAZO_MINIMO };

/* ---------- indicadores resumidos (usados na tela e no PDF) ---------- */

export function listaKPIs(a) {
  return [
    { id: "total", valor: String(a.total), rotulo: "Pedidos analisados", sub: a.excluidos > 0 ? `${a.ativos} ativos e ${a.excluidos} excluídos` : "todos ativos", tom: "azul" },
    { id: "curto", valor: String(a.prazoCurto.qtd), rotulo: `Prazo abaixo de ${PRAZO_MINIMO} dias úteis`, sub: `${fmtNum(a.prazoCurto.pct)}% do total`, tom: "ambar" },
    { id: "just", valor: `${a.prazoCurto.comJustificativa}/${a.prazoCurto.qtd}`, rotulo: "Prazo curto com justificativa", sub: a.prazoCurto.semJustificativa > 0 ? `${a.prazoCurto.semJustificativa} sem justificativa` : "todos justificados", tom: "ambar" },
    { id: "urg", valor: String(a.urgentes.qtd), rotulo: "Prioridade Urgente", sub: `${fmtNum(a.urgentes.pct)}% do total`, tom: "vermelho" },
    { id: "pend", valor: String(a.pendencias.eventos), rotulo: "Pendências registradas", sub: `em ${a.pendencias.pedidos} ${plural(a.pendencias.pedidos, "pedido", "pedidos")}`, tom: "ambar" },
    { id: "pendab", valor: String(a.pendencias.abertas), rotulo: "Pendências abertas agora", sub: a.pendencias.duracaoMedia !== null ? `resolvidas em média ${fmtNum(a.pendencias.duracaoMedia)} dias` : "nenhuma resolvida ainda", tom: "vermelho" },
    { id: "atras", valor: String(a.atrasadosAgora), rotulo: "Atrasados agora", sub: "fora do prazo e sem compra", tom: "vermelho" },
    { id: "compra", valor: a.compra.media === null ? "-" : `${fmtNum(a.compra.media)} d`, rotulo: "Tempo médio até a compra", sub: a.compra.n ? `${a.compra.n} ${plural(a.compra.n, "pedido", "pedidos")}` : "sem compras registradas", tom: "azul" },
    { id: "entr", valor: a.entregas.total ? `${fmtNum(a.entregas.pct)}%` : "-", rotulo: "Entregues após o prazo", sub: a.entregas.total ? `${a.entregas.atrasadas} de ${a.entregas.total} entregues` : "sem entregas registradas", tom: "verde" },
    { id: "canc", valor: String(a.cancelados), rotulo: "Cancelados", sub: `${fmtNum(pct(a.cancelados, a.total))}% do total`, tom: "cinza" },
  ];
}

/* ---------- séries prontas para os gráficos (tela e PDF usam as mesmas) ---------- */

export function seriesDosGraficos(a) {
  const topN = (lista, n = 10) => lista.slice(0, n);
  const curtoObra = topN(a.porObra.filter((g) => g.prazoCurto > 0).sort((x, y) => y.prazoCurto - x.prazoCurto || y.total - x.total)).map((g) => ({
    label: g.nome, valor: g.prazoCurto, texto: `${g.prazoCurto} de ${g.total} (${fmtNum(g.pctPrazoCurto)}%)`,
  }));
  const curtoSol = topN(a.porSolicitante.filter((g) => g.prazoCurto > 0).sort((x, y) => y.prazoCurto - x.prazoCurto || y.total - x.total)).map((g) => ({
    label: g.nome, valor: g.prazoCurto, texto: `${g.prazoCurto} de ${g.total} (${fmtNum(g.pctPrazoCurto)}%)`,
  }));
  const pendObra = topN(a.porObra.filter((g) => g.pendencias > 0).sort((x, y) => y.pendencias - x.pendencias)).map((g) => ({
    label: g.nome, valor: g.pendencias, texto: `${g.pendencias} em ${g.pedidosComPendencia} ${plural(g.pedidosComPendencia, "pedido", "pedidos")}`,
  }));
  const pendSol = topN(a.porSolicitante.filter((g) => g.pedidosComPendencia > 0).sort((x, y) => y.pedidosComPendencia - x.pedidosComPendencia)).map((g) => ({
    label: g.nome, valor: g.pedidosComPendencia, texto: `${g.pedidosComPendencia} de ${g.total} (${fmtNum(pct(g.pedidosComPendencia, g.total))}%)`,
  }));
  const prazo = a.porPrazo.map((f) => ({ label: f.label, valor: f.qtd, texto: `${f.qtd} (${fmtNum(pct(f.qtd, a.total))}%)`, abaixo: f.abaixo }));
  const prioridade = a.porPrioridade.map((p) => ({ label: p.label, valor: p.qtd, texto: `${p.qtd} (${fmtNum(pct(p.qtd, a.total))}%)` }));
  const status = a.porStatus.map((s) => ({ label: s.label, valor: s.qtd, texto: `${s.qtd} (${fmtNum(pct(s.qtd, a.total))}%)` }));
  const tempos = a.tempos.map((t) => ({ label: t.etapa, valor: t.media, texto: `${fmtNum(t.media)} dias (${t.n} ${plural(t.n, "pedido", "pedidos")})` }));
  return { curtoObra, curtoSol, pendObra, pendSol, prazo, prioridade, status, tempos };
}

export const SERIES_MENSAIS = [
  { chave: "total", label: "Total de pedidos", cinza: 40 },
  { chave: "prazoCurto", label: "Prazo abaixo de 5 dias úteis", cinza: 110 },
  { chave: "urgentes", label: "Urgentes", cinza: 165 },
  { chave: "pendencias", label: "Pendências", cinza: 210 },
];

/* ============================================================
   PDF (preto e branco, com a logo da empresa)
   ============================================================ */

function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function construirPDFAnalise(doc, a, meta) {
  const ML = 15, W = 180, LIMITE = 276;
  let y = 14;

  const novaPagina = () => { doc.addPage(); y = 16; };
  const garantir = (h) => { if (y + h > LIMITE) novaPagina(); };
  const texto = (t, x, yy, { size = 9, bold = false, cor = 0, align = "left" } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(cor);
    doc.text(String(t), x, yy, { align });
  };
  const quebrar = (t, larg, size = 9, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    return doc.splitTextToSize(String(t), larg);
  };
  const cortar = (t, n) => (String(t).length > n ? String(t).slice(0, n - 3) + "..." : String(t));

  const secao = (titulo, sub, reservar = 36) => {
    garantir(reservar);
    y += 3;
    texto(titulo, ML, y + 4, { size: 11, bold: true });
    y += 6.5;
    doc.setDrawColor(150);
    doc.setLineWidth(0.3);
    doc.line(ML, y, ML + W, y);
    y += 2.5;
    if (sub) { texto(sub, ML, y + 3, { size: 8, cor: 100 }); y += 5; }
    y += 2;
  };

  const semDados = (msg = "Sem dados no período selecionado.") => {
    texto(msg, ML, y + 3, { size: 8.5, cor: 120 });
    y += 7;
  };

  const barrasH = (itens, { rotuloW = 62, valorW = 36 } = {}) => {
    const positivos = itens.filter((i) => i.valor > 0);
    if (!positivos.length) { semDados(); return; }
    const max = Math.max(...itens.map((i) => i.valor), 1);
    const areaX = ML + rotuloW + 2;
    const areaW = W - rotuloW - 2 - valorW;
    itens.forEach((i) => {
      garantir(6.4);
      texto(cortar(i.label, 38), ML, y + 3.6, { size: 8.5 });
      doc.setFillColor(238);
      doc.rect(areaX, y + 0.8, areaW, 3.6, "F");
      if (i.valor > 0) {
        doc.setFillColor(i.abaixo === false ? 160 : 55);
        doc.rect(areaX, y + 0.8, Math.max(0.6, (i.valor / max) * areaW), 3.6, "F");
      }
      texto(i.texto, ML + W, y + 3.6, { size: 8, align: "right" });
      y += 6.2;
    });
    y += 2;
  };

  const colunas = (meses, series) => {
    if (!meses.length) { semDados(); return; }
    garantir(66);
    // legenda
    let lx = ML;
    series.forEach((s) => {
      doc.setFillColor(s.cinza);
      doc.rect(lx, y + 0.6, 3, 3, "F");
      texto(s.label, lx + 4.5, y + 3.2, { size: 7.5 });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      lx += 4.5 + doc.getTextWidth(s.label) + 6;
    });
    y += 9;
    const ch = 40;
    const base = y + ch;
    const max = Math.max(1, ...meses.flatMap((m) => series.map((s) => m[s.chave])));
    const gw = W / meses.length;
    const bw = Math.min(6, (gw - 3) / series.length);
    doc.setDrawColor(120);
    doc.setLineWidth(0.3);
    doc.line(ML, base, ML + W, base);
    meses.forEach((m, mi) => {
      const gx = ML + mi * gw + (gw - bw * series.length) / 2;
      series.forEach((s, si) => {
        const v = m[s.chave];
        const h = v > 0 ? Math.max(0.5, (v / max) * ch) : 0;
        if (h > 0) {
          doc.setFillColor(s.cinza);
          doc.rect(gx + si * bw, base - h, bw - 0.4, h, "F");
          texto(v, gx + si * bw + (bw - 0.4) / 2, base - h - 0.8, { size: 5.5, align: "center" });
        }
      });
      texto(m.label, ML + mi * gw + gw / 2, base + 4, { size: 7, align: "center" });
    });
    y = base + 9;
  };

  const tabela = (cols, linhas, vazio) => {
    if (!linhas.length) { semDados(vazio); return; }
    const SZ = 7.5, LH = 3.4;
    const cabecalho = () => {
      let x = ML;
      cols.forEach((c) => { texto(c.t, x + 1, y + 3.4, { size: SZ, bold: true }); x += c.w; });
      y += 5;
      doc.setDrawColor(90);
      doc.setLineWidth(0.3);
      doc.line(ML, y, ML + W, y);
      y += 1;
    };
    garantir(22);
    cabecalho();
    linhas.forEach((l) => {
      const cel = cols.map((c) => quebrar(c.f(l), c.w - 2, SZ));
      const n = Math.max(...cel.map((c) => c.length));
      const h = n * LH + 2.4;
      if (y + h > LIMITE) { novaPagina(); cabecalho(); }
      let x = ML;
      cel.forEach((ls, i) => {
        ls.forEach((t, k) => texto(t, x + 1, y + 3 + k * LH, { size: SZ, cor: l.excluido ? 110 : 0 }));
        x += cols[i].w;
      });
      y += h;
      doc.setDrawColor(215);
      doc.setLineWidth(0.15);
      doc.line(ML, y - 0.6, ML + W, y - 0.6);
    });
    y += 3;
  };

  /* ----- cabeçalho ----- */
  if (meta.logo) {
    try { doc.addImage(meta.logo, "PNG", ML, y, 44, 20.3); } catch (e) { /* segue sem logo */ }
  }
  texto("Análise de Compras", ML + W, y + 8, { size: 19, bold: true, align: "right" });
  texto("Alencar & Bezerra Engenharia", ML + W, y + 14, { size: 9.5, cor: 90, align: "right" });
  y += 25;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(ML, y, ML + W, y);
  y += 5;
  texto(`Período: ${meta.periodoTexto}`, ML, y + 3, { size: 9 });
  texto(`Obra: ${meta.obraTexto}`, ML + 90, y + 3, { size: 9 });
  y += 5.5;
  texto(`Gerado em ${meta.geradoEm} por ${meta.geradoPor}`, ML, y + 3, { size: 8, cor: 100 });
  y += 8;

  if (a.vazio) {
    texto("Nenhum pedido encontrado no período e na obra selecionados.", ML, y + 4, { size: 10 });
  } else {
    /* ----- indicadores ----- */
    const kpis = listaKPIs(a);
    const bw = (W - 4 * 3) / 5;
    const bh = 22;
    garantir(bh * 2 + 8);
    kpis.forEach((k, i) => {
      const col = i % 5;
      const lin = Math.floor(i / 5);
      const x = ML + col * (bw + 3);
      const yy = y + lin * (bh + 3);
      doc.setDrawColor(170);
      doc.setLineWidth(0.25);
      doc.rect(x, yy, bw, bh);
      texto(k.valor, x + bw / 2, yy + 8, { size: 15, bold: true, align: "center" });
      const rot = quebrar(k.rotulo, bw - 3, 7, true);
      rot.slice(0, 2).forEach((t, ti) => texto(t, x + bw / 2, yy + 12.2 + ti * 3, { size: 7, bold: true, cor: 40, align: "center" }));
      const sub = quebrar(k.sub, bw - 3, 6.3);
      texto(sub[0], x + bw / 2, yy + 19.2, { size: 6.3, cor: 110, align: "center" });
    });
    y += bh * 2 + 3 + 4;

    /* ----- destaques ----- */
    secao("Destaques do período");
    a.destaques.forEach((d) => {
      const ls = quebrar(d, W - 6, 9);
      garantir(ls.length * 4.3 + 1.5);
      texto("-", ML + 1, y + 3.3, { size: 9 });
      ls.forEach((t, k) => texto(t, ML + 5, y + 3.3 + k * 4.3, { size: 9 }));
      y += ls.length * 4.3 + 1.5;
    });

    const s = seriesDosGraficos(a);

    secao("Pedidos por mês", a.mesesLimitados ? "Agrupado pelo mês de lançamento do pedido. Mostrando os últimos 12 meses." : "Agrupado pelo mês de lançamento do pedido.", 82);
    colunas(a.porMes, SERIES_MENSAIS);

    secao("Prazo pedido pela obra", `Dias úteis entre o lançamento e a data necessária. Barras escuras: abaixo de ${PRAZO_MINIMO} dias úteis (fora da regra).`);
    barrasH(s.prazo);

    secao("Pedidos de prazo curto por obra", `Quantidade de pedidos com menos de ${PRAZO_MINIMO} dias úteis. Entre parênteses, a parcela dos pedidos da própria obra.`);
    barrasH(s.curtoObra);

    secao("Pedidos de prazo curto por solicitante", "Quem lançou os pedidos com prazo abaixo do padrão.");
    barrasH(s.curtoSol);

    secao("Pendências por obra", "Número de vezes que um pedido foi marcado como pendência.");
    barrasH(s.pendObra);

    secao("Pedidos com pendência por solicitante", "Em quantos pedidos de cada pessoa faltou informação ou algo travou a compra.");
    barrasH(s.pendSol);

    secao("Pedidos por prioridade");
    barrasH(s.prioridade);

    secao("Situação atual dos pedidos");
    barrasH(s.status);

    secao("Tempo médio desde o lançamento até cada etapa", "Em dias, considerando só os pedidos que passaram pela etapa.");
    barrasH(s.tempos);

    secao("Pedidos com prazo abaixo de " + PRAZO_MINIMO + " dias úteis e justificativas", "Pedidos excluídos do sistema aparecem em cinza e com a marca (excluído).", 46);
    tabela(
      [
        { t: "Data", w: 17, f: (l) => fmtData(l.data) },
        { t: "Pedido", w: 44, f: (l) => `${l.codigo} ${l.titulo}${l.excluido ? " (excluído)" : ""}` },
        { t: "Obra", w: 30, f: (l) => l.obra },
        { t: "Solicitante", w: 24, f: (l) => l.solicitante },
        { t: "Prazo", w: 13, f: (l) => `${l.diasUteis} d.u.` },
        { t: "Justificativa", w: 52, f: (l) => (l.justificativa ? cortar(l.justificativa, 600) : "Sem justificativa registrada") },
      ],
      a.listaPrazoCurto,
      "Nenhum pedido com prazo curto no período."
    );

    secao("Pendências registradas", "Cada vez que um pedido foi marcado como pendência, com o motivo informado.", 46);
    tabela(
      [
        { t: "Data", w: 17, f: (l) => fmtDataMs(l.em) },
        { t: "Pedido", w: 44, f: (l) => `${l.codigo} ${l.titulo}${l.excluido ? " (excluído)" : ""}` },
        { t: "Obra", w: 30, f: (l) => l.obra },
        { t: "Aberta por", w: 22, f: (l) => l.por },
        { t: "Motivo", w: 47, f: (l) => cortar(l.motivo, 400) },
        { t: "Situação", w: 20, f: (l) => (l.resolvida ? `Resolvida (${fmtNum(l.duracaoDias)} d)` : "Aberta") },
      ],
      a.listaPendencias,
      "Nenhuma pendência registrada no período."
    );
  }

  /* ----- rodapé com numeração ----- */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    texto(`Alencar & Bezerra Engenharia | Análise de Compras | Página ${i} de ${n}`, 105, 290, { size: 7.5, cor: 120, align: "center" });
  }
}

export async function gerarPDFAnalise(a, meta) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let logo = null;
  try { logo = await carregarImagem("/logo-full.png"); } catch (e) { console.error("Logo não carregou no PDF", e); }
  construirPDFAnalise(doc, a, { ...meta, logo });
  doc.save(`analise-de-compras-${isoLocal(Date.now())}.pdf`);
}

/* ============================================================
   TELA: ANÁLISE DE COMPRAS
   ============================================================ */

function BarrasHorizontais({ itens, vazio = "Sem dados no período selecionado." }) {
  const max = Math.max(...itens.map((i) => i.valor), 1);
  if (!itens.some((i) => i.valor > 0)) return <p className="an-vazio">{vazio}</p>;
  return (
    <div className="an-barras">
      {itens.map((i) => (
        <div key={i.label} className="an-barra-linha">
          <span className="an-barra-rotulo" title={i.label}>{i.label}</span>
          <div className="an-barra-trilho">
            <div
              className={"an-barra-preenchimento" + (i.abaixo === false ? " clara" : "")}
              style={{ width: `${i.valor > 0 ? Math.max(1.5, (i.valor / max) * 100) : 0}%` }}
            />
          </div>
          <span className="an-barra-valor">{i.texto}</span>
        </div>
      ))}
    </div>
  );
}

const CORES_SERIES = { total: "var(--navy)", prazoCurto: "var(--amber)", urgentes: "var(--red)", pendencias: "var(--blue)" };

function ColunasMensais({ meses }) {
  if (!meses.length) return <p className="an-vazio">Sem dados no período selecionado.</p>;
  const max = Math.max(1, ...meses.flatMap((m) => SERIES_MENSAIS.map((s) => m[s.chave])));
  return (
    <>
      <div className="an-legenda">
        {SERIES_MENSAIS.map((s) => (
          <span key={s.chave}><i style={{ background: CORES_SERIES[s.chave] }} /> {s.label}</span>
        ))}
      </div>
      <div className="an-colunas-rolagem">
        <div className="an-colunas" style={{ minWidth: meses.length * 64 }}>
          {meses.map((m) => (
            <div key={m.chave} className="an-coluna-grupo">
              <div className="an-coluna-barras">
                {SERIES_MENSAIS.map((s) => (
                  <div key={s.chave} className="an-coluna-item" title={`${s.label}: ${m[s.chave]}`}>
                    <span className="an-coluna-valor">{m[s.chave] > 0 ? m[s.chave] : ""}</span>
                    <div
                      className="an-coluna"
                      style={{ height: `${m[s.chave] > 0 ? Math.max(3, (m[s.chave] / max) * 100) : 0}%`, background: CORES_SERIES[s.chave] }}
                    />
                  </div>
                ))}
              </div>
              <span className="an-coluna-mes">{m.label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const CORES_PRIORIDADE = { Baixa: "#9AA3AE", Média: "var(--blue)", Alta: "var(--amber)", Urgente: "var(--red)" };

function Rosca({ itens, total }) {
  const soma = itens.reduce((s, i) => s + i.qtd, 0);
  if (!soma) return <p className="an-vazio">Sem dados no período selecionado.</p>;
  let acumulado = 0;
  return (
    <div className="an-rosca-wrap">
      <svg viewBox="0 0 42 42" className="an-rosca" role="img" aria-label="Pedidos por prioridade">
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EEF0F3" strokeWidth="6" />
        {itens.filter((i) => i.qtd > 0).map((i) => {
          const parte = (i.qtd / soma) * 100;
          const el = (
            <circle
              key={i.label} cx="21" cy="21" r="15.915" fill="none" strokeWidth="6"
              stroke={CORES_PRIORIDADE[i.label] || "#999"}
              strokeDasharray={`${parte} ${100 - parte}`} strokeDashoffset={25 - acumulado}
            />
          );
          acumulado += parte;
          return el;
        })}
        <text x="21" y="20.5" textAnchor="middle" className="an-rosca-total">{total}</text>
        <text x="21" y="26" textAnchor="middle" className="an-rosca-sub">pedidos</text>
      </svg>
      <ul className="an-rosca-legenda">
        {itens.map((i) => (
          <li key={i.label}>
            <i style={{ background: CORES_PRIORIDADE[i.label] || "#999" }} />
            <span>{i.label}</span>
            <strong>{i.qtd}</strong>
            <em>{fmtNum(pct(i.qtd, soma))}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CartaoGrafico({ titulo, sub, children, largo }) {
  return (
    <section className={"an-cartao" + (largo ? " largo" : "")}>
      <h3>{titulo}</h3>
      {sub && <p className="an-cartao-sub">{sub}</p>}
      {children}
    </section>
  );
}

const ICONES_KPI = {
  total: Package, curto: Hourglass, just: ClipboardList, urg: AlertTriangle, pend: AlertCircle,
  pendab: AlertCircle, atras: Timer, compra: Truck, entr: CheckCircle2, canc: XCircle,
};

function dataDeHoje() { return isoLocal(Date.now()); }

function intervaloDoPeriodo(periodo, inicioLivre, fimLivre) {
  const hoje = dataDeHoje();
  if (periodo === "tudo") return { inicio: null, fim: null };
  if (periodo === "mes") return { inicio: hoje.slice(0, 8) + "01", fim: hoje };
  if (periodo === "livre") return { inicio: inicioLivre || null, fim: fimLivre || null };
  return { inicio: addDiasISO(hoje, -Number(periodo)), fim: hoje };
}

function textoDoPeriodo(periodo, inicio, fim) {
  if (periodo === "tudo") return "Todo o histórico";
  if (inicio && fim) return `${fmtData(inicio)} a ${fmtData(fim)}`;
  if (inicio) return `a partir de ${fmtData(inicio)}`;
  if (fim) return `até ${fmtData(fim)}`;
  return "Todo o histórico";
}

export function AnalisePage({ pedidos, obras, profile }) {
  const [excluidos, setExcluidos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erroExcluidos, setErroExcluidos] = useState(false);
  const [periodo, setPeriodo] = useState("tudo");
  const [inicioLivre, setInicioLivre] = useState("");
  const [fimLivre, setFimLivre] = useState("");
  const [obraId, setObraId] = useState("");
  const [gerandoPDF, setGerandoPDF] = useState(false);
  const [mostrarTodasPrazo, setMostrarTodasPrazo] = useState(false);
  const [mostrarTodasPend, setMostrarTodasPend] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroExcluidos(false);
    const lista = await storageGet("pedidos_excluidos", true);
    if (lista === null) setErroExcluidos(true);
    else setExcluidos(lista);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const { inicio, fim } = intervaloDoPeriodo(periodo, inicioLivre, fimLivre);
  const analise = useMemo(
    () => calcularAnalise({ pedidos, excluidos, obras, inicio, fim, obraId }),
    [pedidos, excluidos, obras, inicio, fim, obraId]
  );
  const series = useMemo(() => seriesDosGraficos(analise), [analise]);
  const kpis = useMemo(() => listaKPIs(analise), [analise]);

  async function handlePDF() {
    setGerandoPDF(true);
    try {
      const obraSel = obras.find((o) => o.id === obraId);
      const agora = new Date();
      await gerarPDFAnalise(analise, {
        periodoTexto: textoDoPeriodo(periodo, inicio, fim),
        obraTexto: obraSel ? obraSel.nome : "Todas as obras",
        geradoEm: `${fmtData(isoLocal(agora.getTime()))} ${pad(agora.getHours())}:${pad(agora.getMinutes())}`,
        geradoPor: profile.nome,
      });
    } catch (e) {
      console.error("Erro ao gerar PDF da análise", e);
    }
    setGerandoPDF(false);
  }

  const listaPrazo = mostrarTodasPrazo ? analise.listaPrazoCurto : analise.listaPrazoCurto.slice(0, 15);
  const listaPend = mostrarTodasPend ? analise.listaPendencias : analise.listaPendencias.slice(0, 15);

  return (
    <div className="an-pagina">
      <div className="an-filtros">
        <div className="an-filtro">
          <label>Período (data de lançamento)</label>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="tudo">Todo o histórico</option>
            <option value="30">Últimos 30 dias</option>
            <option value="60">Últimos 60 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="mes">Este mês</option>
            <option value="livre">Escolher datas</option>
          </select>
        </div>
        {periodo === "livre" && (
          <>
            <div className="an-filtro"><label>De</label><input type="date" value={inicioLivre} onChange={(e) => setInicioLivre(e.target.value)} /></div>
            <div className="an-filtro"><label>Até</label><input type="date" value={fimLivre} onChange={(e) => setFimLivre(e.target.value)} /></div>
          </>
        )}
        <div className="an-filtro">
          <label>Obra</label>
          <select value={obraId} onChange={(e) => setObraId(e.target.value)}>
            <option value="">Todas as obras</option>
            {obras.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </div>
        <div className="an-filtros-acoes">
          <button className="btn btn-secondary" onClick={carregar} disabled={carregando}>
            {carregando ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Atualizar
          </button>
          <button className="btn btn-primary" onClick={handlePDF} disabled={gerandoPDF || carregando}>
            {gerandoPDF ? <Loader2 size={16} className="spin" /> : <FileDown size={16} />} Gerar PDF do relatório
          </button>
        </div>
      </div>

      {erroExcluidos && (
        <div className="an-aviso">
          <AlertTriangle size={15} />
          <span>Não consegui carregar os pedidos já excluídos (o histórico guardado). A análise abaixo mostra só os pedidos que existem agora. Se acabou de atualizar o app, confira se o SQL de atualização foi rodado no Supabase.</span>
        </div>
      )}

      {analise.vazio ? (
        <div className="empty-state">
          <div className="empty-icon"><BarChart3 size={26} /></div>
          <h3>Nenhum pedido neste filtro</h3>
          <p>Troque o período ou a obra para ver os indicadores.</p>
        </div>
      ) : (
        <>
          <div className="an-kpis">
            {kpis.map((k) => {
              const Icone = ICONES_KPI[k.id] || Package;
              return (
                <div key={k.id} className={`an-kpi tom-${k.tom}`}>
                  <div className="an-kpi-icone"><Icone size={17} /></div>
                  <div className="an-kpi-valor">{k.valor}</div>
                  <div className="an-kpi-rotulo">{k.rotulo}</div>
                  <div className="an-kpi-sub">{k.sub}</div>
                </div>
              );
            })}
          </div>

          <section className="an-destaques">
            <h3><BarChart3 size={16} /> Destaques do período</h3>
            <ul>{analise.destaques.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </section>

          <div className="an-grade">
            <CartaoGrafico
              largo titulo="Pedidos por mês"
              sub={analise.mesesLimitados ? "Agrupado pelo mês de lançamento. Mostrando os últimos 12 meses." : "Agrupado pelo mês de lançamento do pedido."}
            >
              <ColunasMensais meses={analise.porMes} />
            </CartaoGrafico>

            <CartaoGrafico titulo="Prazo pedido pela obra" sub={`Dias úteis entre o lançamento e a data necessária. Barras escuras ficam abaixo de ${PRAZO_MINIMO} dias úteis.`}>
              <BarrasHorizontais itens={series.prazo} />
            </CartaoGrafico>

            <CartaoGrafico titulo="Pedidos por prioridade">
              <Rosca itens={analise.porPrioridade} total={analise.total} />
            </CartaoGrafico>

            <CartaoGrafico titulo="Prazo curto por obra" sub="Pedidos com menos de 5 dias úteis. Entre parênteses, a parcela dos pedidos da própria obra.">
              <BarrasHorizontais itens={series.curtoObra} vazio="Nenhum pedido de prazo curto." />
            </CartaoGrafico>

            <CartaoGrafico titulo="Prazo curto por solicitante" sub="Quem lançou os pedidos com prazo abaixo do padrão.">
              <BarrasHorizontais itens={series.curtoSol} vazio="Nenhum pedido de prazo curto." />
            </CartaoGrafico>

            <CartaoGrafico titulo="Pendências por obra" sub="Quantas vezes um pedido foi marcado como pendência.">
              <BarrasHorizontais itens={series.pendObra} vazio="Nenhuma pendência registrada." />
            </CartaoGrafico>

            <CartaoGrafico titulo="Pedidos com pendência por solicitante" sub="Em quantos pedidos de cada pessoa faltou informação ou algo travou a compra.">
              <BarrasHorizontais itens={series.pendSol} vazio="Nenhuma pendência registrada." />
            </CartaoGrafico>

            <CartaoGrafico titulo="Situação atual dos pedidos">
              <BarrasHorizontais itens={series.status} />
            </CartaoGrafico>

            <CartaoGrafico titulo="Tempo médio até cada etapa" sub="Em dias, desde o lançamento, só com os pedidos que passaram pela etapa.">
              <BarrasHorizontais itens={series.tempos} vazio="Ainda sem etapas registradas." />
            </CartaoGrafico>
          </div>

          <section className="an-tabela-cartao">
            <h3>Pedidos com prazo abaixo de {PRAZO_MINIMO} dias úteis e justificativas</h3>
            <p className="an-cartao-sub">Pedidos já excluídos do sistema continuam aqui, marcados como excluídos.</p>
            {analise.listaPrazoCurto.length === 0 ? (
              <p className="an-vazio">Nenhum pedido com prazo curto no período.</p>
            ) : (
              <>
                <div className="an-tabela-rolagem">
                  <table className="an-tabela">
                    <thead>
                      <tr><th>Data</th><th>Pedido</th><th>Obra</th><th>Solicitante</th><th>Prazo</th><th>Justificativa</th></tr>
                    </thead>
                    <tbody>
                      {listaPrazo.map((l) => (
                        <tr key={l.id} className={l.excluido ? "excluido" : ""}>
                          <td>{fmtData(l.data)}</td>
                          <td><strong>{l.codigo}</strong> {l.titulo}{l.excluido && <span className="an-tag-excluido">excluído</span>}</td>
                          <td>{l.obra}</td>
                          <td>{l.solicitante}</td>
                          <td>{l.diasUteis} d.u.</td>
                          <td className={l.justificativa ? "" : "sem-just"}>{l.justificativa || "Sem justificativa registrada"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {analise.listaPrazoCurto.length > 15 && (
                  <button className="link-btn an-ver-mais" onClick={() => setMostrarTodasPrazo((v) => !v)}>
                    {mostrarTodasPrazo ? "Mostrar menos" : `Mostrar todos (${analise.listaPrazoCurto.length})`}
                  </button>
                )}
              </>
            )}
          </section>

          <section className="an-tabela-cartao">
            <h3>Pendências registradas</h3>
            <p className="an-cartao-sub">Cada vez que um pedido foi marcado como pendência, com o motivo informado.</p>
            {analise.listaPendencias.length === 0 ? (
              <p className="an-vazio">Nenhuma pendência registrada no período.</p>
            ) : (
              <>
                <div className="an-tabela-rolagem">
                  <table className="an-tabela">
                    <thead>
                      <tr><th>Data</th><th>Pedido</th><th>Obra</th><th>Aberta por</th><th>Motivo</th><th>Situação</th></tr>
                    </thead>
                    <tbody>
                      {listaPend.map((l, i) => (
                        <tr key={i} className={l.excluido ? "excluido" : ""}>
                          <td>{fmtDataMs(l.em)}</td>
                          <td><strong>{l.codigo}</strong> {l.titulo}{l.excluido && <span className="an-tag-excluido">excluído</span>}</td>
                          <td>{l.obra}</td>
                          <td>{l.por}</td>
                          <td>{l.motivo}</td>
                          <td>{l.resolvida ? `Resolvida (${fmtNum(l.duracaoDias)} d)` : <span className="an-tag-aberta">Aberta</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {analise.listaPendencias.length > 15 && (
                  <button className="link-btn an-ver-mais" onClick={() => setMostrarTodasPend((v) => !v)}>
                    {mostrarTodasPend ? "Mostrar menos" : `Mostrar todas (${analise.listaPendencias.length})`}
                  </button>
                )}
              </>
            )}
          </section>

          <p className="an-rodape-nota">
            <Archive size={13} /> Pedidos excluídos do sistema ficam guardados num histórico só para este relatório e continuam contando nos números.
          </p>
        </>
      )}
    </div>
  );
}
