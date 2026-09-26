import * as vscode from 'vscode';

export const CONFIG_SECTION = 'openEditorGroups';

export type SortOrder = 'alphabetical' | 'editorOrder';
export type PathStyle = 'relativeToProject' | 'relativeToWorkspace' | 'none';
export type FileIconStyle = 'projectColorBar' | 'fileType';

export interface ExtensionConfig {
  projectFilePatterns: string[];
  sortOrder: SortOrder;
  pathStyle: PathStyle;
  fileIconStyle: FileIconStyle;
  groupByEditorGroup: boolean;
  showNonFileEditors: boolean;
  autoReveal: boolean;
  colorizeTabs: boolean;
  projectColorOverrides: Record<string, number>;
}

export function getConfig(): ExtensionConfig {
  const c = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    projectFilePatterns: c.get<string[]>('projectFilePatterns', []).filter((p) => typeof p === 'string' && p.trim().length > 0),
    sortOrder: c.get<SortOrder>('sortOrder', 'alphabetical'),
    pathStyle: c.get<PathStyle>('pathStyle', 'relativeToProject'),
    fileIconStyle: c.get<FileIconStyle>('fileIconStyle', 'projectColorBar'),
    groupByEditorGroup: c.get<boolean>('groupByEditorGroup', true),
    showNonFileEditors: c.get<boolean>('showNonFileEditors', true),
    autoReveal: c.get<boolean>('autoReveal', true),
    colorizeTabs: c.get<boolean>('colorizeTabs', false),
    projectColorOverrides: c.get<Record<string, number>>('projectColorOverrides', {}) ?? {},
  };
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
