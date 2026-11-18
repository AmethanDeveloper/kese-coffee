/* =====================================================================
   Карта для доставки: зона вокруг кофейни, точка гостя, поиск адреса.
   Leaflet лежит в проекте (js/vendor), плитки и поиск — OpenStreetMap.
   ===================================================================== */
(function () {
  'use strict';
  const V = 'js/vendor/leaflet-1.9.4/';
  let loading = null;

  function load() {
    if (window.L) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = V + 'leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script'); s.src = V + 'leaflet.js';
      s.onload = () => window.L ? resolve(window.L) : reject(new Error('Карта не загрузилась'));
      s.onerror = () => { loading = null; reject(new Error('Карта не загрузилась. Проверьте интернет')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function km(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const PIN = '<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1Z" fill="#C9A46C" stroke="#1A120B" stroke-width="2"/><circle cx="16" cy="15.5" r="5.5" fill="#1A120B"/></svg>';
  const SHOP = '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#1A120B" stroke="#C9A46C" stroke-width="2"/><path d="M8 26 L17 14 L21 19 L25 15 L32 26" fill="none" stroke="#C9A46C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* el — контейнер; opts: { shop:[lat,lng], radiusKm, pin:[lat,lng]|null, draggableShop, onPick(lat,lng) } */
  async function picker(el, opts) {
    const L = await load();
    if (!el.isConnected) return null;
    const center = opts.pin || opts.shop || [51.1282, 71.4304];
    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: true }).setView(center, opts.pin ? 16 : 14);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    let circle = null, shopM = null, pinM = null;
    const icon = (html, size, anchor) => L.divIcon({ className: 'map-ic', html, iconSize: size, iconAnchor: anchor });
    function drawZone() {
      if (circle) circle.remove();
      if (opts.shop && opts.radiusKm) {
        circle = L.circle(opts.shop, { radius: opts.radiusKm * 1000, color: '#C9A46C', weight: 2, fillColor: '#C9A46C', fillOpacity: 0.08, dashArray: '6 6', interactive: false }).addTo(map);
      }
    }
    if (opts.shop) {
      shopM = L.marker(opts.shop, { icon: icon(SHOP, [40, 40], [20, 20]), draggable: !!opts.draggableShop, keyboard: !!opts.draggableShop, title: 'Кофейня' }).addTo(map);
      if (opts.draggableShop) shopM.on('dragend', () => { const p = shopM.getLatLng(); opts.shop = [p.lat, p.lng]; drawZone(); opts.onPick && opts.onPick(p.lat, p.lng); });
    }
    drawZone();
    function setPin(lat, lng, pan) {
      if (opts.draggableShop) {           // режим «где кофейня»: двигаем точку кофейни
        opts.shop = [lat, lng];
        if (shopM) shopM.setLatLng(opts.shop); else shopM = L.marker(opts.shop, { icon: icon(SHOP, [40, 40], [20, 20]), draggable: true }).addTo(map);
        drawZone();
      } else {
        if (!pinM) {
          pinM = L.marker([lat, lng], { icon: icon(PIN, [32, 42], [16, 41]), draggable: true, title: 'Адрес доставки' }).addTo(map);
          pinM.on('dragend', () => { const p = pinM.getLatLng(); opts.onPick && opts.onPick(p.lat, p.lng); });
        } else pinM.setLatLng([lat, lng]);
      }
      if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 16));
    }
    if (opts.pin) setPin(opts.pin[0], opts.pin[1]);
    map.on('click', e => { setPin(e.latlng.lat, e.latlng.lng); opts.onPick && opts.onPick(e.latlng.lat, e.latlng.lng); });
    if (!opts.pin && circle) map.fitBounds(circle.getBounds(), { padding: [10, 10] });
    setTimeout(() => map.invalidateSize(), 60);
    return {
      map, setPin,
      setRadius(r) { opts.radiusKm = r; drawZone(); if (circle) map.fitBounds(circle.getBounds(), { padding: [10, 10] }); },
      destroy() { map.remove(); }
    };
  }

  /* Поиск адреса (OpenStreetMap Nominatim), рядом с кофейней */
  async function search(q, near) {
    const p = new URLSearchParams({ format: 'jsonv2', q, limit: '6', 'accept-language': 'ru', addressdetails: '1', countrycodes: 'kz' });
    if (near) { const d = 0.25; p.set('viewbox', [near[1] - d, near[0] + d, near[1] + d, near[0] - d].join(',')); }
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + p.toString(), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Поиск адреса сейчас недоступен. Отметьте точку на карте');
    const list = await r.json();
    return list.map(x => ({ lat: Number(x.lat), lng: Number(x.lon), label: short(x.address, x.display_name) }));
  }
  async function reverse(lat, lng) {
    const p = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '18', 'accept-language': 'ru', addressdetails: '1' });
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?' + p.toString(), { headers: { Accept: 'application/json' } });
    if (!r.ok) return '';
    const x = await r.json();
    return x && x.address ? short(x.address, x.display_name) : '';
  }
  function short(a, full) {
    if (!a) return full || '';
    const street = a.road || a.pedestrian || a.residential || a.neighbourhood || a.suburb || '';
    const house = a.house_number || '';
    const s = [street, house].filter(Boolean).join(', ');
    return s || (full || '').split(',').slice(0, 2).join(',');
  }

  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Телефон не даёт определить местоположение. Отметьте точку на карте'));
      navigator.geolocation.getCurrentPosition(
        p => resolve([p.coords.latitude, p.coords.longitude]),
        e => reject(new Error(e.code === 1 ? 'Нет доступа к геолокации. Разрешите её в настройках браузера или отметьте точку на карте' : 'Не удалось определить местоположение. Отметьте точку на карте')),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }

  window.CafeMap = { load, picker, search, reverse, locate, km };
})();
