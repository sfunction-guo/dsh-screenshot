/**
 * Host half of the screenshot bundle.
 *
 * The region selector is a tiny compiled WinForms program: a browser overlay
 * can only cover the app window, while WeChat-style selection needs a native
 * full-screen window at 1:1. The exe ships beside this file and is rebuilt from
 * select.cs on demand, so an antivirus quarantine never bricks the feature.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))

function cscPath() {
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  for (const arch of ['Framework64', 'Framework']) {
    const candidate = path.join(root, 'Microsoft.NET', arch, 'v4.0.30319', 'csc.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

async function ensureSelector() {
  const exe = path.join(here, 'shot.exe')
  if (fs.existsSync(exe)) return exe
  const csc = cscPath()
  if (!csc) throw new Error('shot.exe is missing and no C# compiler was found')
  await run(csc, [
    '/nologo', '/target:winexe', '/optimize',
    `/out:${exe}`,
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    path.join(here, 'select.cs'),
  ], { windowsHide: true, timeout: 120000 })
  if (!fs.existsSync(exe)) throw new Error('selector rebuild produced no binary')
  return exe
}

/**
 * Run the native selector and return the cropped PNG as a data URL.
 * Resolves null when the user cancels (Esc, or a drag too small to count).
 */
async function selectRegion(probe = false, theme = null) {
  const exe = await ensureSelector()
  const target = path.join(os.tmpdir(), `dsh-shot-${process.pid}-${Date.now()}.png`)
  const args = probe ? [target, '--auto', '400', '300'] : [target]
  if (!probe && theme) args.push('--theme', theme)
  const started = Date.now()
  try {
    await run(exe, args, { windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024 })
    const bytes = fs.readFileSync(target)
    if (!bytes.length) throw new Error('selector wrote an empty image')
    return { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, ms: Date.now() - started }
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined
    // 2 = cancelled, 4 = saved to a file only (pure export): both hand nothing
    // back to the page, so it must not paste anything.
    if (code === 2 || code === 4) return null
    throw error
  } finally {
    fs.rm(target, { force: true }, () => {})
  }
}

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

export function apply(ctx, config = {}) {
  const route = config.route ?? '/shot/capture'

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: route,
      handler: async (req, res) => {
        // A custom header keeps a stray cross-origin <img>/fetch from being a
        // simple request; the value is a marker, not a secret.
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' })
        if (!req.headers['x-dsh-shot']) return send(res, 403, { error: 'missing x-dsh-shot header' })
        try {
          let probe = false
          try {
            probe = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('probe') === '1'
          } catch {
            /* keep the default */
          }
          const result = await selectRegion(probe, config.theme === 'dark' ? 'dark' : null)
          if (!result) {
            res.writeHead(204, { 'Cache-Control': 'no-store' })
            res.end()
            return
          }
          send(res, 200, result)
        } catch (error) {
          ctx.logger?.('screenshot')?.warn?.(error)
          send(res, 500, { error: String((error && error.message) || error) })
        }
      },
    }), 'screenshot: capture route')
  })
}
