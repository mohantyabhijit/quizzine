addEventListener('fetch', event => event.respondWith((async () => {
  const request = event.request;
  const url = new URL(request.url);
  let key = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';
  if (key === 'upload' || key === 'viewer') key += '.html';
  if (url.pathname.endsWith('.html') && (key === 'upload.html' || key === 'viewer.html')) return Response.redirect(`${url.origin}/${key.replace('.html', '')}${url.search}`, 301);

  // These small application assets remain origin-backed so releases do not wait
  // for a separate R2 asset sync. Large quiz files still come directly from R2.
  if (['index.html', 'upload.html', 'viewer.html', 'app.js', 'quizzes.js', 'viewer.js', 'upload.js', 'styles.css'].includes(key)) {
    return fetch(new Request(`https://origin.quizzine.org/${key}${url.search}`, request));
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
