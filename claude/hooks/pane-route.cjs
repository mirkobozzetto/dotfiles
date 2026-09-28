#!/usr/bin/env node
// Hard lock for ~/.claude/rules/pane.md: every Bash command Mirko should SEE is
// rewritten to run inside a visible pane via bin/pane-run, whichever
// multiplexer he is in - tmux or herdr. The runner picks the backend.
//
// This hook is the ONLY PreToolUse hook allowed to rewrite Bash. The docs are
// explicit that matching hooks run in parallel and that with several
// `updatedInput` the last one to finish wins, non-deterministically. rtk also
// rewrites Bash, so it is invoked from here and composed instead of racing.
//
// Wrapping breaks pattern matching in settings.json permissions, so the deny /
// ask lists are evaluated HERE against the pre-wrap command and re-emitted.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const RUNNER = path.join(HOME, '.claude', 'bin', 'pane-run');
const SETTINGS = path.join(HOME, '.claude', 'settings.json');

// Silent reads stay in the hidden shell: sending them to the pane floods it and
// pays the polling latency on every grep.
const SILENT = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'fd', 'find', 'wc',
  'which', 'echo', 'pwd', 'stat', 'file', 'tree', 'jq', 'cd',
]);
const SILENT_GIT = new Set(['status', 'log', 'diff', 'show', 'branch']);

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function emit(payload) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...payload } }));
}

// Every segment must be a read, or `ls && bun install` would slip through local.
function isSilent(command) {
  const segments = command.split(/\|\||&&|;|\|/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return false;
  return segments.every((segment) => {
    const words = segment.split(/\s+/);
    const [head, second, third] = words;
    if (head === 'rtk') return second === 'git' ? SILENT_GIT.has(third) : SILENT.has(second);
    if (head === 'git') return SILENT_GIT.has(second);
    return SILENT.has(head);
  });
}

function globToRegExp(pattern) {
  const body = pattern.replace(/^Bash\(/, '').replace(/\)$/, '').replace(/:\*/g, '*');
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function permissionFor(command) {
  let permissions;
  try {
    permissions = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).permissions || {};
  } catch {
    return null; // unreadable settings must not block the command
  }
  for (const decision of ['deny', 'ask']) {
    for (const pattern of permissions[decision] || []) {
      if (!pattern.startsWith('Bash(')) continue;
      try {
        if (globToRegExp(pattern).test(command)) return decision;
      } catch {
        /* skip unparseable pattern */
      }
    }
  }
  return null;
}

function throughRtk(raw) {
  const result = spawnSync('rtk', ['hook', 'claude'], { input: raw, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0 || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout).hookSpecificOutput || null;
  } catch {
    return null;
  }
}

function main() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return;
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const toolInput = input.tool_input || {};
  const original = typeof toolInput.command === 'string' ? toolInput.command : '';
  if (!original) return;

  let command = original;
  const rtk = throughRtk(raw);
  if (rtk) {
    if (rtk.permissionDecision && rtk.permissionDecision !== 'allow') {
      emit(rtk);
      return;
    }
    if (rtk.updatedInput && typeof rtk.updatedInput.command === 'string') command = rtk.updatedInput.command;
  }

  const decision = permissionFor(command);
  if (decision === 'deny') {
    emit({
      permissionDecision: 'deny',
      permissionDecisionReason: 'Blocked by the Bash deny list in settings.json.',
    });
    return;
  }

  // Silence is judged on what the agent asked for, not on rtk's rewrite: rtk
  // renames commands (`cat` -> `rtk read`) and no allow list can track that.
  const inPane = Boolean(process.env.TMUX) || process.env.HERDR_ENV === '1';
  const skip =
    !inPane ||
    toolInput.run_in_background === true ||
    // Addressing the multiplexer or the runner through the runner would recurse.
    /^\s*(tmux\b|herdr\b|\S*pane-run\b)/.test(command) ||
    isSilent(original);

  const finalCommand = skip ? command : `${RUNNER} ${quote(input.cwd || process.cwd())} ${quote(command)}`;
  // Staying silent would leave an unrewritten command (a background job, a
  // plain binary) to dontAsk, which refuses what the same command in a pane gets.
  if (finalCommand === original) {
    emit({
      permissionDecision: decision === 'ask' ? 'ask' : 'allow',
      permissionDecisionReason: decision === 'ask' ? 'In the Bash ask list' : 'Not in the Bash deny list',
    });
    return;
  }

  emit({
    permissionDecision: decision === 'ask' ? 'ask' : 'allow',
    permissionDecisionReason: skip ? 'rtk rewrite' : 'Runs in a visible pane',
    updatedInput: { ...toolInput, command: finalCommand },
  });
}

main();
