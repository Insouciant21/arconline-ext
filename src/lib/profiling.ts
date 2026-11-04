export interface TimingSpan {
  name: string;
  startMs: number;
  durationMs: number;
  failed?: true;
}

const round = (value: number) => Math.round(Math.max(0, value) * 10) / 10;

// Request-local timings only: never retain a fetch, binding or credential across
// Worker invocations. Names are code constants; reports contain no request data.
export class Profiler {
  private readonly spans: TimingSpan[];

  constructor(private readonly origin = Date.now(), previous: TimingSpan[] = []) {
    this.spans = previous.slice(-256);
  }

  record(name: string, startMs: number, durationMs: number, failed = false) {
    if (!/^[a-z][a-z0-9._-]{0,79}$/.test(name)) throw new Error("Invalid timing name");
    this.spans.push({ name, startMs: round(startMs), durationMs: round(durationMs), ...(failed ? { failed: true as const } : {}) });
    if (this.spans.length > 256) this.spans.shift();
  }

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const offset = Date.now() - this.origin, start = performance.now();
    let failed = false;
    try { return await operation(); }
    catch (error) { failed = true; throw error; }
    finally { this.record(name, offset, performance.now() - start, failed); }
  }

  snapshot() { return this.spans.map(span => ({ ...span })); }

  serverTiming() {
    const totals = new Map<string, number>();
    for (const span of this.spans) totals.set(span.name, (totals.get(span.name) ?? 0) + span.durationMs);
    return [...totals].map(([name, duration]) => `${name};dur=${round(duration)}`).join(", ");
  }
}

export function measure<T>(profiler: Profiler | undefined, name: string, operation: () => Promise<T>) {
  return profiler ? profiler.measure(name, operation) : operation();
}
