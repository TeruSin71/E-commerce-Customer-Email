
import cds from '@sap/cds/eslint.config.mjs'
import cdsPlugin from '@sap/eslint-plugin-cds'

// gen/ is cds-build output (a copy of srv/) — never lint the generated tree.
export default [{ ignores: ['gen/'] }, ...cds.recommended, cdsPlugin.configs.recommended]
