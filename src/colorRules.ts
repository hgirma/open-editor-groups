import * as vscode from 'vscode';
import { isValidSlot } from './colors';
import { ColorRule } from './config';
import { lookupUri } from './projectResolver';

export interface CompiledColorRule {
  regex: RegExp;
  slot: number;
}

const warned = new Set<string>();

/** Compiles the `openEditorGroups.colorRules` setting, skipping (and warning once about) invalid entries. */
export function compileColorRules(rules: ColorRule[]): CompiledColorRule[] {
  const compiled: CompiledColorRule[] = [];
  for (const rule of rules) {
    if (!isValidSlot(rule.color)) {
      warnOnce(`color rule "${rule.pattern}" has an invalid color ${String(rule.color)} (expected 1-12); skipped`);
      continue;
    }
    try {
      compiled.push({ regex: new RegExp(rule.pattern, 'i'), slot: rule.color });
    } catch (err) {
      warnOnce(`color rule "${rule.pattern}" is not a valid regular expression (${err instanceof Error ? err.message : String(err)}); skipped`);
    }
  }
  return compiled;
}

/** Palette slot of the first rule matching the file's workspace-relative path (full path outside the workspace). */
export function matchColorRule(rules: readonly CompiledColorRule[], uri: vscode.Uri): number | undefined {
  if (rules.length === 0) {
    return undefined;
  }
  const path = vscode.workspace.asRelativePath(lookupUri(uri)).replace(/\\/g, '/');
  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    if (rule.regex.test(path)) {
      return rule.slot;
    }
  }
  return undefined;
}

function warnOnce(message: string): void {
  if (!warned.has(message)) {
    warned.add(message);
    console.warn(`[Open Editor Groups] ${message}`);
  }
}
