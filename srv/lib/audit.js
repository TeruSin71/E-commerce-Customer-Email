// Append-only audit trail for dangerous actions (S8, doc 09): void, override, config, role.
// This module is the ONLY writer and exposes INSERT only — no update/delete path exists in
// code. At the DB layer the application role is granted INSERT/SELECT only on AuditLog
// (HANA .hdbrole at deploy; verified at go-live S8). before/after are JSON snapshots.
const cds = require('@sap/cds')

async function record({ actor, action, object, before, after }) {
  const { INSERT } = cds.ql
  const { AuditLog } = cds.entities('courier')
  await cds.run(
    INSERT.into(AuditLog).entries({
      ID: cds.utils.uuid(),
      actor,
      action,
      object: String(object).slice(0, 200),
      before: before === undefined ? null : JSON.stringify(before),
      after: after === undefined ? null : JSON.stringify(after),
      at: new Date().toISOString(),
    })
  )
}

module.exports = { record }
