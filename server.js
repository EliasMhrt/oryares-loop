/* Oryares LOOP - local static server

   This is required, not optional. YouTube's IFrame API refuses to talk to a
   page whose origin is a file:// URL, so index.html loaded by double-clicking
   will never start playing. Serve the folder over http://localhost instead:

       node server.js

   It opens the page for you and serves nothing but files from this folder. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8000;
const ROOT = __dirname;
const URL_LOCAL = `http://${HOST}:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('Method not allowed');
    }

    const pathname = decodeURIComponent(new URL(req.url, URL_LOCAL).pathname);
    const filePath = path.join(ROOT, pathname === '/' ? '/index.html' : pathname);

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }

    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }

      // Range support so <audio> can stream and seek instead of downloading whole files.
      const range = req.headers.range;
      if (range && /^bytes=/.test(range)) {
        const [rawStart, rawEnd] = range.replace(/^bytes=/, '').split('-');
        let start = rawStart === '' ? NaN : Number(rawStart);
        let end = rawEnd === '' || rawEnd === undefined ? NaN : Number(rawEnd);

        if (Number.isNaN(start) && Number.isNaN(end)) {
          res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
          return res.end();
        }
        if (Number.isNaN(start)) {
          start = Math.max(0, stats.size - end);
          end = stats.size - 1;
        } else if (Number.isNaN(end) || end >= stats.size) {
          end = stats.size - 1;
        }
        if (start > end || start >= stats.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
          return res.end();
        }

        res.writeHead(206, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }

      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`Oryares LOOP running at ${URL_LOCAL}`);
    console.log('Leave this window open while you use the app. Close it to stop.');
    const opener = process.platform === 'win32' ? `start "" "${URL_LOCAL}"` : process.platform === 'darwin' ? `open "${URL_LOCAL}"` : `xdg-open "${URL_LOCAL}"`;
    exec(opener, () => {});
  });
