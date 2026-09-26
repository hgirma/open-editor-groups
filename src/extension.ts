import * as vscode from 'vscode';
import { ColorAssigner } from './colors';
import { registerCommands } from './commands';
import { affectsConfig, getConfig, GroupBy } from './config';
import { ProjectColorDecorations } from './decorations';
import { OpenEditorGroupsDragAndDrop } from './dragAndDrop';
import { Model, ModelServices, Node } from './model';
import { MruTracker } from './mru';
import { ProjectResolver } from './projectResolver';
import { SolutionResolver } from './solutionResolver';
import { OpenEditorGroupsProvider, VIEW_ID } from './tree';

export function activate(context: vscode.ExtensionContext): void {
  const resolver = new ProjectResolver();
  const solutions = new SolutionResolver();
  const mru = new MruTracker();
  const colors = new ColorAssigner(context.workspaceState);
  const services: ModelServices = { resolver, colors, solutions, mru };
  const provider = new OpenEditorGroupsProvider(services);
  const decorations = new ProjectColorDecorations();

  const treeView = vscode.window.createTreeView<Node>(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: new OpenEditorGroupsDragAndDrop(),
  });

  context.subscriptions.push(resolver, solutions, mru, provider, decorations, treeView, vscode.window.registerFileDecorationProvider(decorations));

  const updateTitle = (): void => {
    treeView.title = VIEW_TITLES[getConfig().groupBy];
  };
  updateTitle();

  const revealActive = (model: Model): void => {
    if (!getConfig().autoReveal || !treeView.visible || treeView.selection.length > 1) {
      return;
    }
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const node = activeTab ? model.byTab.get(activeTab) : undefined;
    if (!node) {
      return;
    }
    treeView.reveal(node, { select: true, focus: false, expand: true }).then(undefined, () => {
      /* the model may have changed underneath us; the next rebuild reveals again */
    });
  };

  context.subscriptions.push(
    provider.onDidChangeModel((model) => {
      decorations.setModel(model);
      updateBadge(treeView, model);
      revealActive(model);
    }),
    treeView.onDidChangeVisibility((e) => {
      if (e.visible) {
        revealActive(provider.currentModel);
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => provider.scheduleRefresh()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => provider.scheduleRefresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      resolver.invalidate();
      solutions.invalidate();
    }),
    resolver.onDidChange(() => provider.scheduleRefresh()),
    solutions.onDidChange(() => provider.scheduleRefresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!affectsConfig(e)) {
        return;
      }
      if (affectsConfig(e, 'projectFilePatterns')) {
        resolver.reload();
      }
      if (affectsConfig(e, 'groupBy')) {
        updateTitle();
      }
      if (affectsConfig(e, 'colorizeTabs') || affectsConfig(e, 'colorBy') || affectsConfig(e, 'colorRules')) {
        decorations.refreshAll();
      }
      provider.scheduleRefresh(0);
    }),
  );

  registerCommands(context, { provider, resolver, solutions, colors, decorations, treeView });

  provider.scheduleRefresh(0);
  showWelcomeOnce(context);
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}

/**
 * View title per grouping mode. The container is titled "Open Editor Groups"; VS Code renders
 * a single view in a container as "Container: View" unless both titles are identical, so the
 * header reads "Open Editor Groups: By Project" and, for the flat list, just "Open Editor Groups".
 */
const VIEW_TITLES: Record<GroupBy, string> = {
  project: 'By Project',
  folder: 'By Folder',
  workspaceFolder: 'By Workspace Folder',
  none: 'Open Editor Groups',
};

function updateBadge(treeView: vscode.TreeView<unknown>, model: Model): void {
  const dirty = [...model.byTab.keys()].filter((tab) => tab.isDirty).length;
  treeView.badge = dirty > 0 ? { value: dirty, tooltip: `${dirty} unsaved ${dirty === 1 ? 'editor' : 'editors'}` } : undefined;
}

const WELCOME_SHOWN_KEY = 'openEditorGroups.welcomeShown';

/** Points new users to the view and the walkthrough, since the built-in Open Editors view is unchanged. */
function showWelcomeOnce(context: vscode.ExtensionContext): void {
  if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) {
    return;
  }
  void context.globalState.update(WELCOME_SHOWN_KEY, true);
  const getStarted = 'Get Started';
  const showView = 'Show View';
  const hideBuiltIn = 'Hide Built-in Open Editors';
  void vscode.window
    .showInformationMessage(
      'Open Editor Groups lists your open editors grouped by project in its own view in the Activity Bar.',
      getStarted,
      showView,
      hideBuiltIn,
    )
    .then(async (choice) => {
      if (choice === getStarted) {
        await vscode.commands.executeCommand('openEditorGroups.openWalkthrough');
      } else if (choice === showView) {
        await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      } else if (choice === hideBuiltIn) {
        await vscode.commands.executeCommand('openEditorGroups.hideBuiltInOpenEditors');
      }
    });
}
