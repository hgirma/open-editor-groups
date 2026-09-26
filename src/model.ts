import * as vscode from 'vscode';
import { ColorAssigner } from './colors';
import { compileColorRules, CompiledColorRule, matchColorRule } from './colorRules';
import { ExtensionConfig } from './config';
import { MruTracker } from './mru';
import {
  baseName,
  compareOrdinalIgnoreCase,
  displayPath,
  isHierarchical,
  lookupUri,
  parentOf,
  ProjectInfo,
  ProjectResolver,
} from './projectResolver';
import { SolutionInfo, SolutionResolver } from './solutionResolver';

/** What a bucket of editors stands for. Sorted in this order in the view. */
export type Category = 'project' | 'folder' | 'untitled' | 'external' | 'other';

const CATEGORY_RANK: Record<Category, number> = { project: 0, folder: 1, untitled: 2, external: 3, other: 4 };

/** Top-level node for one editor group; only present when the editor area is split. */
export interface GroupNode {
  readonly kind: 'group';
  readonly id: string;
  readonly label: string;
  readonly group: vscode.TabGroup;
  readonly parent: undefined;
  children: ScopeChild[];
}

/** A Visual Studio solution holding project nodes; `solution` is undefined for the "Other projects" node. */
export interface SolutionNode {
  readonly kind: 'solution';
  readonly id: string;
  readonly label: string;
  readonly solution: SolutionInfo | undefined;
  readonly parent: GroupNode | undefined;
  description?: string;
  children: ProjectNode[];
}

/**
 * A bucket of open editors: a project, or (depending on `groupBy`) a folder or
 * workspace folder, or a fallback bucket such as "Untitled".
 */
export interface ProjectNode {
  readonly kind: 'project';
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly category: Category;
  project?: ProjectInfo;
  readonly workspaceFolder?: vscode.WorkspaceFolder;
  readonly dirUri?: vscode.Uri;
  parent: GroupNode | SolutionNode | undefined;
  description?: string;
  /** Palette slot when all children share one; drives the header icon. */
  slot?: number;
  /** Name the color is assigned to (project or workspace folder name) when all children share one. */
  colorKey?: string;
  solutions?: SolutionInfo[];
  children: TabNode[];
}

/** Collects the pinned editors of a scope when `pinnedEditors` is `separateGroup`. */
export interface PinnedNode {
  readonly kind: 'pinned';
  readonly id: string;
  readonly label: string;
  readonly parent: GroupNode | undefined;
  children: TabNode[];
}

/** One open editor tab. */
export interface TabNode {
  readonly kind: 'tab';
  id: string;
  /** Bare name used for sorting; the dirty marker is added at render time. */
  readonly label: string;
  readonly tab: vscode.Tab;
  readonly uri: vscode.Uri | undefined;
  /** True when `uri` names a real (hierarchical, non-untitled) resource that file commands can act on. */
  readonly isFile: boolean;
  /** Folder path shown next to the name (already formatted for the configured path style). */
  readonly pathDescription: string;
  /**
   * "editor group N" when several editor groups are flattened into one list and this
   * editor is outside the anchor group (the lowest group that holds a file-backed editor).
   */
  readonly groupLabel: string | undefined;
  parent: ContainerNode | undefined;
  /** Position of the tab in the editor area, used for the "editor order" sort. */
  readonly tabIndex: number;
  readonly project?: ProjectInfo;
  /** Project (or workspace folder) name, shown as description when the parent does not say it. */
  readonly projectLabel?: string;
  readonly colorKey?: string;
  readonly slot?: number;
  readonly showProject: boolean;
}

export type ContainerNode = GroupNode | SolutionNode | ProjectNode | PinnedNode;
export type ScopeChild = SolutionNode | ProjectNode | PinnedNode | TabNode;
export type Node = ContainerNode | TabNode;

export interface Model {
  readonly roots: Node[];
  readonly byTab: Map<vscode.Tab, TabNode>;
  /** Palette slot per resource (uri.toString()), for the tab colorizer. */
  readonly slotByUri: Map<string, number>;
  readonly tabCount: number;
  /** The configuration the model was built with; rendering uses the same snapshot. */
  readonly cfg: ExtensionConfig;
}

export interface ModelServices {
  resolver: ProjectResolver;
  colors: ColorAssigner;
  solutions: SolutionResolver;
  mru: MruTracker;
}

export function emptyModel(cfg: ExtensionConfig): Model {
  return { roots: [], byTab: new Map(), slotByUri: new Map(), tabCount: 0, cfg };
}

