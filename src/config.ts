import * as vscode from 'vscode';

export const CONFIG_SECTION = 'openEditorGroups';

export type SortOrder = 'alphabetical' | 'editorOrder' | 'mostRecentlyUsed' | 'fileType';
export type PathStyle = 'relativeToProject' | 'relativeToWorkspace' | 'none';
export type FileIconStyle = 'projectColorBar' | 'fileType';
export type GroupBy = 'project' | 'folder' | 'workspaceFolder' | 'none';
export type SolutionNodes = 'auto' | 'always' | 'never';
export type PinnedEditors = 'first' | 'separateGroup' | 'inline';
export type DirtyIndicator = 'dot' | 'asterisk' | 'none';
export type HeaderIcon = 'auto' | 'bar' | 'dot' | 'none';
export type ColorBy = 'project' | 'rules' | 'none';

export interface ColorRule {
  pattern: string;
  color: number;
}

export interface ExtensionConfig {
  projectFilePatterns: string[];
  groupBy: GroupBy;
  solutionNodes: SolutionNodes;
  sortOrder: SortOrder;
  pinnedEditors: PinnedEditors;
  pathStyle: PathStyle;
  fileIconStyle: FileIconStyle;
  headerIcon: HeaderIcon;
  showEditorCount: boolean;
  dirtyIndicator: DirtyIndicator;
  emphasizeActiveEditor: boolean;
  hideSingleGroup: boolean;
  groupByEditorGroup: boolean;
  showNonFileEditors: boolean;
  autoReveal: boolean;
  focusEditorOnClick: boolean;
  showPinButton: boolean;
  showCloseButton: boolean;
  colorBy: ColorBy;
  colorRules: ColorRule[];
  colorizeTabs: boolean;
  projectColorOverrides: Record<string, number>;
}

export function getConfig(): ExtensionConfig {
  const c = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    projectFilePatterns: c.get<string[]>('projectFilePatterns', []).filter((p) => typeof p === 'string' && p.trim().length > 0),
    groupBy: c.get<GroupBy>('groupBy', 'project'),
    solutionNodes: c.get<SolutionNodes>('solutionNodes', 'auto'),
    sortOrder: c.get<SortOrder>('sortOrder', 'alphabetical'),
    pinnedEditors: c.get<PinnedEditors>('pinnedEditors', 'first'),
    pathStyle: c.get<PathStyle>('pathStyle', 'relativeToProject'),
    fileIconStyle: c.get<FileIconStyle>('fileIconStyle', 'projectColorBar'),
    headerIcon: c.get<HeaderIcon>('headerIcon', 'auto'),
    showEditorCount: c.get<boolean>('showEditorCount', false),
    dirtyIndicator: c.get<DirtyIndicator>('dirtyIndicator', 'dot'),
    emphasizeActiveEditor: c.get<boolean>('emphasizeActiveEditor', true),
    hideSingleGroup: c.get<boolean>('hideSingleGroup', false),
    groupByEditorGroup: c.get<boolean>('groupByEditorGroup', true),
    showNonFileEditors: c.get<boolean>('showNonFileEditors', true),
    autoReveal: c.get<boolean>('autoReveal', true),
    focusEditorOnClick: c.get<boolean>('focusEditorOnClick', true),
    showPinButton: c.get<boolean>('showPinButton', true),
    showCloseButton: c.get<boolean>('showCloseButton', true),
    colorBy: c.get<ColorBy>('colorBy', 'project'),
    colorRules: (c.get<unknown[]>('colorRules', []) ?? []).filter(isColorRuleShape),
    colorizeTabs: c.get<boolean>('colorizeTabs', false),
    projectColorOverrides: c.get<Record<string, number>>('projectColorOverrides', {}) ?? {},
  };
}

function isColorRuleShape(value: unknown): value is ColorRule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ColorRule).pattern === 'string' &&
    typeof (value as ColorRule).color === 'number'
  );
}

/** Writes a setting to the workspace when a workspace is open, otherwise to user settings. */
export async function updateSetting(key: keyof ExtensionConfig, value: unknown, preferWorkspace: boolean): Promise<void> {
  const target =
    preferWorkspace && (vscode.workspace.workspaceFolders?.length ?? 0) > 0
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration(CONFIG_SECTION).update(key, value, target);
}

export function affectsConfig(e: vscode.ConfigurationChangeEvent, key?: keyof ExtensionConfig): boolean {
  return e.affectsConfiguration(key ? `${CONFIG_SECTION}.${key}` : CONFIG_SECTION);
}
