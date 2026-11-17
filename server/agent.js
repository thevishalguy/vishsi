import crypto from 'node:crypto';
import os from 'node:os';
import { DEFAULTS, IS_WINDOWS } from './config.js';
import { getRoot } from './workspace.js';
import { readProjectMemory } from './files.js';
import { TOOLS, executeTool, describeToolCall, READ_ONLY_TOOLS } from './tools.js';
import { streamTurn, estimateTokens, completeOnce } from './llm.js';
import * as sessions from './sessions.js';

const MAX_ITERATIONS = 25;
const CONTEXT_BUDGET = 128_000; // tokens, for the usage meter

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function approvalKey(name, input) {
  if (name === 'execute_command') {
    const first = String(input?.command || '').trim().split(/\s+/)[0] || '';
    return `cmd:${first.toLowerCase()}`;
  }
  return `tool:${name}`;
}

async function buildSystemPrompt(mode) {
  const memory = await readProjectMemory();
  const modeRules = {
    plan:
      'MODE: PLAN. You may only read and investigate. Do NOT call write_file, edit_file or execute_command — they will be refused. Produce a concrete, numbered implementation plan and ask the user to switch to Ask or Auto mode to carry it out.',
    ask:
      'MODE: ASK. Every file modification and shell command needs the user to approve it. Explain briefly what you are about to do before calling such a tool. If a request is denied, stop and ask the user how to proceed.',
    auto:
      'MODE: AUTO. You may modify files and run commands without asking. Still prefer small, verifiable steps, and run tests or commands to check your work.',
  };

  const lines = [
    'You are VishSi, the coding agent inside a local agentic IDE of the same name. You work directly on the files of the open workspace through tools. If you are asked who you are, you are VishSi.',
    '',
    '## Environment',
    `- OS: ${os.platform()} ${os.release()}`,
    `- Default shell for execute_command: ${IS_WINDOWS ? 'PowerShell (powershell.exe -Command)' : 'bash -lc'}`,
    `- Workspace root: ${getRoot()}`,
    '- All tool paths are relative to the workspace root. Paths outside it are refused.',
    '',
    '## Working rules',
    '- Read a file before editing it; edit_file needs the exact existing text.',
    '- Prefer edit_file (targeted search-and-replace) over write_file for existing files.',
    '- Every write is snapshotted automatically, so the user can revert.',
    '- After changing code, verify it: run the build, the tests, or browse the dev server.',
    '- Keep answers short and concrete. Report failures honestly, with the actual error output.',
    '- Never print secrets or API keys back to the user.',
    '',
    modeRules[mode] || modeRules.ask,
  ];

  if (memory) {
    lines.push(
      '',
      `## Project memory (${memory.name}, loaded from the workspace root)`,
      'These are the project rules. Follow them.',
      '',
      memory.text
    );
  }
  return lines.join('\n');
}

/**
 * One agent runner per WebSocket connection.
 */
export class AgentRunner {
  constructor({ send }) {
    this.send = send;
    this.sessionAllow = new Set();
    this.pending = new Map(); // requestId -> { resolve }
    this.abortController = null;
    this.running = false;
    this.messages = [];
    this.sessionId = null;
    this.settings = {
      mode: 'ask',
      provider: DEFAULTS.provider,
      baseUrl: DEFAULTS.baseUrl,
      model: DEFAULTS.model,
    };
  }

  emit(kind, payload = {}) {
    this.send({ type: 'agent', ev: { kind, ...payload } });
  }

  async attachSession(sessionId) {
    const { meta, messages } = await sessions.loadSession(sessionId);
    if (!meta) throw new Error(`Unknown session: ${sessionId}`);
    this.sessionId = sessionId;
    this.messages = messages;
    if (meta.model) this.settings.model = meta.model;
    if (meta.provider) this.settings.provider = meta.provider;
    if (meta.baseUrl) this.settings.baseUrl = meta.baseUrl;
    return { meta, messages };
  }

  setSettings(patch = {}) {
    this.settings = { ...this.settings, ...patch };
    if (this.sessionId) {
      sessions
        .updateMeta(this.sessionId, {
          model: this.settings.model,
          provider: this.settings.provider,
          baseUrl: this.settings.baseUrl,
        })
        .catch(() => {});
    }
    return this.settings;
  }

