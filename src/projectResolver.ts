import * as vscode from 'vscode';
import { getConfig } from './config';

/** A project that an open editor belongs to. */
export interface ProjectInfo {
  /** The project file, e.g. `Contoso.Server.csproj`. */
  fileUri: vscode.Uri;
  /** The folder that contains the project file. */
  dirUri: vscode.Uri;
  /** Human readable name, e.g. `Contoso.Server`. */
  name: string;
  /** Unique key (the project file URI as a string). */
  key: string;
}

/**
 * Manifests whose file name says nothing about the project. For these the
 * containing folder name is used as the project name instead.
 */
const FOLDER_NAMED_MANIFESTS = new Set([
  'package.json',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'pubspec.yaml',
  'mix.exs',
  'gemfile',
]);

/** How many parent folders are searched for files that are not inside a workspace folder. */
const MAX_LEVELS_OUTSIDE_WORKSPACE = 8;

/**
 * Finds the nearest enclosing project file for a URI by walking up the folder
 * hierarchy. Directory listings are cached until a project file is created or
 * deleted anywhere in the workspace, so repeated lookups are cheap.
 */
export class ProjectResolver implements vscode.Disposable {
  private readonly dirCache = new Map<string, Promise<vscode.Uri | undefined>>();
  private matchers: { regex: RegExp; index: number }[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires when project files were added or removed and cached results are stale. */
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    this.reload();
  }

  /** Re-reads the configured patterns, clears the cache and re-creates the watcher. */
  reload(): void {
    const patterns = getConfig().projectFilePatterns;
    this.matchers = patterns.map((p, index) => ({ regex: globToRegExp(p), index }));
    this.dirCache.clear();
    this.watcher?.dispose();
    this.watcher = undefined;
    if (patterns.length > 0) {
      const glob = patterns.length === 1 ? `**/${patterns[0]}` : `**/{${patterns.join(',')}}`;
      this.watcher = vscode.workspace.createFileSystemWatcher(glob, false, true, false);
      this.watcher.onDidCreate(() => this.invalidate());
      this.watcher.onDidDelete(() => this.invalidate());
    }
  }

  invalidate(): void {
    this.dirCache.clear();
    this._onDidChange.fire();
  }

  /** Resolves the project for a file URI, or `undefined` when no project file encloses it. */
  async resolve(uri: vscode.Uri): Promise<ProjectInfo | undefined> {
    if (this.matchers.length === 0) {
      return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const maxLevels = folder ? Number.POSITIVE_INFINITY : MAX_LEVELS_OUTSIDE_WORKSPACE;
    let dir = parentOf(uri);
    for (let level = 0; level < maxLevels; level++) {
      const projectFile = await this.projectFileIn(dir);
      if (projectFile) {
        return { fileUri: projectFile, dirUri: dir, name: projectDisplayName(projectFile, dir), key: projectFile.toString() };
      }
      if (folder && samePath(dir, folder.uri)) {
        break; // do not look above the workspace folder
      }
      const parent = parentOf(dir);
      if (parent.path === dir.path) {
        break; // reached the root
      }
      dir = parent;
    }
    return undefined;
  }

  private projectFileIn(dir: vscode.Uri): Promise<vscode.Uri | undefined> {
    const key = dir.toString();
    let pending = this.dirCache.get(key);
    if (!pending) {
      pending = this.readProjectFile(dir);
      this.dirCache.set(key, pending);
    }
    return pending;
  }

  private async readProjectFile(dir: vscode.Uri): Promise<vscode.Uri | undefined> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return undefined;
    }
    let best: { name: string; index: number } | undefined;
    for (const [name, type] of entries) {
      if (!(type & vscode.FileType.File)) {
        continue;
      }
      const matcher = this.matchers.find((m) => m.regex.test(name));
      if (!matcher) {
        continue;
      }
      // Earlier patterns win; ties are broken by name so the result is deterministic.
      if (!best || matcher.index < best.index || (matcher.index === best.index && compareOrdinalIgnoreCase(name, best.name) < 0)) {
        best = { name, index: matcher.index };
      }
    }
    return best ? vscode.Uri.joinPath(dir, best.name) : undefined;
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}

export function parentOf(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, '..');
}

/** True for URIs whose path is a `/`-rooted hierarchy (files, folders), false for e.g. `output:` channels. */
export function isHierarchical(uri: vscode.Uri): boolean {
  return uri.path.startsWith('/');
}

/** Same location; local file paths compare case-insensitively (drive letters and Windows paths vary in case). */
export function samePath(a: vscode.Uri, b: vscode.Uri): boolean {
  if (a.scheme !== b.scheme) {
    return false;
  }
  return a.path === b.path || (a.scheme === 'file' && a.path.toLowerCase() === b.path.toLowerCase());
}

/** Schemes whose path mirrors a file on disk (e.g. `git:` for "Open File (HEAD)"). */
const FILE_MIRROR_SCHEMES = new Set(['git', 'gitlens']);

/** Human readable form of a URI: the file system path for local files, the full URI otherwise. */
export function displayPath(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString(true);
}

/** The on-disk URI to use for project lookup and path display. */
export function lookupUri(uri: vscode.Uri): vscode.Uri {
  if (FILE_MIRROR_SCHEMES.has(uri.scheme)) {
    return uri.with({ scheme: 'file', query: '', fragment: '' });
  }
  return uri;
}

export function baseName(uri: vscode.Uri): string {
  const path = uri.path.replace(/\/+$/, '');
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.substring(idx + 1) : path;
}

function projectDisplayName(projectFile: vscode.Uri, dir: vscode.Uri): string {
  const fileName = baseName(projectFile);
  if (FOLDER_NAMED_MANIFESTS.has(fileName.toLowerCase())) {
    const folderName = baseName(dir);
    if (folderName && !/^[a-z]:$/i.test(folderName)) {
      return folderName;
    }
  }
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.substring(0, dot) : fileName;
}

/** Converts a simple file name glob (`*`, `?`) into a case-insensitive anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .trim()
    .split('')
    .map((ch) => {
      if (ch === '*') {
        return '.*';
      }
      if (ch === '?') {
        return '.';
      }
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Case-insensitive ordinal comparison, the ordering Visual Studio uses for tab names. */
export function compareOrdinalIgnoreCase(a: string, b: string): number {
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  if (ua < ub) {
    return -1;
  }
  if (ua > ub) {
    return 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
