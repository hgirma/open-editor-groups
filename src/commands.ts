import * as vscode from 'vscode';
import { ColorAssigner, isValidSlot, PALETTE_NAMES, PALETTE_SIZE } from './colors';
import { getConfig, updateSetting } from './config';
import { ProjectColorDecorations } from './decorations';
import { Node, ProjectNode, TabNode } from './model';
import { ProjectResolver } from './projectResolver';
import { OpenEditorGroupsProvider } from './tree';

interface Services {
  provider: OpenEditorGroupsProvider;
  resolver: ProjectResolver;
  colors: ColorAssigner;
  decorations: ProjectColorDecorations;
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
  const { provider, resolver, colors, decorations } = services;

  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await handler(...args);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Open Editor Groups: ${message}`);
        }
      }),
    );
  };

  const asTab = (arg: unknown): TabNode | undefined => (isNode(arg) && arg.kind === 'tab' ? arg : undefined);
  const asProject = (arg: unknown): ProjectNode | undefined => {
    if (!isNode(arg)) {
      return undefined;
    }
    return arg.kind === 'project' ? arg : arg.kind === 'tab' ? arg.parent : undefined;
  };

  register('openEditorGroups.open', async (arg) => {
    const node = asTab(arg);
    if (node) {
      await activateTab(node.tab);
    }
  });

  register('openEditorGroups.openToSide', async (arg) => {
    const node = asTab(arg);
    if (node?.uri) {
      await vscode.commands.executeCommand('vscode.open', node.uri, vscode.ViewColumn.Beside);
    }
  });

  register('openEditorGroups.close', async (arg) => {
    const node = asTab(arg);
    if (node) {
      await closeTabs([node.tab]);
    }
  });

  register('openEditorGroups.closeOthers', async (arg) => {
    const node = asTab(arg);
    if (node) {
      await closeTabs(node.parent.children.filter((t) => t !== node && !t.tab.isPinned).map((t) => t.tab));
    }
  });

  register('openEditorGroups.closeSavedInProject', async (arg) => {
    const project = asProject(arg);
    if (project) {
      await closeTabs(project.children.filter((t) => !t.tab.isDirty && !t.tab.isPinned).map((t) => t.tab));
    }
  });

  register('openEditorGroups.closeProject', async (arg) => {
    const project = asProject(arg);
    if (project) {
      await closeTabs(project.children.filter((t) => !t.tab.isPinned).map((t) => t.tab));
    }
  });

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

  register('openEditorGroups.pin', async (arg) => {
    const node = asTab(arg);
    if (node && !node.tab.isPinned) {
      await activateTab(node.tab);
      await vscode.commands.executeCommand('workbench.action.pinEditor');
    }
  });

  register('openEditorGroups.unpin', async (arg) => {
    const node = asTab(arg);
    if (node && node.tab.isPinned) {
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

  register('openEditorGroups.copyPath', async (arg) => {
    const node = asTab(arg);
    if (node?.uri) {
      await vscode.commands.executeCommand('copyFilePath', node.uri);
    }
  });

  register('openEditorGroups.copyRelativePath', async (arg) => {
    const node = asTab(arg);
    if (node?.uri) {
      await vscode.commands.executeCommand('copyRelativeFilePath', node.uri);
    }
  });

  register('openEditorGroups.openProjectFile', async (arg) => {
    const project = asProject(arg);
    if (project?.project) {
      await vscode.commands.executeCommand('vscode.open', project.project.fileUri);
    }
  });

  register('openEditorGroups.setProjectColor', async (arg) => {
    const project = asProject(arg);
    if (!project || !project.slot) {
      return;
    }
    const overrides = { ...getConfig().projectColorOverrides };
    const current = overrides[project.label];
    const items: (vscode.QuickPickItem & { slot?: number })[] = [];
    for (let slot = 1; slot <= PALETTE_SIZE; slot++) {
      items.push({
        slot,
        label: `${PALETTE_NAMES[slot - 1] ?? `Color ${slot}`}`,
        description: `slot ${slot}${slot === project.slot ? ' · current' : ''}`,
      });
    }
    if (isValidSlot(current)) {
      items.push({ label: 'Automatic', description: 'remove the override and assign a color automatically' });
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: `Project color for ${project.label}`,
      placeHolder: 'Colors can be customized in workbench.colorCustomizations (openEditorGroups.projectColor1 ... 12)',
    });
    if (!picked) {
      return;
    }
    if (picked.slot) {
      overrides[project.label] = picked.slot;
    } else {
      delete overrides[project.label];
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
    provider.scheduleRefresh(0);
  });

  register('openEditorGroups.sortAlphabetically', () => updateSetting('sortOrder', 'alphabetical', false));
  register('openEditorGroups.sortByEditorOrder', () => updateSetting('sortOrder', 'editorOrder', false));

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
}

function isNode(arg: unknown): arg is Node {
  return typeof arg === 'object' && arg !== null && 'kind' in arg;
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
export async function activateTab(tab: vscode.Tab): Promise<void> {
  const viewColumn = tab.group.viewColumn;
  const input = tab.input;

  if (input instanceof vscode.TabInputText) {
    await vscode.window.showTextDocument(input.uri, { viewColumn, preserveFocus: false });
    return;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    await vscode.commands.executeCommand('vscode.diff', input.original, input.modified, tab.label, { viewColumn });
    return;
  }
  if (input instanceof vscode.TabInputCustom) {
    await vscode.commands.executeCommand('vscode.openWith', input.uri, input.viewType, viewColumn);
    return;
  }
  if (input instanceof vscode.TabInputNotebook) {
    await vscode.commands.executeCommand('vscode.openWith', input.uri, input.notebookType, viewColumn);
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
}
