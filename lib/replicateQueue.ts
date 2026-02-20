
type TaskStatus = "queued" | "running" | "retrying" | "done" | "failed";

export type QueueUpdate = {
  id: string;
  status: TaskStatus;
  position: number; // 0 = running, 1.. = waiting
  attempt: number;
  message?: string;
};

type TaskFn<T> = () => Promise<T>;
type Listener = (u: QueueUpdate) => void;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function is429(err: any) {
  const msg = String(err?.message ?? "");
  const status = err?.status ?? err?.response?.status;
  return status === 429 || msg.includes("429") || msg.toLowerCase().includes("throttle");
}

function backoffMs(attempt: number) {
  // STRICT POLICY: 30s -> 60s -> 120s -> 240s
  // attempt is the number of the attempt that just failed (1, 2, 3, 4)
  // attempt 1 (failed) -> wait 30s before retry 1
  // attempt 4 (failed) -> wait 240s before retry 4
  const seconds = 30 * Math.pow(2, attempt - 1);
  return seconds * 1000;
}

export class ReplicateQueue {
  private minGapMs: number;
  private maxRetries: number;

  private queue: Array<{
    id: string;
    fn: TaskFn<any>;
    resolve: (v: any) => void;
    reject: (e: any) => void;
    attempt: number;
  }> = [];

  private running = false;
  private lastFinishTime = 0; // Track when the last successful task finished
  private listeners = new Set<Listener>();

  constructor(opts?: { minGapMs?: number; maxRetries?: number }) {
    // STRICT POLICY: Wait 15 seconds after each successful request
    this.minGapMs = opts?.minGapMs ?? 15000;
    // STRICT POLICY: Max 4 retries
    this.maxRetries = opts?.maxRetries ?? 4;
  }

  onUpdate(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(u: QueueUpdate) {
    for (const l of this.listeners) l(u);
  }

  private emitAllPositions() {
    this.queue.forEach((t, idx) => {
      this.emit({ id: t.id, status: "queued", position: idx + 1, attempt: t.attempt });
    });
  }

  add<T>(id: string, fn: TaskFn<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id, fn, resolve, reject, attempt: 0 });
      this.emit({ id, status: "queued", position: this.queue.length, attempt: 0 });
      this.emitAllPositions();
      this.runLoop().catch(() => {});
    });
  }

  size() {
    return this.queue.length + (this.running ? 1 : 0);
  }

  private async runLoop() {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.emitAllPositions();

      // STRICT POLICY: Serial Execution & Safe Pacing
      // Wait for minGapMs since the LAST SUCCESSFUL finish
      const now = Date.now();
      const timeSinceFinish = now - this.lastFinishTime;
      const wait = Math.max(0, this.minGapMs - timeSinceFinish);
      
      if (wait > 0) {
        // We stay in "queued" state (implicitly position 0/1 depending on perspective) while waiting?
        // Actually, we already shifted it. Let's emit a waiting status or just sleep.
        // To user it looks like "Processing..." or "Queued". 
        // Let's sleep.
        await sleep(wait);
      }

      task.attempt += 1;
      this.emit({ id: task.id, status: "running", position: 0, attempt: task.attempt });

      try {
        const res = await task.fn();
        
        // STRICT POLICY: Update last finish time ONLY on success
        this.lastFinishTime = Date.now();
        
        this.emit({ id: task.id, status: "done", position: 0, attempt: task.attempt });
        task.resolve(res);
      } catch (err: any) {
        if (is429(err) && task.attempt <= this.maxRetries) {
          const ms = backoffMs(task.attempt);
          const seconds = Math.ceil(ms / 1000);
          
          this.emit({
            id: task.id,
            status: "retrying",
            position: 0,
            attempt: task.attempt,
            message: `WAITING (retry in ${seconds}s)`,
          });
          
          await sleep(ms);
          
          // Re-queue at the front for retry
          this.queue.unshift(task);
          this.emitAllPositions();
        } else {
          // Final Failure
          let failMessage = String(err?.message ?? err);
          
          // STRICT POLICY: Special message for exhausted retries on throttle
          if (is429(err)) {
            failMessage = "RATE LIMITED: Please wait a few minutes or upgrade credits, then retry.";
          }

          this.emit({
            id: task.id,
            status: "failed",
            position: 0,
            attempt: task.attempt,
            message: failMessage,
          });
          task.reject(new Error(failMessage));
        }
      }
    }

    this.running = false;
  }
}

// Global Singleton
export const replicateQueue = new ReplicateQueue({
  minGapMs: 15000, // 15s gap
  maxRetries: 4,   // 4 retries
});
