// ============================================================
// Camada de armazenamento do app — versão Supabase.
//
// Cada ação (criar, editar, apagar um item) mexe SÓ na linha
// daquele item específico no banco — nunca manda a lista inteira
// de volta. Isso evita que uma tela desatualizada de uma pessoa
// apague, sem querer, algo que outra pessoa acabou de criar.
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
// colunas das tabelas no Postgres (snake_case). Só listamos os
// nomes que realmente mudam — o resto (id, nome, papel, senha,
// codigo, titulo, material, prioridade, status, cancelado,
// pendente, comentarios, historico, read, message...) é igual
// nos dois lados.
const CAMEL_TO_SNAKE = {
  obraId: "obra_id", fotoUrl: "foto_url", dataLancamento: "data_lancamento",
  dataNecessidade: "data_necessidade", lancadoPor: "lancado_por",
  justificativaUrgencia: "justificativa_urgencia", motivoPendencia: "motivo_pendencia",
  mustReset: "must_reset", responsavelCompras: "responsavel_compras",
  perfilCliente: "perfil_cliente", createdAt: "created_at",
  userName: "user_name", pedidoId: "pedido_id",
};
const SNAKE_TO_CAMEL = Object.fromEntries(Object.entries(CAMEL_TO_SNAKE).map(([k, v]) => [v, k]));

function toRow(obj) {
  const row = {};
  for (const [k, v] of Object.entries(obj)) row[CAMEL_TO_SNAKE[k] || k] = v;
  return row;
}
function fromRow(row) {
  const obj = {};
  for (const [k, v] of Object.entries(row)) obj[SNAKE_TO_CAMEL[k] || k] = v;
  if (obj.createdAt) obj.createdAt = new Date(obj.createdAt).getTime();
  return obj;
}

// Leitura de uma tabela inteira (usada só para carregar a tela
// e para a atualização automática em segundo plano).
export async function storageGet(key, shared = false) {
  if (!shared) return getPersonal(key);
  try {
    const { data, error } = await supabase.from(key).select("*");
    if (error) throw error;
    return (data || []).map(fromRow);
  } catch (e) {
    console.error("storageGet (supabase) erro em", key, e);
    return null;
  }
}

// Usado só na primeira vez que o app roda (tabela de usuários
// ainda vazia) para semear a equipe inicial — como a tabela está
// vazia nesse momento, inserir em lote aqui é seguro.
export async function storageSet(key, value, shared = false) {
  if (!shared) return setPersonal(key, value);
  try {
    const rows = (value || []).map(toRow);
    if (rows.length > 0) {
      const { error } = await supabase.from(key).insert(rows);
      if (error) throw error;
    }
    return true;
  } catch (e) {
    console.error("storageSet (supabase) erro em", key, e);
    return false;
  }
}

// ---------- Operações linha a linha (o jeito certo de salvar) ----------

export async function dbInsert(table, obj) {
  const { error } = await supabase.from(table).insert(toRow(obj));
  if (error) throw error;
}

export async function dbUpdate(table, id, patch) {
  const { error } = await supabase.from(table).update(toRow(patch)).eq("id", id);
  if (error) throw error;
}

export async function dbDelete(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}

export async function dbDeleteBy(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) throw error;
}

export async function dbMarkAllRead(userName) {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_name", userName)
    .eq("read", false);
  if (error) throw error;
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
