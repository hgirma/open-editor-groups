# Changelog

## 0.2.2

- The view's title follows the grouping mode: "Open Editor Group: Project", "Folder", "Workspace Folder", or "Open Editor Group" for the flat list. The Activity Bar container is now titled "Open Editor Group".
- README: disclaimer that the extension was built with Claude Code.

## 0.2.1

- With `openEditorGroups.groupByEditorGroup` off, files no longer get a "Group 1" suffix (which looked like a count) as soon as a second editor group appears. Only editors outside the first group that holds a file are marked, with the text "editor group N".
- Fixes from a code review: "Open to the Side" with several files selected opens all of them (previews no longer replace each other); multi-file Copy Path / Copy Relative Path now produces the same paths as the single-file commands; Reveal in Explorer works for `git:` tabs; the workspace-root guard of the project lookup is case-insensitive on Windows; two editors on the same file keep stable ids; output channels opened as editors show their tab title and are listed under *Other*; tab-title decorations are only refreshed for files whose color changed; the "most recently used" order ignores changes in background editor groups.
- `openEditorGroups.colorRules` is a restricted setting in untrusted workspaces, and the extension ships a Marketplace icon.

## 0.2.0

- Grouping modes: by project (default), by folder, by workspace folder, or a flat list (`openEditorGroups.groupBy`); optional solution nodes from `.sln`/`.slnx` files (`openEditorGroups.solutionNodes`); `hideSingleGroup`.
- Pinned editor placement: first in each project, a separate *Pinned* node, or inline (`openEditorGroups.pinnedEditors`).
- New sort orders: most recently used and file type.
- Look: dirty indicator style (dot, asterisk, none), bold active editor, header icon (bar, dot, none) and editor counts on headers.
- Colorization method: by project, by regular-expression rules on the file path (`openEditorGroups.colorRules`), or none.
- Multi-select (Ctrl/Shift+click): Close, Close Others, Pin/Unpin, Open to the Side and Copy Path act on all selected files; a selected project or group stands for all of its editors.
- Drag files (or a whole project) from the view into the editor area to open them there or in a new split.
- `showPinButton`, `showCloseButton` and `focusEditorOnClick` settings; *Expand All* title action.
- Getting Started walkthrough (opens after installation; also **Open Editor Groups: Getting Started**) with one-click commands: Hide/Show Built-in Open Editors View, Show Only the Active Editor Tab, Hide Editor Tabs, Show All Editor Tabs, Open Settings.
- **Set Project Color...** can be run from the Command Palette and the `...` menu (asks for the project).
- README: "Customize further" section with the single-tab layout.

## 0.1.1

- The view now lives in its own "Open Editors" Activity Bar container instead of the bottom of the Explorer, where VS Code kept it collapsed and out of sight.
- First-run message that points to the view and can hide the built-in Open Editors view.

## 0.1.0

- Initial release.
- "Open Editors by Project" view in the Explorer sidebar, grouping open editors by the nearest project file.
- Per-project colors from a themable 12-slot palette, with a Visual Studio style colored bar per file.
- Pin, close, close others/saved/all in project, open to the side, reveal, copy path commands.
- Optional colorizing of the real editor tabs (`openEditorGroups.colorizeTabs`).
