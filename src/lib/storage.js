// ============================================================
// Camada de armazenamento do app — versão Supabase.
//
// O resto do app (App.jsx) só chama storageGet/storageSet com
// uma "chave" (usuarios, obras, pedidos, notifications) e não
// sabe nada sobre banco de dados — essa é a única peça que
// entende Postgres/Supabase.
//
// "shared: true"  -> vai pro banco de verdade (todo mundo vê).
// "shared: false" -> fica só no navegador deste computador
//                    (usado apenas para lembrar quem está logado
//                    neste aparelho).
// ============================================================

import { supabase } from "./supabaseClient";

const PREFIX = "aeb-compras";

function personalKey(key) {
  return `${PREFIX}:personal:${key}`;
}
function getPersonal(key) {
  try {
    const raw = localStorage.getItem(personalKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function setPersonal(key, value) {
  try {
    localStorage.setItem(personalKey(key), JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

// Conversão entre o formato usado no app (camelCase) e as
// colunas das tabelas no Postgres (snake_case), tabela por tabela.
const TABLES = {
  usuarios: {
    toRow: (u) => ({ id: u.id, nome: u.nome, papel: u.papel, senha: u.senha, must_reset: !!u.mustReset }),
    fromRow: (r) => ({ id: r.id, nome: r.nome, papel: r.papel, senha: r.senha, mustReset: !!r.must_reset }),
  },
  obras: {
    toRow: (o) => ({ id: o.id, codigo: o.codigo, nome: o.nome, cliente: o.cliente || null, endereco: o.endereco || null, responsavel_compras: o.responsavelCompras || null, perfil_cliente: o.perfilCliente || null }),
    fromRow: (r) => ({
      id: r.id, codigo: r.codigo, nome: r.nome, cliente: r.cliente, endereco: r.endereco,
      responsavelCompras: r.responsavel_compras, perfilCliente: r.perfil_cliente,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    }),
  },
  pedidos: {
    toRow: (p) => ({
      id: p.id, codigo: p.codigo, obra_id: p.obraId, titulo: p.titulo, material: p.material,
      foto_url: p.fotoUrl || null, data_lancamento: p.dataLancamento, data_necessidade: p.dataNecessidade,
      prioridade: p.prioridade, status: p.status, lancado_por: p.lancadoPor,
      historico: p.historico || [], cancelado: !!p.cancelado, comentarios: p.comentarios || [],
      justificativa_urgencia: p.justificativaUrgencia || null,
      pendente: !!p.pendente, motivo_pendencia: p.motivoPendencia || null,
    }),
    fromRow: (r) => ({
      id: r.id, codigo: r.codigo, obraId: r.obra_id, titulo: r.titulo, material: r.material,
      fotoUrl: r.foto_url, dataLancamento: r.data_lancamento, dataNecessidade: r.data_necessidade,
      prioridade: r.prioridade, status: r.status, lancadoPor: r.lancado_por,
      historico: r.historico || [], cancelado: !!r.cancelado, comentarios: r.comentarios || [],
      justificativaUrgencia: r.justificativa_urgencia,
      pendente: !!r.pendente, motivoPendencia: r.motivo_pendencia,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    }),
  },
  notifications: {
    toRow: (n) => ({
      id: n.id, user_name: n.userName, pedido_id: n.pedidoId || null, obra_id: n.obraId || null,
      message: n.message, read: !!n.read,
      created_at: new Date(n.timestamp || Date.now()).toISOString(),
    }),
    fromRow: (r) => ({
      id: r.id, userName: r.user_name, pedidoId: r.pedido_id, obraId: r.obra_id,
      message: r.message, read: !!r.read,
      timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    }),
  },
};

export async function storageGet(key, shared = false) {
  if (!shared) return getPersonal(key);
  const table = TABLES[key];
  if (!table) return null;
  try {
    const { data, error } = await supabase.from(key).select("*");
    if (error) throw error;
    return (data || []).map(table.fromRow);
  } catch (e) {
    console.error("storageGet (supabase) erro em", key, e);
    return null;
  }
}

export async function storageSet(key, value, shared = false) {
  if (!shared) return setPersonal(key, value);
  const table = TABLES[key];
  if (!table) return false;
  try {
    const rows = (value || []).map(table.toRow);
    const nextIds = new Set(rows.map((r) => r.id));

    const { data: existing, error: selError } = await supabase.from(key).select("id");
    if (selError) throw selError;
    const idsToDelete = (existing || []).map((r) => r.id).filter((id) => !nextIds.has(id));

    if (idsToDelete.length > 0) {
      const { error: delError } = await supabase.from(key).delete().in("id", idsToDelete);
      if (delError) throw delError;
    }
    if (rows.length > 0) {
      const { error: upsertError } = await supabase.from(key).upsert(rows, { onConflict: "id" });
      if (upsertError) throw upsertError;
    }
    return true;
  } catch (e) {
    console.error("storageSet (supabase) erro em", key, e);
    return false;
  }
}

export async function storageRemove(key, shared = false) {
  if (!shared) {
    localStorage.removeItem(personalKey(key));
    return true;
  }
  return true;
}

// Sobe a foto (já comprimida) para o espaço de arquivos do Supabase e devolve
// o link público — assim a tabela de pedidos guarda só um link curto, em vez
// do texto gigante da imagem, o que evita gastar tráfego toda vez que a lista
// de pedidos é atualizada.
export async function uploadFotoPedido(blob) {
  const nomeArquivo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage
    .from("fotos-pedidos")
    .upload(nomeArquivo, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("fotos-pedidos").getPublicUrl(nomeArquivo);
  return data.publicUrl;
}