export function isTab(node: Node): node is TabNode {
  return node.kind === 'tab';
}

/** Every tab below a container, in display order. */
export function descendantTabs(node: ContainerNode): TabNode[] {
  const out: TabNode[] = [];
  const visit = (n: Node): void => {
    if (n.kind === 'tab') {
      out.push(n);
    } else {
      for (const child of n.children) {
        visit(child);
      }
    }
  };
  visit(node);
  return out;
}

/** The tabs listed next to a tab: its container's tab children, or the roots for top-level tabs. */
export function tabSiblings(node: TabNode, model: Model): TabNode[] {
  const siblings: Node[] = node.parent ? node.parent.children : model.roots;
  return siblings.filter(isTab);
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

export function buildModel(services: ModelServices, cfg: ExtensionConfig): Promise<Model> {
  return new ModelBuilder(services, cfg).build();
}

interface TabRef {
  tab: vscode.Tab;
  index: number;
}

/** Everything known about one tab before it is placed in the tree. */
interface TabContext extends TabRef {
  uri: vscode.Uri | undefined;
  category: Category;
  project?: ProjectInfo;
  workspaceFolder?: vscode.WorkspaceFolder;
  projectLabel?: string;
  colorKey?: string;
  slot?: number;
}

interface BucketSpec {
  key: string;
  label: string;
  category: Category;
  project?: ProjectInfo;
  workspaceFolder?: vscode.WorkspaceFolder;
  dirUri?: vscode.Uri;
}

class ModelBuilder {
  private readonly byTab = new Map<vscode.Tab, TabNode>();
  private readonly slotByUri = new Map<string, number>();
  private readonly ids = new Set<string>();
  private readonly rules: CompiledColorRule[];
  private readonly multiRoot: boolean;
  private tabCount = 0;
  /** In the flattened multi-group list: the anchor group whose editors are not annotated. Undefined when no annotation is needed. */
  private mainColumn: vscode.ViewColumn | undefined;
  private solutionLevel = false;

  constructor(
    private readonly services: ModelServices,
    private readonly cfg: ExtensionConfig,
  ) {
    this.rules = cfg.colorBy === 'rules' ? compileColorRules(cfg.colorRules) : [];
    this.multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  }

  async build(): Promise<Model> {
    const { cfg, services } = this;
    const groups = vscode.window.tabGroups.all;
    const splitByGroup = cfg.groupByEditorGroup && groups.length > 1;

    const bucketsAreProjects = cfg.groupBy === 'project' || cfg.groupBy === 'folder';
    if (bucketsAreProjects && cfg.solutionNodes !== 'never') {
      await services.solutions.ready();
      const count = services.solutions.count;
      this.solutionLevel = cfg.solutionNodes === 'always' ? count >= 1 : count >= 2;
    }

    let roots: Node[] = [];
    if (splitByGroup) {
      for (const group of groups) {
        const groupNode: GroupNode = {
          kind: 'group',
          id: `group:${group.viewColumn}`,
          label: groupNodeLabel(group.viewColumn),
          group,
          parent: undefined,
          children: [],
        };
        const contexts = await this.classifyAll(group.tabs.map((tab, index) => ({ tab, index })));
        groupNode.children = this.buildScope(contexts, groupNode);
        roots.push(groupNode);
      }
    } else {
      const refs: TabRef[] = [];
      for (const group of groups) {
        for (const tab of group.tabs) {
          refs.push({ tab, index: refs.length });
        }
      }
      const contexts = await this.classifyAll(refs);
      this.mainColumn = mainViewColumn(contexts);
      roots = this.buildScope(contexts, undefined);
    }

    if (cfg.hideSingleGroup && roots.length === 1 && roots[0].kind === 'project') {
      const only = roots[0];
      for (const tab of only.children) {
        tab.parent = undefined;
      }
      roots = only.children;
    }

    return { roots, byTab: this.byTab, slotByUri: this.slotByUri, tabCount: this.tabCount, cfg };
  }

  private async classifyAll(refs: TabRef[]): Promise<TabContext[]> {
    const contexts = await Promise.all(refs.map((ref) => this.classifyTab(ref)));
    return contexts.filter((c): c is TabContext => c !== undefined);
  }

  private async classifyTab(ref: TabRef): Promise<TabContext | undefined> {
    const uri = tabUri(ref.tab);
    if (!uri) {
      return this.cfg.showNonFileEditors ? { ...ref, uri: undefined, category: 'other' } : undefined;
    }
    if (uri.scheme === 'untitled') {
      return { ...ref, uri, category: 'untitled' };
    }
    if (!isHierarchical(uri)) {
      // e.g. output channels opened as editors: not files, so they go to "Other" like webviews.
      return this.cfg.showNonFileEditors ? { ...ref, uri, category: 'other' } : undefined;
    }
    const target = lookupUri(uri);
    const project = await this.services.resolver.resolve(target);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(target);
    const category: Category = project ? 'project' : workspaceFolder ? 'folder' : 'external';
    const projectLabel = project?.name ?? workspaceFolder?.name;
    const colorKey = projectLabel;
    return { ...ref, uri, category, project, workspaceFolder, projectLabel, colorKey, slot: this.slotOf(uri, colorKey) };
  }

  private slotOf(uri: vscode.Uri, colorKey: string | undefined): number | undefined {
    switch (this.cfg.colorBy) {
      case 'none':
        return undefined;
      case 'rules':
        return matchColorRule(this.rules, uri);
      default:
        return colorKey ? this.services.colors.slotFor(colorKey) : undefined;
    }
  }

  /** Builds the children of an editor-group node, or the roots. */
  private buildScope(contexts: TabContext[], parent: GroupNode | undefined): ScopeChild[] {
    const { cfg } = this;
    const prefix = parent ? `${parent.id}/` : '';
    const out: ScopeChild[] = [];
    let remaining = contexts;

    if (cfg.pinnedEditors === 'separateGroup') {
      const pinned = contexts.filter((c) => c.tab.isPinned);
      if (pinned.length > 0) {
        const node: PinnedNode = { kind: 'pinned', id: `${prefix}pinned`, label: 'Pinned', parent, children: [] };
        node.children = pinned.map((c) => this.makeTabNode(c, node, true));
        this.finishTabs(node.children, node.id);
        out.push(node);
        remaining = contexts.filter((c) => !c.tab.isPinned);
      }
    }

    if (cfg.groupBy === 'none') {
      const tabs = remaining.map((c) => this.makeTabNode(c, parent, true));
      this.finishTabs(tabs, parent?.id);
      out.push(...tabs);
      return out;
    }

    const buckets = new Map<string, ProjectNode>();
    for (const c of remaining) {
      const spec = this.bucketFor(c);
      let node = buckets.get(spec.key);
      if (!node) {
        node = {
          kind: 'project',
          id: `${prefix}project:${spec.key}`,
          key: spec.key,
          label: spec.label,
          category: spec.category,
          project: spec.project,
          workspaceFolder: spec.workspaceFolder,
          dirUri: spec.dirUri,
          parent,
          children: [],
        };
        buckets.set(spec.key, node);
      }
      node.children.push(this.makeTabNode(c, node, cfg.groupBy === 'workspaceFolder'));
    }

    const nodes = [...buckets.values()];
    for (const node of nodes) {
      finalizeBucket(node);
      this.finishTabs(node.children, node.id);
    }
    nodes.sort(compareProjects);
    disambiguate(nodes, (n) => (n.project ? vscode.workspace.asRelativePath(n.project.dirUri, true) : undefined));

    if (!this.solutionLevel) {
      out.push(...nodes);
      return out;
    }

    const solutionNodes = new Map<string, SolutionNode>();
    const loose: ProjectNode[] = [];
    for (const node of nodes) {
      if (node.category !== 'project' && node.category !== 'folder') {
        loose.push(node);
        continue;
      }
      node.solutions = node.project ? this.services.solutions.solutionsFor(node.project.fileUri) : [];
      const solution = node.solutions[0];
      const key = solution ? `solution:${solution.key}` : 'solution:none';
      let solutionNode = solutionNodes.get(key);
      if (!solutionNode) {
        solutionNode = {
          kind: 'solution',
          id: `${prefix}${key}`,
          label: solution ? solution.name : 'Other projects',
          solution,
          parent,
          children: [],
        };
        solutionNodes.set(key, solutionNode);
      }
      solutionNode.children.push(node);
      node.parent = solutionNode;
    }
    const solutions = [...solutionNodes.values()].sort(compareSolutions);
    disambiguate(solutions, (n) => (n.solution ? vscode.workspace.asRelativePath(n.solution.dirUri, true) : undefined));
    out.push(...solutions, ...loose);
    return out;
  }

  private bucketFor(c: TabContext): BucketSpec {
    if (c.category === 'other') {
      return { key: 'other', label: 'Other', category: 'other' };
    }
    if (c.category === 'untitled') {
      return { key: 'untitled', label: 'Untitled', category: 'untitled' };
    }
    const ws = c.workspaceFolder;
    switch (this.cfg.groupBy) {
      case 'folder': {
        const dir = parentOf(lookupUri(c.uri as vscode.Uri));
        return {
          key: `dir:${dir.toString()}`,
          label: this.folderLabel(dir, ws),
          category: ws ? 'folder' : 'external',
          project: c.project,
          workspaceFolder: ws,
          dirUri: dir,
        };
      }
      case 'workspaceFolder':
        return ws
          ? { key: `folder:${ws.uri.toString()}`, label: ws.name, category: 'folder', workspaceFolder: ws, dirUri: ws.uri }
          : { key: 'external', label: 'External', category: 'external' };
      default:
        if (c.project) {
          return { key: c.project.key, label: c.project.name, category: 'project', project: c.project, dirUri: c.project.dirUri };
        }
        if (ws) {
          return { key: `folder:${ws.uri.toString()}`, label: ws.name, category: 'folder', workspaceFolder: ws, dirUri: ws.uri };
        }
        return { key: 'external', label: 'External', category: 'external' };
    }
  }

  private folderLabel(dir: vscode.Uri, ws: vscode.WorkspaceFolder | undefined): string {
    if (ws) {
      const rel = relativePath(ws.uri, dir);
      if (rel !== undefined) {
        if (rel === '') {
          return ws.name;
        }
        return this.multiRoot ? `${ws.name}/${rel}` : rel;
      }
    }
    return displayPath(dir);
  }

  private makeTabNode(c: TabContext, parent: ContainerNode | undefined, showProject: boolean): TabNode {
    const node: TabNode = {
      kind: 'tab',
      id: '',
      label: tabLabel(c.tab, c.uri),
      tab: c.tab,
      uri: c.uri,
      isFile: !!c.uri && c.uri.scheme !== 'untitled' && isHierarchical(c.uri),
      pathDescription: this.cfg.groupBy === 'folder' ? '' : pathDescription(c.uri, c.project, this.cfg, this.multiRoot),
      // In the flattened multi-group list only editors outside the anchor group are annotated,
      // so a lone split (e.g. Settings opened to the side) does not tag every file.
      groupLabel:
        this.mainColumn !== undefined && c.tab.group.viewColumn !== this.mainColumn
          ? editorGroupText(c.tab.group.viewColumn)
          : undefined,
      parent,
      tabIndex: c.index,
      project: c.project,
      projectLabel: c.projectLabel,
      colorKey: c.colorKey,
      slot: c.slot,
      showProject,
    };
    this.byTab.set(c.tab, node);
    if (c.uri && c.slot) {
      this.slotByUri.set(c.uri.toString(), c.slot);
    }
    this.tabCount++;
    return node;
  }

  /** Sorts the tabs of one container and gives them stable ids (independent of the sort position). */
  private finishTabs(tabs: TabNode[], parentId: string | undefined): void {
    tabs.sort(this.compareTabs);
    const prefix = parentId ? `${parentId}/` : '';
    for (const t of tabs) {
      t.id = uniqueId(this.ids, `${prefix}tab:${inputKind(t.tab)}:${t.uri?.toString() ?? `label:${t.tab.label}`}`);
    }
  }

  private readonly compareTabs = (a: TabNode, b: TabNode): number => {
    const { cfg } = this;
    if (cfg.pinnedEditors === 'first' && a.tab.isPinned !== b.tab.isPinned) {
      return a.tab.isPinned ? -1 : 1;
    }
    switch (cfg.sortOrder) {
      case 'editorOrder':
        return a.tabIndex - b.tabIndex;
      case 'mostRecentlyUsed':
        return (this.services.mru.stampOf(b.tab) ?? -1) - (this.services.mru.stampOf(a.tab) ?? -1) || a.tabIndex - b.tabIndex;
      case 'fileType':
        return compareOrdinalIgnoreCase(extensionOf(a.label), extensionOf(b.label)) || compareByName(a, b);
      default:
        return compareByName(a, b);
    }
  };
}

/** Label of a top-level editor-group node ("Group 2"), matching the built-in Open Editors view. */
function groupNodeLabel(viewColumn: vscode.ViewColumn): string {
  return `Group ${viewColumn}`;
}

/** Wording used next to a single editor ("editor group 2"), unambiguous next to counts. */
export function editorGroupText(viewColumn: vscode.ViewColumn, capitalized = false): string {
  return `${capitalized ? 'Editor' : 'editor'} group ${viewColumn}`;
}

/**
 * The anchor group of a flattened multi-group list: the lowest group that holds a
 * file-backed editor (so a Settings or Welcome page alone in another group does not
 * tag every file), falling back to the lowest group with any listed editor. Returns
 * `undefined` when all listed editors are in one group and no annotation is needed.
 */
function mainViewColumn(contexts: readonly TabContext[]): vscode.ViewColumn | undefined {
  const all = contexts.map((c) => c.tab.group.viewColumn);
  if (new Set(all).size < 2) {
    return undefined;
  }
  const withFile = contexts.filter((c) => c.uri).map((c) => c.tab.group.viewColumn);
  return Math.min(...(withFile.length > 0 ? withFile : all)) as vscode.ViewColumn;
}

function compareByName(a: TabNode, b: TabNode): number {
  return (
    compareOrdinalIgnoreCase(a.label, b.label) ||
    compareOrdinalIgnoreCase(a.pathDescription, b.pathDescription) ||
    a.tabIndex - b.tabIndex
  );
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(dot + 1) : '';
}

/** Header color, color key and project of a bucket: the value all children agree on, else none. */
function finalizeBucket(node: ProjectNode): void {
  node.slot = uniqueValue(node.children, (t) => t.slot);
  node.colorKey = uniqueValue(node.children, (t) => t.colorKey);
  if (!node.project) {
    node.project = uniqueValue(node.children, (t) => t.project, (p) => p.key);
  }
}

function uniqueValue<T, V>(items: readonly T[], pick: (item: T) => V | undefined, keyOf?: (value: V) => unknown): V | undefined {
  let found: V | undefined;
  let foundKey: unknown;
  let seen = false;
  for (const item of items) {
    const value = pick(item);
    const key = value === undefined ? undefined : keyOf ? keyOf(value) : value;
    if (!seen) {
      found = value;
      foundKey = key;
      seen = true;
    } else if (key !== foundKey) {
      return undefined;
    }
  }
  return found;
}

/** Adds a description to nodes whose label is shared with a sibling. */
function disambiguate<T extends { label: string; description?: string }>(nodes: T[], describe: (node: T) => string | undefined): void {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    counts.set(n.label, (counts.get(n.label) ?? 0) + 1);
  }
  for (const n of nodes) {
    if ((counts.get(n.label) ?? 0) > 1) {
      n.description = describe(n);
    }
  }
}

