import * as vscode from 'vscode';
import { ColorAssigner } from './colors';
import { ExtensionConfig } from './config';
import { baseName, compareOrdinalIgnoreCase, parentOf, ProjectInfo, ProjectResolver } from './projectResolver';

/** What an editor was grouped by. Sorted in this order in the view. */
export type Category = 'project' | 'folder' | 'untitled' | 'external' | 'other';

const CATEGORY_RANK: Record<Category, number> = { project: 0, folder: 1, untitled: 2, external: 3, other: 4 };

/** Top-level node for one editor group; only present when the editor area is split. */
export interface GroupNode {
  readonly kind: 'group';
  readonly id: string;
  readonly label: string;
  readonly group: vscode.TabGroup;
  readonly parent: undefined;
  children: ProjectNode[];
}

/** A project (or a fallback bucket such as "Untitled") with its open editors. */
export interface ProjectNode {
  readonly kind: 'project';
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly category: Category;
  readonly project?: ProjectInfo;
  readonly workspaceFolder?: vscode.WorkspaceFolder;
  readonly parent: GroupNode | undefined;
  description?: string;
  slot?: number;
  children: TabNode[];
}

/** One open editor tab. */
export interface TabNode {
  readonly kind: 'tab';
  id: string;
  readonly label: string;
  readonly tab: vscode.Tab;
  readonly uri: vscode.Uri | undefined;
  /** Folder path shown next to the name (already formatted for the configured path style). */
  readonly pathDescription: string;
  /** "Group N" when several editor groups are flattened into one list. */
  readonly groupLabel: string | undefined;
  readonly parent: ProjectNode;
  /** Position of the tab in the editor area, used for the "editor order" sort. */
  readonly tabIndex: number;
}

export type Node = GroupNode | ProjectNode | TabNode;

export interface Model {
  readonly roots: Node[];
  readonly byTab: Map<vscode.Tab, TabNode>;
  /** Palette slot per resource (uri.toString()), for the tab colorizer. */
  readonly slotByUri: Map<string, number>;
  readonly tabCount: number;
}

export function emptyModel(): Model {
  return { roots: [], byTab: new Map(), slotByUri: new Map(), tabCount: 0 };
}

/** Returns the resource a tab shows, if it is backed by one. */
export function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }
  if (input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputNotebook) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputNotebookDiff) {
    return input.modified;
  }
  return undefined;
}

/** Schemes whose path mirrors a file on disk (e.g. `git:` for "Open File (HEAD)"). */
const FILE_MIRROR_SCHEMES = new Set(['git', 'gitlens']);

function lookupUri(uri: vscode.Uri): vscode.Uri {
  if (FILE_MIRROR_SCHEMES.has(uri.scheme)) {
    return uri.with({ scheme: 'file', query: '', fragment: '' });
  }
  return uri;
}

interface Classification {
  category: Category;
  key: string;
  label: string;
  project?: ProjectInfo;
  workspaceFolder?: vscode.WorkspaceFolder;
}

interface TabRef {
  tab: vscode.Tab;
  index: number;
}

