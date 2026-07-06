const CACHE = 'aquaflow-v3'

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', e => {
  // Delete ALL old caches on activate
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const url = e.request.url

  // NEVER cache: Supabase API calls, internal API routes, or POST/PUT/DELETE
  if (
    url.includes('supabase.co') ||
    url.includes('/api/') ||
    e.request.method !== 'GET'
  ) return

  // For page navigations, always try network first, no caching
  if (e.request.mode === 'navigate') return

  // Only cache static assets (JS, CSS, images, fonts)
  const isStatic = url.match(/\.(js|css|png|svg|ico|woff2?)(\?|$)/)
  if (!isStatic) return

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          cache.put(e.request, res.clone())
          return res
        })
        return cached || network
      })
    )
  )
})
