/* eslint-disable no-console -- CLI entrypoint: stdout is its interface (the scheduler reads it) */
// CLI entrypoint for the scheduled jobs — invoked nightly by the CF Job Scheduler or
// `cf run-task <app> "node srv/jobs-run.js purge"`. Not an HTTP route (no public surface).
const cds = require('@sap/cds')

async function main() {
  const which = process.argv[2]
  cds.model = cds.compile.for.nodejs(await cds.load('*')) // load+compile the model (no HTTP server)
  await cds.connect.to('db')
  const jobs = require('./lib/jobs')
  if (which === 'purge') {
    console.log(JSON.stringify(await jobs.purgePII()))
  } else if (which === 'poll') {
    const stalled = await jobs.findStalled()
    console.log(JSON.stringify({ stalled: stalled.length }))
  } else {
    console.error('usage: node srv/jobs-run.js purge|poll')
    process.exit(2)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('job failed:', e.message)
  process.exit(1)
})