function uniqueId(ids: Set<string>, id: string): string {
  let candidate = id;
  for (let n = 2; ids.has(candidate); n++) {
    candidate = `${id}#${n}`;
  }
  ids.add(candidate);
  return candidate;
}

/** Short tag for the kind of editor a tab holds, so two editors on one resource get distinct ids. */
function inputKind(tab: vscode.Tab): string {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) {
    return 'text';
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return 'diff';
  }
  if (input instanceof vscode.TabInputCustom) {
    return `custom(${input.viewType})`;
  }
  if (input instanceof vscode.TabInputNotebook) {
    return 'notebook';
  }
  if (input instanceof vscode.TabInputNotebookDiff) {
    return 'notebookDiff';
  }
  if (input instanceof vscode.TabInputWebview) {
    return `webview(${input.viewType})`;
  }
  if (input instanceof vscode.TabInputTerminal) {
    return 'terminal';
  }
  return 'other';
}

function tabLabel(tab: vscode.Tab, uri: vscode.Uri | undefined): string {
  const input = tab.input;
  const fileLike =
    input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook;
  if (uri && fileLike && uri.scheme !== 'untitled' && isHierarchical(uri)) {
    return baseName(uri) || tab.label;
  }
  return tab.label;
}

function pathDescription(uri: vscode.Uri | undefined, project: ProjectInfo | undefined, cfg: ExtensionConfig, multiRoot: boolean): string {
  if (cfg.pathStyle === 'none' || !uri || uri.scheme === 'untitled' || !isHierarchical(uri)) {
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

function compareProjects(a: ProjectNode, b: ProjectNode): number {
  return (
    CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
    compareOrdinalIgnoreCase(a.label, b.label) ||
    compareOrdinalIgnoreCase(a.key, b.key)
  );
}

function compareSolutions(a: SolutionNode, b: SolutionNode): number {
  if (!a.solution !== !b.solution) {
    return a.solution ? -1 : 1; // "Other projects" last
  }
  return compareOrdinalIgnoreCase(a.label, b.label) || compareOrdinalIgnoreCase(a.id, b.id);
}
