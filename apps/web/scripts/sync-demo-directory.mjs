import { readFile, writeFile } from 'node:fs/promises'

// Keep demo data at the HTTP boundary, never in screens (Q-W6).
const directory = JSON.parse(await readFile(new URL('../../../data/demo/directory.json', import.meta.url), 'utf8'))
const source = `// Generated from data/demo/directory.json by npm run sync:demo.\nimport type { Actor, MdtBoard, Organization } from '../client/types.gen'\n\n` +
  `export const organizations: Organization[] = ${JSON.stringify(directory.organizations, null, 2)}\n\n` +
  `export const actors: Actor[] = ${JSON.stringify(directory.actors, null, 2)}\n\n` +
  `export const boards: MdtBoard[] = ${JSON.stringify(directory.mdt_boards, null, 2)}\n`
await writeFile(new URL('../src/mocks/directory.ts', import.meta.url), source)
