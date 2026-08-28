import type LGTV from "lgtv2";
import { RemoteButton } from "@shared/types";

const POINTER_URI = "ssap://com.webos.service.networkinput/getPointerInputSocket";
const MAX_DELTA = 500;
const MAX_QUEUE = 200;

type SpecializedSocket = { send(type: string, payload?: Record<string, string | number>): void; close(): void };

/**
 * Owns exactly one pointer socket per main connection. Concurrent callers share a
 * single in-flight acquisition promise so a burst of events can never open two
 * sockets. The socket is dropped (and lazily reacquired) whenever the underlying
 * connection changes.
 */
export class PointerSocketManager {
  private socket: SpecializedSocket | null = null;
  private pending: Promise<SpecializedSocket> | null = null;
  private queue: Array<() => void> = [];
  private disposed = false;

  constructor(
    private readonly tv: LGTV,
    private readonly onReadyChange: (ready: boolean) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  get ready(): boolean {
    return this.socket !== null;
  }

  /** Acquire (once) and cache the pointer socket. */
  async acquire(): Promise<SpecializedSocket> {
    if (this.disposed) throw new Error("Pointer socket manager disposed");
    if (this.socket) return this.socket;
    if (this.pending) return this.pending;

    this.pending = (async () => {
      const socket = (await this.tv.getSocket(POINTER_URI)) as unknown as SpecializedSocket;
      if (this.disposed) {
        socket.close();
        throw new Error("Pointer socket manager disposed");
      }
      this.socket = socket;
      this.onReadyChange(true);
      this.flush();
      return socket;
    })();

    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  /** Fire-and-forget send; queued (bounded) while the socket is being acquired. */
  send(type: string, payload?: Record<string, string | number>): void {
    if (this.disposed) return;
    const task = () => {
      try {
        this.socket?.send(type, payload);
      } catch (error) {
        this.handleFailure(error);
      }
    };

    if (this.socket) {
      task();
      return;
    }

    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(task);
    void this.acquire().catch((error) => this.handleFailure(error));
  }

  button(name: RemoteButton): void {
    this.send("button", { name });
  }

  click(): void {
    this.send("click");
  }

  move(dx: number, dy: number, dragging = false): void {
    const x = clampDelta(dx);
    const y = clampDelta(dy);
    if (x === 0 && y === 0 && !dragging) return;
    this.send("move", { dx: x, dy: y, down: dragging ? 1 : 0 });
  }

  scroll(dx: number, dy: number): void {
    const x = clampDelta(dx);
    const y = clampDelta(dy);
    if (x === 0 && y === 0) return;
    this.send("scroll", { dx: x, dy: y });
  }

  /** Drop the socket and any queued work; the next send reacquires it. */
  reset(): void {
    this.queue = [];
    const socket = this.socket;
    this.socket = null;
    this.pending = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
      this.onReadyChange(false);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private flush(): void {
    const queued = this.queue;
    this.queue = [];
    for (const task of queued) task();
  }

  private handleFailure(error: unknown): void {
    this.queue = [];
    if (this.socket) {
      this.socket = null;
      this.onReadyChange(false);
    }
    this.onError(error);
  }
}

export function clampDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.trunc(value)));
}

export { POINTER_URI, MAX_QUEUE };
