import { getApiKey } from './config.js';

/**
 * Provider adapters over plain fetch — no SDKs, so the dependency tree and
 * memory footprint stay small.
 *
 * Internal (provider-neutral) message shape:
 *   { role: 'user'|'assistant', content: [
 *       { type: 'text', text }
 *     | { type: 'tool_use', id, name, input }
 *   ]}
 *   { role: 'tool', content: [
 *       { type: 'tool_result', tool_use_id, name, text, is_error }
 *   ]}
 */

function blocksToText(content) {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/* ------------------------------- OpenAI-ish ------------------------------- */

function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'tool') {
      for (const r of m.content) {
        out.push({
          role: 'tool',
          tool_call_id: r.tool_use_id,
          content: String(r.text ?? '').slice(0, 100_000),
        });
      }
      continue;
    }
    if (m.role === 'assistant') {
      const toolUses = m.content.filter((b) => b.type === 'tool_use');
      const msg = { role: 'assistant', content: blocksToText(m.content) || null };
      if (toolUses.length) {
        msg.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        }));
      }
      out.push(msg);
      continue;
    }
    out.push({ role: 'user', content: blocksToText(m.content) });
  }
  return out;
}

function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/* ------------------------------- Anthropic ------------------------------- */

function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: m.content.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content: String(r.text ?? '').slice(0, 100_000),
          is_error: Boolean(r.is_error),
        })),
      });
      continue;
    }
    const content = m.content
      .map((b) => {
        if (b.type === 'text') return b.text ? { type: 'text', text: b.text } : null;
        if (b.type === 'tool_use') {
          return { type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} };
        }
        return null;
      })
      .filter(Boolean);
    if (content.length) out.push({ role: m.role, content });
  }
  return out;
}

/* ----------------------------- SSE line reader ---------------------------- */

async function* sseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

/* ------------------------------ Public entry ------------------------------ */

/**
 * Stream one assistant turn.
 * @returns {Promise<{text:string, toolCalls:Array, usage:object, stopReason:string}>}
 */
export async function streamTurn({
  provider = 'openai',
  baseUrl,
  model,
  system,
  messages,
  tools = [],
  maxTokens = 4096,
  temperature = 0.3,
  signal,
  onText = () => {},
  onToolCallStart = () => {},
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      'No API key. Put one in api_key.txt, or set API_KEY / API_KEY_FILE in .env'
    );
  }

  if (provider === 'anthropic') {
    return streamAnthropic({
      apiKey,
      baseUrl: (baseUrl || 'https://api.anthropic.com').replace(/\/$/, ''),
      model,
      system,
      messages,
      tools,
      maxTokens,
      temperature,
      signal,
      onText,
      onToolCallStart,
    });
  }
  return streamOpenAI({
    apiKey,
    baseUrl: (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model,
    system,
    messages,
    tools,
    maxTokens,
    temperature,
    signal,
    onText,
    onToolCallStart,
  });
}

