import * as vscode from 'vscode';
import { getConfig } from './config';

export const PALETTE_SIZE = 12;

/** Display names for the palette slots, in slot order (matches the `contributes.colors` defaults). */
export const PALETTE_NAMES = ['Blue', 'Purple', 'Teal', 'Gold', 'Orange', 'Red', 'Pink', 'Cyan', 'Green', 'Indigo', 'Brown', 'Gray'];

export const UNASSIGNED_COLOR_ID = 'openEditorGroups.unassignedColor';

/** The codicon id contributed in package.json (`contributes.icons`). */
export const BAR_ICON_ID = 'open-editor-groups-bar';

export function colorIdForSlot(slot: number | undefined): string {
  return slot ? `openEditorGroups.projectColor${slot}` : UNASSIGNED_COLOR_ID;
}

export function isValidSlot(slot: unknown): slot is number {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= PALETTE_SIZE;
}

const STATE_KEY = 'openEditorGroups.projectColorSlots';

/**
 * Assigns a stable palette slot to every project name.
 *
 * Priority: explicit override from settings, then a previously persisted
 * assignment, then a fresh assignment derived from a hash of the name that
 * avoids slots already taken by other projects in this workspace.
 */
export class ColorAssigner {
  private assignments: Record<string, number>;

  constructor(private readonly state: vscode.Memento) {
    this.assignments = { ...(state.get<Record<string, number>>(STATE_KEY) ?? {}) };
  }

  slotFor(projectName: string): number {
    const override = getConfig().projectColorOverrides[projectName];
    if (isValidSlot(override)) {
      return override;
    }
    const existing = this.assignments[projectName];
    if (isValidSlot(existing)) {
      return existing;
    }
    const slot = this.pickFreeSlot(projectName);
    this.assignments[projectName] = slot;
    void this.state.update(STATE_KEY, this.assignments);
    return slot;
  }

  private pickFreeSlot(projectName: string): number {
    const used = new Set<number>();
    for (const s of Object.values(this.assignments)) {
      if (isValidSlot(s)) {
        used.add(s);
      }
    }
    for (const s of Object.values(getConfig().projectColorOverrides)) {
      if (isValidSlot(s)) {
        used.add(s);
      }
    }
    const preferred = (fnv1a(projectName) % PALETTE_SIZE) + 1;
    let slot = preferred;
    for (let i = 0; i < PALETTE_SIZE && used.has(slot); i++) {
      slot = (slot % PALETTE_SIZE) + 1;
    }
    return used.has(slot) ? preferred : slot;
  }

  async reset(): Promise<void> {
    this.assignments = {};
    await this.state.update(STATE_KEY, undefined);
  }
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
