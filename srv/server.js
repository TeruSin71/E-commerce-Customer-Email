// courier-srv bootstrap — wires the docs/10 §1.1 chain app-wide, ahead of every route.
const cds = require('@sap/cds')
const auth = require('./middleware/auth')
const errors = require('./middleware/errors')
const routes = require('./routes')

// Auth first: every route sits behind validate → scope → plants.
cds.on('bootstrap', (app) => {
  app.use(auth.middleware())
  routes(app)
})

// Error handler last (after all routes exist) so express routes errors into it.
cds.on('served', () => cds.app.use(errors()))

module.exports = cds.server
