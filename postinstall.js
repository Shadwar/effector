#!/usr/bin/env node
// @flow

const fs = require('fs-extra')
const semver = require('semver')
const flowgen = require('../../../../desktop/projects/pending/flowgen')
const execa = require('execa')
const pkg = require('./package.json')

/*::
type Package = string
type Lockfile = {|
  version: number,
  packages: {
    flowgen: {[key: string]: Package},
    custom: {[key: string]: Package},
    flowTyped: {[key: string]: Package},
    stub: {[key: string]: Package},
    builtin: {[key: string]: Package}
  }
|}
*/

function normalizePattern(
  pattern /*: string*/,
) /*: {
  hasVersion: boolean,
  name: string,
  range: string,
}*/ {
  let hasVersion = false
  let range = 'latest'
  let name = pattern

  // if we're a scope then remove the @ and add it back later
  let isScoped = false
  if (name[0] === '@') {
    isScoped = true
    name = name.slice(1)
  }

  // take first part as the name
  const parts = name.split('@')
  if (parts.length > 1) {
    name = parts.shift()
    range = parts.join('@')

    if (range) {
      hasVersion = true
    } else {
      range = '*'
    }
  }

  // add back @ scope suffix
  if (isScoped) {
    name = `@${name}`
  }

  return {name, range, hasVersion}
}

const defaultLockfile = {
  version: 2,
  packages: {
    flowgen: {},
    custom: {},
    flowTyped: {},
    stub: {},
    builtin: {},
  },
}
const lockfileData = fs.existsSync('./flow-typed/flow.lock')
const lockfile /*: Lockfile*/ = lockfileData
  ? fs.readJSONSync('./flow-typed/flow.lock', {
    encoding: 'utf8',
  })
  : defaultLockfile

function setLockfilePackage(
  newType /*: 'flowgen' | 'custom' | 'flowTyped' | 'stub' | 'builtin' */,
  name /*: string */,
  path /*: string */,
) {
  const types = ['flowgen', 'custom', 'flowTyped', 'stub', 'builtin']
  for (const type of types) {
    if (!lockfile.packages[type]) lockfile.packages[type] = {}
    if (type === newType) {
      lockfile.packages[type][name] = path
      continue
    }
    if (lockfile.packages[type]) delete lockfile.packages[type][name]
  }
}

function fileName(input) {
  if (input.startsWith('@types')) {
    const name = input.replace('@types/', '')
    if (name.includes('__')) {
      const split = name.split('__')
      const scope = `@${split[0]}`
      const pkg = split[1]
      return `${scope}/${pkg}`
    }
    return name
  }
  return input
}

async function getTypescriptFile(packageName) {
  if (!lockfile.packages[fileName(packageName)]) {
    setLockfilePackage('custom', fileName(packageName), '')
  }

  const isTypes = packageName.startsWith('@types')

  let typesPackageName
  if (isTypes) {
    typesPackageName = packageName
  } else {
    typesPackageName = packageName.startsWith('@')
      ? `@types/${packageName.replace('@', '').replace('/', '__')}`
      : `@types/${packageName}`
  }

  let typescriptFile
  let hasFlowBuiltin = false
  const json = require(`${packageName}/package.json`)
  try {
    const flowTypingsPath = require.resolve(`${packageName}/index.js.flow`)
    if (flowTypingsPath) {
      hasFlowBuiltin = true
      setLockfilePackage('builtin', fileName(packageName), '')
    }
    //console.log(flowTypingsPath)
  } catch {}
  const typingsPath = json.typings || json.types

  //console.log(process.env.npm_config_user_agent, process.env.PWD)
  console.log(`+ ${packageName}`)

  if (hasFlowBuiltin) return

  try {
    const {stdout} = await execa('flow-typed', [
      'install',
      fileName(packageName),
    ])
    setLockfilePackage('flowTyped', fileName(packageName), '')
    //console.log(stdout)
    return
  } catch (err) {
    if (err.failed) {
      //console.error(err.stdout)
    }
  }

  try {
    const path = require.resolve(
      `${packageName}/${typingsPath || 'index.d.ts'}`,
    )
    const name = fileName(packageName)
    //console.log(packageName, name, path)
    const file = await fs.readFile(path, 'utf8')
    const hasHeader =
      file.includes(`declare module '${name}'`)
      || file.includes(`declare module "${name}"`)
    const template = hasHeader
      ? file
      : `
declare module '${name}' {
  ${file}
};
`
    try {
      const code = flowgen.beautify(
        flowgen.compiler.compileDefinitionString(template),
      )
      await fs.ensureFile(`flow-typed/flowgen/${name}_v${json.version}.js`)
      await fs.writeFile(
        `flow-typed/flowgen/${name}_v${json.version}.js`,
        `/**
 * This is an autogenerated libdef stub for:
 *
 *   '${name}'
 *
 * Fill this stub out by fixing all the errors.
 *
 * Once filled out, we encourage you to share your work with the
 * community by sending a pull request to:
 * https://github.com/flowtype/flow-typed
 */
${code}
`,
      )
      setLockfilePackage(
        'flowgen',
        fileName(packageName),
        `flow-typed/flowgen/${name}_v${json.version}.js`,
      )
    } catch (err) {
      //console.log("Can't convert package", err)
      await execa('flow-typed', ['create-stub', name])
      setLockfilePackage(
        'stub',
        fileName(packageName),
        `flow-typed/npm/${name}_vx.x.x.js`,
      )
    }
    return ''
  } catch (err) {
    //console.error(err)
    //console.log(packageName, 'no index.d.ts')
    if (packageName === typesPackageName) return
  }

  try {
    require(`${typesPackageName}/package.json`)
    return getTypescriptFile(typesPackageName)
  } catch (err) {
    //console.error(err)
    //console.log(typesPackageName, 'no types')
    try {
      await execa('yarn', ['add', `${typesPackageName}`, '-D'])
      return getTypescriptFile(typesPackageName)
    } catch {
      //console.error(`package ${typesPackageName} not found`)
    }
  }
}

const packagePattern = JSON.parse(process.env.npm_config_argv).original[1]

if (!packagePattern) {
  async function main() {
    const deps = {...pkg.dependencies, ...pkg.devDependencies}
    for (const key in deps) {
      await getTypescriptFile(key)
    }
    await fs.writeJSON('./flow-typed/flow.lock', lockfile, {spaces: 2})
    process.exit(0)
  }
  main()
} else {
  const normalizedPattern = normalizePattern(packagePattern)
  getTypescriptFile(normalizedPattern.name).then(console.log)
}
