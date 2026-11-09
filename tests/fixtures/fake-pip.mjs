#!/usr/bin/env node
// Stands in for yt-dlp's pip in tests: records its arguments in
// FAKE_PIP_LOG and, with FAKE_PIP_VERSION_FILE, "upgrades" yt-dlp by writing
// FAKE_PIP_NEW_VERSION there (read back by fake-yt-dlp.mjs's --version).
// Fails when FAKE_PIP_FAIL is set.
import { appendFileSync, writeFileSync } from 'node:fs'

if (process.env.FAKE_PIP_LOG) appendFileSync(process.env.FAKE_PIP_LOG, `${process.argv.slice(2).join(' ')}\n`)
if (process.env.FAKE_PIP_FAIL) {
  console.error('ERROR: Could not install packages')
  process.exit(1)
}
if (process.env.FAKE_PIP_VERSION_FILE && process.env.FAKE_PIP_NEW_VERSION) {
  writeFileSync(process.env.FAKE_PIP_VERSION_FILE, process.env.FAKE_PIP_NEW_VERSION)
}
