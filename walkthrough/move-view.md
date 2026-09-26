# Where the view can live

The view starts as its own **Open Editors Group** icon in the Activity Bar. Like any view it can be dragged elsewhere:

- **Into the Explorer**: drag the icon onto the Explorer icon in the Activity Bar, then drag the view's header above *Folders*. Everything is in one side bar.
- **Into the Secondary Side Bar**: drag the icon to the right edge of the window (or run **View: Move View...** and pick *Secondary Side Bar*). The list stays open next to the editor while the Explorer keeps the primary side bar.
- **Into the Panel**: drop it on the Panel (next to the Terminal) for a wide, short list.

[Move the view...](command:workbench.action.moveView)

**View: Reset View Locations** puts every view back where it came from.

## Side bar position

Visual Studio's *Tab layout: Left / Right* corresponds to where the side bar is:

```json
"workbench.sideBar.location": "right"
```

[Toggle the Primary Side Bar position](command:workbench.action.toggleSidebarPosition)

`workbench.activityBar.location` (`default`, `top`, `hidden`, and `bottom` in newer VS Code versions) moves the Activity Bar itself; with `top` the view icons sit above the side bar content.

## Keyboard shortcut

No shortcut is shipped, so nothing collides with your own bindings. To add one, open **Preferences: Open Keyboard Shortcuts (JSON)** and add:

```json
{ "key": "ctrl+alt+o", "command": "openEditorGroups.view.focus" },
{ "key": "delete", "command": "openEditorGroups.close", "when": "focusedView == openEditorGroups.view" }
```
