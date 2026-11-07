// ============================================================================
// PianoFlow — Lector de MusicXML (.musicxml / .xml y comprimido .mxl)
//
// Es el formato que exporta MuseScore además del MIDI. Para aprender es mejor:
// trae la separación exacta de manos (pentagrama 1 = derecha, 2 = izquierda)
// y, muchas veces, la digitación que escribió quien hizo el arreglo.
// ============================================================================
(function () {
  const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // ---------- .mxl = zip: lector mínimo (sin librerías) ----------
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede abrir .mxl; exportá el MusicXML sin comprimir.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('El .mxl no es un archivo comprimido válido.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(local + 26, true);
      const lelen = dv.getUint16(local + 28, true);
      const start = local + 30 + lnlen + lelen;
      const data = u8.subarray(start, start + csize);
      files[name] = { method, data };
      p += 46 + nlen + elen + clen;
    }
    const read = async name => {
      const f = files[name];
      if (!f) return null;
      const raw = f.method === 0 ? f.data : f.method === 8 ? await inflateRaw(f.data) : null;
      if (!raw) throw new Error('El .mxl usa una compresión que no conozco.');
      return dec.decode(raw);
    };
    let main = null;
    const container = await read('META-INF/container.xml');
    if (container) {
      const m = /full-path="([^"]+)"/.exec(container);
      if (m) main = m[1];
    }
    if (!main) main = Object.keys(files).find(n => !n.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(n));
    if (!main) throw new Error('No encontré la partitura dentro del .mxl.');
    return read(main);
  }

  const kids = (el, name) => (el ? [...el.children].filter(c => c.nodeName === name) : []);
  const kid = (el, name) => kids(el, name)[0] || null;
  const txt = (el, name) => {
    const k = kid(el, name);
    return k ? k.textContent.trim() : null;
  };

  // ---------- MusicXML → canción de PianoFlow ----------
  function parseXml(text, fileName) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo MusicXML está dañado.');
    const root = doc.documentElement;
    if (root.nodeName === 'score-timewise') throw new Error('Este MusicXML está en formato "timewise"; exportalo de nuevo desde MuseScore.');
    if (root.nodeName !== 'score-partwise') throw new Error('No parece un archivo MusicXML.');

    const title =
      (doc.querySelector('work > work-title') || {}).textContent ||
      (doc.querySelector('movement-title') || {}).textContent ||
      fileName.replace(/\.(musicxml|xml|mxl)$/i, '');
    const composerEl = [...doc.querySelectorAll('identification > creator')].find(c => c.getAttribute('type') === 'composer');
    const composer = composerEl ? composerEl.textContent.trim() : '';

    const parts = kids(root, 'part');
    if (!parts.length) throw new Error('El MusicXML no tiene partes.');

    const raw = []; // { midi, startQ, endQ, staff, part, finger }
    const tempos = []; // { q, bpm }
    let timeSig = null;
    let pickupQ = 0;
    let maxStaves = 1;

    parts.forEach((part, pi) => {
      let divisions = 1;
      let pos = 0; // en negras
      const open = new Map(); // notas ligadas abiertas (midi:staff → nota)
      kids(part, 'measure').forEach((measure, mi) => {
        const mStart = pos;
        let maxPos = pos;
        let lastStart = pos;
        for (const el of measure.children) {
          switch (el.nodeName) {
            case 'attributes': {
              const d = txt(el, 'divisions');
              if (d) divisions = Number(d) || divisions;
              const time = kid(el, 'time');
              if (time && !timeSig && txt(time, 'beats')) timeSig = [Number(txt(time, 'beats')) || 4, Number(txt(time, 'beat-type')) || 4];
              const st = txt(el, 'staves');
              if (st) maxStaves = Math.max(maxStaves, Number(st) || 1);
              break;
            }
            case 'direction':
            case 'sound': {
              const snd = el.nodeName === 'sound' ? el : kid(el, 'sound');
              let bpm = snd && snd.getAttribute('tempo') ? Number(snd.getAttribute('tempo')) : null;
              if (!bpm) {
                const met = el.querySelector && el.querySelector('metronome');
                const pm = met ? Number(txt(met, 'per-minute')) : 0;
                const unit = met ? txt(met, 'beat-unit') : null;
                const factor = { half: 2, quarter: 1, eighth: 0.5, whole: 4 }[unit] || 1;
                if (pm) bpm = pm * factor * (kid(met, 'beat-unit-dot') ? 1.5 : 1);
              }
              if (bpm && pi === 0) tempos.push({ q: pos, bpm });
              break;
            }
            case 'backup':
              pos -= (Number(txt(el, 'duration')) || 0) / divisions;
              break;
            case 'forward':
              pos += (Number(txt(el, 'duration')) || 0) / divisions;
              maxPos = Math.max(maxPos, pos);
              break;
            case 'note': {
              if (kid(el, 'grace') || kid(el, 'cue')) break;
              const q = (Number(txt(el, 'duration')) || 0) / divisions;
              const isChord = !!kid(el, 'chord');
              const start = isChord ? lastStart : pos;
              if (!isChord) {
                lastStart = pos;
                pos += q;
                maxPos = Math.max(maxPos, pos);
              }
              const pitch = kid(el, 'pitch');
              if (!pitch || kid(el, 'rest')) break; // silencio o percusión
              const midi = (Number(txt(pitch, 'octave')) + 1) * 12 + STEP_PC[txt(pitch, 'step')] + Math.round(Number(txt(pitch, 'alter')) || 0);
              const staff = Number(txt(el, 'staff')) || 1;
              const ties = kids(el, 'tie').map(t => t.getAttribute('type'));
              const key = `${midi}:${staff}:${pi}`;
              if (ties.includes('stop') && open.has(key)) {
                const prev = open.get(key);
                prev.endQ = start + q;
                if (!ties.includes('start')) open.delete(key);
                break;
              }
              const fing = el.querySelector('notations technical fingering');
              const finger = fing ? Number((fing.textContent.match(/[1-5]/) || [])[0]) || null : null;
              const note = { midi, startQ: start, endQ: start + q, staff, part: pi, finger };
              raw.push(note);
              if (ties.includes('start')) open.set(key, note);
              break;
            }
            default:
          }
        }
        // anacrusa: primer compás "implícito" (más corto)
        if (mi === 0 && measure.getAttribute('implicit') === 'yes') pickupQ = maxPos - mStart;
        pos = maxPos;
      });
    });

    if (!raw.length) throw new Error('No encontré notas en el MusicXML.');

    // Manos: pentagrama 1 = derecha y 2 = izquierda; si son dos partes de un pentagrama, la primera es la derecha
    const handOf = n => {
      if (maxStaves >= 2) return n.staff >= 2 ? 'L' : 'R';
      if (parts.length === 2) return n.part === 0 ? 'R' : 'L';
      return n.midi >= 60 ? 'R' : 'L';
    };

    // Tiempo: negras → segundos con el mapa de tempos
    tempos.sort((a, b) => a.q - b.q);
    if (!tempos.length || tempos[0].q > 0) tempos.unshift({ q: 0, bpm: tempos.length ? tempos[0].bpm : 90 });
    const secAt = q => {
      let t = 0;
      for (let i = 0; i < tempos.length; i++) {
        const a = tempos[i];
        const b = tempos[i + 1];
        if (b && q > b.q) t += ((b.q - a.q) * 60) / a.bpm;
        else return t + ((q - a.q) * 60) / a.bpm;
      }
      return t;
    };

    const notes = raw
      .filter(n => n.endQ > n.startQ)
      .map(n => {
        const time = secAt(n.startQ);
        return {
          midi: n.midi,
          time: +time.toFixed(4),
          duration: +Math.max(0.05, secAt(n.endQ) - time).toFixed(4),
          hand: handOf(n),
          finger: n.finger,
          velocity: 84
        };
      })
      .sort((a, b) => a.time - b.time || a.midi - b.midi);

    const withFingers = notes.filter(n => n.finger).length;
    return {
      id: 'xml_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: title.trim(),
      artist: composer ? `${composer} · MusicXML` : 'MusicXML importado',
      concept: 'Partitura importada (MusicXML).',
      tip: withFingers
        ? 'Trae la digitación de quien hizo el arreglo: seguí los números de dedo.'
        : 'Este arreglo no trae digitación. Si una parte es incómoda, probá distintos dedos lento hasta encontrar el que menos mueve la mano.',
      bpm: Math.round(tempos[0].bpm) || 90,
      timeSig: timeSig || [4, 4],
      pickup: +pickupQ.toFixed(4),
      isCustom: true,
      notes
    };
  }

  async function parse(buffer, fileName) {
    const isZip = new Uint8Array(buffer.slice(0, 2))[0] === 0x50 && new Uint8Array(buffer.slice(0, 2))[1] === 0x4b;
    const text = isZip ? await unzip(buffer) : new TextDecoder().decode(buffer);
    return parseXml(text, fileName);
  }

  window.MusicXmlParser = { parse, parseXml };
})();
