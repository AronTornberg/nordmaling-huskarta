// The heritage map – all logic in one file, no frameworks.
// The map is drawn with Leaflet (global variable L) and its Leaflet.markercluster
// plugin, which groups markers that are close together. The content comes from data.json,
// which build.mjs generates from what editors enter in Pages CMS.
// Code is in English; everything the user sees is in Swedish.

// Marker colours and icons an editor can pick. The names are the ones listed in
// .pages.yml (Swedish, since editors see them).
const COLORS = {
  'Blå': '#14447a',
  'Grön': '#2f6b4f',
  'Brun': '#8a4b12',
  'Röd': '#8c2f22',
  'Lila': '#6b4c7a',
  'Grå': '#3f4a52',
};
const DEFAULT_COLOR = COLORS['Blå'];
const colorOf = (place) => COLORS[place.color] || DEFAULT_COLOR;

// 24×24 SVG paths, drawn in white on the marker.
const ICONS = {
  'Hus': 'M12 3.5 2.5 11.5h3V20h4.75v-5.5h3.5V20h4.75v-8.5h3z',
  'Kyrka': 'M11 2h2v2h2v2h-2v2.3l5 3.9V20h-4v-4a2 2 0 0 0-4 0v4H6v-7.8l5-3.9V6H9V4h2z',
  'Fabrik': 'M3 20v-9l5 3v-3l5 3V4.5h3.5l.8 9.5H21v6z',
  'Skola': 'M3 5.5h6.5a2.5 2.5 0 0 1 2.5 2 2.5 2.5 0 0 1 2.5-2H21V18h-6.5a2.5 2.5 0 0 0-2.5 2 2.5 2.5 0 0 0-2.5-2H3z',
  'Butik': 'M4.5 4h15L21 9a3 3 0 0 1-2 2.8V20H5v-8.2A3 3 0 0 1 3 9zM8 13.5V17h8v-3.5z',
  'Lada': 'M12 3 7 5 3.5 10v10h5v-6h7v6h5V10L17 5z',
  'Minnessten': 'M8.5 21 7 9.5a5 5 0 0 1 10 0L15.5 21z',
  'Bro': 'M2 7h20v3.5h-2V18h-3v-2.5a5 5 0 0 0-10 0V18H4v-7.5H2z',
  'Båt': 'M11 2.5V13H4.5zM13 5.5l5.5 7.5H13zM2.5 15h19l-3 5.5h-13z',
  'Stjärna': 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L2.5 9.4l6.6-.9z',
};
// Shown inside the marker when a place has neither picture nor icon.
const DOT_ICON = 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z';

// The part after # in the address decides what the panel shows:
// nothing, one of the names below, or the id of a place.
const ROUTE_LIST = 'lista';
const ROUTE_ABOUT = 'om';
const ROUTE_CLUSTER = 'grupp'; // the places in the cluster that was last tapped
const currentRoute = () => decodeURIComponent(location.hash.slice(1));

const panel = document.getElementById('panel');
const content = document.getElementById('content');
const fullscreen = document.getElementById('fullscreen');
const searchInput = document.getElementById('search');
const wideScreen = matchMedia('(min-width: 45rem)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Helpers ----------

// Creates an element: h('a', { href: '#' }, 'text', otherElement).
// Attributes are set as they are, with three exceptions:
//   html: '...'       sets the element's HTML
//   onclick: fn       (anything starting with "on") adds an event listener
//   null or false     leaves the attribute out
// Children that are false, null, undefined or '' are skipped, so a child can be
// written as `condition && h(...)`.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value != null && value !== false) el.setAttribute(key, value);
  }
  el.append(...children.flat().filter(Boolean));
  return el;
}

// Replaces what the panel shows. Skips empty children the same way h() does.
function setContent(...children) {
  content.replaceChildren(...children.filter(Boolean));
}

