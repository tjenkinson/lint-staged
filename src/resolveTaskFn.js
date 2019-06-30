'use strict'

const chalk = require('chalk')
const dedent = require('dedent')
const execa = require('execa')
const symbols = require('log-symbols')
const stringArgv = require('string-argv')

const debug = require('debug')('lint-staged:task')

/**
 * Execute the given linter cmd using execa and
 * return the promise.
 *
 * @param {string} cmd
 * @return {Promise} child_process
 */
const execLinter = (cmd, args, execaOptions = {}) => {
  debug('cmd:', cmd)
  debug('args:', args)
  debug('execaOptions:', execaOptions)
  return execa(cmd, args, execaOptions)
}

const successMsg = linter => `${symbols.success} ${linter} passed!`

/**
 * Create and returns an error instance with a given message.
 * If we set the message on the error instance, it gets logged multiple times(see #142).
 * So we set the actual error message in a private field and extract it later,
 * log only once.
 *
 * @param {string} message
 * @returns {Error}
 */
function throwError(message) {
  const err = new Error()
  err.privateMsg = `\n\n\n${message}`
  return err
}

/**
 * Create a failure message dependding on process result.
 *
 * @param {string} linter
 * @param {Object} result
 * @param {string} result.stdout
 * @param {string} result.stderr
 * @param {boolean} result.failed
 * @param {boolean} result.killed
 * @param {string} result.signal
 * @param {Object} context (see https://github.com/SamVerschueren/listr#context)
 * @returns {Error}
 */
function makeErr(linter, result, context = {}) {
  // Indicate that some linter will fail so we don't update the index with formatting changes
  context.hasErrors = true // eslint-disable-line no-param-reassign
  const { stdout, stderr, killed, signal } = result
  if (killed || (signal && signal !== '')) {
    return throwError(
      `${symbols.warning} ${chalk.yellow(`${linter} was terminated with ${signal}`)}`
    )
  }
  return throwError(dedent`${symbols.error} ${chalk.redBright(
    `${linter} found some errors. Please fix them and try committing again.`
  )}
  ${stdout}
  ${stderr}
  `)
}

/**
 * Returns the task function for the linter. It handles chunking for file paths
 * if the OS is Windows.
 *
 * @param {Object} options
 * @param {string} options.linter
 * @param {Boolean} options.shellMode
 * @param {string} options.gitDir
 * @param {Array<string>} options.pathsToLint
 * @returns {function(): Promise<Array<string>>}
 */
module.exports = function resolveTaskFn({ gitDir, linter, pathsToLint, shell = false }) {
  // If `linter` is a function, it should return a string when evaluated with `pathsToLint`.
  // Else, it's a already a string
  const fnLinter = typeof linter === 'function'
  const linterString = fnLinter ? linter(pathsToLint) : linter
  // Support arrays of strings/functions by treating everything as arrays
  const linters = Array.isArray(linterString) ? linterString : [linterString]

  const tasks = linters.map(command => {
    const [cmd, ...args] = stringArgv.parseArgsStringToArgv(command)
    // If `linter` is a function, args already include `pathsToLint`.
    const argsWithPaths = fnLinter ? args : args.concat(pathsToLint)

    // Only use gitDir as CWD if we are using the git binary
    // e.g `npm` should run tasks in the actual CWD
    const execaOptions = { preferLocal: true, reject: false, shell }
    if (/^git(\.exe)?/i.test(command) && gitDir !== process.cwd()) {
      execaOptions.cwd = gitDir
    }

    return ctx =>
      execLinter(cmd, argsWithPaths, execaOptions).then(result => {
        if (result.failed || result.killed || result.signal != null) {
          throw makeErr(linter, result, ctx)
        }

        return successMsg(linter)
      })
  })

  return ctx => Promise.all(tasks.map(task => task(ctx)))
}
