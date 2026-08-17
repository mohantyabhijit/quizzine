addEventListener('fetch', event => event.respondWith((async () => {
  const request = event.request;
  const url = new URL(request.url);
  let key = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';

  // This route is called only by the Go API. It keeps R2 credentials in the
  // Worker binding while making the API responsible for validation and data.
  if (url.pathname.startsWith('/_quizzine-storage/')) {
    const objectKey = decodeURIComponent(url.pathname.slice('/_quizzine-storage/'.length));
    if (!['data/quizzes.json'].includes(objectKey) && !/^(uploads\/[a-z0-9][a-z0-9-]*\.(ppt|pptx)|previews\/[a-z0-9][a-z0-9-]*\.pdf)$/i.test(objectKey)) return new Response('Not found', { status: 404 });
    const supplied = request.headers.get('X-Quizzine-Storage-Key') || '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied));
    const suppliedHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    // The corresponding secret is held only in the GitHub Actions secret store.
    if (suppliedHash !== 'a034cad312d3979d2322a8243569fd0773a80d5302e35e02a7c0cbc75c321f83') return new Response('Not found', { status: 404 });
    if (request.method === 'GET') {
      const object = await QUIZZINE_ASSETS.get(objectKey);
      if (!object) return new Response('Not found', { status: 404 });
      const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('etag', object.httpEtag);
      return new Response(object.body, { headers });
    }
    if (request.method === 'PUT') {
      await QUIZZINE_ASSETS.put(objectKey, request.body, { httpMetadata: { contentType: request.headers.get('X-R2-Content-Type') || undefined, cacheControl: request.headers.get('X-R2-Cache-Control') || undefined } });
      return new Response(null, { status: 204 });
    }
    return new Response('Method not allowed', { status: 405 });
  }
  if (key === 'upload' || key === 'viewer') key += '.html';
  if (url.pathname.endsWith('.html') && (key === 'upload.html' || key === 'viewer.html')) return Response.redirect(`${url.origin}/${key.replace('.html', '')}${url.search}`, 301);

  if (url.pathname.startsWith('/api/')) {
    return fetch(new Request(`https://origin.quizzine.org${url.pathname}${url.search}`, request));
  }

  if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/previews/')) {
    const object = await QUIZZINE_ASSETS.get(key);
    if (object) {
      const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('etag', object.httpEtag); headers.set('accept-ranges', 'bytes');
      return new Response(object.body, { headers });
    }
    // Keeps the existing Tech Away deck reachable during the one-time cutover.
    return fetch(new Request(`https://origin.quizzine.org/public${url.pathname}${url.search}`, request));
  }

  // These small application assets remain origin-backed so releases do not wait
  // for a separate R2 asset sync. Large quiz files still come directly from R2.
  if (['index.html', 'upload.html', 'viewer.html', 'app.js', 'quizzes.js', 'viewer.js', 'upload.js', 'styles.css'].includes(key)) {
    const originPath = url.pathname.endsWith('.html') ? `/${key}` : url.pathname;
    return fetch(new Request(`https://origin.quizzine.org${originPath}${url.search}`, request));
  }

  const range = request.headers.get('range');
  let object, status = 200, contentRange;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const head = await QUIZZINE_ASSETS.head(key);
    if (!head) return new Response('Not found', { status: 404 });
    if (!match) return new Response('Invalid range', { status: 416, headers: { 'Content-Range': `bytes */${head.size}` } });
    const start = match[1] ? Number(match[1]) : Math.max(0, head.size - Number(match[2]));
    const end = match[2] ? Math.min(Number(match[2]), head.size - 1) : head.size - 1;
    if (start >= head.size || end < start) return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${head.size}` } });
    object = await QUIZZINE_ASSETS.get(key, { range: { offset: start, length: end - start + 1 } });
    status = 206; contentRange = `bytes ${start}-${end}/${head.size}`;
  } else object = await QUIZZINE_ASSETS.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  if (contentRange) { headers.set('content-range', contentRange); headers.set('content-length', String(object.range.length)); }
  headers.set('cache-control', /\.html$/.test(key) ? 'public, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable');
  return new Response(object.body, { status, headers });
})()));
