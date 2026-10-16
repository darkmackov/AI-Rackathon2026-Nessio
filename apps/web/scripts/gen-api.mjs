// Runs openapi-ts with string sorting pinned to en-US. The generator orders exports with
// localeCompare() in the machine's locale, and Czech collation sorts "Ch" after "H", so a
// Czech Windows machine would produce a different src/client/index.ts than CI.
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const localeCompare = String.prototype.localeCompare
String.prototype.localeCompare = function (that, locales, options) {
  return localeCompare.call(this, that, locales ?? 'en-US', options)
}

const pkg = createRequire(import.meta.url).resolve('@hey-api/openapi-ts/package.json')
await import(pathToFileURL(path.join(path.dirname(pkg), 'dist', 'run.mjs')).href)
