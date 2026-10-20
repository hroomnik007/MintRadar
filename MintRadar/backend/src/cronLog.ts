import { describePoolError } from './db.js'

/**
 * One place for the error line of a cron job. Outside production the full error object is printed as before. In
 * production ONE line is written: the job name and the message (cut to 200 characters, anything that looks like a URL
 * redacted, the same redaction as the pg pool error line in db.ts) with the error code; no stack trace.
 * The job itself still swallows the error; this only decides what is logged.
 */
export function logCronError(job: string, err: unknown): void {
  if (process.env['NODE_ENV'] !== 'production') {
    console.error(`[cron] ${job} error:`, err)
    return
  }
  console.error(`[cron] ${job} error: ${describePoolError(err)}`)
}
