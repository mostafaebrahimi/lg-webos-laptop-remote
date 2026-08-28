import { useCallback, useEffect, useRef } from "react";

export interface PointerPadOptions {
  sensitivity: number;
  scrollSensitivity: number;
  invertScrollY: boolean;
  enabled: boolean;
}

/** Never send a delta larger than this, whatever the OS reports. */
const MAX_DELTA = 500;
const clamp = (value: number) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.trunc(value)));

/**
 * Accumulates mouse deltas and flushes at most once per animation frame, so a
 * fast trackpad cannot flood the TV's pointer socket. Movement is relative:
 * webOS has no absolute cursor positioning.
 */
export function usePointerPad(options: PointerPadOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const move = useRef({ dx: 0, dy: 0 });
  const scroll = useRef({ dx: 0, dy: 0 });
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;

    const dx = clamp(move.current.dx);
    const dy = clamp(move.current.dy);
    move.current = { dx: 0, dy: 0 };
    if (dx !== 0 || dy !== 0) window.tvApi.pointerMove(dx, dy, dragging.current);

    const sx = clamp(scroll.current.dx);
    const sy = clamp(scroll.current.dy);
    scroll.current = { dx: 0, dy: 0 };
    if (sx !== 0 || sy !== 0) window.tvApi.pointerScroll(sx, sy);
  }, []);

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const addMove = useCallback(
    (movementX: number, movementY: number) => {
      if (!optionsRef.current.enabled) return;
      const factor = optionsRef.current.sensitivity;
      move.current.dx += movementX * factor;
      move.current.dy += movementY * factor;
      schedule();
    },
    [schedule],
  );

  const addScroll = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!optionsRef.current.enabled) return;
      const { scrollSensitivity, invertScrollY } = optionsRef.current;
      // Browsers report wildly different wheel magnitudes; normalise to lines.
      const normalise = (value: number) => Math.max(-40, Math.min(40, value / 8)) * scrollSensitivity;
      scroll.current.dx += normalise(deltaX);
      scroll.current.dy += normalise(invertScrollY ? -deltaY : deltaY);
      schedule();
    },
    [schedule],
  );

  const setDragging = useCallback(
    (value: boolean) => {
      if (dragging.current === value) return;
      dragging.current = value;
      // Flush immediately so the down/up state is not reordered behind movement.
      flush();
    },
    [flush],
  );

  const reset = useCallback(() => {
    move.current = { dx: 0, dy: 0 };
    scroll.current = { dx: 0, dy: 0 };
    dragging.current = false;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  return { addMove, addScroll, setDragging, reset, isDragging: () => dragging.current };
}
