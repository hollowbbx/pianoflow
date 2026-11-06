// ============================================================================
// PianoFlow — Motor de audio
//  • Piano real: muestras "Salamander Grand Piano" (dominio público / CC-BY 3.0),
//    se descargan una sola vez la primera vez que sonás algo (requiere internet).
//  • Sin internet: sintetizador de respaldo (suena más "electrónico").
//  • Tres canales independientes: "user" (tus teclas), "auto" (la mano que toca la PC)
//    y "fx" (metrónomo y campanitas), cada uno con su volumen.
//  • Opcional: el acompañamiento puede salir por MIDI hacia tu teclado (sus parlantes).
// ============================================================================

class PianoAudioEngine {
  constructor() {
    this.ctx = null;
    this.buses = {};
    this.samples = new Map(); // midi -> AudioBuffer
    this.sampleMidis = [];
    this.sampleStatus = 'idle'; // idle | loading | ready | error
    this.onStatusChange = null;
    this.voices = new Map(); // "bus:midi" -> voice
    this.autoVoices = new Set();
    this.sustain = false;
    this.sustained = new Set();
    this.userSound = true;
    this.volumes = { master: 0.85, user: 1, auto: 0.7, fx: 0.7 };

    // Salida MIDI hacia el teclado físico (para el acompañamiento)
    this.midiOut = null;
    this.midiOutChannel = 1; // canal 2 (índice 1): no se mezcla con lo que tocás vos (canal 1)
    this.midiOutNotes = new Set();
  }

