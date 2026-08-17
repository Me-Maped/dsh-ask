import { cpSync } from 'node:fs'

const source = new URL('../src/templates/', import.meta.url)
const destination = new URL('../lib/templates/', import.meta.url)

cpSync(source, destination, { recursive: true })
