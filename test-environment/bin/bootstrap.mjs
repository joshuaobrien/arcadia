import { rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const jellyfin = 'http://127.0.0.1:8096'
const clientAuthorization = 'MediaBrowser Client="NeedleTests", Device="Orb", DeviceId="needle-test", Version="1.0"'

async function waitFor(url, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`${label} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`${label} did not become ready: ${lastError}`)
}

async function json(url, init = {}) {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} returned ${response.status}: ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

async function bootstrapJellyfin() {
  await waitFor(`${jellyfin}/System/Info/Public`, 'Jellyfin')
  const publicInfo = await json(`${jellyfin}/System/Info/Public`)
  if (!publicInfo.StartupWizardCompleted) {
    const headers = { 'Content-Type': 'application/json' }
    await json(`${jellyfin}/Startup/Configuration`, { method: 'POST', headers, body: JSON.stringify({
      ServerName: 'needle-test', UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en',
    }) })
    await json(`${jellyfin}/Startup/User`)
    await json(`${jellyfin}/Startup/User`, { method: 'POST', headers, body: JSON.stringify({ Name: 'needle', Password: 'needle-test-password' }) })
    await json(`${jellyfin}/Startup/RemoteAccess`, { method: 'POST', headers, body: JSON.stringify({ EnableRemoteAccess: false }) })
    await json(`${jellyfin}/Startup/Complete`, { method: 'POST' })
  }

  const authentication = await json(`${jellyfin}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: clientAuthorization },
    body: JSON.stringify({ Username: 'needle', Pw: 'needle-test-password' }),
  })
  const token = authentication.AccessToken
  if (!token) throw new Error('Jellyfin authentication returned no access token')
  const authorization = `${clientAuthorization}, Token="${token}"`

  const folders = await json(`${jellyfin}/Library/VirtualFolders`, { headers: { Authorization: authorization } })
  if (!folders.some(folder => folder.Name === 'Music')) {
    await json(`${jellyfin}/Library/VirtualFolders?name=Music&collectionType=music&refreshLibrary=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ LibraryOptions: { PathInfos: [{ Path: '/music' }] } }),
    })
  }

  const appName = 'Needle test environment'
  let keys = await json(`${jellyfin}/Auth/Keys`, { headers: { Authorization: authorization } })
  let matches = keys.Items.filter(key => key.AppName === appName)
  if (matches.length === 0) {
    await json(`${jellyfin}/Auth/Keys?app=${encodeURIComponent(appName)}`, {
      method: 'POST', headers: { Authorization: authorization },
    })
    keys = await json(`${jellyfin}/Auth/Keys`, { headers: { Authorization: authorization } })
    matches = keys.Items.filter(key => key.AppName === appName)
  }
  if (matches.length !== 1 || !matches[0].AccessToken) {
    throw new Error(`Expected exactly one Jellyfin API key named ${JSON.stringify(appName)}; found ${matches.length}`)
  }

  const runtimePath = resolve(root, 'runtime.env')
  const temporaryPath = `${runtimePath}.tmp`
  await writeFile(temporaryPath, `JELLYFIN_API_KEY=${matches[0].AccessToken}\n`, { mode: 0o600 })
  await rename(temporaryPath, runtimePath)
}

await bootstrapJellyfin()
console.log('Jellyfin is configured')
