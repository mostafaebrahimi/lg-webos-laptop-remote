/**
 * On-screen keyboard layouts.
 *
 * Some TV apps (YouTube and its Google sign-in screen are the obvious ones) draw
 * their own keyboard instead of focusing a webOS IME widget. Text cannot be
 * injected into those; the only way in is to drive the grid with the D-pad, the
 * same way the physical remote does. Every grid below was read off a real screen
 * capture, including the symbol layers.
 */

export interface KeyPosition {
  row: number;
  col: number;
}

export interface KeyTarget extends KeyPosition {
  /** Which layer the key lives on. */
  layer: string;
  /** Press the shift key first. */
  shift?: boolean;
}

export interface OskLayer {
  id: string;
  /** The grid, row by row: the character a key produces, or a `#name` marker. */
  rows: string[][];
  /** Key that switches to another layer, and where it goes. */
  switchKey?: KeyPosition & { to: string };
}

export interface OskLayout {
  id: string;
  name: string;
  /** Where this layout appears, shown in the UI. */
  where: string;
  layers: OskLayer[];
  /** Layer the keyboard shows when it first opens. */
  baseLayer: string;
  /**
   * Whether the shift key applies to one character or stays on until pressed
   * again. TV keyboards are usually one-shot.
   */
  shiftMode: "oneshot" | "sticky";
  shiftKey?: KeyPosition & { layer: string };
  submitKey?: KeyPosition & { layer: string };
  backspaceKey?: KeyPosition & { layer: string };
}

/**
 * Google sign-in inside YouTube. Verified on webOS 5.0: RIGHT RIGHT DOWN from
 * the top-left moved the highlight 1 → 3 → e, and `test@gmail.com` typed
 * correctly end to end.
 */
const GOOGLE_SIGN_IN: OskLayout = {
  id: "google-signin",
  name: "Google sign-in (YouTube)",
  where: "The YouTube “Sign in” / password screen.",
  baseLayer: "letters",
  shiftMode: "oneshot",
  shiftKey: { layer: "letters", row: 2, col: 10 },
  backspaceKey: { layer: "letters", row: 0, col: 10 },
  layers: [
    {
      id: "letters",
      rows: [
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "#backspace"],
        ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
        ["a", "s", "d", "f", "g", "h", "j", "k", "l", "@", "#shift"],
        ["z", "x", "c", "v", "b", "n", "m", "_", "-", ".", "#layer"],
      ],
      switchKey: { row: 3, col: 10, to: "symbols" },
    },
    {
      // The !?# page. Read off a capture: `$` sits on the bottom row, 7th key.
      id: "symbols",
      rows: [
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "#backspace"],
        ["|", "/", "\\", ";", ":", ",", "-", '"', "'", "`"],
        ["^", "~", "<", ">", "{", "}", "[", "]", "(", ")", " "],
        ["+", "=", "#", "%", "&", "?", "$", "*", "@", "!", "#layer"],
      ],
      switchKey: { row: 3, col: 10, to: "letters" },
    },
  ],
};

/**
 * YouTube's own search keyboard: alphabetical, not QWERTY. Grid verified against
 * a real capture of the search screen on webOS 5.0. Its `&123` page has not been
 * captured yet, so symbols are reported as unsupported rather than guessed at.
 */
const YOUTUBE_SEARCH: OskLayout = {
  id: "youtube-search",
  name: "YouTube search",
  where: "The YouTube search screen with the A–Z grid.",
  baseLayer: "letters",
  shiftMode: "oneshot",
  backspaceKey: { layer: "letters", row: 0, col: 7 },
  submitKey: { layer: "letters", row: 4, col: 2 },
  layers: [
    {
      id: "letters",
      rows: [
        ["a", "b", "c", "d", "e", "f", "g", "#backspace"],
        ["h", "i", "j", "k", "l", "m", "n", "#layer"],
        ["o", "p", "q", "r", "s", "t", "u", "#language"],
        ["v", "w", "x", "y", "z", "-", "'"],
        [" ", "#clear", "#submit"],
      ],
    },
  ],
};

export const LAYOUTS: OskLayout[] = [GOOGLE_SIGN_IN, YOUTUBE_SEARCH];

export function findLayout(id: string): OskLayout {
  const layout = LAYOUTS.find((candidate) => candidate.id === id);
  if (!layout) throw new Error(`Unknown keyboard layout “${id}”.`);
  return layout;
}

/** Human labels for the page selector: what the key that switches page says. */
export const LAYER_LABELS: Record<string, string> = {
  letters: "abc",
  symbols: "!?#",
};

export function findLayer(layout: OskLayout, id: string): OskLayer {
  const layer = layout.layers.find((candidate) => candidate.id === id);
  if (!layer) throw new Error(`Layout “${layout.id}” has no layer “${id}”.`);
  return layer;
}

/**
 * Where a character lives, or null when this keyboard cannot produce it.
 * A layer the highlight is already on wins, so typing "1$2" does not flip back
 * and forth needlessly.
 */
export function locate(layout: OskLayout, character: string, preferLayer?: string): KeyTarget | null {
  const lower = character.toLowerCase();
  const needsShift = character !== lower && character === character.toUpperCase();

  const ordered = preferLayer
    ? [...layout.layers].sort((a, b) => Number(b.id === preferLayer) - Number(a.id === preferLayer))
    : layout.layers;

  for (const layer of ordered) {
    for (let row = 0; row < layer.rows.length; row += 1) {
      const col = layer.rows[row].indexOf(lower);
      if (col !== -1) {
        return { layer: layer.id, row, col, shift: needsShift && Boolean(layout.shiftKey) };
      }
    }
  }
  return null;
}

/** Characters this keyboard cannot type, so the user is told before it starts. */
export function unsupportedCharacters(layout: OskLayout, text: string): string[] {
  const missing = new Set<string>();
  for (const character of text) {
    if (!locate(layout, character)) missing.add(character);
  }
  return [...missing];
}
