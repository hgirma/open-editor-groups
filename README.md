# Open Editor Groups

Groups your open editors by project and colors them per project, the way the **Tabs** window in Visual Studio 2026 does.

![Open editors grouped by project, each project with its own color bar](images/open-editors-by-project.png)

## Where is it?

The extension adds an **Open Editors by Project** icon to the Activity Bar (the column of icons on the left). Click it to see your open editors grouped by project. The built-in *Open Editors* view in the Explorer is not changed, because VS Code does not let extensions modify built-in views. If you only want the grouped view, hide the built-in one:

```jsonc
"explorer.openEditors.visible": 0
```

You can also drag the view's header into the Explorer sidebar (for example above *Folders*) if you prefer to have everything in one place. No other settings are required.

## Features

- **Grouping by project.** Every open editor is listed under the nearest enclosing folder that contains a project file (`*.csproj`, `*.fsproj`, `*.vbproj`, `package.json`, `Cargo.toml`, ... configurable). Files that belong to no project are grouped by workspace folder, then *Untitled*, *External* and *Other* (Settings, Welcome, webviews, ...).
- **Project colors.** Each project gets a stable color from a 12-slot palette. The palette slots are theme colors, so they follow light/dark/high-contrast themes and can be customized. Pin a project to a specific color with **Set Project Color...** in the context menu.
- **Visual Studio ordering.** Projects and files are sorted alphabetically (case-insensitive ordinal, so `_Imports.razor` sorts last like in Visual Studio). Pinned editors come first. Switch to editor order from the view's `...` menu.
- **Follows the active editor.** The active editor is selected in the view; the view's badge shows the number of unsaved editors.
- **Editor actions.** Click to open, hover for *Pin*/*Close*. The context menu has *Open to the Side*, *Reveal in Explorer View*, *Copy Path*, *Close Others in Project*, *Close Saved in Project*, *Close All in Project* and more. The title bar has *Save All*, *Close All Editors* and *Collapse All*.
- **Split editors.** With several editor groups the view adds a top-level node per group (like the built-in Open Editors view). Turn this off with `openEditorGroups.groupByEditorGroup` to see one flat list.
- **Colorize the real tabs (opt-in).** `openEditorGroups.colorizeTabs` tints the editor tab titles (and the file labels in other views) with the project color through file decorations.

With tab colorizing enabled, the editor tabs pick up the same project colors:

![Editor tabs and the view colored by project](images/colorized-tabs.png)

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `openEditorGroups.projectFilePatterns` | `.csproj`, `.fsproj`, `.vbproj`, `.vcxproj`, `.esproj`, `.sqlproj`, `.wapproj`, `.shproj`, `.pyproj`, `.njsproj`, `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `build.gradle(.kts)` | File name patterns that mark a project root. Earlier patterns win inside one folder. |
| `openEditorGroups.sortOrder` | `alphabetical` | `alphabetical` or `editorOrder`. |
| `openEditorGroups.pathStyle` | `relativeToProject` | Path shown next to the file: `relativeToProject`, `relativeToWorkspace` or `none` (closest to the Visual Studio look). |
| `openEditorGroups.fileIconStyle` | `projectColorBar` | `projectColorBar` shows the colored bar on each file. `fileType` shows the file icon theme's icon and moves the color bar to the project header. |
| `openEditorGroups.groupByEditorGroup` | `true` | Add a node per editor group when the editor area is split. |
| `openEditorGroups.showNonFileEditors` | `true` | List editors without a file (Settings, Welcome, ...) under *Other*. |
| `openEditorGroups.autoReveal` | `true` | Select the active editor in the view. |
| `openEditorGroups.colorizeTabs` | `false` | Color editor tab titles with the project color. Needs `workbench.editor.decorations.colors`. Source control and problem colors keep precedence on files that have them. |
| `openEditorGroups.projectColorOverrides` | `{}` | Project name to palette slot (1-12). Written by **Set Project Color...**. |

### Changing the palette

The slots are theme colors named `openEditorGroups.projectColor1` through `openEditorGroups.projectColor12` (blue, purple, teal, gold, orange, red, pink, cyan, green, indigo, brown, gray) plus `openEditorGroups.unassignedColor`. Override them like any other workbench color:

```jsonc
"workbench.colorCustomizations": {
  "openEditorGroups.projectColor1": "#ff8800"
}
```

## How project detection works

For each open file the extension walks up the folder tree, starting at the file's folder, and stops at the first folder that contains a file matching one of `projectFilePatterns`. The walk never leaves the workspace folder. Directory listings are cached and refreshed automatically when project files are created or deleted. `git:` URIs (for example *Open File (HEAD)*) are mapped to their on-disk path so they group with their project.

For manifests whose file name is generic (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `build.gradle`) the containing folder's name is used as the project name; for everything else the file name without its extension is used (`Contoso.Server.csproj` becomes `Contoso.Server`).

## Development

```powershell
npm install
npm run compile      # type-check and bundle into dist/
npm run watch        # rebuild on change (also the default build task for F5)
npm run vsix:local   # build a .vsix for local installs (no repository URL needed)
npm run vsix         # build the .vsix for publishing (requires "repository" in package.json)
npm run build:icons  # regenerate resources/icons/open-editor-groups.woff (needs: pip install fonttools)
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the extension loaded.

### Publishing to the Marketplace

1. Set `publisher` in `package.json` to your Marketplace publisher ID.
2. Set `repository.url` in `package.json` to the public Git repository. `vsce` uses it to turn the relative image links in this README into absolute URLs; without it the screenshots would be broken on the Marketplace page.
3. Run `npm run vsix` and `npx vsce publish`.

## Known limitations

- Pin/unpin works by activating the editor first, because VS Code has no API to pin an editor that is not active.
- Editors that are not backed by a resource (webviews, terminals in the editor area) are activated by index, which relies on the built-in `workbench.action.openEditorAtIndex` command.
- Tab colorizing uses file decorations, which VS Code also uses for source control status and problems. Where both apply, the earlier registered decoration (usually Git) wins.
