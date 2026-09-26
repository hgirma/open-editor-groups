import * as vscode from 'vscode';
import { BAR_ICON_ID, colorIdForSlot } from './colors';
import { DirtyIndicator, ExtensionConfig, getConfig } from './config';
import { displayPath } from './projectResolver';
import {
  buildModel,
  descendantTabs,
  editorGroupText,
  emptyModel,
  GroupNode,
  Model,
  ModelServices,
  Node,
  PinnedNode,
  ProjectNode,
  SolutionNode,
  TabNode,
} from './model';

export const VIEW_ID = 'openEditorGroups.view';

const DIRTY_SUFFIX: Record<DirtyIndicator, string> = { dot: ' ●', asterisk: '*', none: '' };

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

  private model: Model = emptyModel(getConfig());
  private hasModel = false;
  private building: Promise<Model> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;

  constructor(private readonly services: ModelServices) {}

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
    const build = buildModel(this.services, getConfig()).then(
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
    const cfg = this.model.cfg;
    switch (element.kind) {
      case 'group':
        return this.groupItem(element, cfg);
      case 'solution':
        return this.solutionItem(element, cfg);
      case 'pinned':
        return this.pinnedItem(element, cfg);
      case 'project':
        return this.projectItem(element, cfg);
      case 'tab':
        return this.tabItem(element, cfg);
    }
  }

  private groupItem(node: GroupNode, cfg: ExtensionConfig): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = node.id;
    item.contextValue = 'editorGroup';
    item.description = countDescription(node, cfg);
    item.tooltip = node.group.isActive ? `${node.label} (active)` : node.label;
    return item;
  }

  private solutionItem(node: SolutionNode, cfg: ExtensionConfig): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = node.id;
    item.iconPath = new vscode.ThemeIcon(node.solution ? 'folder-library' : 'folder');
    item.contextValue = `solution:${node.solution ? 'hasFile' : 'plain'}`;
    item.description = joinParts([node.description, countDescription(node, cfg)]);
    const lines = [node.label];
    if (node.solution) {
      lines.push(displayPath(node.solution.fileUri));
    } else {
      lines.push('Projects that are not part of any solution');
    }
    lines.push(`${node.children.length} ${plural(node.children.length, 'project')}, ${countText(descendantTabs(node).length)}`);
    item.tooltip = lines.join('\n');
    return item;
  }

  private pinnedItem(node: PinnedNode, cfg: ExtensionConfig): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = node.id;
    item.iconPath = new vscode.ThemeIcon('pinned');
    item.contextValue = 'pinned';
    item.description = countDescription(node, cfg);
    item.tooltip = `Pinned editors (${countText(node.children.length)})`;
    return item;
  }

  private projectItem(node: ProjectNode, cfg: ExtensionConfig): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = node.id;
    item.description = joinParts([node.description, countDescription(node, cfg)]);
    const colorable = cfg.colorBy === 'project' && !!node.colorKey;
    item.contextValue = `project:${colorable ? 'colorable' : 'plain'}${node.project ? ':hasFile' : ''}`;

    const showIcon = cfg.headerIcon === 'auto' ? cfg.fileIconStyle === 'fileType' && !!node.slot : cfg.headerIcon !== 'none';
    if (showIcon) {
      const icon = cfg.headerIcon === 'dot' ? 'circle-filled' : BAR_ICON_ID;
      item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(colorIdForSlot(node.slot)));
    }

    const lines: string[] = [node.label];
    if (node.project) {
      lines.push(displayPath(node.project.fileUri));
    } else if (node.dirUri) {
      lines.push(displayPath(node.dirUri));
    }
    if (node.solutions && node.solutions.length > 1) {
      lines.push(`Also in: ${node.solutions.slice(1).map((s) => s.name).join(', ')}`);
    }
    lines.push(countText(node.children.length));
    item.tooltip = lines.join('\n');
    return item;
  }

  private tabItem(node: TabNode, cfg: ExtensionConfig): vscode.TreeItem {
    const { tab, uri } = node;
    const label: vscode.TreeItemLabel = { label: node.label + (tab.isDirty ? DIRTY_SUFFIX[cfg.dirtyIndicator] : '') };
    if (cfg.emphasizeActiveEditor && tab.isActive && tab.group.isActive) {
      label.highlights = [[0, node.label.length]];
    }
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.resourceUri = uri;

    if (cfg.fileIconStyle === 'projectColorBar' || !uri) {
      item.iconPath = new vscode.ThemeIcon(BAR_ICON_ID, new vscode.ThemeColor(colorIdForSlot(node.slot)));
    }

    item.description = joinParts([node.showProject ? node.projectLabel : undefined, node.pathDescription, node.groupLabel]);

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
    if (node.projectLabel) {
      lines.push(`Project: ${node.projectLabel}`);
    }
    lines.push(`${editorGroupText(tab.group.viewColumn, true)}${state.length ? ` · ${state.join(' · ')}` : ''}`);
    item.tooltip = lines.join('\n');

    const colorable = cfg.colorBy === 'project' && !!node.colorKey;
    item.contextValue = [
      'tab',
      uri ? 'file' : 'nofile',
      tab.isPinned ? 'pinned' : 'unpinned',
      tab.isDirty ? 'dirty' : 'clean',
      uri?.scheme === 'file' ? 'local' : 'remote',
      colorable ? 'colorable' : 'plain',
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

function countDescription(node: GroupNode | SolutionNode | PinnedNode | ProjectNode, cfg: ExtensionConfig): string | undefined {
  return cfg.showEditorCount ? String(descendantTabs(node).length) : undefined;
}

function countText(n: number): string {
  return `${n} ${plural(n, 'editor')}`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function joinParts(parts: (string | undefined)[]): string | undefined {
  const text = parts.filter((p): p is string => !!p).join(' · ');
  return text || undefined;
}
