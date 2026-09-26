import * as vscode from 'vscode';

/**
 * Remembers in which order tabs were last activated, for the
 * "most recently used" sort order. Tab objects keep their identity while
 * a tab is open, so they can be used as map keys.
 */
export class MruTracker implements vscode.Disposable {
  private readonly stamps = new Map<vscode.Tab, number>();
  private seq = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Seed with the currently active tabs; the active group's tab gets the highest stamp.
    for (const group of vscode.window.tabGroups.all) {
      if (!group.isActive && group.activeTab) {
        this.touch(group.activeTab);
      }
    }
    const active = vscode.window.tabGroups.activeTabGroup?.activeTab;
    if (active) {
      this.touch(active);
    }

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs((e) => {
        for (const tab of e.closed) {
          this.stamps.delete(tab);
        }
        for (const tab of [...e.opened, ...e.changed]) {
          if (tab.isActive) {
            this.touch(tab);
          }
        }
      }),
      vscode.window.tabGroups.onDidChangeTabGroups((e) => {
        for (const group of [...e.opened, ...e.changed]) {
          if (group.isActive && group.activeTab) {
            this.touch(group.activeTab);
          }
        }
      }),
    );
  }

  touch(tab: vscode.Tab): void {
    this.stamps.set(tab, ++this.seq);
  }

  /** Higher means more recently activated; `undefined` for tabs never activated in this session. */
  stampOf(tab: vscode.Tab): number | undefined {
    return this.stamps.get(tab);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.stamps.clear();
  }
}