// Shows a short message at the bottom. With a button it stays until pressed,
// otherwise it disappears after a few seconds.
let toastTimer;
function toast(text, buttonText, onClick) {
  const el = document.getElementById('toast');
  el.replaceChildren(text);
  if (buttonText) el.append(h('button', { type: 'button', onclick: onClick }, buttonText));
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!buttonText) toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

const imageUrl = (image, width) => `${image.base}-${width}.webp`;
const smallestImageUrl = (image) => imageUrl(image, image.widths[0]);
const largestImageUrl = (image) => imageUrl(image, image.widths.at(-1));

// ---------- Load the content ----------

let data;
try {
  const res = await fetch('data.json');
  if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
  data = await res.json();
} catch (error) {
  toast('Kartan kunde inte laddas. Kontrollera uppkopplingen.', 'Försök igen', () => location.reload());
  throw error; // nothing below can run without the content
}

document.title = data.title;
document.getElementById('title').textContent = data.title;
if (data.preview) {
  // Tells editors where they are, and whether there is anything left to publish.
  const banner = document.getElementById('preview-banner');
  if (data.unpublishedChanges === true) banner.textContent = 'Förhandsvisning · har opublicerade ändringar';
  if (data.unpublishedChanges === false) banner.textContent = 'Förhandsvisning · allt är publicerat';
  banner.hidden = false;
  document.body.classList.add('preview');
}

// ---------- Map ----------

// Keeps the map around Nordmaling municipality (with a generous margin), so nobody
// gets lost in the world map. Stretched if a place should lie outside it.
const mapBounds = L.latLngBounds([63.25, 18.5], [64.1, 20.3]);
for (const place of data.places) mapBounds.extend([place.lat, place.lng]);

