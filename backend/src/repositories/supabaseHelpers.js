import { supabaseAdmin } from '../config/supabase.js';

export async function run(request) {
  const { data, error, count } = await request;
  if (error) {
    const failure = new Error(error.message);
    failure.code = error.code;
    failure.status = error.status || 500;
    throw failure;
  }
  return { data, count };
}

export async function rows(table, columns = '*') {
  return pagedRows(() => supabaseAdmin.from(table).select(columns));
}

export async function pagedRows(buildRequest) {
  const result = [];
  let start = 0;
  let page;
  do {
    const { data } = await run(buildRequest().range(start, start + 999));
    page = data || [];
    result.push(...page);
    start += page.length;
  } while (page.length === 1000);
  return result;
}

export async function one(table, id, columns = '*') {
  const { data } = await run(supabaseAdmin.from(table).select(columns).eq('id', id).maybeSingle());
  return data || null;
}

export async function insert(table, value, columns = '*') {
  const { data } = await run(supabaseAdmin.from(table).insert(value).select(columns).single());
  return data;
}

export async function updateById(table, id, value, columns = '*') {
  const { data } = await run(supabaseAdmin.from(table).update(value).eq('id', id).select(columns).maybeSingle());
  return data || null;
}

export async function removeById(table, id, columns = '*') {
  const { data } = await run(supabaseAdmin.from(table).delete().eq('id', id).select(columns).maybeSingle());
  return data || null;
}

export function paginate(items, limit, offset) {
  const start = Math.max(0, Number(offset) || 0);
  const end = limit == null ? undefined : start + Math.max(0, Number(limit) || 0);
  return items.slice(start, end);
}

export function matches(value, term) {
  return String(value || '').toLocaleLowerCase().includes(String(term || '').toLocaleLowerCase());
}

export function byId(items) {
  return new Map(items.map((item) => [item.id, item]));
}
