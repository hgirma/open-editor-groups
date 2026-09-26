import * as os from 'os';
import * as vscode from 'vscode';
import { ColorAssigner, isValidSlot, PALETTE_NAMES, PALETTE_SIZE } from './colors';
import { getConfig, updateSetting } from './config';
import { ProjectColorDecorations } from './decorations';
import { descendantTabs, Model, Node, TabNode } from './model';
import { ProjectResolver } from './projectResolver';
import { isNode, scopeTabsOf, tabsOf } from './selection';
import { SolutionResolver } from './solutionResolver';
import { OpenEditorGroupsProvider, VIEW_ID } from './tree';

export const WALKTHROUGH_ID = 'openEditorGroups.gettingStarted';

interface Services {
  provider: OpenEditorGroupsProvider;
  resolver: ProjectResolver;
  solutions: SolutionResolver;
  colors: ColorAssigner;
  decorations: ProjectColorDecorations;
  treeView: vscode.TreeView<Node>;
}

const FOCUS_GROUP_COMMANDS = [
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusSecondEditorGroup',
  'workbench.action.focusThirdEditorGroup',
  'workbench.action.focusFourthEditorGroup',
  'workbench.action.focusFifthEditorGroup',
  'workbench.action.focusSixthEditorGroup',
  'workbench.action.focusSeventhEditorGroup',
  'workbench.action.focusEighthEditorGroup',
];

