// Builds the site into _site/:
//   1. copies site/ (the app itself), Leaflet and its clustering plugin
//   2. reads content/ (edited through Pages CMS) and writes data.json
//   3. creates small versions of every image in media/
//   4. fills in the version and file list in the service worker (sw.js)
//
// Usage:  node build.mjs           build
//         node build.mjs --serve   build and start a local server
//
// Environment variables (all optional, used by the deploy workflow):
//   PREVIEW=1     build the preview (staging) variant: banner, no service worker, noindex
//   UNPUBLISHED_CHANGES   true/false: whether the preview differs from the live map (for the banner)
//   IMAGE_CACHE   folder for resized images, kept between builds
//   COMMIT        git commit being built, written to version.json

import { readFile, writeFile, readdir, mkdir, cp, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import sharp from 'sharp';

// All paths below are relative to this file's folder, wherever the script is started from.
process.chdir(import.meta.dirname);

const OUT = '_site';
const PREVIEW = !!process.env.PREVIEW;
const IMAGE_CACHE = process.env.IMAGE_CACHE || '.cache/img';
const WIDTHS = [160, 480, 1000, 2000]; // image widths in pixels
const MARKER_WIDTHS = [160];           // an uploaded marker image is only ever shown small

const hash = (buf) => createHash('sha1').update(buf).digest('hex');
// å → a, é → e and so on: split letters from their accents (NFD), then drop the accents.
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const warn = (text) => console.warn('  WARNING: ' + text);
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Only lets simple formatting from the CMS rich-text editor through.
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote']);
function sanitize(html) {
  html = String(html || '').trim();
  if (!html.includes('<')) {
    return html.split(/\n\s*\n/).filter(Boolean).map((s) => `<p>${escapeHtml(s).replace(/\n/g, '<br>')}</p>`).join('');
  }
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (_, close, tag, attrs) => {
      tag = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (tag === 'a' && !close) {
        const href = /href\s*=\s*"((?:https?:\/\/|mailto:)[^"]*)"/i.exec(attrs);
        return href ? `<a href="${href[1]}" target="_blank" rel="noopener">` : '<a>';
      }
      return `<${close}${tag}>`;
    });
}

// Creates webp versions of one image and returns what the app needs to know about it.
async function buildImage(src, caption, targetWidths = WIDTHS) {
  const file = path.normalize(decodeURI(String(src)).replace(/^\/+/, ''));
  if (!file.startsWith('media' + path.sep) || !existsSync(file)) {
    warn(`image "${src}" not found in media/ – skipping it`);
    return null;
  }
  const buf = await readFile(file);
  const meta = await sharp(buf).metadata();
  // Phone photos taken in portrait are stored sideways, with a note (EXIF orientation
  // 5–8) saying they should be turned. The real width and height are then swapped.
  const sideways = (meta.orientation || 1) >= 5;
  const w = sideways ? meta.height : meta.width;
  const h = sideways ? meta.width : meta.height;
  const base = `img/${slug(path.parse(file).name) || 'image'}-${hash(buf).slice(0, 10)}`;
  // Never larger than the original: a 1200 px wide image gets 160, 480, 1000 and 1200.
  const widths = [...new Set(targetWidths.map((width) => Math.min(width, w)))];

  for (const width of widths) {
    const name = `${path.basename(base)}-${width}.webp`;
    const cached = path.join(IMAGE_CACHE, name);
    if (!existsSync(cached)) {
      // rotate() without arguments turns the image the way its EXIF orientation says.
      await sharp(buf).rotate().resize({ width }).webp({ quality: 78 }).toFile(cached);
    }
    await copyFile(cached, path.join(OUT, 'img', name));
  }
  return { base, widths, w, h, caption: String(caption || '').trim() };
}

async function buildPlace(filename) {
  const p = JSON.parse(await readFile(path.join('content/places', filename), 'utf8'));
  if (p.published === false) return null;
  const name = String(p.name || '').trim();
  const coords = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(p.coordinates || '');
  if (!name || !coords) {
    warn(`${filename} has no name or invalid coordinates – not shown on the map`);
    return null;
  }
  const images = [];
  for (const item of p.images || []) {
    if (!item?.image) continue;
    const image = await buildImage(item.image, item.caption);
    if (image) images.push(image);
  }
  return {
    id: slug(path.parse(filename).name),
    name,
    priority: Number(p.priority) || 0,
    color: p.color || '',
    icon: p.marker_icon || '',
    markerImage: p.marker_image ? await buildImage(p.marker_image, '', MARKER_WIDTHS) : null,
    year: String(p.year || '').trim(),
    lat: Number(coords[1]),
    lng: Number(coords[2]),
    summary: String(p.summary || '').trim(),
    html: sanitize(p.description),
    images,
  };
}