  resolveApproval(requestId, decision) {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    entry.resolve(decision);
    this.emit('approval_resolved', { requestId, decision });
    return true;
  }

  abort() {
    if (this.abortController) this.abortController.abort();
    for (const [requestId, entry] of this.pending) {
      entry.resolve('deny');
      this.emit('approval_resolved', { requestId, decision: 'deny' });
    }
    this.pending.clear();
    this.running = false;
  }

  async requestApproval({ name, input }) {
    const key = approvalKey(name, input);
    if (this.sessionAllow.has(key)) return 'session';
    const requestId = newId('appr');
    const label = describeToolCall(name, input);
    this.emit('approval_request', {
      requestId,
      name,
      input,
      key,
      title: label.title,
      subtitle: label.subtitle,
    });
    const decision = await new Promise((resolve) => {
      this.pending.set(requestId, { resolve });
    });
    if (decision === 'session') this.sessionAllow.add(key);
    return decision;
  }

  reportUsage(system) {
    const tokens = estimateTokens(this.messages, system);
    this.emit('usage', {
      tokens,
      budget: CONTEXT_BUDGET,
      percent: Math.min(100, Math.round((tokens / CONTEXT_BUDGET) * 100)),
      messages: this.messages.length,
    });
  }

  /** /compact — summarize all but the last `keep` messages into one note. */
  async compact({ keep = 4 } = {}) {
    if (this.messages.length <= keep + 1) {
      this.emit('system_note', { text: 'Nothing to compact yet.' });
      return;
    }
    const older = this.messages.slice(0, this.messages.length - keep);
    const recent = this.messages.slice(this.messages.length - keep);
    const transcript = older
      .map((m) => {
        const text = (m.content || [])
          .map((b) => {
            if (b.type === 'text') return b.text;
            if (b.type === 'tool_use') return `[tool ${b.name} ${JSON.stringify(b.input).slice(0, 400)}]`;
            if (b.type === 'tool_result') return `[result ${String(b.text).slice(0, 600)}]`;
            return '';
          })
          .join('\n');
        return `${m.role.toUpperCase()}: ${text}`;
      })
      .join('\n\n')
      .slice(0, 60_000);

    this.emit('system_note', { text: 'Compacting conversation…' });
    let summary;
    try {
      summary = await completeOnce({
        provider: this.settings.provider,
        baseUrl: this.settings.baseUrl,
        model: this.settings.model,
        system:
          'Summarize this coding-session transcript for an agent that will continue the work. Keep: the user goal, decisions made, files created or changed (with paths), commands run and their outcomes, and anything still outstanding. Be specific and terse. No preamble.',
        messages: [{ role: 'user', content: [{ type: 'text', text: transcript }] }],
        maxTokens: 1500,
      });
    } catch (err) {
      this.emit('error', { message: `Compaction failed: ${err.message}` });
      return;
    }

    this.messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `[Earlier conversation compacted]\n\n${summary}`,
          },
        ],
      },
      ...recent,
    ];
    if (this.sessionId) await sessions.replaceMessages(this.sessionId, this.messages);
    this.emit('compacted', { summary });
    this.reportUsage(await buildSystemPrompt(this.settings.mode));
  }

  /** Main loop: user text in, streamed assistant turns + tool calls out. */
  async run(userText) {
    if (this.running) {
      this.emit('error', { message: 'A turn is already running.' });
      return;
    }
    this.running = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      if (!this.sessionId) {
        const meta = await sessions.createSession({
          title: userText.slice(0, 60) || 'New session',
          model: this.settings.model,
          provider: this.settings.provider,
          baseUrl: this.settings.baseUrl,
        });
        this.sessionId = meta.id;
        this.emit('session_created', { meta });
      }

      const userMessage = { role: 'user', content: [{ type: 'text', text: userText }] };
      this.messages.push(userMessage);
      await sessions.appendMessage(this.sessionId, userMessage);

      const system = await buildSystemPrompt(this.settings.mode);
      const tools =
        this.settings.mode === 'plan'
          ? TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.name))
          : TOOLS;

      this.emit('turn_start', { mode: this.settings.mode, model: this.settings.model });

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
        if (signal.aborted) break;

        let result;
        try {
          result = await streamTurn({
            provider: this.settings.provider,
            baseUrl: this.settings.baseUrl,
            model: this.settings.model,
            system,
            messages: this.messages,
            tools,
            signal,
            onText: (text, channel) => {
              this.emit(channel === 'thinking' ? 'thinking_delta' : 'text_delta', { text });
            },
            onToolCallStart: ({ id, name }) => {
              this.emit('tool_pending', { id, name });
            },
          });
        } catch (err) {
          if (signal.aborted) break;
          this.emit('error', { message: err.message });
          break;
        }

        const assistantContent = [];
        if (result.text) assistantContent.push({ type: 'text', text: result.text });
        for (const call of result.toolCalls) {
          assistantContent.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.input,
          });
        }
        if (!assistantContent.length) {
          assistantContent.push({ type: 'text', text: '' });
        }
        const assistantMessage = { role: 'assistant', content: assistantContent };
        this.messages.push(assistantMessage);
        await sessions.appendMessage(this.sessionId, assistantMessage);
        this.emit('assistant_message', {
          text: result.text,
          reasoning: result.reasoning || '',
          toolCalls: result.toolCalls.map((c) => ({
            ...c,
            ...describeToolCall(c.name, c.input),
          })),
          usage: result.usage || {},
        });

        if (!result.toolCalls.length) {
          this.emit('turn_end', { stopReason: result.stopReason || 'stop' });
          break;
        }

        const resultBlocks = [];
        for (const call of result.toolCalls) {
          if (signal.aborted) break;
          const label = describeToolCall(call.name, call.input);
          this.emit('tool_call', {
            id: call.id,
            name: call.name,
            input: call.input,
            ...label,
          });

          const toolDef = TOOLS.find((t) => t.name === call.name);
          const mutating = toolDef ? toolDef.mutating : true;

          if (this.settings.mode === 'plan' && mutating) {
            const text = `Refused: ${call.name} is not allowed in Plan Mode (read-only). Finish the plan instead, then the user can switch to Ask or Auto mode.`;
            this.emit('tool_result', { id: call.id, text, is_error: true, refused: true });
            resultBlocks.push({
              type: 'tool_result',
              tool_use_id: call.id,
              name: call.name,
              text,
              is_error: true,
            });
            continue;
          }

          if (this.settings.mode === 'ask' && mutating) {
            const decision = await this.requestApproval({ name: call.name, input: call.input });
            if (decision === 'deny') {
              const text = `Denied by the user: ${call.name}. Do not retry this; ask what to do differently.`;
              this.emit('tool_result', { id: call.id, text, is_error: true, refused: true });
              resultBlocks.push({
                type: 'tool_result',
                tool_use_id: call.id,
                name: call.name,
                text,
                is_error: true,
              });
              continue;
            }
          }

          const toolResult = await executeTool(call.name, call.input || {}, {
            emit: (payload) => this.emit('tool_progress', { id: call.id, ...payload }),
          });
          this.emit('tool_result', {
            id: call.id,
            text: toolResult.text,
            is_error: Boolean(toolResult.is_error),
            meta: toolResult.meta || {},
          });
          resultBlocks.push({
            type: 'tool_result',
            tool_use_id: call.id,
            name: call.name,
            text: toolResult.text,
            is_error: Boolean(toolResult.is_error),
          });
        }

        if (!resultBlocks.length) break;
        const toolMessage = { role: 'tool', content: resultBlocks };
        this.messages.push(toolMessage);
        await sessions.appendMessage(this.sessionId, toolMessage);
        this.reportUsage(system);

        if (iteration === MAX_ITERATIONS - 1) {
          this.emit('error', {
            message: `Stopped after ${MAX_ITERATIONS} tool iterations. Send another message to continue.`,
          });
        }
      }

      this.reportUsage(system);
      if (signal.aborted) this.emit('aborted', {});
    } finally {
      this.running = false;
      this.abortController = null;
      this.emit('idle', {});
    }
  }
}

export { buildSystemPrompt, CONTEXT_BUDGET };