const map = L.map('map', {
  maxBounds: mapBounds,
  maxBoundsViscosity: 0.9,
  minZoom: 9,
  zoomControl: false,
  zoomAnimation: !reducedMotion,
  fadeAnimation: !reducedMotion,
  markerZoomAnimation: !reducedMotion,
});
map.attributionControl.setPrefix(false); // the OpenStreetMap credit is required, the "Leaflet" prefix is not
L.control.zoom({ position: 'topright', zoomInTitle: 'Zooma in', zoomOutTitle: 'Zooma ut' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  crossOrigin: true, // needed for the service worker to store tiles efficiently
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Start with all places in view.
if (data.places.length > 0) {
  const placesBounds = L.latLngBounds(data.places.map((place) => [place.lat, place.lng]));
  map.fitBounds(placesBounds.pad(0.3), { maxZoom: 15 });
} else {
  map.setView(mapBounds.getCenter(), 11);
}

// The part of the map behind the open panel cannot be seen, so it should not count
// when keeping the map inside mapBounds. Otherwise a place near the southern edge could
// never be moved up above the sheet (or, on wide screens, one near the western edge out
// from behind the card). This widens the allowed area by exactly what the panel covers.
function updateMapLimits() {
  let coveredLeft = 0;
  let coveredBottom = 0;
  if (panelOpen && wideScreen.matches) coveredLeft = panel.getBoundingClientRect().right;
  if (panelOpen && !wideScreen.matches) coveredBottom = sheetVisibleHeight();

  // Pixels only mean something at a given zoom, so this is redone after every zoom.
  const zoom = map.getZoom();
  const southWest = map.project(mapBounds.getSouthWest(), zoom).add([-coveredLeft, coveredBottom]);
  map.setMaxBounds(L.latLngBounds(map.unproject(southWest, zoom), mapBounds.getNorthEast()));
}
map.on('zoomend', updateMapLimits);

// What is drawn inside a place's marker, in order of preference:
// an uploaded marker image, a chosen icon, the place's first photo, or a plain dot.
function markerInside(place) {
  const photo = (image) => `<img src="${smallestImageUrl(image)}" alt="">`;
  const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" fill-rule="evenodd" d="${path}"/></svg>`;
  if (place.markerImage) return photo(place.markerImage);
  if (ICONS[place.icon]) return icon(ICONS[place.icon]);
  if (place.images.length > 0) return photo(place.images[0]);
  return icon(DOT_ICON);
}

// Every marker is a round badge in the place's colour with a small tip below.
function markerIcon(place) {
  return L.divIcon({
    className: 'pin',
    iconSize: [48, 57],
    iconAnchor: [24, 57], // the tip
    html: `<span class="badge" style="--color:${colorOf(place)}">${markerInside(place)}</span>`,
  });
}

// The place that represents a cluster: the one with the highest priority (set by the
// editor, 0 if left empty). Between equals, one with a picture wins, then the name decides.
// Leaflet draws markers further down the screen on top of those above them. Adding
// this offset makes priority count first: a higher priority is always drawn on top.
const drawOrderOffset = (place) => place.priority * 10000;

function mostProminent(places) {
  const hasPicture = (place) => Boolean(place.markerImage || place.images.length > 0);
  return [...places].sort((a, b) =>
    b.priority - a.priority
    || hasPicture(b) - hasPicture(a)
    || a.name.localeCompare(b.name, 'sv'))[0];
}

// Markers that would overlap are merged into one cluster marker. It looks like the
// marker of its most prominent place, without the tip and with the number of places
// in the corner. Tapping a cluster lists its places in the panel.
function clusterIcon(cluster) {
  const places = cluster.getAllChildMarkers().map((marker) => marker.options.place);
  const front = mostProminent(places);
  cluster.options.zIndexOffset = drawOrderOffset(front); // a cluster is as important as its front place
  const count = `<span class="count">${places.length}<span class="visually-hidden"> platser</span></span>`;
  return L.divIcon({
    className: 'pin cluster',
    iconSize: [48, 48],
    html: `<span class="badge" style="--color:${colorOf(front)}">${markerInside(front)}${count}</span>`,
  });
}

const clusters = L.markerClusterGroup({
  maxClusterRadius: 50, // px; roughly one marker width, so only real overlaps are merged
  zoomToBoundsOnClick: false,
  showCoverageOnHover: false,
  animate: !reducedMotion,
  iconCreateFunction: clusterIcon,
}).addTo(map);

const markers = new Map(); // place id → marker
for (const place of data.places) {
  // "place" is our own option, used to get from a marker back to its place.
  const marker = L.marker([place.lat, place.lng], {
    icon: markerIcon(place),
    title: place.name,
    zIndexOffset: drawOrderOffset(place),
    place,
  });
  marker.on('click', () => { location.hash = place.id; });
  // A marker only has an element while it is drawn – not while it is inside a cluster
  // or off screen – and gets a new one each time. So set the element up on every 'add'.
  marker.on('add', () => {
    const el = marker.getElement();
    el.setAttribute('aria-label', place.name);
    el.classList.toggle('selected', currentRoute() === place.id);
  });
  markers.set(place.id, marker);
  clusters.addLayer(marker);
}

let tappedCluster = null; // { places, bounds, marker } of the cluster that was last tapped
clusters.on('clusterclick clusterkeypress', (event) => {
  const places = event.layer.getAllChildMarkers().map((marker) => marker.options.place);
  places.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  tappedCluster = { places, bounds: event.layer.getBounds(), marker: event.layer };
  // Setting the same hash again does not fire 'hashchange', so update the panel directly then.
  if (currentRoute() === ROUTE_CLUSTER) route();
  else location.hash = ROUTE_CLUSTER;
});

// "Show my position" button. The first press starts following the position,
// later presses move the map back to it.
let positionMarker = null;
const LocateControl = L.Control.extend({
  onAdd() {
    const button = h('button', {
      type: 'button', class: 'leaflet-bar locate', title: 'Visa min position', 'aria-label': 'Visa min position',
      onclick: () => {
        if (positionMarker) map.setView(positionMarker.getLatLng(), Math.max(map.getZoom(), 15));
        else map.locate({ watch: true, enableHighAccuracy: true });
      },
      html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>',
    });
    L.DomEvent.disableClickPropagation(button);
    return button;
  },
});
new LocateControl({ position: 'topright' }).addTo(map);

map.on('locationfound', (event) => {
  if (positionMarker) {
    positionMarker.setLatLng(event.latlng);
  } else if (!mapBounds.contains(event.latlng)) {
    map.stopLocate();
    toast('Du är utanför kartans område.');
  } else {
    positionMarker = L.circleMarker(event.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(map);
    map.setView(event.latlng, Math.max(map.getZoom(), 15));
  }
});
map.on('locationerror', () => toast('Kunde inte hämta din position.'));

// Tapping the map background closes an open place or cluster (the usual pattern on phones).
// The list and "Om" cover the map on phones and are closed with the close button.
map.on('click', () => {
  const open = currentRoute();
  if (markers.has(open) || open === ROUTE_CLUSTER) closePanel();
});

// ---------- Panel: place ----------

const ARROW_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

// Image carousel: swipe on touch screens, arrow buttons when using a mouse
// (the CSS hides the arrows on touch screens).
function gallery(figures) {
  const strip = h('div', { class: 'strip' }, figures);
  if (figures.length === 1) return h('div', { class: 'gallery' }, strip);

  const scrollOneImage = (direction) => strip.scrollBy({
    left: direction * figures[0].offsetWidth,
    behavior: reducedMotion ? 'auto' : 'smooth',
  });
  const previous = h('button', { type: 'button', class: 'round arrow prev', 'aria-label': 'Föregående bild', html: ARROW_ICON, onclick: () => scrollOneImage(-1) });
  const next = h('button', { type: 'button', class: 'round arrow next', 'aria-label': 'Nästa bild', html: ARROW_ICON, onclick: () => scrollOneImage(1) });

  // Hide the arrow that has nowhere to go. A few pixels of slack, since scroll
  // positions are not always whole numbers.
  const SLACK = 10;
  const updateArrows = () => {
    previous.hidden = strip.scrollLeft < SLACK;
    next.hidden = strip.scrollLeft + strip.clientWidth > strip.scrollWidth - SLACK;
  };
  strip.addEventListener('scroll', updateArrows);
  previous.hidden = true; // starts at the first image; sizes are not known until it is on the page

  return h('div', { class: 'gallery multiple' }, strip, previous, next);
}

function galleryFigure(image, index, total) {
  // The panel is never wider than about 400 px, so the 2000 px version is left out here.
  const widths = image.widths.filter((w) => w <= 1000);
  return h('figure', {},
    h('button', {
      type: 'button',
      'aria-label': `Visa i helskärm: ${image.caption || `bild ${index + 1} av ${total}`}`,
      // currentSrc is the version already on screen, used as a stand-in while the large one loads.
      onclick: (event) => showFullscreen(image, event.currentTarget.querySelector('img').currentSrc),
    },
      h('img', {
        // The browser picks the smallest version in srcset that is sharp enough for the
        // space the image takes up (sizes). src is the fallback for old browsers.
        srcset: widths.map((w) => `${imageUrl(image, w)} ${w}w`).join(', '),
        sizes: '(min-width: 45rem) 24rem, 90vw',
        src: imageUrl(image, widths.at(-1)),
        width: image.w,
        height: image.h,
        alt: '', // the button's label and the caption describe the image
        loading: index === 0 ? 'eager' : 'lazy',
      })),
    image.caption && h('figcaption', {}, image.caption),
  );
}

// Clicking anywhere in the fullscreen view closes it, as does Esc (built into <dialog>).
function showFullscreen(image, placeholderUrl) {
  const img = h('img', {
    // Fills the screen, so the browser picks the smallest version that is sharp enough
    // for this screen – a phone never downloads the 2000 px one.
    sizes: '100vw',
    srcset: image.widths.map((w) => `${imageUrl(image, w)} ${w}w`).join(', '),
    src: largestImageUrl(image),
    alt: image.caption,
    // On a slow connection the large version takes a while. Until then the smaller
    // version that is already downloaded shows through as the background.
    style: `background-image: url("${placeholderUrl}")`,
  });
  // A new element each time: reusing one would keep showing the previous image
  // until the new one has loaded.
  fullscreen.querySelector('img').replaceWith(img);
  fullscreen.showModal();
}
fullscreen.addEventListener('click', () => fullscreen.close());

// Link that shows the place as a pin in a maps app, where the user can start a route.
// There is no way to detect whether a browser supports geo: links, and no fallback if
// it does not, so they are only used on Android, where they always work and let the
// user pick their own maps app.
function mapsAppUrl(place) {
  const position = `${place.lat},${place.lng}`;
  const name = encodeURIComponent(place.name);
  const agent = navigator.userAgent;
  if (/Android/.test(agent)) return `geo:${position}?q=${position}(${name})`;
  if (/iPhone|iPad|Macintosh/.test(agent)) return `https://maps.apple.com/?ll=${position}&q=${name}`;
  return `https://www.google.com/maps/search/?api=1&query=${position}`;
}

function showPlace(place) {
  const figures = place.images.map((image, index) => galleryFigure(image, index, place.images.length));
  const share = () => navigator.share({ title: place.name, url: location.href })
    .catch(() => {}); // the user closed the share sheet – nothing to do

  setContent(
    figures.length > 0 && gallery(figures),
    place.year && h('p', { class: 'label' }, place.year),
    h('h2', { tabindex: -1 }, place.name),
    place.summary && h('p', { class: 'lead' }, place.summary),
    h('div', { class: 'text', html: place.html }), // sanitised by build.mjs
    h('p', { class: 'actions' },
      h('a', { class: 'button', href: mapsAppUrl(place), target: '_blank', rel: 'noopener' }, 'Öppna i kartapp'),
      navigator.share && h('button', { class: 'button', type: 'button', onclick: share }, 'Dela'),
    ),
  );
}

// Moves the map so the place's marker is drawn on its own and not hidden by the panel.
function showOnMap(place) {
  const marker = markers.get(place.id);
  // Zooms and pans until the marker is on screen and no longer inside a cluster.
  clusters.zoomToShowLayer(marker, () => {
    marker.getElement().classList.add('selected');
    // The panel covers the left part of a wide screen and the bottom part of a phone.
    const box = panel.getBoundingClientRect();
    const padding = wideScreen.matches
      ? { paddingTopLeft: [box.width + 50, 60], paddingBottomRight: [50, 30] }
      : { paddingTopLeft: [30, 130], paddingBottomRight: [30, sheetVisibleHeight() + 20] }; // top: clear of the search bar
    map.panInside([place.lat, place.lng], { animate: !reducedMotion, ...padding });
  });
}

// ---------- Panel: lists and about ----------

function placeListItem(place) {
  const thumbnail = place.images.length > 0
    ? h('img', { src: smallestImageUrl(place.images[0]), alt: '', loading: 'lazy', width: 56, height: 56 })
    : h('span', { class: 'no-image', style: `background:${colorOf(place)}` });
  return h('li', {},
    h('a', { href: '#' + place.id },
      thumbnail,
      h('span', {}, h('strong', {}, place.name), place.year && h('small', {}, place.year)),
    ));
}

// The places that match what is typed in the search bar – all of them when it is empty.
function showList() {
  const words = searchInput.value.trim().toLowerCase();
  const hits = data.places.filter((place) => `${place.name} ${place.year} ${place.summary}`.toLowerCase().includes(words));
  const hitCount = hits.length === 1 ? '1 plats' : `${hits.length} platser`;
  setContent(
    h('h2', { tabindex: -1 }, words ? 'Sökresultat' : 'Alla platser'),
    h('p', { class: 'visually-hidden', role: 'status' }, hitCount), // read out by screen readers
    h('ul', { class: 'list' },
      hits.map(placeListItem),
      hits.length === 0 && h('li', { class: 'empty' }, 'Inga platser matchar sökningen.')),
  );
}

// Typing in the search bar, or clicking in it, shows the list. Focus stays in the bar.
function showSearchResults() {
  if (currentRoute() === ROUTE_LIST) showList(); // already there: 'hashchange' would not fire
  else location.hash = ROUTE_LIST;
}
searchInput.addEventListener('input', showSearchResults);
searchInput.addEventListener('click', showSearchResults);
searchInput.addEventListener('keydown', (event) => {
  // Enter hides the phone's keyboard so the results are not covered by it.
  if (event.key === 'Enter') searchInput.blur();
});

// The places in a tapped cluster.
function showCluster(cluster) {
  const zoomIn = () => {
    closePanel();
    map.fitBounds(cluster.bounds.pad(0.3));
  };
  setContent(
    h('h2', { tabindex: -1 }, `${cluster.places.length} platser här`),
    h('ul', { class: 'list' }, cluster.places.map(placeListItem)),
    h('p', { class: 'actions' }, h('button', { class: 'button', type: 'button', onclick: zoomIn }, 'Zooma in')),
  );
}

function showAbout() {
  setContent(
    h('h2', { tabindex: -1 }, data.title),
    h('div', { class: 'text', html: data.about }), // sanitised by build.mjs
  );
}

// ---------- Bottom sheet (phones) ----------

// On phones the panel is a sheet that slides up from the bottom. It rests at half
// or full height, can be dragged between the two, and is closed by dragging it down.
// On wide screens the panel is a fixed card and none of this has any effect: the CSS
// there ignores --sheet-offset, and the touch handlers return at once.
//
// The sheet always has its full height. --sheet-offset says how many px it is pushed
// down from there: 0 = full, halfOffset() = half, closedOffset() = out of sight.

const sheetHandle = document.getElementById('handle');
const HALF_SCREEN = 0.5;  // share of the screen the sheet covers at half height …
const HALF_MAX = 0.7;     // … or up to this much, when needed for the heading to show
const SLIDE_MS = 250;     // same as the transition in style.css
const DRAG_START = 8;     // px a finger must move before it counts as a drag
const FLICK = 0.4;        // px per ms; faster than this is a flick

let sheetIsFull = false;
// "Half" is half the screen, stretched a little when that would cut off the heading
// (a place with one large photo on a short phone).
function halfOffset() {
  const heading = content.querySelector('h2');
  const headingBottom = heading ? heading.getBoundingClientRect().bottom - panel.getBoundingClientRect().top + 12 : 0;
  const visible = Math.min(Math.max(innerHeight * HALF_SCREEN, headingBottom), innerHeight * HALF_MAX);
  return Math.max(0, panel.offsetHeight - visible);
}
const closedOffset = () => panel.offsetHeight;
const moveSheet = (offset) => panel.style.setProperty('--sheet-offset', `${offset}px`);

// Lets the sheet come to rest at full or half height.
function restSheet(full) {
  sheetIsFull = full;
  // The content only scrolls at full height. At half height a drag moves the sheet instead.
  panel.classList.toggle('full', full);
  if (!full) panel.scrollTop = 0;
  sheetHandle.setAttribute('aria-label', full ? 'Visa mindre' : 'Visa mer');
  moveSheet(full ? 0 : halfOffset());
  updateMapLimits(); // the sheet now covers a different part of the map
}

// How much of the screen the resting sheet covers, in px.
function sheetVisibleHeight() {
  return panel.offsetHeight - (sheetIsFull ? 0 : halfOffset());
}

// The handle also works as a button, for those who cannot drag.
sheetHandle.addEventListener('click', () => restSheet(!sheetIsFull));
// Scrolling with a mouse wheel, or moving keyboard focus to something below the
// edge of the screen, opens the sheet fully so the content can be reached.
panel.addEventListener('wheel', (event) => {
  if (!wideScreen.matches && !sheetIsFull && event.deltaY > 0) restSheet(true);
});
panel.addEventListener('focusin', (event) => {
  if (wideScreen.matches || sheetIsFull) return;
  // Not for the heading: route() focuses it every time the panel opens, and that
  // must not change the height.
  if (event.target.matches('h2')) return;
  // Measured from the sheet's own top, so it is right even while the sheet is sliding.
  const bottomInSheet = event.target.getBoundingClientRect().bottom - panel.getBoundingClientRect().top;
  if (bottomInSheet > sheetVisibleHeight()) restSheet(true);
});
// The half position depends on the screen height, e.g. when the phone is turned.
addEventListener('resize', () => { if (panelOpen) restSheet(sheetIsFull); });

// Dragging. `drag` exists from a finger touching the sheet until it lifts, or until
// the movement turns out to be something else (scrolling, swiping the carousel).
let drag = null;

panel.addEventListener('touchstart', (event) => {
  if (wideScreen.matches || event.touches.length !== 1) return;
  const touch = event.touches[0];
  drag = {
    startX: touch.clientX,
    startY: touch.clientY,
    startOffset: sheetIsFull ? 0 : halfOffset(),
    offset: 0,
    moving: false,     // true once the finger has moved far enough to count as a drag
    speed: 0,          // px per ms, positive downwards
    lastY: touch.clientY,
    lastTime: event.timeStamp,
  };
}, { passive: true });

panel.addEventListener('touchmove', (event) => {
  if (!drag) return;
  const touch = event.touches[0];
  const dx = touch.clientX - drag.startX;
  const dy = touch.clientY - drag.startY;

  if (!drag.moving) {
    if (Math.abs(dx) < DRAG_START && Math.abs(dy) < DRAG_START) return;
    const sideways = Math.abs(dx) > Math.abs(dy);                    // swiping the image carousel
    const scrolling = sheetIsFull && (dy < 0 || panel.scrollTop > 0); // reading the content
    if (sideways || scrolling) {
      drag = null;
      return;
    }
    drag.moving = true;
    panel.classList.add('dragging'); // turns off the slide animation so the sheet follows the finger
  }

  if (event.cancelable) event.preventDefault(); // keep the browser from scrolling at the same time
  drag.offset = Math.min(Math.max(drag.startOffset + dy, 0), closedOffset());
  moveSheet(drag.offset);

  const elapsed = event.timeStamp - drag.lastTime;
  if (elapsed > 0) drag.speed = (touch.clientY - drag.lastY) / elapsed;
  drag.lastY = touch.clientY;
  drag.lastTime = event.timeStamp;
}, { passive: false });

function endDrag() {
  if (!drag) return;
  const { moving, offset, speed } = drag;
  drag = null;
  if (!moving) return;
  panel.classList.remove('dragging');

  const half = halfOffset();
  const closeBeyond = half + (closedOffset() - half) * 0.35; // dragged a good bit below half
  let target; // 'full', 'half' or 'closed'
  if (speed > FLICK) target = offset < half ? 'half' : 'closed';      // flicked down: one step down
  else if (speed < -FLICK) target = offset > half ? 'half' : 'full';  // flicked up: one step up
  else if (offset > closeBeyond) target = 'closed';
  else target = offset > half / 2 ? 'half' : 'full';                  // otherwise: whichever is nearest

  if (target === 'closed') closePanel();
  else restSheet(target === 'full');
}
panel.addEventListener('touchend', endDrag);
panel.addEventListener('touchcancel', endDrag);

// ---------- Routing ----------

let panelOpen = false;
let focusBeforeOpen = null; // where keyboard focus was before the panel opened

// Shows what the address says. Runs at start and every time the part after # changes.
function route() {
  let id = currentRoute();
  // After a reload there is no tapped cluster to show – fall back to the full list.
  if (id === ROUTE_CLUSTER && !tappedCluster) id = ROUTE_LIST;
  const place = data.places.find((p) => p.id === id);

  document.querySelector('.pin.selected')?.classList.remove('selected');

  if (place) showPlace(place);
  else if (id === ROUTE_LIST) showList();
  else if (id === ROUTE_CLUSTER) showCluster(tappedCluster);
  else if (id === ROUTE_ABOUT) showAbout();
  else {
    hidePanel();
    return;
  }

  if (!panelOpen) {
    panelOpen = true;
    focusBeforeOpen = document.activeElement;
    panel.hidden = false;
    // Start out of sight so the sheet slides up. Reading offsetHeight makes the
    // browser apply this position before the next one is set below.
    moveSheet(closedOffset());
    panel.offsetHeight;
  }
  panel.scrollTop = 0;
  // On phones the list and "Om" open at full height; a place or cluster opens at
  // half height and leaves the map visible.
  restSheet(id === ROUTE_LIST || id === ROUTE_ABOUT);

  // Move focus to the heading (every view has one) so screen readers and keyboard
  // users land on the new content – unless the user is typing in the search bar.
  const typing = id === ROUTE_LIST && document.activeElement === searchInput;
  if (!typing) content.querySelector('h2').focus({ preventScroll: true });

  if (place) showOnMap(place);
  // Enlarge the tapped cluster the same way as a selected place. (Its element is gone
  // if the map has been zoomed since, as clusters are redrawn on every zoom.)
  if (id === ROUTE_CLUSTER) tappedCluster.marker.getElement()?.classList.add('selected');
}

function hidePanel() {
  if (!panelOpen) return;
  panelOpen = false;
  updateMapLimits();
  // On phones the sheet slides out before it is hidden. Wide screens have no slide.
  const hide = () => { if (!panelOpen) panel.hidden = true; }; // unless it was reopened meanwhile
  moveSheet(closedOffset());
  if (wideScreen.matches || reducedMotion) hide();
  else setTimeout(hide, SLIDE_MS);

  // Give keyboard focus back to where it was, e.g. the marker that opened the panel.
  // Not to the search bar though: on a phone that would bring the keyboard back up.
  if (focusBeforeOpen?.isConnected && focusBeforeOpen !== searchInput) focusBeforeOpen.focus({ preventScroll: true });
  focusBeforeOpen = null;
}

// Closing means going to the address without a #. Setting location.hash = '' would
// leave a stray "#" in the address, so pushState is used instead. pushState does not
// fire 'hashchange', hence the explicit route().
function closePanel() {
  searchInput.value = '';
  searchInput.blur();
  history.pushState(null, '', location.pathname + location.search);
  route();
}

document.getElementById('close').addEventListener('click', closePanel);
document.addEventListener('keydown', (event) => {
  // While the fullscreen image is open, Esc closes that instead (built into <dialog>).
  if (event.key === 'Escape' && panelOpen && !fullscreen.open) closePanel();
});
addEventListener('hashchange', route); // links, markers and the browser's back button
route();

// ---------- Offline and updates ----------

// The preview never uses a service worker, so editors always see their latest changes.
if ('serviceWorker' in navigator && !data.preview) {
  // False on the very first visit, when there is nothing to update from.
  const hadServiceWorker = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.register('sw.js');
  // A new version was downloaded in the background and has taken over –
  // let the user decide when to reload.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadServiceWorker) toast('Kartan har uppdaterats.', 'Ladda om', () => location.reload());
  });
}
