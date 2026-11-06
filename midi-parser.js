// ============================================================================
// PianoFlow — Teoría musical (nombres, acordes) + lector/exportador de archivos MIDI
// ============================================================================

const NOTE_NAMES_ES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const NOTE_NAMES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

const MusicTheory = {
  NOTE_NAMES_ES,
  NOTE_NAMES_EN,

  pc(midi) {
    return ((midi % 12) + 12) % 12;
  },

  octave(midi) {
    return Math.floor(midi / 12) - 1;
  },

  isBlackKey(midi) {
    return BLACK_PCS.has(this.pc(midi));
  },

  // mode: 'es' | 'en' | 'both'
  name(midi, mode = 'es', withOctave = false) {
    const pc = this.pc(midi);
    const oct = withOctave ? this.octave(midi) : '';
    if (mode === 'en') return NOTE_NAMES_EN[pc] + oct;
    if (mode === 'both') return `${NOTE_NAMES_ES[pc]}${oct} (${NOTE_NAMES_EN[pc]}${oct})`;
    return NOTE_NAMES_ES[pc] + oct;
  },

  shortName(midi, mode = 'es') {
    const pc = this.pc(midi);
    if (mode === 'en') return NOTE_NAMES_EN[pc];
    if (mode === 'both') return `${NOTE_NAMES_ES[pc]}/${NOTE_NAMES_EN[pc]}`;
    return NOTE_NAMES_ES[pc];
  },

  // Cantidad de teclas blancas entre dos notas blancas (con signo)
  whiteKeySteps(from, to) {
    const dir = to > from ? 1 : -1;
    let steps = 0;
    for (let m = from; m !== to; m += dir) {
      if (!this.isBlackKey(m + dir)) steps += dir;
    }
    return steps;
  },

  detectChord(midis) {
    if (!midis || midis.length === 0) return null;
    const sorted = [...midis].sort((a, b) => a - b);
    const es = pc => NOTE_NAMES_ES[pc];
    const en = pc => NOTE_NAMES_EN[pc];

    if (sorted.length === 1) {
      const m = sorted[0];
      const extra = m === 60 ? ' · Do central' : '';
      return { name: `${es(this.pc(m))}${this.octave(m)}`, type: `Nota ${en(this.pc(m))}${this.octave(m)}${extra}` };
    }

    const pcs = [...new Set(sorted.map(n => this.pc(n)))];
    const bass = this.pc(sorted[0]);
    if (pcs.length === 1) return { name: es(pcs[0]), type: 'Octava' };

    if (pcs.length === 2) {
      const iv = (this.pc(sorted[sorted.length - 1]) - bass + 12) % 12;
      const names = {
        1: 'Segunda menor', 2: 'Segunda mayor', 3: 'Tercera menor', 4: 'Tercera mayor', 5: 'Cuarta',
        6: 'Tritono', 7: 'Quinta', 8: 'Sexta menor', 9: 'Sexta mayor', 10: 'Séptima menor', 11: 'Séptima mayor'
      };
      return { name: `${es(pcs[0])} + ${es(pcs[1])}`, type: `Intervalo: ${names[iv] || ''}` };
    }

    const patterns = [
      { iv: [0, 4, 7], es: '', en: '', desc: 'Acorde mayor · suena alegre' },
      { iv: [0, 3, 7], es: 'm', en: 'm', desc: 'Acorde menor · suena melancólico' },
      { iv: [0, 4, 7, 11], es: 'maj7', en: 'maj7', desc: 'Séptima mayor · suave, jazzero' },
      { iv: [0, 4, 7, 10], es: '7', en: '7', desc: 'Séptima de dominante · tensión' },
      { iv: [0, 3, 7, 10], es: 'm7', en: 'm7', desc: 'Menor séptima · soul / lo-fi' },
      { iv: [0, 2, 7], es: 'sus2', en: 'sus2', desc: 'Suspendido 2 · abierto' },
      { iv: [0, 5, 7], es: 'sus4', en: 'sus4', desc: 'Suspendido 4 · épico' },
      { iv: [0, 3, 6], es: 'dim', en: 'dim', desc: 'Disminuido · suspenso' },
      { iv: [0, 4, 8], es: 'aum', en: 'aug', desc: 'Aumentado · misterioso' },
      { iv: [0, 4, 7, 9], es: '6', en: '6', desc: 'Sexta · retro' },
      { iv: [0, 2, 4, 7], es: 'add9', en: 'add9', desc: 'Con novena · moderno' }
    ];

    for (const root of pcs) {
      const rel = pcs.map(p => (p - root + 12) % 12).sort((a, b) => a - b);
      for (const p of patterns) {
        if (p.iv.length === rel.length && p.iv.every((v, i) => v === rel[i])) {
          const inv = bass !== root ? ` / ${es(bass)}` : '';
          const invTxt = bass !== root ? ' (invertido)' : '';
          return { name: `${es(root)}${p.es}${inv}`, type: `${en(root)}${p.en} · ${p.desc}${invTxt}` };
        }
      }
    }
    return { name: pcs.map(es).join(' + '), type: `${sorted.length} notas` };
  }
};

