import * as vscode from 'vscode';
import { baseName, compareOrdinalIgnoreCase, parentOf } from './projectResolver';

/** A Visual Studio solution (`*.sln` or `*.slnx`) found in the workspace. */
export interface SolutionInfo {
  fileUri: vscode.Uri;
  dirUri: vscode.Uri;
  /** File name without extension. */
  name: string;
  /** Unique key (the solution file URI as a string). */
  key: string;
  /** Normalized keys (see `normalizeProjectKey`) of the project files the solution references. */
  projectKeys: Set<string>;
}

/** Type GUID of solution folders in classic .sln files; they are not projects. */
const SOLUTION_FOLDER_TYPE = '2150e333-8fdc-42a3-9474-1a3956d46de8';

const SLN_PROJECT_LINE = /^Project\("\{([0-9A-Fa-f-]+)\}"\)\s*=\s*"[^"]*",\s*"([^"]*)",\s*"\{[0-9A-Fa-f-]+\}"/gm;
const SLNX_PROJECT = /<Project\s+[^>]*?Path="([^"]+)"/gi;

/**
 * Discovers solution files in the workspace and maps project files to the
 * solutions that reference them. Reloads when solution files change.
 */
export class SolutionResolver implements vscode.Disposable {
  private solutions: SolutionInfo[] = [];
  private byProject = new Map<string, SolutionInfo[]>();
  private loading: Promise<void> = Promise.resolve();
  private version = 0;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires after a (re)load completed. */
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{sln,slnx}');
    this.watcher.onDidCreate(() => this.invalidate());
    this.watcher.onDidChange(() => this.invalidate());
    this.watcher.onDidDelete(() => this.invalidate());
    this.invalidate();
  }

  invalidate(): void {
    const version = ++this.version;
    this.loading = this.load().then(
      (result) => {
        if (version === this.version) {
          this.solutions = result.solutions;
          this.byProject = result.byProject;
          this._onDidChange.fire();
        }
      },
      (err) => console.error('[Open Editor Groups] failed to load solutions', err),
    );
  }

  /** Resolves when the in-flight load has finished. */
  ready(): Promise<void> {
    return this.loading;
  }

  get count(): number {
    return this.solutions.length;
  }

  /** All solutions, sorted by name. */
  all(): readonly SolutionInfo[] {
    return this.solutions;
  }

  /** Solutions that reference the given project file, in name order. */
  solutionsFor(projectFile: vscode.Uri): SolutionInfo[] {
    return this.byProject.get(normalizeProjectKey(projectFile)) ?? [];
  }

  private async load(): Promise<{ solutions: SolutionInfo[]; byProject: Map<string, SolutionInfo[]> }> {
    const solutions: SolutionInfo[] = [];
    const byProject = new Map<string, SolutionInfo[]>();
    if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) {
      return { solutions, byProject };
    }
    let files: vscode.Uri[] = [];
    try {
      files = await vscode.workspace.findFiles('**/*.{sln,slnx}', '**/{node_modules,bin,obj,.git}/**');
    } catch {
      return { solutions, byProject };
    }
    const decoder = new TextDecoder();
    for (const fileUri of files) {
      let text: string;
      try {
        text = decoder.decode(await vscode.workspace.fs.readFile(fileUri));
      } catch {
        continue;
      }
      const dirUri = parentOf(fileUri);
      const isSlnx = /\.slnx$/i.test(fileUri.path);
      const projectKeys = new Set<string>();
      for (const raw of isSlnx ? parseSlnx(text) : parseSln(text)) {
        const projectUri = resolveProjectPath(dirUri, raw);
        if (projectUri) {
          projectKeys.add(normalizeProjectKey(projectUri));
        }
      }
      const fileName = baseName(fileUri);
      solutions.push({
        fileUri,
        dirUri,
        name: fileName.replace(/\.slnx?$/i, ''),
        key: fileUri.toString(),
        projectKeys,
      });
    }
    solutions.sort((a, b) => compareOrdinalIgnoreCase(a.name, b.name) || compareOrdinalIgnoreCase(a.key, b.key));
    for (const solution of solutions) {
      for (const key of solution.projectKeys) {
        const list = byProject.get(key);
        if (list) {
          list.push(solution);
        } else {
          byProject.set(key, [solution]);
        }
      }
    }
    return { solutions, byProject };
  }

  dispose(): void {
    this.version++;
    this.watcher.dispose();
    this._onDidChange.dispose();
  }
}

/** Key used to match project files across the solution parser and the project resolver. */
export function normalizeProjectKey(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath.toLowerCase() : uri.toString();
}

/** Relative (or absolute) project paths referenced by a classic .sln file. */
export function parseSln(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(SLN_PROJECT_LINE)) {
    if (match[1].toLowerCase() === SOLUTION_FOLDER_TYPE) {
      continue;
    }
    paths.push(match[2]);
  }
  return paths;
}

/** Project paths referenced by an XML .slnx file. */
export function parseSlnx(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(SLNX_PROJECT)) {
    paths.push(match[1]);
  }
  return paths;
}

function resolveProjectPath(solutionDir: vscode.Uri, raw: string): vscode.Uri | undefined {
  const path = raw.trim().replace(/\\/g, '/');
  if (!path || path.includes('://')) {
    return undefined;
  }
  const last = path.substring(path.lastIndexOf('/') + 1);
  if (!last.includes('.')) {
    return undefined; // a folder reference, not a project file
  }
  if (/^[a-z]:\//i.test(path) || path.startsWith('/')) {
    return vscode.Uri.file(path);
  }
  return vscode.Uri.joinPath(solutionDir, path);
}
