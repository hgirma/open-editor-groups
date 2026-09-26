import * as vscode from 'vscode';
import { BAR_ICON_ID, ColorAssigner, colorIdForSlot } from './colors';
import { ExtensionConfig, getConfig } from './config';
import { buildModel, emptyModel, Model, Node, ProjectNode, TabNode } from './model';
import { ProjectResolver } from './projectResolver';

export const VIEW_ID = 'openEditorGroups.view';

/**
 * Tree data provider for the "Open Editors by Project" view.
 *
 * The whole model is rebuilt (debounced) whenever tabs change. Tree items carry
 * stable ids so VS Code keeps expansion state across rebuilds.
 */
export class OpenEditorGroupsProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _onDidChangeModel = new vscode.EventEmitter<Model>();
  /** Fires after a rebuilt model has been published to the tree. */
  readonly onDidChangeModel = this._onDidChangeModel.event;

  private model: Model = emptyModel();
  private hasModel = false;
  private building: Promise<Model> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;

  constructor(
    private readonly resolver: ProjectResolver,
    private readonly colors: ColorAssigner,
  ) {}

  get currentModel(): Model {
    return this.model;
  }

  /** Rebuilds the model after a short delay, coalescing bursts of tab events. */
  scheduleRefresh(delayMs = 50): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.rebuild();
    }, delayMs);
  }

  rebuild(): Promise<Model> {
    const version = ++this.version;
    const build = buildModel(this.resolver, this.colors, getConfig()).then(
      (model) => {
        if (version === this.version) {
          this.model = model;
          this.hasModel = true;
          this._onDidChangeTreeData.fire(undefined);
          this._onDidChangeModel.fire(model);
        }
        return model;
      },
      (err) => {
        console.error('[Open Editor Groups] failed to build model', err);
        return this.model;
      },
    );
    this.building = build;
    return build;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      if (!this.hasModel) {
        await (this.building ?? this.rebuild());
      }
      return this.model.roots;
    }
    return element.kind === 'tab' ? [] : element.children;
  }

  getParent(element: Node): Node | undefined {
    return element.parent;
  }

  getTreeItem(element: Node): vscode.TreeItem {
    const cfg = getConfig();
    switch (element.kind) {
      case 'group': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = element.id;
        item.contextValue = 'editorGroup';
        item.tooltip = element.group.isActive ? `${element.label} (active)` : element.label;
        return item;
      }
      case 'project':
        return this.projectItem(element, cfg);
      case 'tab':
        return this.tabItem(element, cfg);
    }
  }

  private projectItem(node: ProjectNode, cfg: ExtensionConfig): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = node.id;
    item.description = node.description;
    item.contextValue = `project:${node.slot ? 'colorable' : 'plain'}${node.project ? ':hasFile' : ''}`;
    // When the files show their file-type icon the project color moves to the header.
    if (cfg.fileIconStyle === 'fileType' && node.slot) {
      item.iconPath = new vscode.ThemeIcon(BAR_ICON_ID, new vscode.ThemeColor(colorIdForSlot(node.slot)));
    }
    const lines: string[] = [node.label];
    if (node.project) {
      lines.push(displayPath(node.project.fileUri));
    } else if (node.workspaceFolder) {
      lines.push(displayPath(node.workspaceFolder.uri));
    }
    lines.push(`${node.children.length} ${node.children.length === 1 ? 'editor' : 'editors'}`);
    item.tooltip = lines.join('\n');
    return item;
  }

  private tabItem(node: TabNode, cfg: ExtensionConfig): vscode.TreeItem {
    const { tab, uri } = node;
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.resourceUri = uri;

    if (cfg.fileIconStyle === 'projectColorBar' || !uri) {
      item.iconPath = new vscode.ThemeIcon(BAR_ICON_ID, new vscode.ThemeColor(colorIdForSlot(node.parent.slot)));
    }

    const description: string[] = [];
    if (tab.isDirty) {
      description.push('●');
    }
    if (node.pathDescription) {
      description.push(node.pathDescription);
    }
    if (node.groupLabel) {
      description.push(node.groupLabel);
    }
    item.description = description.join(' ');

    const state: string[] = [];
    if (tab.isPinned) {
      state.push('Pinned');
    }
    if (tab.isPreview) {
      state.push('Preview');
    }
    if (tab.isDirty) {
      state.push('Unsaved changes');
    }
    const lines: string[] = [uri ? displayPath(uri) : tab.label];
    if (node.parent.category === 'project' || node.parent.category === 'folder') {
      lines.push(`Project: ${node.parent.label}`);
    }
    lines.push(`Editor group ${tab.group.viewColumn}${state.length ? ` · ${state.join(' · ')}` : ''}`);
    item.tooltip = lines.join('\n');

    item.contextValue = [
      'tab',
      uri ? 'file' : 'nofile',
      tab.isPinned ? 'pinned' : 'unpinned',
      tab.isDirty ? 'dirty' : 'clean',
      uri?.scheme === 'file' ? 'local' : 'remote',
    ].join(':');

    item.command = { command: 'openEditorGroups.open', title: 'Open', arguments: [node] };
    return item;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this._onDidChangeTreeData.dispose();
    this._onDidChangeModel.dispose();
  }
}

function displayPath(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString(true);
}