async function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(p, base));
    else files.push(path.relative(base, p).replaceAll('\\', '/'));
  }
  return files;
}

async function build() {
  await rm(OUT, { recursive: true, force: true });
  await cp('site', OUT, { recursive: true });
  await mkdir(path.join(OUT, 'img'), { recursive: true });
  await mkdir(IMAGE_CACHE, { recursive: true });
  await copyFile('node_modules/leaflet/dist/leaflet.js', path.join(OUT, 'leaflet.js'));
  await copyFile('node_modules/leaflet/dist/leaflet.css', path.join(OUT, 'leaflet.css'));
  await copyFile('node_modules/leaflet.markercluster/dist/leaflet.markercluster.js', path.join(OUT, 'markercluster.js'));
  await copyFile('node_modules/leaflet.markercluster/dist/MarkerCluster.css', path.join(OUT, 'markercluster.css'));

  // App icons in the sizes Android and iOS ask for.
  for (const px of [180, 192, 512]) {
    await sharp('site/icon.svg', { density: 300 }).resize(px, px).png().toFile(path.join(OUT, `icon-${px}.png`));
  }

  const settings = JSON.parse(await readFile('content/settings.json', 'utf8'));
  const places = [];
  for (const f of (await readdir('content/places')).filter((f) => f.endsWith('.json')).sort()) {
    // A broken file must never take the whole site down – skip it and carry on.
    try {
      const place = await buildPlace(f);
      if (place) places.push(place);
    } catch (e) {
      warn(`${f} could not be read (${e.message}) – skipping it`);
    }
  }
  places.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  const title = String(settings.title || 'Karta').trim();
  const shortTitle = String(settings.short_title || title).trim();
  const description = String(settings.description || '').trim();

  const data = {
    title,
    about: sanitize(settings.about),
    preview: PREVIEW,
    // true or false when the deploy workflow says so, null when built locally.
    unpublishedChanges: { true: true, false: false }[process.env.UNPUBLISHED_CHANGES] ?? null,
    places,
  };
  await writeFile(path.join(OUT, 'data.json'), JSON.stringify(data));

  // The app's name is set in the CMS. Write it into the page itself (for search engines,
  // link previews and the moment before app.js has run) and into the web app manifest
  // (the name shown when the map is added to a phone's home screen).
  const indexFile = path.join(OUT, 'index.html');
  let index = (await readFile(indexFile, 'utf8'))
    .replaceAll('%TITLE%', escapeHtml(title))
    .replaceAll('%DESCRIPTION%', escapeHtml(description));
  if (PREVIEW) index = index.replace('</head>', '  <meta name="robots" content="noindex">\n</head>');
  await writeFile(indexFile, index);

  const manifestFile = path.join(OUT, 'manifest.webmanifest');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  await writeFile(manifestFile, JSON.stringify({ name: title, short_name: shortTitle, description, ...manifest }, null, 2));

  // The "shell" is everything except the images. The service worker stores all of it,
  // and the version changes as soon as any of the files (or the content) changes.
  const shell = (await listFiles(OUT)).filter((f) => !f.startsWith('img/') && f !== 'sw.js').sort();
  const version = createHash('sha1');
  for (const f of shell) version.update(f).update(await readFile(path.join(OUT, f)));
  const sw = (await readFile('site/sw.js', 'utf8'))
    .replace('__VERSION__', version.digest('hex').slice(0, 12))
    .replace('__SHELL__', JSON.stringify(shell.map((f) => (f === 'index.html' ? './' : f))));
  await writeFile(path.join(OUT, 'sw.js'), sw);

  // Lets the deploy workflow find out which commit is currently live.
  await writeFile(path.join(OUT, 'version.json'), JSON.stringify({ commit: process.env.COMMIT || null }));

  console.log(`Built ${places.length} places, ${places.reduce((n, p) => n + p.images.length, 0)} images → ${OUT}/${PREVIEW ? ' (preview)' : ''}`);
}

function serve(port) {
  const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  };
  createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(OUT, path.normalize(p));
    try {
      if (!file.startsWith(OUT)) throw new Error('outside');
      const buf = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }).listen(port, () => console.log(`http://localhost:${port}`));
}

await build();
if (process.argv.includes('--serve')) serve(Number(process.env.PORT) || 8080);
