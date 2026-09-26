import * as vscode from 'vscode';
import { descendantTabs, Model, Node, TabNode, tabSiblings } from './model';

export function isNode(arg: unknown): arg is Node {
  return typeof arg === 'object' && arg !== null && 'kind' in arg && 'id' in arg;
}

/**
 * The tabs a set of selected nodes stands for: a tab is itself, a container
 * (project, solution, pinned, editor group) is every tab below it. Deduplicated,
 * in selection order.
 */
export function tabsOf(nodes: readonly Node[]): TabNode[] {
  const seen = new Set<vscode.Tab>();
  const out: TabNode[] = [];
  for (const node of nodes) {
    const tabs = node.kind === 'tab' ? [node] : descendantTabs(node);
    for (const t of tabs) {
      if (!seen.has(t.tab)) {
        seen.add(t.tab);
        out.push(t);
      }
    }
  }
  return out;
}

/**
 * The tabs in the "scope" of each selected node: for a tab, the tabs listed
 * next to it (its project, or the whole flat list); for a container, every tab
 * below it. Used by "Close All in Project" style commands.
 */
export function scopeTabsOf(nodes: readonly Node[], model: Model): TabNode[] {
  const seen = new Set<vscode.Tab>();
  const out: TabNode[] = [];
  for (const node of nodes) {
    const tabs = node.kind === 'tab' ? tabSiblings(node, model) : descendantTabs(node);
    for (const t of tabs) {
      if (!seen.has(t.tab)) {
        seen.add(t.tab);
        out.push(t);
      }
    }
  }
  return out;
}
