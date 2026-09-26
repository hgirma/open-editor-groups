import * as vscode from 'vscode';
import { Node } from './model';
import { tabsOf } from './selection';

/**
 * Lets files be dragged out of the view. VS Code turns the `text/uri-list`
 * payload into an editor drop, so dropping in the editor area opens the files
 * there (or in a new split when dropped at an edge). Nothing can be dropped
 * onto the view.
 */
export class OpenEditorGroupsDragAndDrop implements vscode.TreeDragAndDropController<Node> {
  readonly dragMimeTypes = ['text/uri-list'];
  readonly dropMimeTypes: readonly string[] = [];

  handleDrag(source: readonly Node[], dataTransfer: vscode.DataTransfer): void {
    const uris = new Set<string>();
    for (const node of tabsOf(source)) {
      if (node.uri) {
        uris.add(node.uri.toString());
      }
    }
    if (uris.size > 0) {
      dataTransfer.set('text/uri-list', new vscode.DataTransferItem([...uris].join('\r\n')));
    }
  }
}
