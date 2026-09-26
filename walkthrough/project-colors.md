# Project colors

Every project gets one of 12 palette slots. The slot is chosen from the project name, so a project keeps its color across sessions, and colors that are already taken by other projects in the workspace are avoided.

| Slot | Name | Slot | Name |
| --- | --- | --- | --- |
| 1 | Blue | 7 | Pink |
| 2 | Purple | 8 | Cyan |
| 3 | Teal | 9 | Green |
| 4 | Gold | 10 | Indigo |
| 5 | Orange | 11 | Brown |
| 6 | Red | 12 | Gray |

Editors that belong to no project (Untitled, External, Other) use the *unassigned* color.

## Pin a project to a slot

Right-click a project header and choose **Set Project Color...**, or run it from the Command Palette. The choice is stored in the workspace settings:

```json
"openEditorGroups.projectColorOverrides": {
  "Contoso.Store.Api": 1
}
```

[Set a project color...](command:openEditorGroups.setProjectColor)

**Reset Project Colors** in the view's `...` menu forgets the automatic assignments (and, if you want, the pinned ones).

## Change the palette

The slots are theme colors named `openEditorGroups.projectColor1` through `openEditorGroups.projectColor12`, plus `openEditorGroups.unassignedColor`. Override them like any other workbench color:

```json
"workbench.colorCustomizations": {
  "openEditorGroups.projectColor1": "#ff8800"
}
```

[Open color customizations](command:workbench.action.openSettings?%5B%22workbench.colorCustomizations%22%5D)

## Color by file pattern instead

Set `openEditorGroups.colorBy` to `rules` and describe the colors with regular expressions (the first matching rule wins):

```json
"openEditorGroups.colorBy": "rules",
"openEditorGroups.colorRules": [
  { "pattern": "\\.razor$", "color": 4 },
  { "pattern": "/Tests?/", "color": 9 },
  { "pattern": "^src/", "color": 1 }
]
```
