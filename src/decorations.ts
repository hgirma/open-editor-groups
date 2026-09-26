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

  private model: Model = emptyModel();
  private projectNameByUri = new Map<string, string>();

  setModel(model: Model): void {
    const changed = new Set<string>([...this.model.slotByUri.keys(), ...model.slotByUri.keys()]);
    this.model = model;
    this.projectNameByUri = new Map();
    for (const node of model.byTab.values()) {
      if (node.uri) {
        this.projectNameByUri.set(node.uri.toString(), node.parent.label);
      }
    }
    if (changed.size > 0) {
      this._onDidChange.fire([...changed].map((s) => vscode.Uri.parse(s)));
    }
  }

  /** Re-queries every decoration, e.g. after the setting was toggled. */
  refreshAll(): void {
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!getConfig().colorizeTabs) {
      return undefined;
    }
    const slot = this.model.slotByUri.get(uri.toString());
    if (!slot) {
      return undefined;
    }
    const decoration = new vscode.FileDecoration(undefined, this.projectNameByUri.get(uri.toString()), new vscode.ThemeColor(colorIdForSlot(slot)));
    decoration.propagate = false;
    return decoration;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
