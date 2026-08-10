import { rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const jellyfin = 'http://127.0.0.1:8096'
const lidarr = 'http://127.0.0.1:8686'
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

async function bootstrapLidarr() {
  const apiKey = 'needle-test-lidarr-api-key'
  const headers = { 'Content-Type': 'application/json', 'X-Api-Key': apiKey }
  await waitFor(`${lidarr}/ping`, 'Lidarr')
  const [downloadClientSchemas, indexerSchemas] = await Promise.all([
    json(`${lidarr}/api/v1/downloadclient/schema`, { headers }),
    json(`${lidarr}/api/v1/indexer/schema`, { headers }),
  ])
  const downloadClientSchema = downloadClientSchemas.find(item => item.implementation === 'Slskd')
  const indexerSchema = indexerSchemas.find(item => item.implementation === 'Slskd')
  if (!downloadClientSchema || !indexerSchema) throw new Error('The pinned Lidarr slskd plugin did not load')

  const withFieldValues = (fields, values) => fields.map(field => (
    Object.hasOwn(values, field.name) ? { ...field, value: values[field.name] } : field
  ))
  const downloadClients = await json(`${lidarr}/api/v1/downloadclient`, { headers })
  const managedDownloadClients = downloadClients.filter(item => item.implementation === 'Slskd')
  if (managedDownloadClients.length > 1) throw new Error('Expected at most one Lidarr slskd download client')
  const downloadClient = {
    ...downloadClientSchema,
    ...(managedDownloadClients[0]?.id ? { id: managedDownloadClients[0].id } : {}),
    name: 'slskd', enable: true, priority: 1,
    removeCompletedDownloads: false, removeFailedDownloads: true,
    fields: withFieldValues(downloadClientSchema.fields, {
      host: 'slskd', port: 5030, apiKey: 'needle-test-slskd-api-key', repairConfiguration: false,
    }),
  }
  await json(`${lidarr}/api/v1/downloadclient${downloadClient.id ? `/${downloadClient.id}` : ''}`, {
    method: downloadClient.id ? 'PUT' : 'POST', headers, body: JSON.stringify(downloadClient),
  })

  const downloadClientConfig = await json(`${lidarr}/api/v1/config/downloadclient`, { headers })
  if (downloadClientConfig.enableCompletedDownloadHandling) {
    await json(`${lidarr}/api/v1/config/downloadclient/${downloadClientConfig.id}`, {
      method: 'PUT', headers, body: JSON.stringify({
        ...downloadClientConfig, enableCompletedDownloadHandling: false,
      }),
    })
  }

  const indexers = await json(`${lidarr}/api/v1/indexer`, { headers })
  const managedIndexers = indexers.filter(item => item.implementation === 'Slskd')
  if (managedIndexers.length > 1) throw new Error('Expected at most one Lidarr slskd indexer')
  const indexer = {
    ...indexerSchema,
    ...(managedIndexers[0]?.id ? { id: managedIndexers[0].id } : {}),
    name: 'slskd', enableRss: false, enableAutomaticSearch: true, enableInteractiveSearch: true, priority: 1,
    fields: withFieldValues(indexerSchema.fields, {
      baseUrl: 'http://slskd:5030/', apiKey: 'needle-test-slskd-api-key',
    }),
  }
  await json(`${lidarr}/api/v1/indexer${indexer.id ? `/${indexer.id}` : ''}`, {
    method: indexer.id ? 'PUT' : 'POST', headers, body: JSON.stringify(indexer),
  })

  const delayProfiles = await json(`${lidarr}/api/v1/delayprofile`, { headers })
  for (const profile of delayProfiles) {
    const slskdItem = profile.items.find(item => item.protocol === 'SlskdDownloadProtocol')
    if (slskdItem && !slskdItem.allowed) {
      await json(`${lidarr}/api/v1/delayprofile/${profile.id}`, { method: 'PUT', headers, body: JSON.stringify({
        ...profile, items: profile.items.map(item => (
          item.protocol === 'SlskdDownloadProtocol' ? { ...item, allowed: true } : item
        )),
      }) })
    }
  }

  const roots = await json(`${lidarr}/api/v1/rootfolder`, { headers })
  if (!roots.some(root => root.path === '/data/staging')) {
    const [qualityProfiles, metadataProfiles] = await Promise.all([
      json(`${lidarr}/api/v1/qualityprofile`, { headers }),
      json(`${lidarr}/api/v1/metadataprofile`, { headers }),
    ])
    if (!qualityProfiles[0]?.id || !metadataProfiles[0]?.id) throw new Error('Lidarr did not create its default profiles')
    await json(`${lidarr}/api/v1/rootfolder`, { method: 'POST', headers, body: JSON.stringify({
      path: '/data/staging', name: 'Orb staging',
      defaultQualityProfileId: qualityProfiles[0].id,
      defaultMetadataProfileId: metadataProfiles[0].id,
    }) })
  }
}

await Promise.all([bootstrapJellyfin(), bootstrapLidarr()])
console.log('Jellyfin and Lidarr are configured')
