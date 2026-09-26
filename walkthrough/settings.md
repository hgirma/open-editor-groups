# Settings

All settings live under `openEditorGroups.*`. The view's `...` menu has quick toggles for the sort order, the icon style, colorized tabs and the project colors.

[Open the extension's settings](command:openEditorGroups.openSettings)

## Grouping

| Setting | Default | Meaning |
| --- | --- | --- |
| `groupBy` | `project` | `project`, `folder`, `workspaceFolder` or `none` (flat list, still colored by project). |
| `solutionNodes` | `auto` | Add a node per `.sln`/`.slnx`: `auto` (only with two or more solutions), `always`, `never`. |
| `groupByEditorGroup` | `true` | A node per editor group when the editor area is split. |
| `hideSingleGroup` | `false` | No header when everything belongs to one project. |
| `showNonFileEditors` | `true` | List Settings, Welcome, webviews, ... under *Other*. |
| `projectFilePatterns` | `*.csproj`, `package.json`, ... | File names that mark a project root. |

## Sorting

| Setting | Default | Meaning |
| --- | --- | --- |
| `sortOrder` | `alphabetical` | `alphabetical`, `editorOrder`, `mostRecentlyUsed` or `fileType`. |
| `pinnedEditors` | `first` | Pinned editors `first` in each project, in a `separateGroup`, or `inline`. |

## Look

| Setting | Default | Meaning |
| --- | --- | --- |
| `pathStyle` | `relativeToProject` | Path next to the name: `relativeToProject`, `relativeToWorkspace` or `none` (the Visual Studio look). |
| `fileIconStyle` | `projectColorBar` | Colored bar or the file icon theme's icon. |
| `headerIcon` | `auto` | `auto`, `bar`, `dot` or `none` on project headers. |
| `showEditorCount` | `false` | Number of editors next to each header. |
| `dirtyIndicator` | `dot` | `dot` (●), `asterisk` (*) or `none` for unsaved editors. |
| `emphasizeActiveEditor` | `true` | Bold name for the active editor. |

## Behavior

| Setting | Default | Meaning |
| --- | --- | --- |
| `autoReveal` | `true` | Select the active editor in the view. |
| `focusEditorOnClick` | `true` | `false` keeps keyboard focus in the view after a click. |
| `showPinButton` | `true` | Inline Pin/Unpin button on hover. |
| `showCloseButton` | `true` | Inline Close button on hover. |

## Colors

| Setting | Default | Meaning |
| --- | --- | --- |
| `colorBy` | `project` | `project`, `rules` (see `colorRules`) or `none`. |
| `colorRules` | `[]` | `{ "pattern": regex, "color": 1-12 }` rules, first match wins. |
| `colorizeTabs` | `false` | Color the real editor tab titles too. |
| `projectColorOverrides` | `{}` | Project name to palette slot, written by *Set Project Color...*. |

## Selecting several editors

Use <kbd>Ctrl</kbd>+click or <kbd>Shift</kbd>+click to select several files (or a whole project). *Close*, *Pin*, *Open to the Side* and *Copy Path* then act on all of them. Files can also be dragged from the view into the editor area to open them there or in a new split.