// ============================================================================
// Lector de archivos MIDI estándar (.mid / .midi)
// ============================================================================
const MidiFileParser = {
  parse(arrayBuffer, fileName = 'Canción MIDI') {
    const data = new DataView(arrayBuffer);
    let offset = 0;
    const need = n => {
      if (offset + n > data.byteLength) throw new Error('El archivo MIDI está cortado o dañado.');
    };
    const readStr = len => {
      need(len);
      let s = '';
      for (let i = 0; i < len; i++) s += String.fromCharCode(data.getUint8(offset + i));
      offset += len;
      return s;
    };
    const readVar = () => {
      let r = 0;
      for (let i = 0; i < 4; i++) {
        need(1);
        const b = data.getUint8(offset++);
        r = (r << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return r;
    };

    if (readStr(4) !== 'MThd') throw new Error('No es un archivo MIDI válido.');
    const headerLen = data.getUint32(offset);
    offset += 4;
    const numTracks = data.getUint16(offset + 2);
    const division = data.getUint16(offset + 4);
    offset += headerLen;
    if (division & 0x8000) throw new Error('Este MIDI usa tiempo SMPTE, que no está soportado.');
    const tpq = division || 480;

    const tempos = [{ tick: 0, mpqn: 500000 }];
    let timeSig = null;
    const raw = [];

    for (let t = 0; t < numTracks && offset < data.byteLength; t++) {
      const id = readStr(4);
      need(4);
      const len = data.getUint32(offset);
      offset += 4;
      const end = Math.min(data.byteLength, offset + len);
      if (id !== 'MTrk') {
        offset = end;
        continue;
      }
      let tick = 0;
      let running = 0;
      const open = new Map();
      const close = (key, endTick) => {
        const st = open.get(key);
        if (!st) return;
        raw.push({ midi: st.midi, startTick: st.tick, endTick: Math.max(st.tick + 10, endTick), velocity: st.vel, track: t, channel: st.ch });
        open.delete(key);
      };

      while (offset < end) {
        tick += readVar();
        need(1);
        let status = data.getUint8(offset);
        if (status >= 0x80) {
          offset++;
          if (status < 0xf0) running = status;
        } else {
          status = running;
        }
        const type = status & 0xf0;
        const ch = status & 0x0f;

        if (type === 0x90 || type === 0x80) {
          need(2);
          const note = data.getUint8(offset++);
          const vel = data.getUint8(offset++);
          const key = ch * 128 + note;
          if (type === 0x90 && vel > 0) {
            close(key, tick); // nota repetida sin note-off: cerramos la anterior
            open.set(key, { midi: note, tick, vel, ch });
          } else {
            close(key, tick);
          }
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          offset += 2;
        } else if (type === 0xc0 || type === 0xd0) {
          offset += 1;
        } else if (status === 0xff) {
          need(1);
          const meta = data.getUint8(offset++);
          const mlen = readVar();
          need(mlen);
          if (meta === 0x51 && mlen === 3) {
            tempos.push({ tick, mpqn: (data.getUint8(offset) << 16) | (data.getUint8(offset + 1) << 8) | data.getUint8(offset + 2) });
          } else if (meta === 0x58 && mlen >= 2 && !timeSig) {
            timeSig = [data.getUint8(offset), Math.pow(2, data.getUint8(offset + 1))];
          }
          offset += mlen;
        } else if (status === 0xf0 || status === 0xf7) {
          offset += readVar();
        } else {
          break;
        }
      }
      for (const key of [...open.keys()]) close(key, tick);
      offset = end;
    }

    tempos.sort((a, b) => a.tick - b.tick);
    // Si hay un tempo en el tick 0, reemplaza al de 120 BPM por defecto
    const tmap = tempos.filter((tc, i) => !(i === 0 && tempos.length > 1 && tempos[1].tick === 0));
    const segs = [];
    let acc = 0;
    for (let i = 0; i < tmap.length; i++) {
      if (i > 0) acc += ((tmap[i].tick - tmap[i - 1].tick) / tpq) * (tmap[i - 1].mpqn / 1e6);
      segs.push({ tick: tmap[i].tick, sec: acc, mpqn: tmap[i].mpqn });
    }
    const toSec = tick => {
      let s = segs[0];
      for (const seg of segs) {
        if (seg.tick > tick) break;
        s = seg;
      }
      return s.sec + ((tick - s.tick) / tpq) * (s.mpqn / 1e6);
    };

    let notes = raw.filter(n => n.channel !== 9); // sin batería
    if (notes.length === 0) notes = raw;
    if (notes.length === 0) throw new Error('El archivo no tiene notas para tocar.');

    // Asignar manos: si hay exactamente 2 pistas (o 2 canales) con notas, la más aguda es la derecha
    const assignByGroups = keyFn => {
      const groups = new Map();
      for (const n of notes) {
        const k = keyFn(n);
        if (!groups.has(k)) groups.set(k, { sum: 0, count: 0 });
        const g = groups.get(k);
        g.sum += n.midi;
        g.count++;
      }
      if (groups.size !== 2) return false;
      const [a, b] = [...groups.entries()];
      const rightKey = a[1].sum / a[1].count >= b[1].sum / b[1].count ? a[0] : b[0];
      for (const n of notes) n.hand = keyFn(n) === rightKey ? 'R' : 'L';
      return true;
    };
    if (!assignByGroups(n => n.track) && !assignByGroups(n => n.channel)) {
      for (const n of notes) n.hand = n.midi >= 60 ? 'R' : 'L';
    }

    let minTick = Infinity;
    for (const n of notes) if (n.startTick < minTick) minTick = n.startTick;
    const t0 = toSec(minTick);
    const out = notes
      .map(n => {
        const start = toSec(n.startTick) - t0;
        const endS = Math.max(start + 0.06, toSec(n.endTick) - t0);
        return { midi: n.midi, time: +start.toFixed(4), duration: +(endS - start).toFixed(4), velocity: n.velocity, hand: n.hand };
      })
      .sort((a, b) => a.time - b.time || a.midi - b.midi);

    // Ajustar el tiempo para que el compás coincida con el inicio de la música
    const firstTempo = tmap.find(tc => tc.tick <= minTick) || tmap[0];
    const bpm = Math.round(60000000 / (firstTempo ? firstTempo.mpqn : 500000));

    return {
      id: 'midi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: fileName.replace(/\.(mid|midi)$/i, ''),
      artist: 'MIDI importado',
      concept: 'Archivo MIDI importado.',
      tip: 'Si las manos quedaron mal separadas, practicá con "Ambas". Bajá la velocidad y usá "Repetir tramo".',
      bpm: bpm || 120,
      timeSig: timeSig || [4, 4],
      pickup: 0,
      isCustom: true,
      notes: out
    };
  },

  // Exporta una canción a un archivo .mid (formato 0, mano derecha canal 1, izquierda canal 2)
  exportToMidiBytes(song) {
    const tpq = 480;
    const bpm = song.bpm || 120;
    const mpqn = Math.round(60000000 / bpm);
    const toTicks = sec => Math.round(sec * (bpm / 60) * tpq);
    const varInt = v => {
      const bytes = [v & 0x7f];
      v >>= 7;
      while (v > 0) {
        bytes.unshift((v & 0x7f) | 0x80);
        v >>= 7;
      }
      return bytes;
    };
    const [num, den] = song.timeSig || [4, 4];
    const events = [];
    for (const n of song.notes) {
      const s = Math.max(0, toTicks(n.time));
      const e = Math.max(s + 20, toTicks(n.time + n.duration));
      const ch = n.hand === 'L' ? 1 : 0;
      events.push({ tick: s, bytes: [0x90 | ch, n.midi, Math.max(1, n.velocity || 90)], order: 1 });
      events.push({ tick: e, bytes: [0x80 | ch, n.midi, 0], order: 0 });
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const track = [
      0x00, 0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff,
      0x00, 0xff, 0x58, 0x04, num, Math.round(Math.log2(den)), 24, 8
    ];
    let last = 0;
    for (const ev of events) {
      track.push(...varInt(ev.tick - last), ...ev.bytes);
      last = ev.tick;
    }
    track.push(0x00, 0xff, 0x2f, 0x00);
    const out = new Uint8Array(22 + track.length);
    const view = new DataView(out.buffer);
    out.set([0x4d, 0x54, 0x68, 0x64], 0);
    view.setUint32(4, 6);
    view.setUint16(8, 0);
    view.setUint16(10, 1);
    view.setUint16(12, tpq);
    out.set([0x4d, 0x54, 0x72, 0x6b], 14);
    view.setUint32(18, track.length);
    out.set(track, 22);
    return out;
  }
};

window.MusicTheory = MusicTheory;
window.MidiFileParser = MidiFileParser;
