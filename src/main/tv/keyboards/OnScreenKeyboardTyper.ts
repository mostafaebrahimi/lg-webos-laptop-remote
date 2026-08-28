import type { RemoteButton } from "@shared/types";
import {
  findLayer,
  findLayout,
  locate,
  unsupportedCharacters,
  type KeyPosition,
  type KeyTarget,
  type OskLayer,
  type OskLayout,
} from "./layouts";

export interface TyperProgress {
  typed: number;
  total: number;
  character: string;
}

/** Where the highlight is, and which page of the keyboard is showing. */
export interface TyperState {
  position: KeyPosition;
  layer: string;
}

/**
 * Turns a string into D-pad presses on an app's own on-screen keyboard.
 *
 * Two things make this fiddly and both are handled here: the grid is ragged, so
 * vertical movement only happens at a column that exists in every row crossed;
 * and characters like `$` live on a second page reached through a layer key, so
 * the page is switched and switched back rather than the character being
 * silently dropped.
 */
export class OnScreenKeyboardTyper {
  private cancelled = false;

  constructor(
    private readonly press: (button: RemoteButton) => void,
    private readonly ok: () => void,
    private readonly delayMs: number = 150,
  ) {}

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Move the highlight to a known corner: all the way down, then all the way
   * left. Bottom-left exists on every layer and repeated presses at an edge are
   * harmless, so this is a reliable origin.
   */
  /**
   * The page currently on screen cannot be read back from the TV, so the caller
   * states it. Homing only normalises the highlight position, not the page.
   */
  async home(layout: OskLayout, layer: string): Promise<TyperState> {
    const grid = findLayer(layout, layer);
    const widest = Math.max(...grid.rows.map((row) => row.length));
    for (let i = 0; i < grid.rows.length + 2; i += 1) await this.tap("DOWN");
    for (let i = 0; i < widest + 2; i += 1) await this.tap("LEFT");
    return { position: { row: grid.rows.length - 1, col: 0 }, layer };
  }

  async type(
    layoutId: string,
    text: string,
    from: TyperState | null,
    onProgress?: (progress: TyperProgress) => void,
  ): Promise<TyperState> {
    this.cancelled = false;
    const layout = findLayout(layoutId);

    // Refuse up front rather than typing half a password and dropping the rest.
    const missing = unsupportedCharacters(layout, text);
    if (missing.length > 0) {
      throw new Error(
        `This TV keyboard has no key for ${missing.map((character) => `“${character}”`).join(", ")}. ` +
          `Remove ${missing.length === 1 ? "it" : "them"}, or pick the keyboard that is actually on screen.`,
      );
    }

    let state = from ?? (await this.home(layout, layout.baseLayer));

    const characters = [...text];
    for (let index = 0; index < characters.length; index += 1) {
      if (this.cancelled) break;
      const character = characters[index];
      const target = locate(layout, character, state.layer);
      if (!target) continue;

      state = await this.ensureLayer(layout, state, target.layer);

      if (target.shift && layout.shiftKey) {
        state = await this.moveTo(layout, state, layout.shiftKey);
        await this.tapOk();
        // A sticky shift key stays on, so it is pressed again after the letter.
      }

      state = await this.moveTo(layout, state, target);
      await this.tapOk();

      if (target.shift && layout.shiftKey && layout.shiftMode === "sticky") {
        state = await this.moveTo(layout, state, layout.shiftKey);
        await this.tapOk();
      }

      onProgress?.({ typed: index + 1, total: characters.length, character });
    }

    // Leave the keyboard on its normal page so the next run starts predictably.
    state = await this.ensureLayer(layout, state, layout.baseLayer);
    return state;
  }

  /** Press the layout's own submit/search key, when it has one. */
  async submit(layoutId: string, from: TyperState | null): Promise<TyperState | null> {
    const layout = findLayout(layoutId);
    if (!layout.submitKey) return from;
    let state = from ?? (await this.home(layout, layout.baseLayer));
    state = await this.ensureLayer(layout, state, layout.submitKey.layer);
    state = await this.moveTo(layout, state, layout.submitKey);
    await this.tapOk();
    return state;
  }

  async backspace(layoutId: string, from: TyperState | null, count: number): Promise<TyperState | null> {
    const layout = findLayout(layoutId);
    if (!layout.backspaceKey) return from;
    let state = from ?? (await this.home(layout, layout.baseLayer));
    state = await this.ensureLayer(layout, state, layout.backspaceKey.layer);
    state = await this.moveTo(layout, state, layout.backspaceKey);
    for (let i = 0; i < count; i += 1) {
      if (this.cancelled) break;
      await this.tapOk();
    }
    return state;
  }

  /** Walk to the layer key and press it until the wanted page is showing. */
  private async ensureLayer(layout: OskLayout, state: TyperState, wanted: string): Promise<TyperState> {
    let current = state;
    // Bounded: one hop per layer at most, so a bad definition cannot loop.
    for (let hop = 0; hop < layout.layers.length && current.layer !== wanted; hop += 1) {
      const grid = findLayer(layout, current.layer);
      if (!grid.switchKey) break;
      current = await this.moveTo(layout, current, grid.switchKey);
      await this.tapOk();
      // Switching pages keeps the highlight on the key that was pressed.
      current = { position: { row: grid.switchKey.row, col: grid.switchKey.col }, layer: grid.switchKey.to };
    }
    return current;
  }

  private async moveTo(layout: OskLayout, state: TyperState, to: KeyPosition | KeyTarget): Promise<TyperState> {
    const grid: OskLayer = findLayer(layout, state.layer);
    let { row, col } = state.position;

    // Vertical travel must happen at a column that exists in every row crossed.
    const first = Math.min(row, to.row);
    const last = Math.max(row, to.row);
    let narrowest = Number.POSITIVE_INFINITY;
    for (let index = first; index <= last; index += 1) {
      narrowest = Math.min(narrowest, grid.rows[index].length);
    }
    const transitCol = Math.min(col, narrowest - 1);

    while (col > transitCol) {
      await this.tap("LEFT");
      col -= 1;
    }
    while (row > to.row) {
      await this.tap("UP");
      row -= 1;
    }
    while (row < to.row) {
      await this.tap("DOWN");
      row += 1;
    }
    while (col > to.col) {
      await this.tap("LEFT");
      col -= 1;
    }
    while (col < to.col) {
      await this.tap("RIGHT");
      col += 1;
    }
    return { position: { row, col }, layer: state.layer };
  }

  private async tap(button: RemoteButton): Promise<void> {
    if (this.cancelled) return;
    this.press(button);
    await delay(this.delayMs);
  }

  private async tapOk(): Promise<void> {
    if (this.cancelled) return;
    this.ok();
    await delay(this.delayMs);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
