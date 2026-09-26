# Two lists of the same files

The Explorer has a built-in **Open Editors** section at its top. It lists every open editor in tab order, without grouping. Once you use this extension's **Open Editors** view, that section only repeats what the view already shows.

Hiding it writes this to your **user** settings (it is not a workspace setting):

```json
"explorer.openEditors.visible": 0
```

[Hide the built-in Open Editors section](command:openEditorGroups.hideBuiltInOpenEditors)

[Show it again](command:openEditorGroups.showBuiltInOpenEditors)

**Prefer everything in one side bar?** Drag the extension's *Open Editors* icon from the Activity Bar into the Explorer, then drag its header above *Folders*. The next step of this walkthrough shows how to shrink the editor tab bar as well.