export function registerCommands(context: vscode.ExtensionContext, services: Services): void {
  const { provider, resolver, solutions, colors, decorations, treeView } = services;
  const extensionId = context.extension.id;

  const register = (id: string, handler: (arg?: unknown, selection?: unknown) => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (arg?: unknown, selection?: unknown) => {
        try {
          await handler(arg, selection);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Open Editor Groups: ${message}`);
        }
      }),
    );
  };

  /**
   * The nodes a command should act on. VS Code passes the multi-selection as the
   * second argument only when several items are selected and the clicked item is
   * one of them; keyboard invocations pass nothing, so fall back to the selection.
   */
  const targets = (arg: unknown, selection: unknown): Node[] => {
    if (Array.isArray(selection) && selection.length > 1) {
      return selection.filter(isNode);
    }
    if (isNode(arg)) {
      return [arg];
    }
    return arg === undefined ? [...treeView.selection] : [];
  };
  const tabTargets = (arg: unknown, selection: unknown): TabNode[] => tabsOf(targets(arg, selection));
  const scopeTargets = (arg: unknown, selection: unknown): TabNode[] => scopeTabsOf(targets(arg, selection), provider.currentModel);
  const asTab = (arg: unknown): TabNode | undefined => (isNode(arg) && arg.kind === 'tab' ? arg : undefined);

  register('openEditorGroups.open', async (arg) => {
    const node = asTab(arg);
    if (node) {
      await activateTab(node.tab, { preserveFocus: !getConfig().focusEditorOnClick });
    }
  });

  register('openEditorGroups.openToSide', async (arg, selection) => {
    const uris = tabTargets(arg, selection).map((t) => t.uri).filter((u): u is vscode.Uri => !!u);
    if (uris.length === 0) {
      return;
    }
    await vscode.commands.executeCommand('vscode.open', uris[0], vscode.ViewColumn.Beside);
    // "Beside" is relative to the active group, so resolve it once for the remaining files.
    const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
    for (const uri of uris.slice(1)) {
      await vscode.commands.executeCommand('vscode.open', uri, column);
    }
  });

  register('openEditorGroups.close', (arg, selection) => closeTabs(tabTargets(arg, selection).map((t) => t.tab)));

  register('openEditorGroups.closeOthers', (arg, selection) => {
    const keep = new Set(tabTargets(arg, selection).map((t) => t.tab));
    return closeTabs(
      scopeTargets(arg, selection)
        .filter((t) => !keep.has(t.tab) && !t.tab.isPinned)
        .map((t) => t.tab),
    );
  });

  register('openEditorGroups.closeSavedInProject', (arg, selection) =>
    closeTabs(
      scopeTargets(arg, selection)
        .filter((t) => !t.tab.isDirty && !t.tab.isPinned)
        .map((t) => t.tab),
    ),
  );

  register('openEditorGroups.closeProject', (arg, selection) =>
    closeTabs(
      scopeTargets(arg, selection)
        .filter((t) => !t.tab.isPinned)
        .map((t) => t.tab),
    ),
  );

  register('openEditorGroups.closeAll', () => vscode.commands.executeCommand('workbench.action.closeAllEditors'));

  register('openEditorGroups.closeSaved', async () => {
    const tabs: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (!tab.isDirty && !tab.isPinned) {
          tabs.push(tab);
        }
      }
    }
    await closeTabs(tabs);
  });

  register('openEditorGroups.saveAll', () => vscode.commands.executeCommand('workbench.action.files.saveAll'));

  register('openEditorGroups.pin', async (arg, selection) => {
    for (const node of tabTargets(arg, selection).filter((t) => !t.tab.isPinned)) {
      await activateTab(node.tab); // pinEditor acts on the active editor
      await vscode.commands.executeCommand('workbench.action.pinEditor');
    }
  });

  register('openEditorGroups.unpin', async (arg, selection) => {
    for (const node of tabTargets(arg, selection).filter((t) => t.tab.isPinned)) {
      await activateTab(node.tab);
      await vscode.commands.executeCommand('workbench.action.unpinEditor');
    }
  });

  register('openEditorGroups.revealInExplorer', async (arg) => {
    const node = asTab(arg);
    if (node?.uri) {
      await vscode.commands.executeCommand('revealInExplorer', node.uri);
    }
  });

  register('openEditorGroups.revealInOS', async (arg) => {
    const node = asTab(arg);
    if (node?.uri) {
      await vscode.commands.executeCommand('revealFileInOS', node.uri);
    }
  });

  register('openEditorGroups.copyPath', (arg, selection) => copyPaths(tabTargets(arg, selection), false));
  register('openEditorGroups.copyRelativePath', (arg, selection) => copyPaths(tabTargets(arg, selection), true));

  register('openEditorGroups.openProjectFile', async (arg) => {
    const project = isNode(arg) ? (arg.kind === 'project' ? arg.project : arg.kind === 'tab' ? arg.project : undefined) : undefined;
    if (project) {
      await vscode.commands.executeCommand('vscode.open', project.fileUri);
    }
  });

  register('openEditorGroups.openSolutionFile', async (arg) => {
    if (isNode(arg) && arg.kind === 'solution' && arg.solution) {
      await vscode.commands.executeCommand('vscode.open', arg.solution.fileUri);
    }
  });

  register('openEditorGroups.setProjectColor', async (arg) => {
    let colorKey: string | undefined;
    let currentSlot: number | undefined;
    if (isNode(arg) && (arg.kind === 'project' || arg.kind === 'tab')) {
      colorKey = arg.colorKey;
      currentSlot = arg.slot;
    }
    if (!colorKey) {
      const picked = await pickColorKey(provider.currentModel);
      if (!picked) {
        return;
      }
      colorKey = picked.colorKey;
      currentSlot = picked.slot;
    }

    const overrides = { ...getConfig().projectColorOverrides };
    const items: (vscode.QuickPickItem & { slot?: number })[] = [];
    for (let slot = 1; slot <= PALETTE_SIZE; slot++) {
      items.push({
        slot,
        label: PALETTE_NAMES[slot - 1] ?? `Color ${slot}`,
        description: `slot ${slot}${slot === currentSlot ? ' · current' : ''}`,
      });
    }
    if (isValidSlot(overrides[colorKey])) {
      items.push({ label: 'Automatic', description: 'remove the override and assign a color automatically' });
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: `Project color for ${colorKey}`,
      placeHolder: 'Colors can be customized in workbench.colorCustomizations (openEditorGroups.projectColor1 ... 12)',
    });
    if (!picked) {
      return;
    }
    if (picked.slot) {
      overrides[colorKey] = picked.slot;
    } else {
      delete overrides[colorKey];
    }
    await updateSetting('projectColorOverrides', overrides, true);
    provider.scheduleRefresh(0);
  });

  register('openEditorGroups.resetProjectColors', async () => {
    const overrides = getConfig().projectColorOverrides;
    const hasOverrides = Object.keys(overrides).length > 0;
    let clearOverrides = false;
    if (hasOverrides) {
      const choice = await vscode.window.showWarningMessage(
        'Reset the automatically assigned project colors? Some projects also have colors pinned in settings (openEditorGroups.projectColorOverrides).',
        { modal: true },
        'Reset and clear pinned colors',
        'Reset automatic colors only',
      );
      if (!choice) {
        return;
      }
      clearOverrides = choice === 'Reset and clear pinned colors';
    }
    await colors.reset();
    if (clearOverrides) {
      await updateSetting('projectColorOverrides', undefined, true);
      await updateSetting('projectColorOverrides', undefined, false);
    }
    provider.scheduleRefresh(0);
  });

  register('openEditorGroups.refresh', () => {
    resolver.invalidate();
    solutions.invalidate();
    provider.scheduleRefresh(0);
  });

  register('openEditorGroups.expandAll', async () => {
    // VS Code has no expand-all API; revealing each root with `expand` expands its subtree.
    // Reverse order so the first root ends up scrolled into view.
    const roots = [...provider.currentModel.roots].reverse();
    for (const root of roots) {
      if (root.kind !== 'tab') {
        await treeView.reveal(root, { select: false, focus: false, expand: 3 });
      }
    }
  });

  register('openEditorGroups.sortAlphabetically', () => updateSetting('sortOrder', 'alphabetical', false));
  register('openEditorGroups.sortByEditorOrder', () => updateSetting('sortOrder', 'editorOrder', false));
  register('openEditorGroups.sortByMostRecentlyUsed', () => updateSetting('sortOrder', 'mostRecentlyUsed', false));
  register('openEditorGroups.sortByFileType', () => updateSetting('sortOrder', 'fileType', false));

  register('openEditorGroups.toggleFileIconStyle', () => {
    const next = getConfig().fileIconStyle === 'projectColorBar' ? 'fileType' : 'projectColorBar';
    return updateSetting('fileIconStyle', next, false);
  });

  register('openEditorGroups.toggleColorizeTabs', async () => {
    const next = !getConfig().colorizeTabs;
    await updateSetting('colorizeTabs', next, false);
    decorations.refreshAll();
    if (next && !vscode.workspace.getConfiguration('workbench.editor.decorations').get<boolean>('colors', true)) {
      void vscode.window.showInformationMessage(
        'Editor tab colors are disabled by the setting workbench.editor.decorations.colors. Enable it to see project colors on tabs.',
      );
    }
  });

  // Onboarding helpers: these write VS Code's own settings at user level.
  register('openEditorGroups.hideBuiltInOpenEditors', async () => {
    const c = vscode.workspace.getConfiguration('explorer.openEditors');
    if (c.get<number>('visible') !== 0) {
      await c.update('visible', 0, vscode.ConfigurationTarget.Global);
    }
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  });
  register('openEditorGroups.showBuiltInOpenEditors', () =>
    vscode.workspace.getConfiguration('explorer.openEditors').update('visible', undefined, vscode.ConfigurationTarget.Global),
  );
  const setShowTabs = (value: 'single' | 'none' | undefined): Thenable<void> =>
    vscode.workspace.getConfiguration('workbench.editor').update('showTabs', value, vscode.ConfigurationTarget.Global);
  register('openEditorGroups.showSingleEditorTab', () => setShowTabs('single'));
  register('openEditorGroups.hideEditorTabs', () => setShowTabs('none'));
  register('openEditorGroups.restoreEditorTabs', () => setShowTabs(undefined));
  register('openEditorGroups.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${extensionId}`));
  register('openEditorGroups.openWalkthrough', () =>
    vscode.commands.executeCommand('workbench.action.openWalkthrough', `${extensionId}#${WALKTHROUGH_ID}`, false),
  );
}

/** QuickPick over the projects that currently have an automatic or pinned color. */
async function pickColorKey(model: Model): Promise<{ colorKey: string; slot: number | undefined } | undefined> {
  const byKey = new Map<string, number | undefined>();
  for (const root of model.roots) {
    const tabs = root.kind === 'tab' ? [root] : descendantTabs(root);
    for (const t of tabs) {
      if (t.colorKey && !byKey.has(t.colorKey)) {
        byKey.set(t.colorKey, t.slot);
      }
    }
  }
  if (byKey.size === 0) {
    void vscode.window.showInformationMessage('Open Editor Groups: no open editor belongs to a project, so there is no project color to set.');
    return undefined;
  }
  const items = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([colorKey, slot]) => ({
      label: colorKey,
      description: slot ? (PALETTE_NAMES[slot - 1] ?? `slot ${slot}`) : undefined,
      colorKey,
      slot,
    }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Set Project Color', placeHolder: 'Choose a project' });
  return picked ? { colorKey: picked.colorKey, slot: picked.slot } : undefined;
}

async function copyPaths(nodes: TabNode[], relative: boolean): Promise<void> {
  const uris = nodes.map((t) => t.uri).filter((u): u is vscode.Uri => !!u);
  if (uris.length === 0) {
    return;
  }
  if (uris.length === 1) {
    // The built-in commands honour explorer.copyRelativePathSeparator and remote paths.
    await vscode.commands.executeCommand(relative ? 'copyRelativeFilePath' : 'copyFilePath', uris[0]);
    return;
  }
  const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const lines = uris.map((uri) =>
    relative ? vscode.workspace.asRelativePath(uri, multiRoot) : uri.scheme === 'file' ? uri.fsPath : uri.toString(true),
  );
  await vscode.env.clipboard.writeText(lines.join(os.EOL));
}

async function closeTabs(tabs: vscode.Tab[]): Promise<void> {
  if (tabs.length === 0) {
    return;
  }
  // Only close tabs that still exist; the model may lag behind a burst of changes.
  const live = new Set<vscode.Tab>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      live.add(tab);
    }
  }
  const existing = tabs.filter((t) => live.has(t));
  if (existing.length > 0) {
    await vscode.window.tabGroups.close(existing, true);
  }
}