  // --------------------------------------------------------------------------
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch (_) {
      this.ctx = new AC();
    }
    const ctx = this.ctx;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;
    this.compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.compressor);

    // Reverb suave de sala
    this.reverb = this.createReverb();
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.14;
    this.master.connect(this.reverb);
    this.reverb.connect(reverbGain);
    reverbGain.connect(this.compressor);

    for (const name of ['user', 'auto']) {
      const g = ctx.createGain();
      g.gain.value = this.volumes[name];
      g.connect(this.master);
      this.buses[name] = g;
    }
    const fx = ctx.createGain();
    fx.gain.value = this.volumes.fx * this.volumes.master;
    fx.connect(this.compressor);
    this.buses.fx = fx;

    this.loadSamples();
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  createReverb() {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 1.8);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    return conv;
  }

  setStatus(s) {
    this.sampleStatus = s;
    if (this.onStatusChange) this.onStatusChange(s);
  }

  async loadSamples() {
    if (this.sampleStatus !== 'idle' || !this.ctx) return;
    this.setStatus('loading');
    const base = 'https://tonejs.github.io/audio/salamander/';
    const list = [['A0', 21]];
    for (let o = 1; o <= 7; o++) {
      const c = 12 * (o + 1);
      list.push([`C${o}`, c], [`Ds${o}`, c + 3], [`Fs${o}`, c + 6], [`A${o}`, c + 9]);
    }
    list.push(['C8', 108]);

    // Primero las notas centrales (las que más se usan), después el resto
    list.sort((a, b) => Math.abs(a[1] - 62) - Math.abs(b[1] - 62));
    let ok = 0;
    const worker = async () => {
      while (list.length) {
        const [name, midi] = list.shift();
        try {
          const res = await fetch(base + name + '.mp3', { cache: 'force-cache' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.samples.set(midi, buf);
          this.sampleMidis = [...this.samples.keys()].sort((a, b) => a - b);
          ok++;
          // En cuanto tenemos las notas del centro ya podemos usarlas
          if (ok === 8 && this.sampleStatus === 'loading') this.setStatus('partial');
        } catch (_) {
          /* sin internet o bloqueado: seguimos con el sintetizador */
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.setStatus(ok >= 20 ? 'ready' : ok > 0 ? 'partial' : 'error');
  }

  usingSamples() {
    return (this.sampleStatus === 'ready' || this.sampleStatus === 'partial') && this.sampleMidis.length > 0;
  }

  // --------------------------------------------------------------------------
  // Volúmenes y opciones
  // --------------------------------------------------------------------------
  setVolume(name, v) {
    this.volumes[name] = Math.max(0, Math.min(1, v));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (name === 'master') {
      this.master.gain.setTargetAtTime(this.volumes.master, t, 0.02);
      this.buses.fx.gain.setTargetAtTime(this.volumes.fx * this.volumes.master, t, 0.02);
    } else if (name === 'fx') {
      this.buses.fx.gain.setTargetAtTime(this.volumes.fx * this.volumes.master, t, 0.02);
    } else if (this.buses[name]) {
      this.buses[name].gain.setTargetAtTime(this.volumes[name], t, 0.02);
    }
  }

  setUserSound(on) {
    this.userSound = on;
    if (!on) {
      for (const [key] of this.voices) if (key.startsWith('user:')) this.releaseKey(key, 0.05);
    }
  }

  setMidiOutput(output) {
    if (this.midiOut && this.midiOut !== output) this.midiOutAllOff();
    this.midiOut = output || null;
    if (this.midiOut) {
      try {
        // Program Change 0 = Piano de cola (General MIDI) en el canal del acompañamiento
        this.midiOut.send([0xc0 | this.midiOutChannel, 0]);
        // Volumen del canal (CC7)
        this.midiOut.send([0xb0 | this.midiOutChannel, 7, Math.round(this.volumes.auto * 127)]);
      } catch (_) {}
    }
  }

  // --------------------------------------------------------------------------
  // Voces
  // --------------------------------------------------------------------------
  nearestSample(midi) {
    const arr = this.sampleMidis;
    let best = arr[0];
    for (const m of arr) if (Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    return best;
  }

  createVoice(midi, velocity, when, busName) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const v = Math.max(0.05, Math.min(1, velocity / 127));
    const out = ctx.createGain();
    out.connect(this.buses[busName]);
    const sources = [];

    if (this.usingSamples()) {
      const ref = this.nearestSample(midi);
      const src = ctx.createBufferSource();
      src.buffer = this.samples.get(ref);
      src.playbackRate.value = Math.pow(2, (midi - ref) / 12);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900 + 17000 * v * v; // tocar fuerte = más brillo
      filter.Q.value = 0.3;
      out.gain.setValueAtTime(0.12 + 0.95 * Math.pow(v, 1.6), t);
      src.connect(filter);
      filter.connect(out);
      src.start(t);
      sources.push(src);
    } else {
      // Sintetizador de respaldo
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const amp = Math.pow(v, 1.4) * 0.38;
      const decay = Math.max(0.9, 4.2 - (midi - 36) * 0.045);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(amp, t + 0.006);
      out.gain.exponentialRampToValueAtTime(amp * 0.35, t + 0.25);
      out.gain.exponentialRampToValueAtTime(0.0008, t + decay);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(14000, freq * (3.5 + v * 7)), t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.6, 400), t + decay * 0.7);
      filter.connect(out);
      const partials = [
        ['triangle', 1, 1],
        ['sine', 2, 0.22 * v],
        ['sawtooth', 1.001, 0.12 * v]
      ];
      for (const [type, mult, g] of partials) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq * mult;
        const og = ctx.createGain();
        og.gain.value = g;
        osc.connect(og);
        og.connect(filter);
        osc.start(t);
        osc.stop(t + decay + 0.1);
        sources.push(osc);
      }
    }

    const voice = { out, sources, released: false, start: t };
    sources[0].onended = () => {
      try { out.disconnect(); } catch (_) {}
    };
    return voice;
  }

  releaseVoice(voice, at, timeConstant = 0.09) {
    if (!voice || voice.released || !this.ctx) return;
    voice.released = true;
    const t = Math.max(at, this.ctx.currentTime);
    const g = voice.out.gain;
    try {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, timeConstant);
      for (const s of voice.sources) s.stop(t + timeConstant * 8);
    } catch (_) {}
  }

  releaseKey(key, tc = 0.09) {
    const voice = this.voices.get(key);
    if (!voice) return;
    this.releaseVoice(voice, this.ctx.currentTime, tc);
    this.voices.delete(key);
  }

  // Tus teclas (MIDI / mouse / teclado de la PC)
  noteOn(midi, velocity = 95, bus = 'user') {
    if (bus === 'user' && !this.userSound) return;
    this.init();
    if (!this.ctx) return;
    const key = `${bus}:${midi}`;
    if (this.voices.has(key)) this.releaseKey(key, 0.02);
    this.sustained.delete(key);
    this.voices.set(key, this.createVoice(midi, velocity, this.ctx.currentTime, bus));
  }

  noteOff(midi, bus = 'user') {
    const key = `${bus}:${midi}`;
    if (bus === 'user' && this.sustain) {
      if (this.voices.has(key)) this.sustained.add(key);
      return;
    }
    if (this.ctx) this.releaseKey(key);
  }

  setSustain(down) {
    this.sustain = down;
    if (!down && this.ctx) {
      for (const key of this.sustained) this.releaseKey(key);
      this.sustained.clear();
    }
  }

  // Notas programadas de la mano automática / modo escuchar
  playScheduled(midi, velocity, when, duration) {
    this.init();
    if (!this.ctx) return;
    if (this.midiOut) {
      this.sendMidiNote(midi, velocity, when, duration);
      return;
    }
    const voice = this.createVoice(midi, velocity, when, 'auto');
    this.releaseVoice(voice, when + Math.max(0.08, duration * 0.96), 0.12);
    voice.released = false; // seguimos pudiendo cortarla si se pausa
    voice.endAt = when + duration;
    this.autoVoices.add(voice);
    voice.sources[0].addEventListener('ended', () => this.autoVoices.delete(voice));
  }

  sendMidiNote(midi, velocity, when, duration) {
    const toPerf = t => performance.now() + Math.max(0, (t - this.ctx.currentTime) * 1000);
    const ch = this.midiOutChannel;
    try {
      this.midiOut.send([0x90 | ch, midi, Math.max(1, Math.min(127, velocity | 0))], toPerf(when));
      this.midiOut.send([0x80 | ch, midi, 0], toPerf(when + Math.max(0.05, duration * 0.96)));
      this.midiOutNotes.add(midi);
    } catch (_) {}
  }

  midiOutAllOff() {
    if (!this.midiOut) return;
    const ch = this.midiOutChannel;
    try {
      if (this.midiOut.clear) this.midiOut.clear(); // descarta notas programadas a futuro
      for (const m of this.midiOutNotes) this.midiOut.send([0x80 | ch, m, 0]);
      this.midiOut.send([0xb0 | ch, 123, 0]); // All Notes Off
    } catch (_) {}
    this.midiOutNotes.clear();
  }

  stopAuto() {
    if (this.ctx) {
      const t = this.ctx.currentTime;
      for (const v of this.autoVoices) {
        if (v.start > t) {
          // Todavía no empezó a sonar: la cancelamos sin que llegue a sonar
          try { for (const s of v.sources) s.stop(t); } catch (_) {}
          continue;
        }
        v.released = false;
        this.releaseVoice(v, t, 0.05);
      }
    }
    this.autoVoices.clear();
    this.midiOutAllOff();
  }

  allNotesOff() {
    this.stopAuto();
    if (!this.ctx) return;
    for (const key of [...this.voices.keys()]) this.releaseKey(key, 0.05);
    this.sustained.clear();
  }

  // --------------------------------------------------------------------------
  // Metrónomo y sonidos de recompensa
  // --------------------------------------------------------------------------
  click(accent = false, when) {
    this.init();
    if (!this.ctx) return;
    const t = Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(accent ? 0.5 : 0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(g);
    g.connect(this.buses.fx);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  chime(kind = 'success') {
    this.init();
    if (!this.ctx) return;
    const seqs = {
      success: [72, 76, 79, 84],
      lap: [79, 84],
      star: [76, 79, 84, 88, 91]
    };
    const notes = seqs[kind] || seqs.success;
    const t0 = this.ctx.currentTime + 0.02;
    notes.forEach((m, i) => {
      const t = t0 + i * 0.07;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
      osc.connect(g);
      g.connect(this.buses.fx);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }
}

window.PianoAudioEngine = PianoAudioEngine;
