'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

/**
 * Bridge to the Python ingest CLI (`packages/ig-ingest`, the `decent-ig-ingest`
 * command). The CLI does all Instagram/Instaloader I/O and emits the contract JSON
 * (see src/mirror/INGEST_CONTRACT.md) on stdout. We shell out and parse.
 *
 * The user's IG credentials live in the CLI's environment (IG_USERNAME etc.) — the
 * Decent backend passes through process.env, so the operator configures them where
 * the daemon runs. We never see or store them here.
 */

const IG_INGEST_DIR = path.join(__dirname, '..', '..', '..', 'ig-ingest')

/** Resolve the CLI entrypoint: prefer the package venv, fall back to PATH. */
function resolveBin() {
  const venvBin = path.join(IG_INGEST_DIR, '.venv', 'bin', 'decent-ig-ingest')
  if (fs.existsSync(venvBin)) return { cmd: venvBin, args: [] }
  return { cmd: 'decent-ig-ingest', args: [] } // assume on PATH
}

/**
 * Run an ingest subcommand and return its parsed JSON.
 * @param {string[]} argv - e.g. ['fetch', 'chef_jane', '--limit', '12']
 * @returns {Promise<object>} parsed contract JSON
 * @throws {Error & {kind?: string}} on non-zero exit, with `kind` from the CLI's error
 */
function runIngest(argv) {
  const { cmd, args } = resolveBin()
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args, ...argv], {
      cwd: IG_INGEST_DIR,
      env: process.env,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      let parsed
      try {
        parsed = JSON.parse(out)
      } catch {
        return reject(new Error(`ingest emitted non-JSON (exit ${code}): ${err || out}`.slice(0, 500)))
      }
      if (code !== 0 || parsed.error) {
        const e = new Error(parsed.error || `ingest failed (exit ${code})`)
        e.kind = parsed.kind || 'other'
        return reject(e)
      }
      resolve(parsed)
    })
  })
}

/** Fetch a handle's recent posts (contract `fetch`). */
function fetchProfile(handle, { limit, since } = {}) {
  const argv = ['fetch', handle]
  if (limit != null) argv.push('--limit', String(limit))
  if (since) argv.push('--since', since)
  return runIngest(argv)
}

/** Cheap freshness probe (contract `freshness`). */
function fetchFreshness(handle) {
  return runIngest(['freshness', handle])
}

module.exports = { fetchProfile, fetchFreshness, IG_INGEST_DIR }
