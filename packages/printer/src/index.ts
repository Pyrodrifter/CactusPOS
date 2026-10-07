import { connect } from 'node:net';

/** Sends raw bytes to a printer. */
export interface Transport { send(data: Uint8Array): Promise<void> }

/**
 * Network receipt printer: raw bytes to TCP port 9100, which is what Ethernet and WiFi
 * ESC/POS printers listen on. One connection per job; the printer prints as bytes arrive.
 */
export class NetworkTransport implements Transport {
  constructor(private host: string, private port = 9100, private timeoutMs = 4000) {}
  send(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let done = false;
      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        socket.destroy();
        if (err) reject(err); else resolve();
      };
      socket.setTimeout(this.timeoutMs, () => finish(new Error(`Printer at ${this.host}:${this.port} did not answer`)));
      socket.once('error', (e) => finish(new Error(`Printer at ${this.host}:${this.port}: ${e.message}`)));
      socket.once('connect', () => socket.end(Buffer.from(data), () => finish()));
    });
  }
}

export type JobStatus = 'queued' | 'printing' | 'done' | 'failed';
export interface PrintJob {
  id: number; label: string; status: JobStatus; attempts: number; error?: string; createdAt: string;
}
interface Queued extends PrintJob { data: Uint8Array }

export interface QueueOptions {
  /** Attempts before a job is marked failed. */
  maxAttempts?: number;
  /** Wait before retry n (1-based), in ms. */
  backoffMs?: (attempt: number) => number;
  onChange?: (jobs: PrintJob[]) => void;
}

/**
 * Prints jobs one at a time, in order, retrying when the printer is off or out of paper.
 * A stuck job never blocks the till: sales continue and the receipt can be reprinted later.
 * The queue lives in memory; after a server restart, reprint from the Orders screen.
 */
export class PrintQueue {
  private jobs: Queued[] = [];
  private nextId = 1;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private transport: Transport | null = null;
  private maxAttempts: number;
  private backoff: (attempt: number) => number;

  constructor(private opts: QueueOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.backoff = opts.backoffMs ?? ((n) => Math.min(1000 * 2 ** (n - 1), 15_000));
  }

  setTransport(t: Transport | null): void { this.transport = t; this.kick(); }

  add(label: string, data: Uint8Array): PrintJob {
    const job: Queued = { id: this.nextId++, label, data, status: 'queued', attempts: 0, createdAt: new Date().toISOString() };
    this.jobs.push(job);
    if (this.jobs.length > 100) this.jobs = this.jobs.filter((j) => j.status === 'queued' || j.status === 'printing').concat(this.jobs.filter((j) => j.status === 'done' || j.status === 'failed').slice(-30)).sort((a, b) => a.id - b.id);
    this.changed();
    this.kick();
    return this.view(job);
  }

  /** Newest first, without the bytes. */
  list(): PrintJob[] { return this.jobs.map((j) => this.view(j)).reverse(); }
  pending(): number { return this.jobs.filter((j) => j.status === 'queued' || j.status === 'printing').length; }

  retryFailed(): void {
    for (const j of this.jobs) if (j.status === 'failed') { j.status = 'queued'; j.attempts = 0; j.error = undefined; }
    this.changed();
    this.kick();
  }
  clear(): void { this.jobs = this.jobs.filter((j) => j.status === 'printing'); this.changed(); }

  /** Resolves when nothing is queued or printing (used by tests and shutdown). */
  async idle(): Promise<void> {
    while (this.pending() > 0) await new Promise((r) => setTimeout(r, 5));
  }
  stop(): void { clearTimeout(this.timer); }

  private view(j: Queued): PrintJob {
    return { id: j.id, label: j.label, status: j.status, attempts: j.attempts, error: j.error, createdAt: j.createdAt };
  }
  private changed(): void { this.opts.onChange?.(this.list()); }
  private kick(): void {
    if (this.running) return;
    clearTimeout(this.timer);
    void this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      for (;;) {
        const job = this.jobs.find((j) => j.status === 'queued');
        if (!job) return;
        if (!this.transport) { job.status = 'failed'; job.error = 'No printer is set up'; this.changed(); continue; }
        job.status = 'printing';
        job.attempts += 1;
        this.changed();
        try {
          await this.transport.send(job.data);
          job.status = 'done';
          job.error = undefined;
          this.changed();
        } catch (e) {
          job.error = e instanceof Error ? e.message : String(e);
          if (job.attempts >= this.maxAttempts) { job.status = 'failed'; this.changed(); continue; }
          // Keep order: wait, then try the same job again before anything queued behind it.
          job.status = 'queued';
          this.changed();
          this.timer = setTimeout(() => this.kick(), this.backoff(job.attempts));
          return;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
