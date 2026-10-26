#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
const root = new URL('../', import.meta.url)
const source = await readFile(new URL('src/content.ts', root), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { allArticles, featured } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
if (!allArticles.length || allArticles.some(a => !a.id || !a.title || !a.sources.length || a.status !== 'published')) throw new Error('Seed content is incomplete')
const output = resolve(process.argv[2] || new URL('dist/seed.json', root).pathname)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify({ articles: allArticles, featuredId: featured.id }, null, 2) + '\n')
console.log(`Exported ${allArticles.length} existing articles to ${output}`)
