/* =====================================================================
   Подготовка фото позиции в браузере перед загрузкой:
   - большое фото (до 1000 px по длинной стороне) — для карточки товара;
   - миниатюра 400×300 — для списка меню. Если фото вертикальное
     (стакан), оно вписывается целиком, а поля по бокам заливаются
     цветом краёв самого фото, без затемнения.
   ===================================================================== */
(function () {
  'use strict';

  async function decode(file) {
    if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) {
      throw new Error('Это не фото. Выберите файл JPG, PNG или WebP');
    }
    if (file.size > 25 * 1024 * 1024) throw new Error('Фото слишком большое (больше 25 МБ)');
    try {
      if (window.createImageBitmap) return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) { /* попробуем через <img> */ }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото. Сохраните его как JPG и попробуйте снова')); };
      img.src = url;
    });
  }
  const W = img => img.width || img.naturalWidth, H = img => img.height || img.naturalHeight;
  const toBlob = (canvas, q) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Не удалось обработать фото')), 'image/jpeg', q));

  function full(img) {
    const k = Math.min(1, 1000 / Math.max(W(img), H(img)));
    const c = document.createElement('canvas'); c.width = Math.round(W(img) * k); c.height = Math.round(H(img) * k);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function thumb(img) {
    const TW = 400, TH = 300, c = document.createElement('canvas'); c.width = TW; c.height = TH;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    const ar = W(img) / H(img);
    if (ar >= 1.2) {                                  // горизонтальное фото: просто кадрируем по центру
      const k = Math.max(TW / W(img), TH / H(img)), w = W(img) * k, h = H(img) * k;
      x.drawImage(img, (TW - w) / 2, (TH - h) / 2, w, h);
      return c;
    }
    // вертикальное фото: вписываем целиком по высоте
    const h = TH, w = Math.round(W(img) * TH / H(img)), left = Math.round((TW - w) / 2);
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const t = tmp.getContext('2d'); t.imageSmoothingQuality = 'high'; t.drawImage(img, 0, 0, w, h);
    const px = t.getImageData(0, 0, w, h).data;
    // цвет краёв по строкам, сглаженный по вертикали — чтобы не было полос
    const edge = (x0) => {
      const rows = [];
      for (let yy = 0; yy < h; yy++) {
        let r = 0, g = 0, b = 0;
        for (let xx = x0; xx < x0 + 6; xx++) { const i = (yy * w + xx) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; }
        let m = [r / 6, g / 6, b / 6];
        const lum = Math.max(m[0], m[1], m[2]); if (lum > 70) m = m.map(v => v * 70 / lum);   // светлые края не тянем в поля
        rows.push(m);
      }
      const R = 24, out = [];
      for (let yy = 0; yy < h; yy++) {
        let s = [0, 0, 0], n = 0;
        for (let k = Math.max(0, yy - R); k <= Math.min(h - 1, yy + R); k++) { s[0] += rows[k][0]; s[1] += rows[k][1]; s[2] += rows[k][2]; n++; }
        out.push(s.map(v => Math.round(v / n)));
      }
      return out;
    };
    const L = edge(0), Rr = edge(Math.max(0, w - 6));
    for (let yy = 0; yy < h; yy++) {
      x.fillStyle = 'rgb(' + L[yy].join(',') + ')'; x.fillRect(0, yy, left + 2, 1);
      x.fillStyle = 'rgb(' + Rr[yy].join(',') + ')'; x.fillRect(left + w - 2, yy, TW - left - w + 2, 1);
    }
    // мягкий переход от фото к полям
    const f = Math.max(10, Math.round(w / 6));
    const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
    const mx = mask.getContext('2d'); mx.drawImage(tmp, 0, 0);
    mx.globalCompositeOperation = 'destination-in';
    const g = mx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(f / w, '#000'); g.addColorStop(1 - f / w, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    mx.fillStyle = g; mx.fillRect(0, 0, w, h);
    x.drawImage(mask, left, 0);
    return c;
  }

  async function prepare(file) {
    const img = await decode(file);
    const [big, small] = await Promise.all([toBlob(full(img), 0.86), toBlob(thumb(img), 0.86)]);
    if (img.close) img.close();
    return { full: big, thumb: small };
  }
  const toDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Не удалось прочитать фото')); r.readAsDataURL(blob); });

  window.CafePhoto = { prepare, toDataURL };
})();
