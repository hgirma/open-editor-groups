import * as vscode from 'vscode';
import { colorIdForSlot } from './colors';
import { getConfig } from './config';
import { emptyModel, Model } from './model';

/**
 * Colors the labels of open files (most visibly: the editor tab titles) with
 * their project color. Opt-in through `openEditorGroups.colorizeTabs`.
 */
export class ProjectColorDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  private model: Model = emptyModel(getConfig());
  private enabled = getConfig().colorizeTabs;
  private projectNameByUri = new Map<string, string>();

  setModel(model: Model): void {
    // Only resources whose slot appeared, disappeared or changed need to be re-decorated.
    const changed: vscode.Uri[] = [];
    for (const [key, slot] of model.slotByUri) {
      if (this.model.slotByUri.get(key) !== slot) {
        changed.push(vscode.Uri.parse(key));
      }
    }
    for (const key of this.model.slotByUri.keys()) {
      if (!model.slotByUri.has(key)) {
        changed.push(vscode.Uri.parse(key));
      }
    }
    this.model = model;
    this.enabled = model.cfg.colorizeTabs;
    this.projectNameByUri = new Map();
    for (const node of model.byTab.values()) {
      if (node.uri && node.projectLabel) {
        this.projectNameByUri.set(node.uri.toString(), node.projectLabel);
      }
    }
    if (changed.length > 0) {
      this._onDidChange.fire(changed);
    }
  }

  /** Re-queries every decoration, e.g. after the setting was toggled. */
  refreshAll(): void {
    this.enabled = getConfig().colorizeTabs;
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.enabled) {
      return undefined;
    }
    const key = uri.toString();
    const slot = this.model.slotByUri.get(key);
    if (!slot) {
      return undefined;
    }
    const decoration = new vscode.FileDecoration(undefined, this.projectNameByUri.get(key), new vscode.ThemeColor(colorIdForSlot(slot)));
    decoration.propagate = false;
    return decoration;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