/** Brings a tab to the front in its editor group. */
export async function activateTab(tab: vscode.Tab, options: { preserveFocus?: boolean } = {}): Promise<void> {
  const viewColumn = tab.group.viewColumn;
  const preserveFocus = options.preserveFocus ?? false;
  const input = tab.input;

  if (input instanceof vscode.TabInputText) {
    await vscode.window.showTextDocument(input.uri, { viewColumn, preserveFocus });
    return;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    await vscode.commands.executeCommand('vscode.diff', input.original, input.modified, tab.label, { viewColumn, preserveFocus });
    return;
  }
  if (input instanceof vscode.TabInputCustom) {
    await vscode.commands.executeCommand('vscode.openWith', input.uri, input.viewType, { viewColumn, preserveFocus });
    return;
  }
  if (input instanceof vscode.TabInputNotebook) {
    await vscode.commands.executeCommand('vscode.openWith', input.uri, input.notebookType, { viewColumn, preserveFocus });
    return;
  }

  // Webviews, terminals, notebook diffs, settings pages, ...: there is no public API to
  // activate them directly, so focus the group and open the editor by its index.
  const groupIndex = vscode.window.tabGroups.all.indexOf(tab.group);
  const tabIndex = tab.group.tabs.indexOf(tab);
  if (groupIndex < 0 || tabIndex < 0) {
    return;
  }
  if (!tab.group.isActive && groupIndex < FOCUS_GROUP_COMMANDS.length) {
    await vscode.commands.executeCommand(FOCUS_GROUP_COMMANDS[groupIndex]);
  }
  await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', tabIndex);
  if (preserveFocus) {
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }
}