export async function buildModel(resolver: ProjectResolver, colors: ColorAssigner, cfg: ExtensionConfig): Promise<Model> {
  const groups = vscode.window.tabGroups.all;
  const byTab = new Map<vscode.Tab, TabNode>();
  const slotByUri = new Map<string, number>();
  const ids = new Set<string>();
  const roots: Node[] = [];
  let tabCount = 0;

  const splitByGroup = cfg.groupByEditorGroup && groups.length > 1;
  const flattenedGroups = !splitByGroup && groups.length > 1;

  const classify = async (tab: vscode.Tab): Promise<Classification | undefined> => {
    const uri = tabUri(tab);
    if (!uri) {
      return cfg.showNonFileEditors ? { category: 'other', key: 'other', label: 'Other' } : undefined;
    }
    if (uri.scheme === 'untitled') {
      return { category: 'untitled', key: 'untitled', label: 'Untitled' };
    }
    const target = lookupUri(uri);
    const project = await resolver.resolve(target);
    if (project) {
      return { category: 'project', key: project.key, label: project.name, project };
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(target);
    if (workspaceFolder) {
      return { category: 'folder', key: `folder:${workspaceFolder.uri.toString()}`, label: workspaceFolder.name, workspaceFolder };
    }
    return { category: 'external', key: 'external', label: 'External' };
  };

  const bucket = async (tabs: TabRef[], parent: GroupNode | undefined): Promise<ProjectNode[]> => {
    const classifications = await Promise.all(tabs.map(({ tab }) => classify(tab)));
    const buckets = new Map<string, ProjectNode>();
    const parentPrefix = parent ? `${parent.id}/` : '';

    tabs.forEach(({ tab, index }, i) => {
      const c = classifications[i];
      if (!c) {
        return;
      }
      let node = buckets.get(c.key);
      if (!node) {
        node = {
          kind: 'project',
          id: `${parentPrefix}project:${c.key}`,
          key: c.key,
          label: c.label,
          category: c.category,
          project: c.project,
          workspaceFolder: c.workspaceFolder,
          parent,
          children: [],
        };
        buckets.set(c.key, node);
      }
      const uri = tabUri(tab);
      const tabNode: TabNode = {
        kind: 'tab',
        id: '',
        label: tabLabel(tab, uri),
        tab,
        uri,
        pathDescription: pathDescription(uri, c.project, cfg),
        groupLabel: flattenedGroups ? `Group ${tab.group.viewColumn}` : undefined,
        parent: node,
        tabIndex: index,
      };
      node.children.push(tabNode);
      byTab.set(tab, tabNode);
      tabCount++;
    });

    const nodes = [...buckets.values()];
    nodes.sort(compareProjects);

    // Projects with the same display name get their folder as a description so they can be told apart.
    const labelCounts = new Map<string, number>();
    for (const n of nodes) {
      labelCounts.set(n.label, (labelCounts.get(n.label) ?? 0) + 1);
    }

    for (const n of nodes) {
      if (n.category === 'project' || n.category === 'folder') {
        n.slot = colors.slotFor(n.label);
      }
      if (n.project && (labelCounts.get(n.label) ?? 0) > 1) {
        n.description = vscode.workspace.asRelativePath(n.project.dirUri, true);
      }
      n.children.sort((a, b) => compareTabs(a, b, cfg));
      for (const t of n.children) {
        t.id = uniqueId(ids, `${n.id}/tab:${t.uri?.toString() ?? `label:${t.tab.label}`}`);
        if (t.uri && n.slot) {
          slotByUri.set(t.uri.toString(), n.slot);
        }
      }
    }
    return nodes;
  };

  if (splitByGroup) {
    for (const group of groups) {
      const groupNode: GroupNode = {
        kind: 'group',
        id: `group:${group.viewColumn}`,
        label: `Group ${group.viewColumn}`,
        group,
        parent: undefined,
        children: [],
      };
      groupNode.children = await bucket(
        group.tabs.map((tab, index) => ({ tab, index })),
        groupNode,
      );
      roots.push(groupNode);
    }
  } else {
    const all: TabRef[] = [];
    for (const group of groups) {
      for (const tab of group.tabs) {
        all.push({ tab, index: all.length });
      }
    }
    roots.push(...(await bucket(all, undefined)));
  }

  return { roots, byTab, slotByUri, tabCount };
}

function uniqueId(ids: Set<string>, id: string): string {
  let candidate = id;
  for (let n = 2; ids.has(candidate); n++) {
    candidate = `${id}#${n}`;
  }
  ids.add(candidate);
  return candidate;
}

function tabLabel(tab: vscode.Tab, uri: vscode.Uri | undefined): string {
  const input = tab.input;
  const fileLike =
    input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook;
  if (uri && fileLike && uri.scheme !== 'untitled') {
    return baseName(uri) || tab.label;
  }
  return tab.label;
}

function pathDescription(uri: vscode.Uri | undefined, project: ProjectInfo | undefined, cfg: ExtensionConfig): string {
  if (cfg.pathStyle === 'none' || !uri || uri.scheme === 'untitled') {
    return '';
  }
  const target = lookupUri(uri);
  const dir = parentOf(target);
  if (cfg.pathStyle === 'relativeToProject' && project) {
    const rel = relativePath(project.dirUri, dir);
    return rel ?? displayPath(dir);
  }
  const folder = vscode.workspace.getWorkspaceFolder(target);
  if (folder) {
    const rel = relativePath(folder.uri, dir);
    if (rel !== undefined) {
      const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      if (!multiRoot) {
        return rel;
      }
      return rel ? `${folder.name}/${rel}` : folder.name;
    }
  }
  return displayPath(dir);
}

/** Path of `target` below `base`, '' when equal, `undefined` when `target` is not below `base`. */
function relativePath(base: vscode.Uri, target: vscode.Uri): string | undefined {
  if (base.scheme !== target.scheme) {
    return undefined;
  }
  const basePath = base.path.replace(/\/+$/, '');
  const targetPath = target.path.replace(/\/+$/, '');
  if (targetPath === basePath || targetPath.toLowerCase() === basePath.toLowerCase()) {
    return '';
  }
  const prefix = `${basePath}/`;
  if (targetPath.startsWith(prefix) || targetPath.toLowerCase().startsWith(prefix.toLowerCase())) {
    return targetPath.substring(prefix.length);
  }
  return undefined;
}

function displayPath(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.path;
}

function compareProjects(a: ProjectNode, b: ProjectNode): number {
  return (
    CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
    compareOrdinalIgnoreCase(a.label, b.label) ||
    compareOrdinalIgnoreCase(a.key, b.key)
  );
}

function compareTabs(a: TabNode, b: TabNode, cfg: ExtensionConfig): number {
  if (a.tab.isPinned !== b.tab.isPinned) {
    return a.tab.isPinned ? -1 : 1;
  }
  if (cfg.sortOrder === 'editorOrder') {
    return a.tabIndex - b.tabIndex;
  }
  return (
    compareOrdinalIgnoreCase(a.label, b.label) ||
    compareOrdinalIgnoreCase(a.pathDescription, b.pathDescription) ||
    a.tabIndex - b.tabIndex
  );
}
