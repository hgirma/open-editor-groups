import * as vscode from 'vscode';
import { ColorAssigner } from './colors';
import { registerCommands } from './commands';
import { affectsConfig, getConfig } from './config';
import { ProjectColorDecorations } from './decorations';
import { Model } from './model';
import { ProjectResolver } from './projectResolver';
import { OpenEditorGroupsProvider, VIEW_ID } from './tree';

export function activate(context: vscode.ExtensionContext): void {
  const resolver = new ProjectResolver();
  const colors = new ColorAssigner(context.workspaceState);
  const provider = new OpenEditorGroupsProvider(resolver, colors);
  const decorations = new ProjectColorDecorations();

  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(resolver, provider, decorations, treeView, vscode.window.registerFileDecorationProvider(decorations));

  const revealActive = (model: Model): void => {
    if (!getConfig().autoReveal || !treeView.visible) {
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
    }),
    resolver.onDidChange(() => provider.scheduleRefresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!affectsConfig(e)) {
        return;
      }
      if (affectsConfig(e, 'projectFilePatterns')) {
        resolver.reload();
      }
      if (affectsConfig(e, 'colorizeTabs')) {
        decorations.refreshAll();
      }
      provider.scheduleRefresh(0);
    }),
  );

  registerCommands(context, { provider, resolver, colors, decorations });

  provider.scheduleRefresh(0);
  showWelcomeOnce(context);
}

const WELCOME_SHOWN_KEY = 'openEditorGroups.welcomeShown';

/** Points new users to the view, since the built-in Open Editors view is unchanged. */
function showWelcomeOnce(context: vscode.ExtensionContext): void {
  if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) {
    return;
  }
  void context.globalState.update(WELCOME_SHOWN_KEY, true);
  const showView = 'Show View';
  const hideBuiltIn = 'Hide Built-in Open Editors';
  void vscode.window
    .showInformationMessage(
      'Open Editor Groups adds an "Open Editors by Project" icon to the Activity Bar that lists your open editors grouped by project. The built-in Open Editors view is not changed.',
      showView,
      hideBuiltIn,
    )
    .then(async (choice) => {
      if (choice === showView) {
        await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      } else if (choice === hideBuiltIn) {
        await vscode.workspace.getConfiguration('explorer.openEditors').update('visible', 0, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      }
    });
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}

function updateBadge(treeView: vscode.TreeView<unknown>, model: Model): void {
  const dirty = [...model.byTab.keys()].filter((tab) => tab.isDirty).length;
  treeView.badge = dirty > 0 ? { value: dirty, tooltip: `${dirty} unsaved ${dirty === 1 ? 'editor' : 'editors'}` } : undefined;
}