async function streamOpenAI({
  apiKey,
  baseUrl,
  model,
  system,
  messages,
  tools,
  maxTokens,
  temperature,
  signal,
  onText,
  onToolCallStart,
}) {
  const body = {
    model,
    messages: toOpenAIMessages(system, messages),
    stream: true,
    temperature,
    max_tokens: maxTokens,
  };
  if (tools.length) {
    body.tools = toOpenAITools(tools);
    body.tool_choice = 'auto';
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Provider error ${res.status}: ${detail.slice(0, 1200)}`);
  }

  let text = '';
  let reasoning = '';
  const calls = new Map(); // index -> { id, name, argsText }
  const announced = new Set();
  let usage = {};
  let stopReason = 'stop';

  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') break;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    if (json.usage) usage = json.usage;
    const choice = json.choices && json.choices[0];
    if (!choice) continue;
    if (choice.finish_reason) stopReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      onText(delta.reasoning_content, 'thinking');
    }
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      onText(delta.content, 'text');
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!calls.has(idx)) calls.set(idx, { id: tc.id || `call_${idx}`, name: '', argsText: '' });
        const entry = calls.get(idx);
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name += tc.function.name;
        if (tc.function?.arguments) entry.argsText += tc.function.arguments;
        if (entry.name && !announced.has(idx)) {
          announced.add(idx);
          onToolCallStart({ id: entry.id, name: entry.name });
        }
      }
    }
  }

  const toolCalls = [...calls.values()].map((c) => ({
    id: c.id,
    name: c.name,
    input: safeJson(c.argsText),
  }));
  return { text, reasoning, toolCalls, usage, stopReason };
}

async function streamAnthropic({
  apiKey,
  baseUrl,
  model,
  system,
  messages,
  tools,
  maxTokens,
  temperature,
  signal,
  onText,
  onToolCallStart,
}) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    messages: toAnthropicMessages(messages),
  };
  if (system) body.system = system;
  if (tools.length) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Provider error ${res.status}: ${detail.slice(0, 1200)}`);
  }

  let text = '';
  let reasoning = '';
  let usage = {};
  let stopReason = 'end_turn';
  const blocks = new Map(); // index -> { type, name, id, jsonText }

  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    let ev;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }
    if (ev.type === 'content_block_start') {
      const cb = ev.content_block || {};
      blocks.set(ev.index, {
        type: cb.type,
        name: cb.name,
        id: cb.id,
        jsonText: '',
      });
      if (cb.type === 'tool_use') onToolCallStart({ id: cb.id, name: cb.name });
    } else if (ev.type === 'content_block_delta') {
      const d = ev.delta || {};
      if (d.type === 'text_delta') {
        text += d.text;
        onText(d.text, 'text');
      } else if (d.type === 'thinking_delta') {
        reasoning += d.thinking || '';
        onText(d.thinking || '', 'thinking');
      } else if (d.type === 'input_json_delta') {
        const b = blocks.get(ev.index);
        if (b) b.jsonText += d.partial_json || '';
      }
    } else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
      if (ev.usage) usage = { ...usage, ...ev.usage };
    } else if (ev.type === 'message_start') {
      if (ev.message?.usage) usage = { ...usage, ...ev.message.usage };
    } else if (ev.type === 'error') {
      throw new Error(`Provider stream error: ${JSON.stringify(ev.error).slice(0, 600)}`);
    }
  }

  const toolCalls = [...blocks.values()]
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: safeJson(b.jsonText) }));

  return { text, reasoning, toolCalls, usage, stopReason };
}

function safeJson(str) {
  if (!str || !str.trim()) return {};
  try {
    return JSON.parse(str);
  } catch {
    // Some providers emit trailing commentary; try the first balanced object.
    const start = str.indexOf('{');
    if (start === -1) return { _raw: str };
    let depth = 0;
    for (let i = start; i < str.length; i += 1) {
      if (str[i] === '{') depth += 1;
      else if (str[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(str.slice(start, i + 1));
          } catch {
            return { _raw: str };
          }
        }
      }
    }
    return { _raw: str };
  }
}

/** Rough token estimate (chars/4) for the context meter. */
export function estimateTokens(messages, system = '') {
  let chars = system.length;
  for (const m of messages) {
    for (const b of m.content || []) {
      if (b.type === 'text') chars += (b.text || '').length;
      else if (b.type === 'tool_use') chars += JSON.stringify(b.input || {}).length + 20;
      else if (b.type === 'tool_result') chars += String(b.text || '').length + 20;
    }
  }
  return Math.ceil(chars / 4);
}

/** Non-streaming single call, used by /compact. */
export async function completeOnce({ provider, baseUrl, model, system, messages, maxTokens = 1200 }) {
  const result = await streamTurn({
    provider,
    baseUrl,
    model,
    system,
    messages,
    tools: [],
    maxTokens,
    temperature: 0.2,
  });
  return result.text;
}
