// Tiny in-process job runner. Jobs run only while the server is running.
// Packs call schedule() when they load; timers never keep the process alive.
//
// `events` is the seam for alerts: a job emits an event (e.g. "reminder.due")
// and any pack can listen, such as a future Telegram pack that pings you.
import { EventEmitter } from "events";

export const events = new EventEmitter();

const jobs = new Map(); // name -> { fn, timer, running }

export function schedule(name, intervalMs, fn) {
  unschedule(name);
  const job = { fn, timer: null, running: false };
  job.timer = setInterval(() => runJob(name), intervalMs);
  job.timer.unref?.();
  jobs.set(name, job);
}

/** Run one job now. Skips if it is already running; errors are logged, never thrown. */
export async function runJob(name) {
  const job = jobs.get(name);
  if (!job || job.running) return;
  job.running = true;
  try {
    await job.fn();
  } catch (err) {
    console.error(`causly-server: scheduled job "${name}" failed: ${err.message}`);
  } finally {
    job.running = false;
  }
}

export function unschedule(name) {
  const job = jobs.get(name);
  if (job) clearInterval(job.timer);
  jobs.delete(name);
}

export function stopScheduler() {
  for (const name of [...jobs.keys()]) unschedule(name);
}

export function listJobs() {
  return [...jobs.keys()];
}
