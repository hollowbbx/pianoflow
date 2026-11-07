// ============================================================================
// PianoFlow — Motor principal
//
//  Modos de práctica (en este orden se aprende cada canción):
//   Escuchar   La PC toca todo. Ver y oír antes de tocar.
//   Aprender   El tiempo se frena en cada nota hasta que la tocás (sin ritmo).
//   Con ritmo  El tiempo sigue. Se mide si llegás a tiempo (Perfecto/Bien/Temprano/Tarde).
//
//  Además: manos separadas con acompañamiento, repetir tramo con subida automática
//  de velocidad, estrellas por canción, racha diaria, pentagrama de ayuda,
//  grabador, importar/exportar MIDI y salida del acompañamiento al teclado.
// ============================================================================
(function () {
  'use strict';

  const MT = window.MusicTheory;
  const LIB = window.PianoFlowLibrary;
  const audio = new window.PianoAudioEngine();

  // --------------------------------------------------------------------------
  // Constantes
  // --------------------------------------------------------------------------
  const COLORS = {
    R: { main: '#c9a35a', light: '#ddb978', pale: '#f2e4c2', dark: '#7f6330' },
    L: { main: '#6f93b8', light: '#93b2d1', pale: '#d5e2ee', dark: '#47698c' }
  };
  const AMBER = '#cf6e4c';
  const VISIBLE_SEC = 3.0; // segundos de canción visibles en pantalla
  const LEARN_EARLY = 0.25; // en Aprender, se acepta la nota un poquito antes de que llegue
  const CHORD_EPS = 0.06; // notas a menos de 60 ms se consideran un acorde
  const WIN = { perfect: 0.07, good: 0.14, ok: 0.24 }; // ventanas de tiempo (segundos reales)
  const HAND_NAME = { R: 'mano derecha', L: 'mano izquierda' };

  // --------------------------------------------------------------------------
  // Almacenamiento local
  // --------------------------------------------------------------------------
  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? def : JSON.parse(v);
      } catch (_) {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch (_) {
        return false;
      }
    }
  };

  const DEFAULT_SETTINGS = {
    noteNames: 'es', barLabel: 'both', keyLabels: 'all', showStaff: 'on', range: 'auto', effects: 'on',
    userSound: 'on', otherHand: 'play', autoOut: 'pc', midiChannel: 'all', octaveShift: '0', pcKeyboard: 'on',
    dailyGoal: '10', pianoNav: 'on', autoNext: 'on', sheetMusic: 'off', vol: { master: 0.85, auto: 0.7, fx: 0.7 },
    mode: 'learn', speed: 1, metronome: false, loopAutoSpeed: true, lastSong: null, welcomed: false, display: 'falling'
  };
  const settings = Object.assign({}, DEFAULT_SETTINGS, store.get('pf2_settings', {}));
  settings.vol = Object.assign({}, DEFAULT_SETTINGS.vol, settings.vol || {});
  const saveSettings = () => store.set('pf2_settings', settings);

  const progress = Object.assign({ songs: {}, days: {}, goalToast: null, reading: {}, today: null }, store.get('pf2_progress', {}));
  if (!progress.reading || typeof progress.reading !== 'object') progress.reading = {};
  const saveProgress = () => store.set('pf2_progress', progress);

  // Las grabaciones/importaciones viejas se conservan (misma clave que la versión anterior)
  let customSongs = store.get('pianoflow_custom_songs', []);
  if (!Array.isArray(customSongs)) customSongs = [];
  customSongs = customSongs.filter(s => s && Array.isArray(s.notes) && s.notes.length);
  const saveCustom = () => {
    if (!store.set('pianoflow_custom_songs', customSongs)) {
      toast('No hay más espacio para guardar canciones. Borrá alguna importada o grabada.', 'warn');
    }
  };

  // --------------------------------------------------------------------------
  // Estado
  // --------------------------------------------------------------------------
  const S = {
    song: null,
    mode: ['listen', 'learn', 'rhythm'].includes(settings.mode) ? settings.mode : 'learn',
    hand: 'both',
    speed: Math.min(1.5, Math.max(0.25, Number(settings.speed) || 1)),
    playing: false,
    time: 0,
    frameTs: 0,
    lastTs: 0,
    autoIdx: 0,
    userIdx: 0,
    waiting: false,
    waitTime: 0,
    waitGroup: [],
    waitSince: 0,
    autoHi: [],
    autoFx: [],
    nextBeat: null,
    metronome: !!settings.metronome,
    loop: { on: false, a: 0, b: 0, startBar: 1, endBar: 4, laps: 0, clean: 0 },
    lap: null,
    run: null,
    totals: { user: 0 },
    userKeys: new Map(),
    wrong: null,
    octaveSlips: { offset: 0, count: 0, warned: false },
    popups: [],
    particles: [],
    record: { mode: 'off' },
    range: { min: 36, max: 96 },
    geom: [],
    view: { W: 1, H: 1, PW: 1, PH: 1 },
    lastActivity: 0,
    practiceDirty: 0,
    staffSig: '',
    midiAccess: null,
    midiOutput: null,
    midiKnown: new Set(),
    pcBase: 60,
    pcDown: new Map(),
    pointerNotes: new Map(),
    drag: null,
    audioHintShown: false,
    activeStep: null,
    display: settings.display === 'sheet' && settings.sheetMusic === 'on' ? 'sheet' : 'falling', // 'falling' (notas que caen) o 'sheet' (partitura)
    hintOverride: null // el plan apaga ayudas: null | 'finger' (sin nombres) | 'none'
  };

  // --------------------------------------------------------------------------
  // DOM
  // --------------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const stageCanvas = $('stageCanvas');
  const stageCtx = stageCanvas.getContext('2d');
  const pianoCanvas = $('pianoCanvas');
  const pianoCtx = pianoCanvas.getContext('2d');
  const staffCanvas = $('staffCanvas');
  const staffCtx = staffCanvas.getContext('2d');
  const stageEl = $('stage');

  const ui = {
    songTitle: $('songTitle'), songKicker: $('songKicker'), songStars: $('songStars'),
    dailyChip: $('dailyChip'), streakText: $('streakText'), dailyFill: $('dailyFill'), dailyText: $('dailyText'),
    midiBadge: $('midiBadge'), midiText: $('midiText'),
    btnPlay: $('btnPlay'), btnRestart: $('btnRestart'), btnLoop: $('btnLoop'), btnMetronome: $('btnMetronome'),
    btnRecord: $('btnRecord'), btnSettings: $('btnSettings'), btnLibrary: $('btnLibrary'),
    speedRange: $('speedRange'), speedValue: $('speedValue'),
    barDisplay: $('barDisplay'), timeDisplay: $('timeDisplay'), timeline: $('timeline'),
    timelineTicks: $('timelineTicks'), timelineFill: $('timelineFill'), loopRegion: $('loopRegion'), timelineSelect: $('timelineSelect'),
    chordCard: $('chordCard'), chordName: $('chordName'), chordType: $('chordType'),
    staffCard: $('staffCard'), lessonConcept: $('lessonConcept'), lessonTip: $('lessonTip'),
    statCombo: $('statCombo'), statAcc: $('statAcc'), statNotes: $('statNotes'),
    loopInfo: $('loopInfo'), loopText: $('loopText'), loopAutoSpeed: $('loopAutoSpeed'),
    centerMessage: $('centerMessage'), centerTitle: $('centerTitle'), centerSub: $('centerSub'),
    waitHint: $('waitHint'), recordBanner: $('recordBanner'), toasts: $('toasts'),
    libraryList: $('libraryList'), fileInput: $('fileInput'),
    resStars: $('resStars'), resTitle: $('resTitle'), resSubtitle: $('resSubtitle'), resGrid: $('resGrid'),
    resGoal: $('resGoal'), resNext: $('resNext'), resRetry: $('resRetry'), resClose: $('resClose'),
    saveDesc: $('saveDesc'), saveTitle: $('saveTitle'),
    soundStatus: $('soundStatus'), midiDevices: $('midiDevices'),
    stepsRow: $('stepsRow'), stepDots: $('stepDots'), stepLabel: $('stepLabel'), stepSub: $('stepSub'), btnStepGo: $('btnStepGo'),
    homeToday: $('homeToday'),
    readerLevels: $('readerLevels'), readerDesc: $('readerDesc'), readerCanvas: $('readerCanvas'), readerOverlay: $('readerOverlay'),
    readerCount: $('readerCount'), readerFeedback: $('readerFeedback'), readerPace: $('readerPace'), readerStart: $('readerStart')
  };

  // --------------------------------------------------------------------------
  // Utilidades
  // --------------------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ICO_PLAY = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>';
  const ICO_PAUSE = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.8h3v10.4H4zM9 2.8h3v10.4H9z" fill="currentColor"/></svg>';
  const sheetOn = () => settings.sheetMusic === 'on';
  const IS_TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const pct = x => Math.round(x * 100) + '%';
  const round5 = x => Math.round(x * 20) / 20;
  const fmtTime = sec => {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function lowerBound(notes, t) {
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].time < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function anyModalOpen() {
    return !!document.querySelector('.modal.open');
  }

  // --------------------------------------------------------------------------
  // Avisos (toasts)
  // --------------------------------------------------------------------------
  function toast(text, kind = '', opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    const span = document.createElement('span');
    span.innerHTML = text;
    el.appendChild(span);
    if (opts.action) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = opts.action.label;
      b.addEventListener('click', () => {
        opts.action.fn();
        el.remove();
      });
      el.appendChild(b);
    }
    ui.toasts.appendChild(el);
    while (ui.toasts.children.length > 3) ui.toasts.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
    }, opts.ms || (opts.action ? 9000 : 2800));
  }

  // --------------------------------------------------------------------------
  // Biblioteca
  // --------------------------------------------------------------------------
  const allSongs = () => [...LIB.BUILTIN_SONGS, ...(LIB.TECHNIQUE || []), ...customSongs];
  const findSong = id => allSongs().find(s => s.id === id);

  function prepareSong(raw) {
    const bpm = raw.bpm || 120;
    const [num, den] = Array.isArray(raw.timeSig) ? raw.timeSig : [4, 4];
    const spq = 60 / bpm;
    const beatSec = (spq * 4) / den;
    const barSec = beatSec * num;
    const pickupSec = (raw.pickup || 0) * spq;
    const notes = raw.notes
      .filter(n => Number.isFinite(n.midi) && Number.isFinite(n.time))
      .map((n, i) => ({
        id: i,
        midi: n.midi | 0,
        time: Math.max(0, n.time),
        duration: Math.max(0.05, n.duration || 0.3),
        hand: n.hand === 'L' ? 'L' : 'R',
        finger: n.finger || null,
        velocity: n.velocity || 90,
        status: 'pending',
        judge: null,
        hitAt: 0
      }))
      .sort((a, b) => a.time - b.time || a.midi - b.midi);
    let end = 0;
    let minMidi = 127;
    let maxMidi = 0;
    let maxDur = 0;
    const hands = new Set();
    for (const n of notes) {
      end = Math.max(end, n.time + n.duration);
      minMidi = Math.min(minMidi, n.midi);
      maxMidi = Math.max(maxMidi, n.midi);
      maxDur = Math.max(maxDur, n.duration);
      hands.add(n.hand);
    }
    return {
      raw, id: raw.id, title: raw.title, bpm, num, den, beatSec, barSec, pickupSec, notes,
      endTime: end, duration: end + 0.8, minMidi, maxMidi, maxDur, hands,
      hasBothHands: hands.size > 1,
      firstBar: pickupSec > 0 ? 0 : 1,
      numBars: Math.max(1, Math.ceil((end - pickupSec) / barSec - 1e-6))
    };
  }

  const barStart = b => (b <= 0 ? 0 : S.song.pickupSec + (b - 1) * S.song.barSec);
  function barAt(t) {
    const s = S.song;
    if (t < s.pickupSec) return s.firstBar;
    return clamp(Math.floor((t - s.pickupSec) / s.barSec + 1e-6) + 1, s.firstBar, s.numBars);
  }

  function selectSong(id) {
    selectRaw(findSong(id) || LIB.BUILTIN_SONGS[0]);
  }

  function selectRaw(raw) {
    pause();
    audio.allNotesOff();
    S.song = prepareSong(raw);
    if (!raw.isFreePiano) {
      settings.lastSong = raw.id;
      saveSettings();
    }
    if (S.hand !== 'both' && !S.song.hands.has(S.hand)) S.hand = 'both';
    S.loop.on = false;
    computeRange();
    computeGeometry();
    buildTimelineTicks();
    syncControls();
    updateSongHeader();
    S.activeStep = null;
    S.hintOverride = null;
    S.display = sheetOn() ? settings.display : 'falling';
    applyDisplay();
    seek(startTime());
    S.staffSig = '';
    updateStepper();
  }

  function updateSongHeader() {
    const raw = S.song.raw;
    const idx = LIB.BUILTIN_SONGS.indexOf(raw);
    ui.songKicker.textContent = idx >= 0 ? `Lección ${idx + 1}` : raw.technique ? 'Técnica' : raw.isCustom ? 'Mía' : 'Canción';
    ui.songTitle.textContent = raw.title;
    ui.songStars.textContent = starString((progress.songs[raw.id] || {}).stars || 0);
    ui.lessonConcept.textContent = raw.concept || `${raw.artist || ''}`;
    ui.lessonTip.textContent = raw.tip || '';
    document.title = `${raw.title} · PianoFlow`;
  }

  const starString = n => '★'.repeat(n) + '☆'.repeat(3 - n);

  function recommendedSong() {
    return LIB.BUILTIN_SONGS.find(s => ((progress.songs[s.id] || {}).stars || 0) < 2) || null;
  }

  // --------------------------------------------------------------------------
  // Plan guiado de cada lección: pasos cortos, como en una clase
  //  escuchar → aprender por partes (cada mano y después juntas) → con ritmo 60/80/100 %
  // --------------------------------------------------------------------------
  const STEP_LEARN_ACC = 0.8;
  const RHYTHM_STEPS = [[0.6, 0.75], [0.8, 0.8], [1, 0.9]]; // [velocidad, precisión mínima]
  const planCache = new Map();

  function lessonPlan(song) {
    if (planCache.has(song.id)) return planCache.get(song.id);
    const steps = [{ id: 'listen', mode: 'listen', hand: 'both', speed: 1, part: null, minAcc: 0, icon: '', label: 'Escuchar', sub: 'la PC la toca entera: escuchá y mirá las manos' }];
    // Canciones largas: en partes de ~8 compases (aprender en pedacitos y después unir)
    const count = song.numBars - song.firstBar + 1;
    const parts = [];
    if (count >= 12) {
      const n = clamp(Math.ceil(count / 8), 2, 4);
      const len = Math.ceil(count / n);
      for (let a = song.firstBar; a <= song.numBars; a += len) parts.push([a, Math.min(song.numBars, a + len - 1)]);
    } else {
      parts.push(null);
    }
    const hands = song.hasBothHands ? ['R', 'L', 'both'] : ['both'];
    // Cuántas notas tiene cada mano en cada parte (una parte sin notas de esa mano no genera paso: quedaría un tramo vacío girando)
    const barOf = t => (t < song.pickupSec ? song.firstBar : Math.floor((t - song.pickupSec) / song.barSec + 1e-6) + 1);
    const notesIn = (p, h) => song.notes.filter(n => (h === 'both' || n.hand === h) && (!p || (barOf(n.time) >= p[0] && barOf(n.time) <= p[1]))).length;
    parts.forEach((p, pi) => {
      for (const h of hands) {
        if (!notesIn(p, h)) continue;
        const partTxt = p ? `Parte ${pi + 1}` : '';
        const handTxt = h === 'both' ? (song.hasBothHands ? 'manos juntas' : '') : HAND_NAME[h];
        const label = [partTxt, handTxt].filter(Boolean).join(', ') || 'Aprender las notas';
        const bars = p ? `compases ${Math.max(1, p[0])}–${p[1]}` : 'toda la canción';
        steps.push({ id: `learn-${p ? p.join('_') : 'all'}-${h}`, mode: 'learn', hand: h, speed: 1, part: p, minAcc: STEP_LEARN_ACC, icon: '', label, sub: `${bars}; las notas te esperan` });
      }
    });
    // Las ayudas se van apagando: al 80% sin nombres de notas, al 100% sin ayudas
    const HINTS = { 0.6: null, 0.8: 'finger', 1: 'none' };
    const HINT_TXT = { finger: ', sin nombres de notas', none: ', sin ayudas' };
    for (const [sp, acc] of RHYTHM_STEPS) {
      const hints = HINTS[sp] || null;
      steps.push({
        id: `rhythm-${Math.round(sp * 100)}`, mode: 'rhythm', hand: 'both', speed: sp, part: null, minAcc: acc, icon: '', hints,
        label: `Con ritmo al ${pct(sp)}`, sub: `toda la canción${song.hasBothHands ? ', manos juntas' : ''}; meta ${pct(acc)}${hints ? HINT_TXT[hints] : ''}`
      });
    }
    // Último paso: tocarla leyendo la partitura, como un pianista (solo si elegiste aprender a leer)
    if (sheetOn()) steps.push({
      id: 'sheet-100', mode: 'rhythm', hand: 'both', speed: 1, part: null, minAcc: 0.85, icon: '', hints: 'none', display: 'sheet',
      label: 'Leyendo la partitura', sub: 'sin notas que caen, solo el pentagrama; meta 85%'
    });
    planCache.set(song.id, steps);
    return steps;
  }

  const planForRaw = raw => (planCache.has(raw.id) ? planCache.get(raw.id) : lessonPlan(S.song && S.song.raw === raw ? S.song : prepareSong(raw)));
  const stepIsDone = (songId, st) => !!(((progress.songs[songId] || {}).steps || {})[st.id]);
  const nextStepIdx = (songId, plan) => plan.findIndex(st => !stepIsDone(songId, st));
  const stepsDoneCount = (songId, plan) => plan.filter(st => stepIsDone(songId, st)).length;
  // Próximo paso pendiente después de 'from' (si no hay, el primero pendiente)
  function nextStepAfter(songId, plan, from) {
    for (let i = from + 1; i < plan.length; i++) if (!stepIsDone(songId, plan[i])) return i;
    return nextStepIdx(songId, plan);
  }

  // ¿Lo que acaba de tocar cumple este paso?  cov = { mode, hand, speed, acc, from, to, full }
  function stepCovered(st, cov) {
    if (st.mode !== cov.mode) return false;
    if (st.mode === 'listen') return cov.full;
    const hand = S.song.hasBothHands ? cov.hand : 'both';
    if (st.hand === 'both' ? hand !== 'both' : hand !== 'both' && hand !== st.hand) return false;
    if (st.part) {
      if (!cov.full && (cov.from > st.part[0] || cov.to < st.part[1])) return false;
    } else if (!cov.full) {
      return false;
    }
    if (st.mode === 'rhythm' && cov.speed < st.speed - 1e-6) return false;
    if (st.display === 'sheet' && cov.display !== 'sheet') return false;
    return cov.acc >= st.minAcc;
  }

  // Marca los pasos cumplidos y devuelve los nuevos
  function completeSteps(cov) {
    if (S.free) return [];
    const song = S.song;
    const plan = lessonPlan(song);
    const rec = progress.songs[song.id] || (progress.songs[song.id] = { stars: 0, plays: 0 });
    rec.steps = rec.steps || {};
    const today = dayKey(new Date());
    const fresh = [];
    plan.forEach((st, i) => {
      if (rec.steps[st.id] || !stepCovered(st, cov)) return;
      rec.steps[st.id] = today;
      fresh.push(st);
      // Tocarla bien con ritmo demuestra que los pasos anteriores ya están
      if (st.mode === 'rhythm') for (let j = 0; j < i; j++) if (!rec.steps[plan[j].id]) rec.steps[plan[j].id] = today;
    });
    if (fresh.length) {
      todayRec().lesson = true;
      saveProgress();
      updateStepper();
    }
    return fresh;
  }

  function stepMatchesCurrent(st) {
    if (!S.song) return false;
    const hand = S.song.hasBothHands ? S.hand : 'both';
    if (S.mode !== st.mode || hand !== st.hand) return false;
    if (st.part ? !(S.loop.on && S.loop.startBar === st.part[0] && S.loop.endBar === st.part[1]) : S.loop.on) return false;
    if (st.display === 'sheet' && S.display !== 'sheet') return false;
    if ((st.hints || null) !== S.hintOverride) return false;
    return st.mode !== 'rhythm' || Math.abs(S.speed - st.speed) < 0.01;
  }

  function applyStep(i, opts = {}) {
    if (!S.song) return;
    const plan = lessonPlan(S.song);
    const st = plan[i];
    if (!st) return;
    pause();
    S.activeStep = i;
    S.mode = st.mode;
    settings.mode = st.mode;
    saveSettings();
    S.hand = st.hand === 'both' || S.song.hands.has(st.hand) ? st.hand : 'both';
    S.display = st.display || (sheetOn() ? settings.display : 'falling');
    S.hintOverride = st.hints || null;
    applyDisplay();
    if (st.mode !== 'learn') setSpeed(st.speed);
    if (st.part) setLoop(st.part[0], st.part[1]);
    else S.loop.on = false;
    seek(startTime());
    syncControls();
    if (!opts.quiet) toast(`Paso ${i + 1} de ${plan.length}: <b>${st.label}</b> (${st.sub})`, '', { ms: 4500 });
    if (opts.autoplay && st.mode === 'listen') play();
  }

  function updateStepper() {
    if (!S.song) return;
    if (S.free) {
      ui.stepDots.innerHTML = '';
      ui.stepLabel.textContent = S.freeEmpty ? 'Piano libre' : `Tocar libre: ${S.song.title}`;
      ui.stepSub.textContent = S.freeEmpty ? 'Sin canción: tocá lo que quieras. Con Grabar lo guardás.' : 'Sin plan ni puntaje: a tu ritmo, cambiá modo y velocidad cuando quieras.';
      ui.btnStepGo.textContent = 'Salir de tocar libre';
      ui.btnStepGo.dataset.action = 'exitFree';
      ui.btnStepGo.classList.remove('hidden');
      return;
    }
    const song = S.song;
    const plan = lessonPlan(song);
    const active = S.activeStep != null && plan[S.activeStep] && !stepIsDone(song.id, plan[S.activeStep]) ? S.activeStep : null;
    const focus = active != null ? active : nextStepAfter(song.id, plan, S.activeStep != null ? S.activeStep : -1);
    ui.stepDots.innerHTML = plan
      .map((st, i) => {
        const done = stepIsDone(song.id, st);
        const cls = ['step-dot', done ? 'done' : '', i === focus ? 'focus' : '', st.mode].join(' ');
        return `<button class="${cls}" data-step="${i}" title="${i + 1}. ${escapeHtml(st.label)} (${escapeHtml(st.sub)})${done ? ' ✓' : ''}">${done ? '✓' : i + 1}</button>`;
      })
      .join('');
    if (focus < 0) {
      ui.stepLabel.textContent = '✓ Lección completa';
      ui.stepSub.textContent = 'Volvé a tocarla en unos días (aparece en Repaso) para que quede en la memoria.';
      const nextSong = nextLessonAfter(song.id);
      ui.btnStepGo.textContent = nextSong ? 'Siguiente lección' : 'Inicio';
      ui.btnStepGo.dataset.action = nextSong ? 'nextSong' : 'home';
      ui.btnStepGo.classList.remove('hidden');
      return;
    }
    const st = plan[focus];
    ui.stepLabel.textContent = `Paso ${focus + 1} de ${plan.length}: ${st.label}`;
    ui.stepSub.textContent = st.sub;
    ui.btnStepGo.textContent = 'Hacer este paso';
    ui.btnStepGo.dataset.action = 'step';
    ui.btnStepGo.dataset.step = focus;
    ui.btnStepGo.classList.toggle('hidden', stepMatchesCurrent(st));
  }

  function nextLessonAfter(id) {
    const list = LIB.BUILTIN_SONGS;
    const idx = list.findIndex(s => s.id === id);
    if (idx >= 0 && idx < list.length - 1) return list[idx + 1];
    const rec = recommendedSong();
    return rec && rec.id !== id ? rec : null;
  }

  // Tocar libre: una pieza sin plan ni puntaje, o el piano solo (sin canción)
  const FREE_PIANO = { id: '__piano_libre', title: 'Piano libre', artist: '', bpm: 100, notes: [], isFreePiano: true };
  function openFree(id) {
    S.free = true;
    S.freeEmpty = !id;
    document.body.classList.add('free-mode');
    document.body.classList.toggle('free-empty', S.freeEmpty);
    if (id) {
      selectSong(id);
      if (S.mode === 'listen') setMode('learn');
    } else {
      selectRaw(FREE_PIANO);
    }
    updateStepper();
    updateCenterMessage();
    toast(id ? 'Tocar libre: sin plan ni puntaje. Tocá cualquier tecla para empezar.' : 'Piano libre: tocá lo que quieras.', '', { ms: 4000 });
  }
  function exitFree() {
    S.free = false;
    S.freeEmpty = false;
    document.body.classList.remove('free-mode', 'free-empty');
    const back = findSong(settings.lastSong) && settings.lastSong !== FREE_PIANO.id ? settings.lastSong : (recommendedSong() || LIB.BUILTIN_SONGS[0]).id;
    openLesson(back);
  }

  // Abre una lección en su próximo paso pendiente
  function openLesson(id, opts = {}) {
    if (S.free) {
      S.free = false;
      S.freeEmpty = false;
      document.body.classList.remove('free-mode', 'free-empty');
    }
    selectSong(id);
    const plan = lessonPlan(S.song);
    const i = nextStepIdx(S.song.id, plan);
    applyStep(i >= 0 ? i : plan.length - 1, { autoplay: opts.autoplay });
  }

  // Práctica de hoy (rutina de clase: lectura → lección → repaso)
  function todayRec() {
    const k = dayKey(new Date());
    if (!progress.today || progress.today.day !== k) progress.today = { day: k, read: false, lesson: false, review: false };
    return progress.today;
  }

  // Escala del día: la primera que todavía no está en ★★; si ya están todas, rota por día
  function scaleOfTheDay() {
    const T = LIB.TECHNIQUE || [];
    if (!T.length) return null;
    const pending = T.find(s => ((progress.songs[s.id] || {}).stars || 0) < 2);
    if (pending) return pending;
    const day = Math.floor(Date.now() / 864e5);
    return T[day % T.length];
  }

  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  // Repaso espaciado: la canción ya aprendida (★★) que hace más tiempo no tocás (2 días o más)
  function reviewCandidate(excludeId) {
    const today = dayKey(new Date());
    let best = null;
    for (const s of LIB.BUILTIN_SONGS.concat(customSongs)) {
      const p = progress.songs[s.id];
      if (!p || (p.stars || 0) < 2 || !p.last || s.id === excludeId) continue;
      const age = daysBetween(p.last, today);
      if (age >= 2 && (!best || age > best.age)) best = { song: s, age };
    }
    return best;
  }

  // --------------------------------------------------------------------------
  // Motor de práctica
  // --------------------------------------------------------------------------
  const isUserNote = n => S.mode !== 'listen' && (S.hand === 'both' || n.hand === S.hand);

  function newRun(fromStart) {
    return {
      fromStart, hits: 0, errors: 0, perfect: 0, good: 0, ok: 0, missed: 0, extras: 0, combo: 0, maxCombo: 0, barErr: {}, started: performance.now(),
      fb: { off: { R: [], L: [] }, vel: { R: [], L: [] }, held: [], waits: [], waitBar: {} } // para los comentarios del profe
    };
  }
  const newLap = () => ({ hits: 0, errors: 0, missed: 0, extras: 0 });

  function prerollSec() {
    const s = S.song;
    if (S.mode === 'rhythm') return s.barSec <= 3.2 ? s.barSec : s.beatSec * 2;
    return 1.4;
  }

  function startTime() {
    return (S.loop.on ? S.loop.a : 0) - prerollSec();
  }

  function computeTotals() {
    if (!S.song) return;
    const a = S.loop.on ? S.loop.a - 1e-4 : -1;
    const b = S.loop.on ? S.loop.b - 1e-4 : Infinity;
    let user = 0;
    for (const n of S.song.notes) if (n.time >= a && n.time < b && isUserNote(n)) user++;
    S.totals.user = user;
  }

  function seek(time, opts = {}) {
    if (!S.song) return;
    audio.stopAuto();
    S.time = time;
    S.waiting = false;
    S.waitGroup = [];
    for (const n of S.song.notes) {
      n.status = n.time < time - 1e-4 ? 'skipped' : 'pending';
      n.judge = null;
      n.hitAt = 0;
    }
    S.autoIdx = S.userIdx = lowerBound(S.song.notes, time - 1e-4);
    S.autoHi = [];
    S.autoFx = [];
    S.nextBeat = null;
    S.wrong = null;
    hideWaitHint();
    if (!opts.keepRun) {
      S.run = newRun(time <= 0.001 && !S.loop.on);
      S.lap = newLap();
    }
    computeTotals();
    updateHud();
    updateTimeline();
    updateCenterMessage();
    S.staffSig = '';
  }

  function play() {
    if (!S.song || S.record.mode !== 'off' || S.playing) return;
    audio.init();
    if (S.time >= S.song.duration - 0.01) seek(startTime());
    S.playing = true;
    S.nextBeat = null;
    S.frameTs = performance.now();
    markActivity();
    document.body.classList.add('is-playing');
    updatePlayButton();
  }

  function pause() {
    if (!S.playing) return;
    S.playing = false;
    // Las notas automáticas que estaban programadas "a futuro" vuelven a quedar pendientes
    const notes = S.song.notes;
    for (let i = S.autoIdx - 1; i >= 0 && notes[i].time > S.time; i--) {
      if (notes[i].status === 'auto') notes[i].status = 'pending';
      S.autoIdx = i;
    }
    S.autoHi = S.autoHi.filter(h => h.from <= S.time);
    S.autoFx = S.autoFx.filter(n => n.time <= S.time);
    audio.stopAuto();
    document.body.classList.remove('is-playing');
    updatePlayButton();
    updateCenterMessage();
  }

  const togglePlay = () => (S.playing ? pause() : play());

  function restart() {
    if (!S.song) return;
    pause();
    seek(startTime());
    play();
  }

  function nextPendingUserNote() {
    const notes = S.song.notes;
    while (S.userIdx < notes.length) {
      const n = notes[S.userIdx];
      if (n.status === 'pending' && isUserNote(n)) return n;
      S.userIdx++;
    }
    return null;
  }

  const IDLE_PAUSE_MS = 20000;
  function update(dt) {
    if (!S.playing || !S.song) return;
    const song = S.song;

    // Con ritmo la canción no espera: si nadie toca durante 20 s, pausamos (no sigue sonando sola ni suma minutos)
    if (S.mode === 'rhythm' && S.record.mode === 'off' && performance.now() - S.lastActivity > IDLE_PAUSE_MS && (S.idleMisses || 0) >= 4) {
      pause();
      toast('Pausé porque no llegaron notas tuyas. Tocá cualquier tecla para seguir desde acá.', 'warn', { ms: 8000 });
      return;
    }

    if (S.mode === 'learn') {
      if (!S.waiting) {
        const next = S.time + dt * S.speed;
        const target = nextPendingUserNote();
        if (target && next >= target.time) {
          S.time = target.time;
          beginWait(target);
        } else {
          S.time = next;
        }
      }
    } else {
      S.time += dt * S.speed;
    }

    // Programar la mano automática con 100 ms de anticipación (ritmo preciso)
    let limit = S.time + 0.1 * S.speed;
    if (S.mode === 'learn') {
      const t = S.waiting ? S.waitTime : (nextPendingUserNote() || { time: Infinity }).time;
      limit = Math.min(limit, t - 0.001);
    }
    processAuto(limit);
    processAutoFx();
    if (S.mode === 'rhythm') checkMisses();
    scheduleMetronome();

    if (S.loop.on) {
      if (S.time >= S.loop.b) onLoopLap();
    } else if (S.time >= song.duration) {
      finishSong();
    }
  }

  function processAuto(limit) {
    const notes = S.song.notes;
    const muted = S.mode !== 'listen' && settings.otherHand === 'mute';
    while (S.autoIdx < notes.length && notes[S.autoIdx].time <= limit) {
      const n = notes[S.autoIdx++];
      if (n.status !== 'pending' || isUserNote(n)) continue;
      n.status = 'auto';
      if (S.time - n.time > 0.3) continue;
      const when = audio.now() + Math.max(0, (n.time - S.time) / S.speed);
      if (!muted) audio.playScheduled(n.midi, n.velocity, when, n.duration / S.speed);
      S.autoHi.push({ midi: n.midi, hand: n.hand, from: n.time, until: n.time + n.duration });
      S.autoFx.push(n);
    }
  }

  function processAutoFx() {
    while (S.autoFx.length && S.autoFx[0].time <= S.time) {
      const n = S.autoFx.shift();
      n.hitAt = performance.now();
      if (S.mode === 'listen') spawnParticles(n.midi, COLORS[n.hand].light, 6);
    }
    if (S.autoHi.length > 64 || (S.autoHi.length && S.autoHi[0].until < S.time)) {
      S.autoHi = S.autoHi.filter(h => h.until > S.time);
    }
  }

  function checkMisses() {
    const notes = S.song.notes;
    const late = S.time - WIN.ok * S.speed;
    while (S.userIdx < notes.length && notes[S.userIdx].time < late) {
      const n = notes[S.userIdx++];
      if (n.status === 'pending' && isUserNote(n)) {
        n.status = 'missed';
        S.run.missed++;
        S.lap.missed++;
        S.idleMisses = (S.idleMisses || 0) + 1;
        noteBarError(n.time);
        breakCombo();
      }
    }
  }

  function scheduleMetronome() {
    const s = S.song;
    const countInEnd = S.loop.on ? S.loop.a : 0;
    const countIn = S.mode === 'rhythm' && S.time < countInEnd;
    if ((!S.metronome && !countIn) || S.waiting) {
      S.nextBeat = null;
      return;
    }
    if (S.nextBeat === null) S.nextBeat = Math.ceil((S.time - s.pickupSec) / s.beatSec - 1e-6);
    const ahead = S.time + 0.1 * S.speed;
    for (let guard = 0; guard < 16; guard++) {
      const bt = s.pickupSec + S.nextBeat * s.beatSec;
      if (bt > ahead) break;
      if (bt >= S.time - 0.02 && (S.metronome || bt < countInEnd - 1e-3)) {
        const accent = ((S.nextBeat % s.num) + s.num) % s.num === 0;
        audio.click(accent, audio.now() + Math.max(0, (bt - S.time) / S.speed));
      }
      S.nextBeat++;
    }
  }

  // ---------- Modo Aprender: espera ----------
  function beginWait(target) {
    S.waiting = true;
    S.waitTime = target.time;
    S.waitSince = performance.now();
    S.waitGroup = [];
    const notes = S.song.notes;
    for (let i = S.userIdx; i < notes.length && notes[i].time <= target.time + CHORD_EPS; i++) {
      const n = notes[i];
      if (n.status === 'pending' && isUserNote(n)) S.waitGroup.push(n);
    }
    showWaitHint();
    S.staffSig = '';
  }

  function checkWaitDone() {
    const rem = S.waitGroup.filter(n => n.status === 'pending');
    if (rem.length === 0) {
      const w = Math.min(15000, performance.now() - S.waitSince);
      const b = barAt(S.waitTime);
      S.run.fb.waits.push(w);
      (S.run.fb.waitBar[b] = S.run.fb.waitBar[b] || []).push(w);
      S.waiting = false;
      S.waitGroup = [];
      S.wrong = null;
      hideWaitHint();
      S.staffSig = '';
    } else {
      showWaitHint();
    }
  }

  // ---------- Entrada del usuario ----------
  function preciseTime() {
    if (!S.playing || S.waiting) return S.time;
    return S.time + Math.min(0.05, (performance.now() - S.frameTs) / 1000) * S.speed;
  }

  function onUserNoteOn(midi, velocity) {
    if (midi < 0 || midi > 127) return;
    S.userKeys.set(midi, { vel: velocity, t: performance.now(), verdict: null, hand: midi >= 60 ? 'R' : 'L' });
    audio.noteOn(midi, velocity, 'user');
    if (audio.ctx && audio.ctx.state !== 'running' && !S.audioHintShown) {
      S.audioHintShown = true;
      toast('Hacé clic en cualquier parte de la página para activar el sonido de la PC.', 'warn', { ms: 6000 });
    }
    markActivity();
    updateChord();

    if (S.record.mode !== 'off') {
      recordNoteOn(midi, velocity);
      return;
    }
    if (readerOpen()) {
      readerPress(midi);
      return;
    }
    if (chordsOpen()) {
      chordInput(midi);
      return;
    }
    if (anyModalOpen()) {
      pianoNav(MT.isBlackKey(midi) ? 'secondary' : 'primary');
      return;
    }
    if (!S.song) return;

    if (S.freeEmpty) {
      if (settings.effects === 'on') spawnParticles(midi, COLORS[midi >= 60 ? 'R' : 'L'].light, 6);
      return;
    }
    // Tocar cualquier tecla arranca la canción (no hace falta soltar el piano para usar el mouse)
    if (!S.playing && S.mode !== 'listen' && !anyModalOpen()) {
      play();
      // Si estaba en pausa esperando justo esta nota, la contamos
      if (S.playing && S.mode === 'learn' && S.waiting) learnPress(midi, S.time);
      return;
    }
    if (!S.playing || S.mode === 'listen') {
      if (settings.effects === 'on') spawnParticles(midi, COLORS[midi >= 60 ? 'R' : 'L'].light, 6);
      return;
    }
    const t = preciseTime();
    if (S.mode === 'learn') learnPress(midi, t);
    else rhythmPress(midi, t);
  }

  function onUserNoteOff(midi) {
    const key = S.userKeys.get(midi);
    if (!key) return;
    if (key.note && S.mode === 'rhythm' && S.playing && S.run && key.note.duration / S.speed >= 0.3) {
      S.run.fb.held.push((preciseTime() - key.hitSong) / key.note.duration);
    }
    S.userKeys.delete(midi);
    audio.noteOff(midi, 'user');
    updateChord();
    if (chordsOpen()) chordInput(null);
    if (S.record.mode === 'recording') recordNoteOff(midi);
  }

  function learnPress(midi, t) {
    let cand = null;
    if (S.waiting) {
      cand = S.waitGroup.find(n => n.midi === midi && n.status === 'pending') || null;
    } else {
      const notes = S.song.notes;
      for (let i = S.userIdx; i < notes.length && notes[i].time <= t + LEARN_EARLY; i++) {
        const n = notes[i];
        if (n.midi === midi && n.status === 'pending' && isUserNote(n)) {
          cand = n;
          break;
        }
      }
    }
    if (cand) {
      registerHit(cand, 'learn');
      if (S.waiting) checkWaitDone();
    } else if (S.waiting) {
      registerLearnMistake(midi);
    }
  }

  function rhythmPress(midi, t) {
    const notes = S.song.notes;
    const win = WIN.ok * S.speed;
    let best = null;
    let bestD = Infinity;
    for (let i = lowerBound(notes, t - win); i < notes.length && notes[i].time <= t + win; i++) {
      const n = notes[i];
      if (n.midi !== midi || n.status !== 'pending' || !isUserNote(n)) continue;
      const d = Math.abs(n.time - t);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    if (best) {
      const dtReal = (t - best.time) / S.speed;
      const a = Math.abs(dtReal);
      const judge = a <= WIN.perfect ? 'perfect' : a <= WIN.good ? 'good' : dtReal < 0 ? 'early' : 'late';
      registerHit(best, judge, dtReal);
    } else {
      S.run.extras++;
      S.lap.extras++;
      noteBarError(t);
      breakCombo();
      const k = S.userKeys.get(midi);
      if (k) k.verdict = 'wrong';
      S.wrong = { midi, target: null, t: performance.now() };
      updateHud();
    }
  }

  const JUDGE_TEXT = {
    perfect: ['¡Perfecto!', '#e6c15e'],
    good: ['Bien', '#ddb978'],
    early: ['Temprano', '#b3cbe2'],
    late: ['Tarde', '#e2a07f']
  };

  function registerHit(n, judge, dtReal = null) {
    n.status = 'hit';
    const fbk = S.userKeys.get(n.midi);
    if (fbk) {
      S.run.fb.vel[n.hand].push(fbk.vel);
      fbk.note = n;
      fbk.hitSong = preciseTime();
    }
    if (dtReal !== null) S.run.fb.off[n.hand].push(dtReal);
    n.judge = judge;
    n.hitAt = performance.now();
    S.run.hits++;
    S.lap.hits++;
    if (judge === 'perfect' || judge === 'good') S.run[judge]++;
    else if (judge === 'early' || judge === 'late') S.run.ok++;
    S.run.combo++;
    S.run.maxCombo = Math.max(S.run.maxCombo, S.run.combo);
    S.octaveSlips.count = 0;
    const k = S.userKeys.get(n.midi);
    if (k) {
      k.verdict = 'ok';
      k.hand = n.hand;
    }
    if (settings.effects === 'on') spawnParticles(n.midi, COLORS[n.hand].light, judge === 'perfect' ? 18 : 12);
    if (JUDGE_TEXT[judge]) addPopup(n.midi, ...JUDGE_TEXT[judge]);
    const c = S.run.combo;
    if (c === 10 || c === 25 || c === 50 || c % 100 === 0) {
      addPopup(n.midi, `${c} seguidas`, '#e6c15e', 1.4, true);
    }
    updateHud(true);
    S.staffSig = '';
  }

  function registerLearnMistake(midi) {
    S.run.errors++;
    S.lap.errors++;
    noteBarError(S.waitTime);
    breakCombo();
    const rem = S.waitGroup.filter(n => n.status === 'pending');
    if (!rem.length) return;
    let target = rem[0];
    for (const n of rem) if (Math.abs(n.midi - midi) < Math.abs(target.midi - midi)) target = n;
    const k = S.userKeys.get(midi);
    if (k) k.verdict = 'wrong';
    S.wrong = { midi, target: target.midi, t: performance.now() };
    showWaitHint(midi, target.midi);
    checkOctaveSlip(midi, target.midi);
    updateHud();
  }

  // Si tocás siempre la nota correcta pero una octava corrida, probablemente el
  // teclado tiene activado OCTAVE o TRANSPOSE (pasa mucho en los Yamaha PSR).
  function checkOctaveSlip(midi, target) {
    const diff = target - midi;
    const o = S.octaveSlips;
    if (diff !== 0 && diff % 12 === 0) {
      o.count = o.offset === diff ? o.count + 1 : 1;
      o.offset = diff;
    } else {
      o.count = 0;
    }
    if (o.count >= 3 && !o.warned) {
      o.warned = true;
      const oct = diff / 12;
      toast(
        `Venís tocando las notas bien pero ${Math.abs(oct)} octava${Math.abs(oct) > 1 ? 's' : ''} ${oct > 0 ? 'más grave' : 'más aguda'}. ¿Tu teclado tiene activado <b>Octave</b> o <b>Transpose</b>? Podés corregirlo en el teclado o acá.`,
        'warn',
        {
          action: {
            label: 'Corregir acá',
            fn: () => {
              settings.octaveShift = String(clamp((Number(settings.octaveShift) || 0) + oct, -2, 2));
              saveSettings();
              syncSettingsUI();
              toast(`Corrección de octava: ${settings.octaveShift > 0 ? '+' : ''}${settings.octaveShift}. Se cambia en Ajustes.`, 'good');
            }
          },
          ms: 14000
        }
      );
    }
  }

  function breakCombo() {
    S.run.combo = 0;
  }

  function noteBarError(t) {
    if (!S.song) return;
    const b = barAt(Math.max(0, t));
    S.run.barErr[b] = (S.run.barErr[b] || 0) + 1;
  }

  // ---------- Repetir tramo ----------
  function setLoop(b1, b2, opts = {}) {
    const s = S.song;
    S.loop.goal = opts.goal || 0;
    S.loop.returnStep = opts.goal ? S.activeStep : null;
    S.loop.warned = false;
    const lo = clamp(Math.min(b1, b2), s.firstBar, s.numBars);
    const hi = clamp(Math.max(b1, b2), s.firstBar, s.numBars);
    S.loop.on = true;
    S.loop.startBar = lo;
    S.loop.endBar = hi;
    S.loop.a = barStart(lo);
    S.loop.b = Math.min(barStart(hi + 1), s.endTime + 0.3);
    S.loop.laps = 0;
    S.loop.clean = 0;
    const wasPlaying = S.playing;
    pause();
    seek(S.loop.a - prerollSec());
    if (wasPlaying) play();
    updateLoopUI();
  }

  function clearLoop() {
    S.loop.on = false;
    computeTotals();
    updateLoopUI();
    if (S.run) S.run.fromStart = false;
  }

  function toggleLoop() {
    if (!S.song) return;
    if (S.loop.on) {
      clearLoop();
      toast('Tramo desactivado: la canción sigue entera');
      return;
    }
    const b = barAt(Math.max(0, S.time));
    const span = S.song.barSec < 2 ? 4 : 2;
    setLoop(b, b + span - 1);
    toast(`Repitiendo compases ${S.loop.startBar}–${S.loop.endBar}. Consejo: arrastrá en la línea de tiempo para elegir otro tramo.`, '', { ms: 4000 });
  }

  function onLoopLap() {
    const L = S.lap;
    const total = S.totals.user;
    S.loop.laps++;
    if (S.mode !== 'listen' && total === 0) {
      exitLoop('En ese tramo no hay notas para la mano elegida: volvimos a la canción entera.');
      return;
    }
    if (S.mode !== 'listen' && total > 0) {
      const acc = S.mode === 'learn' ? L.hits / Math.max(1, L.hits + L.errors) : L.hits / Math.max(1, total + L.extras);
      let msg = `Vuelta ${S.loop.laps}: ${pct(acc)}`;
      let kind = '';
      if (acc >= 0.9) {
        S.loop.clean++;
        kind = 'good';
        msg += ' ✓';
        if (S.mode === 'rhythm' && settings.loopAutoSpeed && S.speed < 1 - 1e-6) {
          setSpeed(Math.min(1, S.speed + 0.05));
          msg += `, subimos a ${pct(S.speed)}`;
        }
      } else {
        S.loop.clean = 0;
        if (acc < 0.6 && S.speed > 0.4 && S.mode === 'rhythm') msg += '. Bajá la velocidad: primero la precisión.';
      }
      const fresh = completeSteps({ mode: S.mode, hand: S.hand, speed: S.speed, acc, from: S.loop.startBar, to: S.loop.endBar, full: false, display: S.display });
      if (fresh.length) {
        S.lap = newLap();
        seek(S.loop.a - prerollSec(), { keepRun: true });
        S.run.fromStart = false;
        pause();
        showStepComplete(fresh, acc);
        return;
      }
      // Meta del tramo cumplida: se vuelve sola a la canción (o al paso del plan)
      const goal = loopGoal();
      if (S.loop.clean >= goal && (S.loop.goal || S.mode !== 'rhythm' || !settings.loopAutoSpeed || S.speed >= 1 - 1e-6)) {
        exitLoop(`Tramo dominado ✓ (${S.loop.clean} vueltas seguidas sin errores). Volvemos a la canción entera: tocá cualquier tecla para seguir.`);
        audio.chime('star');
        return;
      }
      if (S.loop.laps >= 6 && S.loop.clean === 0 && !S.loop.warned) {
        S.loop.warned = true;
        toast('Este tramo está costando. Probá más lento, o salí y volvé a escuchar la canción.', 'warn', { action: { label: 'Salir del tramo', fn: () => exitLoop() }, ms: 10000 });
      } else {
        toast(msg, kind);
      }
    }
    audio.chime('lap');
    S.lap = newLap();
    seek(S.loop.a - (S.mode === 'rhythm' ? S.song.beatSec : 0.6), { keepRun: true });
    S.run.fromStart = false;
    updateLoopUI();
  }

  // --------------------------------------------------------------------------
  // "El profe te escucha": comentarios como los de un profesor, a partir de
  // CÓMO tocaste (pulso, volumen de cada mano, legato), no solo de qué notas.
  // --------------------------------------------------------------------------
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const sdev = a => {
    const m = mean(a);
    return Math.sqrt(mean(a.map(x => (x - m) * (x - m))));
  };
  const median = a => {
    if (!a.length) return 0;
    const b = [...a].sort((x, y) => x - y);
    return b[Math.floor(b.length / 2)];
  };

  function teacherNotes(run, mode) {
    const fb = run.fb;
    if (!fb) return [];
    const out = []; // { p: prioridad, icon, text }
    const both = S.song && S.song.hasBothHands;

    if (mode === 'rhythm') {
      const offs = fb.off.R.concat(fb.off.L);
      if (offs.length >= 8) {
        const m = mean(offs) * 1000;
        const sd = sdev(offs) * 1000;
        if (m <= -28) {
          out.push({ p: 9, icon: '', text: `Tendés a <b>apurarte</b>: llegás en promedio ${Math.round(-m)} ms antes del pulso. Contá en voz alta y "esperá" cada nota; el metrónomo ayuda mucho.` });
        } else if (m >= 28) {
          out.push({ p: 9, icon: '', text: `Tendés a <b>atrasarte</b> ${Math.round(m)} ms. Mirá la nota que viene antes de que llegue y prepará la mano en el aire.` });
        }
        if (sd >= 70) {
          out.push({ p: 8, icon: '', text: `El pulso sale <b>irregular</b> (±${Math.round(sd)} ms). Bajá un 10% la velocidad y prendé el metrónomo: primero parejo, después rápido.` });
        } else if (Math.abs(m) < 28) {
          out.push({ p: 2, icon: '', text: `Tu pulso está muy firme (±${Math.round(sd)} ms). Es lo más difícil de lograr: ¡muy bien!` });
        }
      }
      if (both && fb.off.R.length >= 5 && fb.off.L.length >= 5) {
        const d = (mean(fb.off.L) - mean(fb.off.R)) * 1000;
        if (Math.abs(d) >= 40) {
          out.push({ p: 7, icon: '', text: `Las manos no caen juntas: la izquierda llega ${Math.round(Math.abs(d))} ms ${d < 0 ? 'antes' : 'después'} que la derecha. Practicá los compases con las dos manos, muy lento, buscando que suenen como una sola.` });
        }
      }
      if (fb.held.length >= 6) {
        const h = median(fb.held);
        if (h < 0.45) {
          out.push({ p: 6, icon: '', text: 'Soltás las teclas antes de tiempo y suena entrecortado. Mantené cada tecla hasta tocar la siguiente: eso es tocar <b>legato</b>.' });
        }
      }
    }

    // Volumen: solo si el teclado manda la fuerza (los teclados sensibles al toque sí; el mouse no)
    const allVel = fb.vel.R.concat(fb.vel.L);
    if (allVel.length >= 8 && sdev(allVel) >= 2) {
      if (both && fb.vel.R.length >= 5 && fb.vel.L.length >= 5) {
        const r = mean(fb.vel.R);
        const l = mean(fb.vel.L);
        if (l > r + 12) {
          out.push({ p: 7, icon: '', text: 'Tu <b>mano izquierda suena más fuerte</b> que la derecha. La melodía tiene que "cantar" por encima: acompañamiento más suave.' });
        }
      }
      const hands = ['R', 'L'].filter(h => fb.vel[h].length >= 8);
      const worst = hands.map(h => ({ h, sd: sdev(fb.vel[h]) })).sort((a, b) => b.sd - a.sd)[0];
      if (worst && worst.sd >= 17) {
        out.push({ p: 5, icon: '', text: `El volumen de la ${HAND_NAME[worst.h]} sale <b>desparejo</b>: algunas notas suenan golpeadas. Dedos curvos y peso del brazo, sin golpear; buscá que todas suenen igual.` });
      } else if (mean(allVel) > 112) {
        out.push({ p: 4, icon: '', text: 'Estás tocando todo muy fuerte. Suele ser tensión: aflojá hombros y muñecas, y dejá caer el peso del brazo.' });
      } else if (worst && worst.sd < 9 && mode === 'rhythm') {
        out.push({ p: 1, icon: '', text: 'El toque sale muy parejo. ¡Eso suena a pianista!' });
      }
    }

    if (mode === 'learn' && fb.waits.length >= 5) {
      const med = median(fb.waits) / 1000;
      let slowBar = null;
      for (const [b, arr] of Object.entries(fb.waitBar)) {
        const m = mean(arr) / 1000;
        if (m > 2.5 && (!slowBar || m > slowBar.m)) slowBar = { b: Number(b), m };
      }
      if (slowBar) {
        out.push({ p: 6, icon: '', text: `Donde más dudaste fue en el <b>compás ${slowBar.b}</b> (${slowBar.m.toFixed(1)} s por nota). Practicalo solo hasta tocarlo 3 veces seguidas sin parar.` });
      } else if (med < 1.2) {
        out.push({ p: 3, icon: '', text: 'Ya encontrás las notas rápido. Estás listo para tocarla <b>con ritmo</b>.' });
      }
    }

    return out.sort((a, b) => b.p - a.p).slice(0, 3);
  }

  // Registro de sesiones (para el informe semanal)
  function logSession(result) {
    const fb = result.run.fb;
    const offs = fb ? fb.off.R.concat(fb.off.L) : [];
    const entry = {
      d: dayKey(new Date()),
      s: S.song.id,
      m: result.mode,
      h: result.hand,
      sp: result.speed,
      a: Math.round(result.acc * 100) / 100
    };
    if (offs.length >= 8) {
      entry.tm = Math.round(mean(offs) * 1000);
      entry.ts = Math.round(sdev(offs) * 1000);
    }
    progress.log = (progress.log || []).concat(entry).slice(-400);
  }

  // ---------- Fin de la canción ----------
  function runAccuracy(run) {
    if (S.mode === 'learn') return run.hits / Math.max(1, run.hits + run.errors);
    return run.hits / Math.max(1, S.totals.user + run.extras);
  }

  function finishSong() {
    pause();
    if (S.free) {
      seek(startTime());
      toast('Fin. Tocá cualquier tecla para tocarla otra vez, o elegí otra pieza.', 'good', { ms: 5000 });
      return;
    }
    const run = S.run;
    const song = S.song;
    if (S.mode === 'listen' || S.totals.user === 0 || run.hits + run.missed + run.errors === 0) {
      seek(startTime());
      if (S.mode === 'listen') {
        if (run.fromStart) completeSteps({ mode: 'listen', full: true });
        const plan = lessonPlan(song);
        const ni = nextStepIdx(song.id, plan);
        if (ni >= 0 && plan[ni].mode !== 'listen') {
          const st = plan[ni];
          applyStep(ni, { quiet: true });
          toast(`¡Listo! Ahora, paso ${ni + 1}: <b>${st.label}</b>. Tocá cualquier tecla para empezar.`, 'good', { ms: 7000 });
        } else {
          toast('¡Listo! Ahora probala en Aprender.', 'good', { action: { label: 'Ir a Aprender', fn: () => setMode('learn') } });
        }
      }
      return;
    }
    const acc = runAccuracy(run);
    const fullHands = S.hand === 'both' || !song.hasBothHands;
    const result = { mode: S.mode, hand: S.hand, speed: S.speed, acc, fullHands, fromStart: run.fromStart, run };
    result.passedSteps = run.fromStart ? completeSteps({ mode: S.mode, hand: S.hand, speed: S.speed, acc, full: true, display: S.display }) : [];
    logSession(result);

    let stars = 0;
    if (run.fromStart) {
      stars = 1;
      if (S.mode === 'rhythm' && fullHands && acc >= 0.75 && S.speed >= 0.5 - 1e-6) stars = 2;
      if (S.mode === 'rhythm' && fullHands && acc >= 0.9 && S.speed >= 1 - 1e-6) stars = 3;
    }
    const rec = progress.songs[song.id] || { stars: 0, plays: 0 };
    const prevStars = rec.stars || 0;
    rec.plays = (rec.plays || 0) + 1;
    rec.last = dayKey(new Date());
    rec.stars = Math.max(prevStars, stars);
    if (S.mode === 'rhythm' && fullHands) rec.bestAcc = Math.max(rec.bestAcc || 0, acc);
    // Repasar una canción que ya sabías (★★) cuenta como el repaso del día
    if (prevStars >= 2 && run.fromStart && S.mode === 'rhythm') todayRec().review = true;
    progress.songs[song.id] = rec;
    saveProgress();
    updateSongHeader();

    showResults(result, stars, prevStars);
    seek(startTime());
  }

  function worstBars(run) {
    const entries = Object.entries(run.barErr).map(([b, c]) => [Number(b), c]);
    if (!entries.length) return null;
    let best = null;
    for (const [b] of entries) {
      const c = (run.barErr[b] || 0) + (run.barErr[b + 1] || 0);
      if (!best || c > best.c) best = { from: b, to: Math.min(b + 1, S.song.numBars), c };
    }
    return best && best.c >= 2 ? best : null;
  }

  function nextGoal(result) {
    const { mode, acc, fullHands, fromStart, run, speed } = result;
    const song = S.song;
    if (run.hits + run.errors + run.extras === 0) {
      return { text: 'No llegó ninguna nota tuya. Si estabas tocando, revisá que el teclado esté conectado (indicador arriba a la derecha).', label: 'Probar otra vez', fn: restart, noAuto: true };
    }
    if (!fromStart) {
      return { text: 'Para ganar estrellas tocala de principio a fin, sin saltar ni usar "Repetir tramo".', label: 'Desde el principio', fn: restart };
    }
    const worst = worstBars(run);
    if (mode === 'learn') {
      if (acc < 0.8 && worst) {
        return {
          text: `Lo que más costó fueron los compases <b>${worst.from}–${worst.to}</b>. Repetí solo ese tramo un par de veces y después volvé a la canción entera.`,
          label: `Practicar compases ${worst.from}–${worst.to}`,
          fn: () => { setLoop(worst.from, worst.to, { goal: 2 }); play(); }
        };
      }
      if (acc < 0.8) return { text: 'Una vuelta más en Aprender. Mirá el número de dedo en cada nota: usar siempre los mismos dedos es lo que la hace salir sola.', label: 'Otra vez en Aprender', fn: restart };
      if (!fullHands) {
        const other = S.hand === 'R' ? 'L' : 'R';
        return { text: `¡Muy bien con la ${HAND_NAME[S.hand]}! Ahora la ${HAND_NAME[other]} sola, y después las dos juntas.`, label: `Probar ${HAND_NAME[other]}`, fn: () => { setHand(other); restart(); } };
      }
      return { text: 'Ya sabés qué notas van. Ahora tocala <b>con ritmo</b>: empezá al 60% de velocidad. La precisión importa más que la velocidad.', label: 'Con ritmo al 60%', fn: () => { setMode('rhythm'); setSpeed(0.6); restart(); } };
    }
    if (!fullHands) {
      return { text: 'Excelente con una mano. El gran salto es juntar las dos: primero en Aprender, despacio.', label: 'Ambas manos en Aprender', fn: () => { setHand('both'); setMode('learn'); restart(); } };
    }
    if (acc < 0.75) {
      const ns = Math.max(0.3, round5(speed - 0.1));
      if (worst) {
        return { text: `Los compases <b>${worst.from}–${worst.to}</b> son el punto difícil. Repetilos al ${pct(ns)}; la velocidad va a subir sola cada vez que te salga bien.`, label: `Compases ${worst.from}–${worst.to} al ${pct(ns)}`, fn: () => { setSpeed(ns); setLoop(worst.from, worst.to, { goal: 2 }); play(); } };
      }
      return { text: `Bajá un poco: probá al ${pct(ns)}. Lento y bien enseña más que rápido y mal.`, label: `Repetir al ${pct(ns)}`, fn: () => { setSpeed(ns); restart(); } };
    }
    if (speed < 1 - 1e-6) {
      const ns = Math.min(1, round5(speed + 0.1));
      return { text: `¡Bien! Subí la velocidad al ${pct(ns)}.`, label: `Repetir al ${pct(ns)}`, fn: () => { setSpeed(ns); restart(); } };
    }
    if (acc < 0.9) {
      if (worst) {
        return { text: `Ya estás a velocidad normal. Para la 3ª estrella (90%), puleá los compases <b>${worst.from}–${worst.to}</b>.`, label: `Compases ${worst.from}–${worst.to}`, fn: () => { setLoop(worst.from, worst.to, { goal: 2 }); play(); } };
      }
      return { text: 'Ya estás a velocidad normal. Buscá el 90% para la 3ª estrella.', label: 'Otra vez', fn: restart };
    }
    const list = LIB.BUILTIN_SONGS;
    const idx = list.findIndex(s => s.id === song.id);
    const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : recommendedSong();
    if (next && next.id !== song.id) {
      return { text: `¡Canción dominada! Seguí con <b>${escapeHtml(next.title)}</b>. Volvé a esta en unos días para que quede en la memoria de largo plazo.`, label: 'Siguiente canción', fn: () => { selectSong(next.id); setMode('listen'); } };
    }
    return { text: '¡Canción dominada! Probá grabar tu propia versión o importar un MIDI de una canción que te guste.', label: 'Tocarla otra vez', fn: restart };
  }

  // Si se cumplió un paso del plan, el próximo paso es el siguiente del plan
  function stepGoal(passed) {
    if (!passed || !passed.length) return null;
    const plan = lessonPlan(S.song);
    const ni = nextStepAfter(S.song.id, plan, Math.max(...passed.map(p => plan.indexOf(p))));
    if (ni < 0) return null;
    const st = plan[ni];
    const names = passed.map(p => `${p.label}`).join(', ');
    return {
      text: `Paso cumplido: <b>${escapeHtml(names)}</b>.<br>Siguiente: <b>${escapeHtml(st.label)}</b> (${escapeHtml(st.sub)}).`,
      label: `Paso ${ni + 1}: ${st.label}`,
      fn: () => applyStep(ni)
    };
  }

  function renderTeacher(notes) {
    const el = $('resTeacher');
    el.classList.toggle('hidden', !notes.length);
    el.innerHTML = notes.length
      ? `<div class="teacher-label">Lo que escuché</div>${notes.map(n => `<div class="teacher-note"><p>${n.text}</p></div>`).join('')}`
      : '';
  }

  function showStepComplete(passed, acc) {
    ui.resStars.innerHTML = '<span class="on">✓</span>';
    ui.resTitle.textContent = '¡Paso cumplido!';
    ui.resSubtitle.textContent = passed.map(p => `${p.label}`).join(', ');
    ui.resGrid.innerHTML = `<div class="res-item"><b>${pct(acc)}</b><span>Precisión</span></div><div class="res-item"><b>${S.loop.laps}</b><span>Vueltas</span></div>`;
    renderTeacher(teacherNotes(S.run, S.mode));
    const plan = lessonPlan(S.song);
    const goal = stepGoal(passed) || {
      text: nextStepIdx(S.song.id, plan) < 0 ? '¡Lección completa! ' : 'Seguí con el plan de la lección.',
      label: 'Seguir',
      fn: () => updateStepper()
    };
    ui.resGoal.innerHTML = goal.text;
    ui.resNext.textContent = goal.label;
    ui.resNext.onclick = () => {
      closeModal('resultsModal');
      goal.fn();
    };
    openModal('resultsModal');
    startAutoNext(10);
    audio.chime('star');
  }

  function showResults(result, stars, prevStars) {
    const { run, acc, mode } = result;
    ui.resStars.innerHTML = [1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : 'off'}">★</span>`).join('');
    const titles = ['¡Terminaste!', '¡Bien hecho!', '¡Muy bien!', '¡Excelente!'];
    ui.resTitle.textContent = titles[stars];
    const handTxt = !S.song.hasBothHands ? '' : result.hand === 'both' ? ', ambas manos' : `, ${HAND_NAME[result.hand]}`;
    let sub = `${mode === 'learn' ? 'Aprender' : 'Con ritmo'}${handTxt}, velocidad ${pct(result.speed)}`;
    if (stars > prevStars) sub = `Nueva estrella. ${sub}`;
    ui.resSubtitle.textContent = sub;
    const items = [[pct(acc), 'Precisión'], [run.maxCombo, 'Racha máx.']];
    if (mode === 'rhythm') {
      items.push([run.perfect, 'Perfectos'], [run.missed, 'Sin tocar']);
      if (run.extras) items.push([run.extras, 'Teclas de más']);
    } else {
      items.push([run.errors, 'Correcciones']);
    }
    items.push([fmtTime((performance.now() - run.started) / 1000), 'Tiempo']);
    ui.resGrid.innerHTML = items.map(([v, l]) => `<div class="res-item"><b>${v}</b><span>${l}</span></div>`).join('');
    renderTeacher(teacherNotes(run, mode));
    const goal = stepGoal(result.passedSteps) || nextGoal(result);
    ui.resGoal.innerHTML = goal.text;
    ui.resNext.textContent = goal.label;
    ui.resNext.onclick = () => {
      closeModal('resultsModal');
      goal.fn();
    };
    openModal('resultsModal');
    // La cuenta regresiva solo si tocaste algo (si no estás, no avanza solo)
    if (!goal.noAuto) startAutoNext($('resTeacher').classList.contains('hidden') ? 8 : 14);
    audio.chime(stars > prevStars ? 'star' : 'success');
  }

  // --------------------------------------------------------------------------
  // Controles (modo, manos, velocidad, metrónomo)
  // --------------------------------------------------------------------------
  function setMode(m) {
    if (!['listen', 'learn', 'rhythm'].includes(m)) return;
    const wasPlaying = S.playing;
    pause();
    S.mode = m;
    settings.mode = m;
    saveSettings();
    if (S.song) seek(S.time <= 0.001 ? startTime() : S.time);
    syncControls();
    if (wasPlaying) play();
  }

  function setHand(h) {
    if (S.song && h !== 'both' && !S.song.hands.has(h)) return;
    const wasPlaying = S.playing;
    pause();
    S.hand = h;
    if (S.song) seek(S.time <= 0.001 ? startTime() : S.time);
    syncControls();
    if (wasPlaying) play();
  }

  function setSpeed(v) {
    S.speed = clamp(round5(v), 0.25, 1.5);
    settings.speed = S.speed;
    saveSettings();
    ui.speedRange.value = Math.round(S.speed * 100);
    ui.speedValue.textContent = pct(S.speed);
    updateStepper();
  }

  function syncControls() {
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === S.mode));
    document.querySelectorAll('#handSeg button').forEach(b => {
      const h = b.dataset.hand;
      b.classList.toggle('active', h === S.hand);
      b.disabled = !!S.song && h !== 'both' && !S.song.hands.has(h);
    });
    ui.btnMetronome.classList.toggle('active', S.metronome);
    setSpeed(S.speed);
    updateLoopUI();
    updatePlayButton();
    updateCenterMessage();
  }

  function updatePlayButton() {
    const atStart = !S.song || S.time <= startTime() + 0.01;
    ui.btnPlay.innerHTML = S.playing ? `${ICO_PAUSE}Pausa` : `${ICO_PLAY}${atStart ? 'Empezar' : 'Seguir'}`;
    ui.btnPlay.classList.toggle('playing', S.playing);
  }

  function updateCenterMessage() {
    if (S.freeEmpty) {
      ui.centerTitle.textContent = 'Piano libre';
      ui.centerSub.textContent = 'Tocá lo que quieras: acá vas a ver qué nota o acorde estás tocando.';
      return;
    }
    const msgs = {
      listen: ['Apretá Empezar para escuchar', 'Escuchá y mirá la canción entera antes de tocarla: tu cerebro aprende el "mapa" primero.'],
      learn: ['Tocá cualquier tecla para empezar', 'Las notas se frenan y te esperan. Usá el dedo que indica el número de cada nota.'],
      rhythm: ['Tocá cualquier tecla para empezar', 'Primero suena un compás de cuenta. Si te perdés, no frenes: seguí con la próxima nota.']
    };
    const [t, s] = msgs[S.mode];
    ui.centerTitle.textContent = t;
    ui.centerSub.textContent = s;
  }

  const loopGoal = () => S.loop.goal || 3;

  // Salir del tramo repetido: vuelve al paso del plan que estabas haciendo, o a la canción entera
  function exitLoop(message) {
    const back = S.loop.returnStep;
    pause();
    S.loop.goal = 0;
    S.loop.returnStep = null;
    S.loop.warned = false;
    if (back != null && S.song && lessonPlan(S.song)[back]) applyStep(back, { quiet: true });
    else {
      clearLoop();
      seek(startTime());
    }
    updateLoopUI();
    toast(message || 'Saliste del tramo: seguís con la canción entera.', message ? 'good' : '', { ms: 6500 });
  }

  function updateLoopUI() {
    updateStepper();
    ui.btnLoop.classList.toggle('active', S.loop.on);
    ui.loopInfo.classList.toggle('visible', S.loop.on);
    ui.loopAutoSpeed.checked = !!settings.loopAutoSpeed;
    if (S.loop.on) {
      ui.loopText.textContent = `Compases ${S.loop.startBar}–${S.loop.endBar}: ${S.loop.clean} de ${loopGoal()} vueltas sin errores`;
    }
    updateTimeline();
  }

  // --------------------------------------------------------------------------
  // HUD
  // --------------------------------------------------------------------------
  function updateHud(pop = false) {
    const run = S.run;
    if (!run) return;
    ui.statCombo.textContent = run.combo;
    if (pop) {
      ui.statCombo.classList.add('pop');
      setTimeout(() => ui.statCombo.classList.remove('pop'), 120);
    }
    // En vivo se mide sobre lo que ya pasó (no sobre el total de la canción)
    const attempts = S.mode === 'learn' ? run.hits + run.errors : run.hits + run.missed + run.extras;
    ui.statAcc.textContent = S.mode === 'listen' || attempts === 0 ? '—' : pct(run.hits / attempts);
    ui.statNotes.textContent = S.mode === 'listen' ? '—' : `${S.loop.on ? S.lap.hits : run.hits}/${S.totals.user}`;
  }

  function updateChord() {
    const keys = [...S.userKeys.keys()];
    if (!keys.length) {
      ui.chordCard.classList.add('chord-card-dim');
      return;
    }
    ui.chordCard.classList.remove('chord-card-dim');
    const c = MT.detectChord(keys);
    if (c) {
      ui.chordName.textContent = c.name;
      ui.chordType.textContent = c.type;
      // En el piano libre, el acorde se ve grande en el centro
      if (S.freeEmpty) {
        ui.centerTitle.textContent = c.name;
        ui.centerSub.textContent = c.type;
      }
    }
  }

  function showWaitHint(wrongMidi = null, targetMidi = null) {
    const rem = S.waitGroup.filter(n => n.status === 'pending');
    if (!rem.length) return hideWaitHint();
    const el = ui.waitHint;
    const nm = m => MT.name(m, settings.noteNames, true);
    el.classList.add('visible');
    el.classList.toggle('left', rem.every(n => n.hand === 'L'));
    if (wrongMidi !== null) {
      el.classList.add('wrong');
      el.innerHTML = directionText(wrongMidi, targetMidi);
      return;
    }
    el.classList.remove('wrong');
    const hands = new Set(rem.map(n => n.hand));
    const handTxt = hands.size === 1 ? `, ${HAND_NAME[rem[0].hand]}` : ', las dos manos';
    if (rem.length === 1) {
      const f = rem[0].finger ? ` con el dedo <b>${rem[0].finger}</b>` : '';
      el.innerHTML = `Tocá <b>${nm(rem[0].midi)}</b>${f}${handTxt}`;
    } else {
      el.innerHTML = `Tocá juntas: <b>${rem.map(n => nm(n.midi)).join(' + ')}</b>${handTxt}`;
    }
  }

  function directionText(wrong, target) {
    const nm = m => MT.name(m, settings.noteNames, true);
    if (MT.pc(wrong) === MT.pc(target)) {
      const oct = Math.round((target - wrong) / 12);
      return `Tocaste ${nm(wrong)}: es la nota correcta, pero en otra octava. ${oct > 0 ? 'Subí' : 'Bajá'} ${Math.abs(oct)} octava${Math.abs(oct) > 1 ? 's' : ''} ${oct > 0 ? '→' : '←'}`;
    }
    const dir = target > wrong ? 'a la derecha →' : '← a la izquierda';
    let dist;
    if (!MT.isBlackKey(wrong) && !MT.isBlackKey(target)) {
      const s = Math.abs(MT.whiteKeySteps(wrong, target));
      dist = `${s} tecla${s > 1 ? 's' : ''} blanca${s > 1 ? 's' : ''}`;
    } else {
      const s = Math.abs(target - wrong);
      dist = `${s} tecla${s > 1 ? 's' : ''} contando las negras`;
    }
    const black = MT.isBlackKey(target) ? ' (es una tecla negra)' : '';
    return `Tocaste ${nm(wrong)}. Buscá <b>${nm(target)}</b>${black}: ${dist} ${dir}`;
  }

  function hideWaitHint() {
    ui.waitHint.classList.remove('visible', 'wrong');
  }

  // --------------------------------------------------------------------------
  // Línea de tiempo
  // --------------------------------------------------------------------------
  function buildTimelineTicks() {
    const s = S.song;
    let html = '';
    for (let b = 1; b <= s.numBars; b++) {
      const x = (barStart(b) / s.duration) * 100;
      html += `<i class="${(b - 1) % 4 === 0 ? 'major' : ''}" style="left:${x}%"></i>`;
    }
    ui.timelineTicks.innerHTML = html;
  }

  function updateTimeline() {
    const s = S.song;
    if (!s) return;
    const t = Math.max(0, S.time);
    ui.timelineFill.style.width = `${clamp(t / s.duration, 0, 1) * 100}%`;
    ui.timeDisplay.textContent = `${fmtTime(t / S.speed)} / ${fmtTime(s.duration / S.speed)}`;
    const b = barAt(t);
    ui.barDisplay.textContent = b === 0 ? `Anacrusa / ${s.numBars}` : `Compás ${b} / ${s.numBars}`;
    if (S.loop.on) {
      ui.loopRegion.style.display = 'block';
      ui.loopRegion.style.left = `${(S.loop.a / s.duration) * 100}%`;
      ui.loopRegion.style.width = `${((S.loop.b - S.loop.a) / s.duration) * 100}%`;
    } else {
      ui.loopRegion.style.display = 'none';
    }
  }

  function barAtClientX(x) {
    const r = ui.timeline.getBoundingClientRect();
    const ratio = clamp((x - r.left) / r.width, 0, 1);
    return barAt(ratio * S.song.duration);
  }

  ui.timeline.addEventListener('pointerdown', e => {
    if (!S.song) return;
    ui.timeline.setPointerCapture(e.pointerId);
    S.drag = { x0: e.clientX, bar0: barAtClientX(e.clientX), moved: false };
  });
  ui.timeline.addEventListener('pointermove', e => {
    if (!S.drag) return;
    if (Math.abs(e.clientX - S.drag.x0) > 6) S.drag.moved = true;
    if (!S.drag.moved) return;
    const b1 = S.drag.bar0;
    const b2 = barAtClientX(e.clientX);
    const lo = Math.min(b1, b2);
    const hi = Math.max(b1, b2);
    const s = S.song;
    ui.timelineSelect.style.display = 'block';
    ui.timelineSelect.style.left = `${(barStart(lo) / s.duration) * 100}%`;
    ui.timelineSelect.style.width = `${((Math.min(barStart(hi + 1), s.duration) - barStart(lo)) / s.duration) * 100}%`;
  });
  ui.timeline.addEventListener('pointerup', e => {
    if (!S.drag) return;
    const d = S.drag;
    S.drag = null;
    ui.timelineSelect.style.display = 'none';
    if (d.moved) {
      setLoop(d.bar0, barAtClientX(e.clientX));
      toast(`Repitiendo compases ${S.loop.startBar}–${S.loop.endBar}`);
    } else {
      seekToBar(d.bar0);
    }
  });

  function seekToBar(b) {
    if (!S.song) return;
    const s = S.song;
    b = clamp(b, s.firstBar, s.numBars);
    const wasPlaying = S.playing;
    pause();
    if (S.loop.on && (barStart(b) < S.loop.a || barStart(b) >= S.loop.b)) clearLoop();
    const lead = S.mode === 'rhythm' ? s.beatSec * 2 : 1.0;
    seek(b <= s.firstBar ? startTime() : barStart(b) - lead);
    if (wasPlaying) play();
  }

  // --------------------------------------------------------------------------
  // Teclado en pantalla: rango y geometría
  // --------------------------------------------------------------------------
  function computeRange() {
    const r = settings.range;
    let min;
    let max;
    if (r === '88') [min, max] = [21, 108];
    else if (r === '76') [min, max] = [28, 103];
    else if (r === '61' || !S.song || !S.song.notes.length) [min, max] = [36, 96];
    else if (window.innerWidth < 700) {
      // Celular: teclas más anchas para el dedo (solo la zona que usa la canción)
      min = Math.min(S.song.minMidi, 60) - 1;
      max = Math.max(S.song.maxMidi, 60) + 1;
      while (max - min < 14) {
        min--;
        max++;
      }
      while (MT.isBlackKey(min)) min--;
      while (MT.isBlackKey(max)) max++;
      min = Math.max(21, min);
      max = Math.min(108, max);
    } else {
      min = Math.min(S.song.minMidi, 60) - 3;
      max = Math.max(S.song.maxMidi, 60) + 3;
      while (max - min < 24) {
        min--;
        max++;
      }
      while (MT.pc(min) !== 0) min--;
      while (MT.pc(max) !== 0) max++;
      min = Math.max(21, min);
      max = Math.min(108, max);
    }
    S.range = { min, max };
  }

  function computeGeometry() {
    const { PW, PH } = S.view;
    const { min, max } = S.range;
    const whites = [];
    for (let m = min; m <= max; m++) if (!MT.isBlackKey(m)) whites.push(m);
    const ww = PW / whites.length;
    const bw = ww * 0.6;
    const bh = PH * 0.62;
    const geom = [];
    whites.forEach((m, i) => (geom[m] = { x: i * ww, w: ww, h: PH, black: false }));
    for (let m = min; m <= max; m++) {
      if (!MT.isBlackKey(m) || !geom[m - 1]) continue;
      const pc = MT.pc(m);
      const shift = pc === 1 || pc === 6 ? 0.6 : pc === 3 || pc === 10 ? 0.4 : 0.5;
      const prev = geom[m - 1];
      geom[m] = { x: prev.x + prev.w - bw * shift, w: bw, h: bh, black: true };
    }
    S.geom = geom;
  }

  function resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    const sr = stageEl.getBoundingClientRect();
    const pr = pianoCanvas.getBoundingClientRect();
    S.view = { W: sr.width, H: sr.height, PW: pr.width, PH: pr.height, dpr };
    stageCanvas.width = Math.max(1, Math.round(sr.width * dpr));
    stageCanvas.height = Math.max(1, Math.round(sr.height * dpr));
    stageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pianoCanvas.width = Math.max(1, Math.round(pr.width * dpr));
    pianoCanvas.height = Math.max(1, Math.round(pr.height * dpr));
    pianoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staffCanvas.width = 220 * dpr;
    staffCanvas.height = 120 * dpr;
    staffCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S.staffSig = '';
    computeRange();
    computeGeometry();
  }

  // --------------------------------------------------------------------------
  // Efectos: partículas y textos flotantes
  // --------------------------------------------------------------------------
  function spawnParticles(midi, color, count) {
    if (settings.effects !== 'on') return;
    const g = S.geom[midi];
    if (!g) return;
    const cx = g.x + g.w / 2;
    const cy = S.view.H - 3;
    for (let i = 0; i < count && S.particles.length < 260; i++) {
      const ang = -Math.PI * (0.15 + Math.random() * 0.7);
      const sp = 60 + Math.random() * 170;
      S.particles.push({
        x: cx + (Math.random() - 0.5) * g.w * 0.6, y: cy,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        size: 2 + Math.random() * 3.2, color, life: 0.3 + Math.random() * 0.35, max: 0.65
      });
    }
  }

  function updateParticles(dt) {
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.life -= dt;
      if (p.life <= 0) S.particles.splice(i, 1);
    }
    const now = performance.now();
    S.popups = S.popups.filter(p => now - p.t < p.life * 1000);
  }

  function addPopup(midi, text, color, life = 0.8, big = false) {
    if (S.popups.length > 12) S.popups.shift();
    S.popups.push({ midi, text, color, t: performance.now(), life, big });
  }

  // --------------------------------------------------------------------------
  // Dibujo: escenario (notas que caen)
  // --------------------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const S_FRAME = { upcoming: new Map(), waitSet: new Map(), autoOn: new Map() };

  function drawStage() {
    const ctx = stageCtx;
    const { W, H } = S.view;
    ctx.clearRect(0, 0, W, H);
    if (S.display === 'sheet' && S.song && S.record.mode === 'off') {
      S_FRAME.upcoming.clear();
      drawSheet(ctx, W, H);
      drawPopups(ctx, H);
      for (const p of S.particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    const pps = (H - 4) / VISIBLE_SEC;
    const yOf = t => H - (t - S.time) * pps;

    // Carriles
    for (let m = S.range.min; m <= S.range.max; m++) {
      const g = S.geom[m];
      if (!g) continue;
      if (g.black) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(g.x, 0, g.w, H);
      } else if (MT.pc(m) === 0 || MT.pc(m) === 5) {
        ctx.fillStyle = MT.pc(m) === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)';
        ctx.fillRect(g.x, 0, 1, H);
      }
      if (m === 60) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.fillRect(g.x, 0, g.w, H);
      }
    }

    S_FRAME.upcoming.clear();

    if (S.record.mode === 'recording') {
      drawRecording(ctx, H, pps);
    } else if (S.song) {
      const s = S.song;
      // Líneas de tiempo y compases
      const k0 = Math.ceil((S.time - s.pickupSec) / s.beatSec - 1e-6);
      const k1 = Math.floor((S.time + VISIBLE_SEC - s.pickupSec) / s.beatSec);
      ctx.font = '600 10px "Atkinson Hyperlegible", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (let k = k0; k <= k1; k++) {
        const y = yOf(s.pickupSec + k * s.beatSec);
        const isBar = ((k % s.num) + s.num) % s.num === 0;
        ctx.fillStyle = isBar ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.035)';
        ctx.fillRect(0, y, W, isBar ? 1.5 : 1);
        if (isBar && k >= 0) {
          ctx.fillStyle = 'rgba(169, 161, 147,0.55)';
          ctx.fillText(String(k / s.num + 1), 4, y - 2);
        }
      }

      // Tramo repetido: oscurecer lo que queda fuera
      if (S.loop.on) {
        const yb = yOf(S.loop.b);
        if (yb > 0) {
          ctx.fillStyle = 'rgba(10, 9, 8,0.6)';
          ctx.fillRect(0, 0, W, yb);
          ctx.fillStyle = AMBER;
          ctx.fillRect(0, yb, W, 2);
          ctx.fillStyle = '#f0cbb8';
          ctx.font = '700 11px "Atkinson Hyperlegible", system-ui, sans-serif';
          ctx.fillText('vuelve al inicio del tramo', W - 190, yb - 4);
        }
      }

      drawNotes(ctx, W, H, yOf);
    }

    // Línea de impacto
    ctx.fillStyle = '#c9a35a';
    ctx.fillRect(0, H - 2, W, 2);

    drawWrongArrow(ctx, H);
    drawPopups(ctx, H);

    for (const p of S.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawNotes(ctx, W, H, yOf) {
    const s = S.song;
    const notes = s.notes;
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    const waitIds = new Set(S.waiting ? S.waitGroup.map(n => n.id) : []);
    const label = barLabelEff();
    const tEnd = S.time + VISIBLE_SEC;

    for (let i = lowerBound(notes, S.time - s.maxDur - 0.1); i < notes.length && notes[i].time <= tEnd; i++) {
      const n = notes[i];
      if (n.time + n.duration < S.time - 0.05) continue;
      const g = S.geom[n.midi];
      if (!g) continue;
      const user = isUserNote(n);
      const pal = COLORS[n.hand];

      if (user && n.status === 'pending' && S.hintOverride !== 'none') {
        const dt = n.time - S.time;
        if (dt > 0 && dt < 0.9) {
          const prox = 1 - dt / 0.9;
          const prev = S_FRAME.upcoming.get(n.midi);
          if (!prev || prev.prox < prox) S_FRAME.upcoming.set(n.midi, { prox, hand: n.hand });
        }
      }

      const yBottom = yOf(n.time);
      const yTop = yOf(n.time + n.duration);
      const h = Math.max(10, yBottom - yTop - 2);
      const y = yBottom - h;
      const pad = g.black ? 1 : 2;
      const x = g.x + pad;
      const w = Math.max(6, g.w - pad * 2);

      let fill = g.black ? pal.dark : pal.main;
      let alpha = 1;
      let stroke = pal.pale;
      if (S.mode === 'listen') {
        alpha = n.status === 'auto' && n.time <= S.time ? 0.55 : 0.92;
      } else if (!user) {
        alpha = 0.3;
        stroke = null;
      } else if (n.status === 'hit') {
        alpha = 0.38;
      } else if (n.status === 'missed') {
        fill = '#5a534b';
        stroke = '#a9a193';
        alpha = 0.7;
      } else if (n.status === 'skipped') {
        alpha = 0.25;
      }

      ctx.globalAlpha = alpha;
      const isWait = waitIds.has(n.id);
      if (isWait) {
        ctx.shadowColor = pal.light;
        ctx.shadowBlur = 10 + 14 * pulse;
      } else if (n.hitAt && now - n.hitAt < 250) {
        ctx.shadowColor = '#f7f2e8';
        ctx.shadowBlur = 18;
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = fill;
      roundRect(ctx, x, y, w, h, 5);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = isWait ? 2.5 : 1.3;
        ctx.stroke();
      }

      // Etiquetas: número de dedo y nombre de nota
      if (label !== 'none' && (user || S.mode === 'listen') && n.status !== 'hit' && w >= 12) {
        const bottom = Math.min(yBottom, H - 4);
        const visibleH = bottom - Math.max(y, 0);
        const showFinger = n.finger && (label === 'both' || label === 'finger');
        const showName = label === 'note' || label === 'both' || (label === 'finger' && !n.finger);
        let cursor = bottom - 3;
        ctx.globalAlpha = Math.max(alpha, 0.85);
        if (showFinger && visibleH >= 16) {
          const r = Math.min(9, w / 2 - 1);
          const cy = cursor - r;
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.beginPath();
          ctx.arc(x + w / 2, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = g.black ? pal.dark : '#161412';
          ctx.font = `800 ${Math.round(r * 1.35)}px "Atkinson Hyperlegible", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(n.finger), x + w / 2, cy + 0.5);
          cursor = cy - r - 2;
        }
        if (showName && cursor - Math.max(y, 0) >= 11) {
          const txt = MT.shortName(n.midi, settings.noteNames === 'both' ? 'es' : settings.noteNames);
          ctx.fillStyle = g.black ? '#f7f2e8' : '#1b1916';
          ctx.font = `800 ${Math.max(8, Math.min(12, Math.floor(w * 0.42)))}px "Atkinson Hyperlegible", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(txt, x + w / 2, cursor);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawWrongArrow(ctx, H) {
    const w = S.wrong;
    if (!w || w.target == null || S.mode !== 'learn') return;
    const age = performance.now() - w.t;
    if (age > 1800) return;
    const g0 = S.geom[w.midi];
    const g1 = S.geom[w.target];
    if (!g0 || !g1) return;
    const x0 = g0.x + g0.w / 2;
    const x1 = g1.x + g1.w / 2;
    const y = H - 26;
    ctx.globalAlpha = age < 1300 ? 1 : 1 - (age - 1300) / 500;
    ctx.strokeStyle = AMBER;
    ctx.fillStyle = AMBER;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x0, y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (Math.abs(x1 - x0) > 6) {
      const dir = Math.sign(x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1 - dir * 8, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x1 - dir * 10, y - 6);
      ctx.lineTo(x1 - dir * 10, y + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups(ctx, H) {
    const now = performance.now();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const p of S.popups) {
      const g = S.geom[p.midi];
      if (!g) continue;
      const age = (now - p.t) / 1000;
      const k = age / p.life;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.fillStyle = p.color;
      ctx.font = `800 ${p.big ? 18 : 13}px "Atkinson Hyperlegible", system-ui, sans-serif`;
      const x = clamp(g.x + g.w / 2, 40, S.view.W - 40);
      ctx.fillText(p.text, x, H - 34 - age * 40 - (p.big ? 20 : 0));
    }
    ctx.globalAlpha = 1;
  }

  function drawRecording(ctx, H, pps) {
    const now = (performance.now() - S.record.start) / 1000;
    const bar = (midi, t0, t1) => {
      const g = S.geom[midi];
      if (!g) return;
      const yTop = H - (now - t0) * pps;
      const yBot = H - (now - t1) * pps;
      ctx.fillStyle = '#b4483b';
      ctx.strokeStyle = '#f2d3cd';
      ctx.lineWidth = 1.2;
      roundRect(ctx, g.x + 2, yTop, g.w - 4, Math.max(8, yBot - yTop), 5);
      ctx.fill();
      ctx.stroke();
    };
    for (const n of S.record.done) if (now - (n.time + n.duration) < VISIBLE_SEC) bar(n.midi, n.time, n.time + n.duration);
    for (const [midi, o] of S.record.open) bar(midi, o.t, now);
  }

  // --------------------------------------------------------------------------
  // Dibujo: teclado
  // --------------------------------------------------------------------------
  function drawPiano() {
    const ctx = pianoCtx;
    const { PW, PH } = S.view;
    ctx.clearRect(0, 0, PW, PH);
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);

    const waitMap = S_FRAME.waitSet;
    waitMap.clear();
    if (S.waiting) for (const n of S.waitGroup) if (n.status === 'pending') waitMap.set(n.midi, n);
    const autoOn = S_FRAME.autoOn;
    autoOn.clear();
    for (const h of S.autoHi) if (h.from <= S.time && h.until > S.time) autoOn.set(h.midi, h.hand);
    const wrongFlash = S.wrong && now - S.wrong.t < 900 ? S.wrong.midi : null;

    for (const pass of [false, true]) {
      for (let m = S.range.min; m <= S.range.max; m++) {
        const g = S.geom[m];
        if (!g || g.black !== pass) continue;
        const uk = S.userKeys.get(m);
        const wait = waitMap.get(m);
        const autoHand = autoOn.get(m);
        let fill = g.black ? '#1b1916' : '#f7f2e8';
        if (uk) {
          if (uk.verdict === 'wrong') fill = AMBER;
          else fill = g.black ? COLORS[uk.hand].main : COLORS[uk.hand].light;
        } else if (wrongFlash === m) {
          fill = g.black ? '#94472f' : '#f0cbb8';
        } else if (autoHand) {
          fill = g.black ? COLORS[autoHand].dark : COLORS[autoHand].pale;
        } else if (wait) {
          fill = g.black ? COLORS[wait.hand].main : COLORS[wait.hand].pale;
        }

        ctx.fillStyle = fill;
        roundRect(ctx, g.x + 0.5, -4, g.w - 1, g.h + 4, g.black ? 3 : 5);
        ctx.fill();
        if (!g.black) {
          ctx.strokeStyle = '#3e3933';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          ctx.fillRect(g.x + 1, g.h - 6, g.w - 2, 5);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.1)';
          ctx.fillRect(g.x + 2, g.h - 8, g.w - 4, 4);
        }

        // Tecla objetivo: borde que late
        if (wait && !uk) {
          ctx.strokeStyle = COLORS[wait.hand].main;
          ctx.lineWidth = 2 + 2 * pulse;
          roundRect(ctx, g.x + 2, 0, g.w - 4, g.h - 2, 4);
          ctx.stroke();
        }

        // Anticipación: franja arriba de la tecla que se va a necesitar pronto
        const up = S_FRAME.upcoming.get(m);
        if (up && !wait) {
          ctx.globalAlpha = 0.25 + up.prox * 0.75;
          ctx.fillStyle = COLORS[up.hand].main;
          ctx.fillRect(g.x + 1, 0, g.w - 2, 4 + up.prox * 6);
          ctx.globalAlpha = 1;
        }

        // Número de dedo sobre la tecla que hay que tocar
        if (wait && wait.finger) {
          const r = Math.min(10, g.w / 2 - 2);
          const cy = g.black ? g.h - r - 8 : g.h - r - 26;
          ctx.fillStyle = COLORS[wait.hand].main;
          ctx.beginPath();
          ctx.arc(g.x + g.w / 2, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#f7f2e8';
          ctx.font = `800 ${Math.round(r * 1.3)}px "Atkinson Hyperlegible", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(wait.finger), g.x + g.w / 2, cy + 0.5);
        }

        // Nombres
        const isC = MT.pc(m) === 0;
        if (!g.black) {
          const kl = keyLabelsEff();
          const showLabel = kl === 'all' || (kl === 'c' && isC);
          if (showLabel) {
            const fs = Math.max(8, Math.min(12, Math.floor(g.w * 0.38)));
            ctx.font = `${isC ? 800 : 600} ${fs}px "Atkinson Hyperlegible", system-ui, sans-serif`;
            ctx.fillStyle = isC ? '#1b1916' : '#7b7369';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const txt = MT.shortName(m, settings.noteNames === 'both' ? 'es' : settings.noteNames) + (isC && g.w > 22 ? MT.octave(m) : '');
            ctx.fillText(txt, g.x + g.w / 2, g.h - 8);
          }
          if (m === 60) {
            ctx.fillStyle = '#c9a35a';
            ctx.beginPath();
            ctx.arc(g.x + g.w / 2, g.h - 30 - (wait && wait.finger ? 22 : 0), Math.min(4, g.w * 0.15), 0, Math.PI * 2);
            ctx.fill();
          }
        } else if ((wait || uk) && g.w > 14) {
          ctx.font = `700 ${Math.max(8, Math.min(10, Math.floor(g.w * 0.45)))}px "Atkinson Hyperlegible", system-ui, sans-serif`;
          ctx.fillStyle = '#f7f2e8';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(MT.shortName(m, settings.noteNames === 'en' ? 'en' : 'es'), g.x + g.w / 2, 6);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Vista partitura: las notas pasan sobre un pentagrama de piano real
  // (derecha en clave de Sol, izquierda en clave de Fa). La línea verde marca "ahora".
  // --------------------------------------------------------------------------

  // Ayudas efectivas: las del ajuste, pero más reducidas si el paso del plan lo pide
  function barLabelEff() {
    const base = settings.barLabel;
    if (S.hintOverride === 'none') return 'none';
    if (S.hintOverride === 'finger') return base === 'both' || base === 'finger' ? 'finger' : 'none';
    return base;
  }
  function keyLabelsEff() {
    if (!S.hintOverride) return settings.keyLabels;
    return settings.keyLabels === 'none' ? 'none' : 'c';
  }

  function drawSheet(ctx, W, H) {
    const s = S.song;
    const notes = s.notes;
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    const STEP = clamp((H - 24) / 30, 3.2, 9);
    const yOf = d => H / 2 + (28 - d) * STEP; // 28 = Do central (entre los dos pentagramas)
    const left = Math.round(STEP * 7.5);
    const px = Math.max(left + 50, W * 0.22);
    const pxPerSec = (W - px - 16) / (s.num * 2.2 * s.beatSec); // ~2 compases a la vista
    const xOf = t => px + (t - S.time) * pxPerSec;
    const tFrom = S.time - (px - left) / pxPerSec;
    const tTo = S.time + (W - px) / pxPerSec;
    const label = barLabelEff();
    const waitIds = new Set(S.waiting ? S.waitGroup.map(n => n.id) : []);

    // Pentagramas
    ctx.strokeStyle = 'rgba(216, 208, 194,0.45)';
    ctx.lineWidth = 1;
    for (const d of [30, 32, 34, 36, 38, 18, 20, 22, 24, 26]) {
      ctx.beginPath();
      ctx.moveTo(6, yOf(d));
      ctx.lineTo(W, yOf(d));
      ctx.stroke();
    }

    // Compases
    ctx.font = `600 ${Math.max(9, Math.round(STEP * 1.3))}px "Atkinson Hyperlegible", system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const k0 = Math.max(0, Math.floor((tFrom - s.pickupSec) / s.barSec));
    const k1 = Math.ceil((tTo - s.pickupSec) / s.barSec);
    for (let k = k0; k <= k1; k++) {
      const x = xOf(s.pickupSec + k * s.barSec);
      if (x < left || x > W) continue;
      ctx.fillStyle = 'rgba(216, 208, 194,0.5)';
      ctx.fillRect(x, yOf(38), 1.2, yOf(18) - yOf(38));
      ctx.fillStyle = 'rgba(169, 161, 147,0.75)';
      ctx.fillText(String(k + 1), x + 3, yOf(38) - STEP * 0.6);
    }

    // Tramo repetido: oscurecer lo que queda fuera
    if (S.loop.on) {
      const xb = xOf(S.loop.b);
      if (xb < W) {
        ctx.fillStyle = 'rgba(10, 9, 8,0.6)';
        ctx.fillRect(xb, 0, W - xb, H);
        ctx.fillStyle = AMBER;
        ctx.fillRect(xb, 0, 2, H);
      }
    }

    // Notas
    const rx = STEP * 1.3;
    const ry = STEP * 0.92;
    for (let i = lowerBound(notes, tFrom - s.maxDur); i < notes.length && notes[i].time <= tTo; i++) {
      const n = notes[i];
      const x = xOf(n.time);
      const xEnd = xOf(n.time + n.duration);
      if (xEnd < left) continue;
      const user = isUserNote(n);
      const pal = COLORS[n.hand];
      const d = diatonic(n.midi);
      const y = yOf(d);

      if (user && n.status === 'pending' && S.hintOverride !== 'none') {
        const dt = n.time - S.time;
        if (dt > 0 && dt < 0.9) {
          const prox = 1 - dt / 0.9;
          const prev = S_FRAME.upcoming.get(n.midi);
          if (!prev || prev.prox < prox) S_FRAME.upcoming.set(n.midi, { prox, hand: n.hand });
        }
      }

      let col = user || S.mode === 'listen' ? '#efe8da' : 'rgba(169, 161, 147,0.45)';
      if (n.status === 'hit' || (S.mode === 'listen' && n.status === 'auto' && n.time <= S.time)) col = pal.light;
      else if (n.status === 'missed') col = '#7b7369';
      else if (n.status === 'skipped') col = 'rgba(169, 161, 147,0.35)';

      // Duración (cola suave) — ayuda a "ver" el ritmo
      ctx.fillStyle = user ? `${pal.main}33` : 'rgba(169, 161, 147,0.12)';
      ctx.fillRect(x, y - ry * 0.55, Math.max(0, xEnd - x - 2), ry * 1.1);

      // Líneas adicionales
      ctx.strokeStyle = 'rgba(216, 208, 194,0.6)';
      ctx.lineWidth = 1.2;
      const ledgers = [];
      if (d >= 40) for (let L = 40; L <= d; L += 2) ledgers.push(L);
      if (d <= 16) for (let L = 16; L >= d; L -= 2) ledgers.push(L);
      if (d === 28) ledgers.push(28);
      for (const L of ledgers) {
        ctx.beginPath();
        ctx.moveTo(x - rx * 1.6, yOf(L));
        ctx.lineTo(x + rx * 1.6, yOf(L));
        ctx.stroke();
      }

      // Cabeza de nota
      if (waitIds.has(n.id)) {
        ctx.shadowColor = pal.light;
        ctx.shadowBlur = 8 + 12 * pulse;
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (MT.isBlackKey(n.midi)) {
        ctx.font = `700 ${Math.round(STEP * 2.3)}px "Segoe UI Symbol", system-ui, serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('♯', x - rx - 2, y);
      }

      // Ayudas: dedo (arriba en la derecha, abajo en la izquierda) y nombre
      if (label !== 'none' && (user || S.mode === 'listen') && n.status !== 'hit') {
        const up = n.hand === 'R';
        const ly = up ? y - STEP * 2.4 : y + STEP * 2.4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let txt = '';
        if ((label === 'both' || label === 'finger') && n.finger) txt = String(n.finger);
        if (label === 'note' || label === 'both' || (label === 'finger' && !n.finger)) {
          const nm = MT.shortName(n.midi, settings.noteNames === 'both' ? 'es' : settings.noteNames);
          if (label !== 'finger') txt = txt ? `${txt} · ${nm}` : nm;
        }
        if (txt) {
          ctx.font = `800 ${Math.max(9, Math.round(STEP * 1.45))}px "Atkinson Hyperlegible", system-ui, sans-serif`;
          ctx.fillStyle = pal.light;
          ctx.fillText(txt, x, ly);
        }
      }
    }

    // Zona de claves (tapa lo que ya pasó)
    ctx.fillStyle = '#161412';
    ctx.fillRect(0, 0, left, H);
    ctx.strokeStyle = 'rgba(216, 208, 194,0.45)';
    ctx.lineWidth = 1;
    for (const d of [30, 32, 34, 36, 38, 18, 20, 22, 24, 26]) {
      ctx.beginPath();
      ctx.moveTo(6, yOf(d));
      ctx.lineTo(left, yOf(d));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(216, 208, 194,0.9)';
    ctx.fillRect(6, yOf(38), 2, yOf(18) - yOf(38));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.round(STEP * 10)}px "Segoe UI Symbol", "Noto Music", serif`;
    ctx.fillText('𝄞', 10, yOf(30) + STEP * 2.5);
    ctx.font = `${Math.round(STEP * 7)}px "Segoe UI Symbol", "Noto Music", serif`;
    ctx.fillText('𝄢', 12, yOf(18) - STEP * 0.9);

    // Línea de "ahora"
    const g = ctx.createLinearGradient(0, yOf(42), 0, yOf(14));
    g.addColorStop(0, 'rgba(201, 163, 90,0)');
    g.addColorStop(0.5, 'rgba(201, 163, 90,0.95)');
    g.addColorStop(1, 'rgba(201, 163, 90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - 1.5, yOf(42), 3, yOf(14) - yOf(42));
  }

  // --------------------------------------------------------------------------
  // Pentagrama de ayuda (lo que viene, escrito como partitura)
  // --------------------------------------------------------------------------
  const LETTER_OF_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const diatonic = m => MT.octave(m) * 7 + LETTER_OF_PC[MT.pc(m)];

  function drawStaff() {
    if (settings.showStaff !== 'on' || !sheetOn() || !S.song || S.record.mode !== 'off' || S.display === 'sheet') return;
    const notes = S.song.notes;
    const groups = [];
    const start = S.waiting ? S.waitTime - 0.001 : S.time - 0.02;
    for (let i = lowerBound(notes, start); i < notes.length && groups.length < 6; i++) {
      const n = notes[i];
      if (n.status === 'hit' || n.status === 'skipped') continue;
      const last = groups[groups.length - 1];
      if (last && Math.abs(last.time - n.time) <= 0.03) last.notes.push(n);
      else if (groups.length < 6) groups.push({ time: n.time, notes: [n] });
    }
    const sig = groups.map(g => g.notes.map(n => n.id + n.status).join(',')).join('|') + S.mode + S.hand;
    if (sig === S.staffSig) return;
    S.staffSig = sig;

    const ctx = staffCtx;
    ctx.clearRect(0, 0, 220, 120);
    // Pentagrama doble como en una partitura de piano: derecha en clave de Sol, izquierda en clave de Fa
    const STEP = 3.5;
    const yT = d => 14 + (38 - d) * STEP; // clave de Sol: líneas Mi4..Fa5 (d 30..38)
    const yB = d => 70 + (26 - d) * STEP; // clave de Fa: líneas Sol2..La3 (d 18..26)
    ctx.strokeStyle = 'rgba(216, 208, 194,0.55)';
    ctx.lineWidth = 1;
    for (const y of [30, 32, 34, 36, 38].map(yT).concat([18, 20, 22, 24, 26].map(yB))) {
      ctx.beginPath();
      ctx.moveTo(26, y);
      ctx.lineTo(216, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(216, 208, 194,0.85)';
    ctx.fillRect(26, yT(38), 1, yB(18) - yT(38));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '36px "Segoe UI Symbol", "Noto Music", serif';
    ctx.fillText('𝄞', 3, yT(30) + 9);
    ctx.font = '25px "Segoe UI Symbol", "Noto Music", serif';
    ctx.fillText('𝄢', 5, yB(18) - 3);

    groups.forEach((grp, gi) => {
      const x = 48 + gi * 30;
      const first = gi === 0;
      for (const n of grp.notes) {
        const d = diatonic(n.midi);
        const treble = n.hand === 'R';
        const y = clamp(treble ? yT(d) : yB(d), 3, 117);
        // Líneas adicionales
        ctx.strokeStyle = 'rgba(216, 208, 194,0.55)';
        const ledgers = [];
        if (treble) {
          for (let L = 28; L >= d; L -= 2) ledgers.push(yT(L));
          for (let L = 40; L <= d; L += 2) ledgers.push(yT(L));
        } else {
          for (let L = 28; L <= d; L += 2) ledgers.push(yB(L));
          for (let L = 16; L >= d; L -= 2) ledgers.push(yB(L));
        }
        for (const ly of ledgers) {
          ctx.beginPath();
          ctx.moveTo(x - 8, ly);
          ctx.lineTo(x + 8, ly);
          ctx.stroke();
        }
        const user = isUserNote(n) || S.mode === 'listen';
        const col = first && user ? COLORS[n.hand].light : user ? 'rgba(231, 224, 211,0.85)' : 'rgba(169, 161, 147,0.45)';
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(x, y, 4.6, 3.4, -0.35, 0, Math.PI * 2);
        ctx.fill();
        if (MT.isBlackKey(n.midi)) {
          ctx.font = '700 11px "Atkinson Hyperlegible", system-ui, sans-serif';
          ctx.fillText('♯', x - 13, y + 4);
        }
      }
      if (first) {
        ctx.fillStyle = 'rgba(221, 185, 120,0.15)';
        ctx.fillRect(x - 11, 6, 22, 108);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Grabador
  // --------------------------------------------------------------------------
  function startRecording() {
    pause();
    audio.init();
    const bpm = S.song ? Math.round(S.song.bpm * S.speed) : 100;
    S.record = { mode: 'armed', start: 0, open: new Map(), done: [], bpm, withClick: S.metronome, lastBeat: -1 };
    if (S.metronome) {
      S.record.mode = 'recording';
      S.record.start = performance.now();
    }
    document.body.classList.add('is-recording');
    ui.btnRecord.classList.add('recording');
    ui.btnRecord.textContent = '■ Terminar';
    ui.recordBanner.textContent = S.metronome
      ? `Grabando con metrónomo a ${bpm} BPM… tocá cuando quieras`
      : 'Listo: el reloj arranca cuando toques la primera tecla';
  }

  function recordNoteOn(midi, vel) {
    const r = S.record;
    if (r.mode === 'armed') {
      r.mode = 'recording';
      r.start = performance.now();
    }
    const t = (performance.now() - r.start) / 1000;
    if (r.open.has(midi)) recordNoteOff(midi);
    r.open.set(midi, { t, vel });
    spawnParticles(midi, '#cf6f61', 8);
  }

  function recordNoteOff(midi) {
    const r = S.record;
    const o = r.open.get(midi);
    if (!o) return;
    const t = (performance.now() - r.start) / 1000;
    r.done.push({ midi, time: +o.t.toFixed(4), duration: +Math.max(0.06, t - o.t).toFixed(4), velocity: o.vel, hand: midi >= 60 ? 'R' : 'L' });
    r.open.delete(midi);
  }

  function updateRecording() {
    const r = S.record;
    if (r.mode !== 'recording') return;
    const t = (performance.now() - r.start) / 1000;
    if (r.withClick) {
      const beat = Math.floor(t / (60 / r.bpm));
      if (beat !== r.lastBeat) {
        r.lastBeat = beat;
        audio.click(beat % 4 === 0);
      }
    }
    ui.recordBanner.textContent = `Grabando ${fmtTime(t)}, ${r.done.length + r.open.size} notas. Tocá Terminar cuando quieras.`;
  }

  function stopRecording() {
    const r = S.record;
    for (const midi of [...r.open.keys()]) recordNoteOff(midi);
    S.record = { mode: 'off' };
    document.body.classList.remove('is-recording');
    ui.btnRecord.classList.remove('recording');
    ui.btnRecord.textContent = 'Grabar';
    if (!r.done || !r.done.length) {
      toast('No se grabó ninguna nota.');
      return;
    }
    const notes = r.done.sort((a, b) => a.time - b.time);
    // Recortar el silencio inicial (si hubo metrónomo, se recorta en compases enteros)
    const first = notes[0].time;
    const barSec = (60 / r.bpm) * 4;
    const shift = r.withClick ? Math.floor(first / barSec) * barSec : first;
    for (const n of notes) n.time = +(n.time - shift).toFixed(4);
    S.pendingRecording = { notes, bpm: r.bpm };
    ui.saveDesc.textContent = `Grabaste ${notes.length} notas. Ponele un nombre para guardarla y practicarla como cualquier canción (podés bajarle la velocidad).`;
    ui.saveTitle.value = `Mi grabación ${customSongs.filter(s => s.id.startsWith('rec_')).length + 1}`;
    openModal('saveModal');
    setTimeout(() => {
      ui.saveTitle.focus();
      ui.saveTitle.select();
    }, 50);
  }

  $('btnSaveConfirm').addEventListener('click', () => {
    const rec = S.pendingRecording;
    if (!rec) return closeModal('saveModal');
    const song = {
      id: 'rec_' + Date.now(),
      title: ui.saveTitle.value.trim() || 'Mi grabación',
      artist: 'Grabado por vos',
      concept: 'Tu propia grabación.',
      tip: 'Practicala en Aprender para memorizarla, o en Escuchar para revisar cómo quedó.',
      bpm: rec.bpm,
      timeSig: [4, 4],
      pickup: 0,
      isCustom: true,
      notes: rec.notes
    };
    customSongs.push(song);
    saveCustom();
    S.pendingRecording = null;
    closeModal('saveModal');
    selectSong(song.id);
    audio.chime('success');
  });
  $('btnSaveCancel').addEventListener('click', () => {
    S.pendingRecording = null;
    closeModal('saveModal');
  });
  ui.saveTitle.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btnSaveConfirm').click();
  });

  // --------------------------------------------------------------------------
  // Lectura de notas: aparece una nota en el pentagrama y la tocás en tu teclado.
  // Entrena leer partitura (lo que las notas que caen no enseñan solas).
  // --------------------------------------------------------------------------
  const READ_ROUND = 20;
  const keysIn = (a, b, white = true) => {
    const r = [];
    for (let m = a; m <= b; m++) if (!white || !MT.isBlackKey(m)) r.push(m);
    return r;
  };
  const READ_LEVELS = [
    { id: 'r1', name: 'Nivel 1 · Do a Sol', desc: 'Las 5 notas de la mano derecha en posición de Do (clave de Sol). Empezá por acá.', pool: keysIn(60, 67), clef: 'T' },
    { id: 'r2', name: 'Nivel 2 · Clave de Sol', desc: 'De Do central a Do5: la zona de la mano derecha. Truco: las líneas, de abajo hacia arriba, son Mi-Sol-Si-Re-Fa.', pool: keysIn(60, 72), clef: 'T' },
    { id: 'r3', name: 'Nivel 3 · Clave de Fa', desc: 'De Do3 a Do central: la zona de la mano izquierda. Truco: las líneas, de abajo hacia arriba, son Sol-Si-Re-Fa-La.', pool: keysIn(48, 60), clef: 'B' },
    { id: 'r4', name: 'Nivel 4 · Las dos claves', desc: 'Saltar entre clave de Sol y clave de Fa, como en una partitura de piano. El Do central puede aparecer en las dos.', pool: keysIn(48, 72), clef: 'auto' },
    { id: 'r5', name: 'Nivel 5 · Líneas adicionales', desc: 'Notas más graves y más agudas, con líneas adicionales. Contá de a saltos de "línea-espacio".', pool: keysIn(41, 81), clef: 'auto' },
    { id: 'r6', name: 'Nivel 6 · Sostenidos y bemoles', desc: '♯ (sostenido) = la tecla de al lado hacia la derecha. ♭ (bemol) = hacia la izquierda.', pool: keysIn(53, 74, false), clef: 'auto' }
  ];
  // Oído: suena una nota (al principio, después de un Do de referencia) y la buscás en el teclado
  const EAR_ROUND = 10;
  const EAR_LEVELS = [
    { id: 'e1', name: 'Nivel 1 · Do, Re, Mi', desc: 'Primero suena Do (la referencia) y después la nota misteriosa: ¿Do, Re o Mi? Cantala por dentro antes de buscarla.', pool: [60, 62, 64], clef: 'T', refEach: true },
    { id: 'e2', name: 'Nivel 2 · Do a Sol', desc: 'Las 5 notas de la posición de Do, siempre con el Do de referencia antes.', pool: keysIn(60, 67), clef: 'T', refEach: true },
    { id: 'e3', name: 'Nivel 3 · Escala de Do', desc: 'Toda la escala de Do. El Do de referencia suena solo al empezar: después comparás con la nota anterior.', pool: keysIn(60, 72), clef: 'T', refEach: false },
    { id: 'e4', name: 'Nivel 4 · Con teclas negras', desc: 'Las 12 notas. Tip: si suena "tensa" o "rara", probablemente sea una tecla negra.', pool: keysIn(60, 72, false), clef: 'T', refEach: false }
  ];
  const LETTERS = { es: ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'], en: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] };
  const R = { mode: 'read', lastNote: null, level: 0, running: false, queue: [], idx: 0, firstTry: 0, tries: 0, noteAt: 0, times: [], flash: null, result: null };

  const readerOpen = () => $('readerModal').classList.contains('open');

  const rLevels = () => (R.mode === 'ear' ? EAR_LEVELS : READ_LEVELS);
  const rStore = () => (R.mode === 'ear' ? (progress.ear = progress.ear || {}) : progress.reading);
  const rRound = () => (R.mode === 'ear' ? EAR_ROUND : READ_ROUND);

  function playEar(withRef) {
    const t = R.queue[R.idx];
    if (!t) return;
    audio.init();
    let when = audio.now() + 0.08;
    if (withRef) {
      audio.playScheduled(60, 80, when, 0.6);
      when += 0.85;
    }
    audio.playScheduled(t.midi, 92, when, 0.9);
  }

  function recommendedReadLevel() {
    return READ_LEVELS.find(l => ((progress.reading[l.id] || {}).stars || 0) < 2) || READ_LEVELS[READ_LEVELS.length - 1];
  }

  // Nota a mostrar: clave, posición en el pentagrama y alteración
  function readNote(level, midi) {
    let clef = level.clef;
    if (clef === 'auto') clef = midi > 60 ? 'T' : midi < 60 ? 'B' : Math.random() < 0.5 ? 'T' : 'B';
    let d = diatonic(midi);
    let acc = '';
    if (MT.isBlackKey(midi)) {
      if (Math.random() < 0.5) acc = '#';
      else {
        acc = 'b';
        d += 1; // Re♭ se escribe en la posición de Re
      }
    }
    return { midi, clef, d, acc };
  }

  function readNoteName(n) {
    const letter = d => (settings.noteNames === 'en' ? LETTERS.en : LETTERS.es)[((d % 7) + 7) % 7];
    const sign = n.acc === '#' ? '♯' : n.acc === 'b' ? '♭' : '';
    if (settings.noteNames === 'both') return `${LETTERS.es[((n.d % 7) + 7) % 7]}${sign} (${LETTERS.en[((n.d % 7) + 7) % 7]}${sign})`;
    return letter(n.d) + sign;
  }

  function openReader(mode = 'read') {
    pause();
    R.mode = mode === 'ear' ? 'ear' : 'read';
    const store = rStore();
    const lv = rLevels();
    R.level = Math.max(0, lv.indexOf(lv.find(l => ((store[l.id] || {}).stars || 0) < 2) || lv[lv.length - 1]));
    stopReader();
    openModal('readerModal');
    renderReader();
  }

  function stopReader() {
    R.running = false;
    R.result = null;
    R.queue = [];
    R.idx = 0;
    R.flash = null;
  }

  function startReader() {
    const lvl = rLevels()[R.level];
    const q = [];
    while (q.length < rRound()) {
      const m = lvl.pool[Math.floor(Math.random() * lvl.pool.length)];
      const prev = q[q.length - 1];
      if (prev && prev.midi === m) continue;
      q.push(readNote(lvl, m));
    }
    Object.assign(R, { running: true, queue: q, idx: 0, firstTry: 0, tries: 0, times: [], flash: null, result: null, lastNote: null, noteAt: performance.now() });
    ui.readerFeedback.textContent = R.mode === 'ear' ? 'Escuchá y buscá la nota en el teclado. Repetir (o Espacio) para oírla otra vez.' : 'Mirá la nota y tocala. Si podés, sin mirar las manos.';
    ui.readerFeedback.className = 'reader-feedback';
    renderReader();
    if (R.mode === 'ear') setTimeout(() => playEar(true), 250);
  }

  function readerPress(midi) {
    if (!R.running) {
      if (R.result && performance.now() - (R.finishedAt || 0) < 900) return;
      if (R.result && R.result.next != null && !MT.isBlackKey(midi)) {
        R.level = R.result.next;
        stopReader();
      }
      startReader();
      return;
    }
    const target = R.queue[R.idx];
    const now = performance.now();
    const ear = R.mode === 'ear';
    if (ear ? MT.pc(midi) === MT.pc(target.midi) : midi === target.midi) {
      R.lastNote = target;
      if (R.tries === 0) R.firstTry++;
      R.times.push(now - R.noteAt);
      R.flash = { kind: 'good', until: now + 220 };
      R.idx++;
      R.tries = 0;
      R.noteAt = now;
      ui.readerFeedback.textContent = ['¡Bien!', '¡Eso!', '✓', '¡Correcto!'][R.idx % 4];
      ui.readerFeedback.className = 'reader-feedback good';
      if (ear) ui.readerFeedback.textContent = `¡Sí! Era ${readNoteName(target)}.`;
      if (R.idx >= R.queue.length) finishReader();
      else if (ear) setTimeout(() => R.running && playEar(rLevels()[R.level].refEach), 750);
    } else if (ear) {
      R.tries++;
      R.flash = { kind: 'bad', until: now + 300 };
      // la nota buscada, en la octava más cercana a la que tocaste
      let tm = midi + ((MT.pc(target.midi) - MT.pc(midi) + 12) % 12);
      if (tm - midi > 6) tm -= 12;
      const played = MT.name(midi, settings.noteNames === 'en' ? 'en' : 'es', false);
      ui.readerFeedback.textContent =
        R.tries >= 3
          ? `Era ${readNoteName(target)}. Tocala y escuchá cómo suena.`
          : `No es ${played}: la nota es más ${tm > midi ? 'aguda ↑ (a la derecha)' : 'grave ↓ (a la izquierda)'}. Escuchala otra vez.`;
      ui.readerFeedback.className = 'reader-feedback warn';
      setTimeout(() => R.running && playEar(false), 450);
    } else {
      R.tries++;
      R.flash = { kind: 'bad', until: now + 300 };
      const played = MT.name(midi, settings.noteNames === 'en' ? 'en' : 'es', false);
      let msg;
      if (MT.pc(midi) === MT.pc(target.midi)) msg = `Esa es la nota, pero en otra octava: buscala más ${midi < target.midi ? 'a la derecha →' : 'a la izquierda ←'}`;
      else msg = `Tocaste ${played}. La nota del pentagrama es más ${midi < target.midi ? 'aguda (hacia la derecha →)' : 'grave (hacia la izquierda ←)'}`;
      if (R.tries >= 2) msg = `Es ${readNoteName(target)}. Tocala para seguir (y fijate dónde está en el pentagrama).`;
      ui.readerFeedback.textContent = msg;
      ui.readerFeedback.className = 'reader-feedback warn';
    }
    renderReader();
    setTimeout(drawReader, 320);
  }

  function finishReader() {
    R.running = false;
    R.finishedAt = performance.now();
    const ear = R.mode === 'ear';
    const lvl = rLevels()[R.level];
    const acc = R.firstTry / rRound();
    const avg = R.times.reduce((a, b) => a + b, 0) / Math.max(1, R.times.length) / 1000;
    const stars = ear ? (acc >= 1 ? 3 : acc >= 0.8 ? 2 : acc >= 0.6 ? 1 : 0) : acc >= 0.9 && avg <= 2 ? 3 : acc >= 0.9 ? 2 : acc >= 0.75 ? 1 : 0;
    const store = rStore();
    const rec = store[lvl.id] || { stars: 0, best: 0, bestAvg: null, rounds: 0 };
    const prevStars = rec.stars || 0;
    rec.stars = Math.max(prevStars, stars);
    rec.best = Math.max(rec.best || 0, R.firstTry);
    rec.bestAvg = rec.bestAvg == null ? avg : Math.min(rec.bestAvg, avg);
    rec.rounds = (rec.rounds || 0) + 1;
    store[lvl.id] = rec;
    todayRec().read = true;
    saveProgress();
    const next = rLevels()[R.level + 1];
    let tip;
    if (stars >= 2 && next) tip = `¡Nivel superado! Seguí con <b>${escapeHtml(next.name)}</b>.`;
    else if (stars >= 2) tip = '¡Dominaste todos los niveles! Mantenelo con una ronda por día.';
    else if (ear) tip = acc >= 0.6 ? 'Muy cerca: con 8 de 10 a la primera pasás al nivel siguiente.' : 'El oído se entrena de a poco: cantá la nota por dentro antes de buscarla. Otra ronda del mismo nivel.';
    else if (acc >= 0.75) tip = 'Muy cerca: con 18 de 20 a la primera pasás al nivel siguiente.';
    else tip = 'Tomate tu tiempo: leer bien importa más que leer rápido. Otra ronda del mismo nivel.';
    if (stars === 2) tip += ear ? ' Para la ★★★: 10 de 10.' : ' Para la ★★★: menos de 2 segundos por nota.';
    R.result = { acc, avg, stars, tip, next: stars >= 2 && next ? R.level + 1 : null };
    audio.chime(stars > prevStars ? 'star' : 'success');
    renderReader();
  }

  function renderReader() {
    const lvls = rLevels();
    const lvl = lvls[R.level];
    const store = rStore();
    document.querySelectorAll('#readerTabs button').forEach(b => b.classList.toggle('active', b.dataset.rmode === R.mode));
    $('readerReplay').classList.toggle('hidden', !(R.mode === 'ear' && R.running));
    ui.readerLevels.innerHTML = lvls.map((l, i) => {
      const st = (store[l.id] || {}).stars || 0;
      return `<button class="reader-level ${i === R.level ? 'active' : ''}" data-level="${i}" title="${escapeHtml(l.desc)}">
        <span>${escapeHtml(l.name)}</span><span class="reader-level-stars">${[1, 2, 3].map(k => `<i class="${k <= st ? 'on' : ''}">★</i>`).join('')}</span></button>`;
    }).join('');
    ui.readerDesc.textContent = lvl.desc;
    ui.readerCount.textContent = `${Math.min(R.idx, rRound())}/${rRound()}`;
    const avg = R.times.length ? R.times.reduce((a, b) => a + b, 0) / R.times.length / 1000 : 0;
    ui.readerPace.textContent = !R.times.length ? '' : R.mode === 'ear' ? `${R.firstTry} a la primera` : `${R.firstTry} a la primera, ${avg.toFixed(1)} s por nota`;
    ui.readerStart.textContent = R.running ? 'Reiniciar ronda' : R.result ? 'Otra ronda' : 'Empezar ronda';
    const ov = ui.readerOverlay;
    if (R.result) {
      const r = R.result;
      ov.innerHTML = `<div class="reader-result">
        <div class="results-stars">${[1, 2, 3].map(k => `<span class="${k <= r.stars ? 'on' : 'off'}">★</span>`).join('')}</div>
        <b>${R.firstTry} de ${rRound()} a la primera${R.mode === 'ear' ? '' : `, ${r.avg.toFixed(1)} s por nota`}</b>
        <p>${r.tip}</p>
        ${r.next != null ? `<button class="btn btn-primary" data-reader-next="${r.next}">Nivel siguiente</button>` : ''}
        <small class="piano-nav-inline">${r.next != null ? 'Tecla blanca: nivel siguiente · negra: otra ronda del mismo' : 'Tocá cualquier tecla para otra ronda'}</small>
      </div>`;
      ov.classList.add('visible');
    } else if (!R.running) {
      ov.innerHTML = R.mode === 'ear'
        ? '<div class="reader-idle">Tocá cualquier tecla para empezar<br><small>Suena una nota: buscala en tu teclado. 10 notas por ronda. Con auriculares, mejor.</small></div>'
        : '<div class="reader-idle">Tocá cualquier tecla para empezar<br><small>Aparece una nota: tocala en tu teclado. 20 notas por ronda.</small></div>';
      ov.classList.add('visible');
    } else {
      ov.classList.remove('visible');
    }
    drawReader();
  }

  function drawReader() {
    const cv = ui.readerCanvas;
    const W = cv.clientWidth || 640;
    const H = 270;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const STEP = 9;
    const yT = d => 50 + (38 - d) * STEP; // clave de Sol: líneas Mi4..Fa5
    const yB = d => 158 + (26 - d) * STEP; // clave de Fa: líneas Sol2..La3
    const x0 = 16;
    const x1 = W - 16;
    ctx.strokeStyle = 'rgba(216, 208, 194,0.6)';
    ctx.lineWidth = 1.2;
    for (const y of [30, 32, 34, 36, 38].map(yT).concat([18, 20, 22, 24, 26].map(yB))) {
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(216, 208, 194,0.85)';
    ctx.fillRect(x0, yT(38), 2, yB(18) - yT(38));
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = '92px "Segoe UI Symbol", "Noto Music", serif';
    ctx.fillText('𝄞', x0 + 6, yT(30) + 23);
    ctx.font = '64px "Segoe UI Symbol", "Noto Music", serif';
    ctx.fillText('𝄢', x0 + 10, yB(18) - 8);

    if (!R.queue.length) return;
    const now = performance.now();
    if (R.mode === 'ear') {
      // La última nota acertada se muestra escrita (une oído y lectura); la actual es un "?"
      const drawHead = (n, x, col) => {
        const y = n.clef === 'T' ? yT(n.d) : yB(n.d);
        ctx.strokeStyle = 'rgba(216, 208, 194,0.7)';
        ctx.lineWidth = 1.4;
        for (let L = 28; L >= n.d; L -= 2) {
          ctx.beginPath();
          ctx.moveTo(x - 18, yT(L));
          ctx.lineTo(x + 18, yT(L));
          ctx.stroke();
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.ellipse(x, y, 11, 7.5, -0.35, 0, Math.PI * 2);
        ctx.stroke();
        if (n.acc) {
          ctx.fillStyle = col;
          ctx.font = '700 26px "Segoe UI Symbol", system-ui, serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(n.acc === '#' ? '♯' : '♭', x - 16, n.acc === 'b' ? y - 5 : y);
        }
        ctx.fillStyle = col;
        ctx.font = '700 14px "Atkinson Hyperlegible", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(readNoteName(n), x, H - 6);
      };
      const cx = Math.max(200, W * 0.62);
      if (R.lastNote) drawHead(R.lastNote, cx - Math.min(150, W * 0.25), '#ddb978');
      const cur = R.queue[R.idx];
      if (cur && R.running) {
        if (R.tries >= 3) drawHead(cur, cx, '#e6c15e');
        else {
          let col = '#f7f2e8';
          if (R.flash && now < R.flash.until) col = R.flash.kind === 'good' ? '#ddb978' : '#cf6e4c';
          ctx.fillStyle = col;
          ctx.font = '800 64px "Atkinson Hyperlegible", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', cx, yT(32));
          ctx.font = '600 13px "Atkinson Hyperlegible", system-ui, sans-serif';
          ctx.fillStyle = 'rgba(216, 208, 194,0.75)';
          ctx.fillText('¿qué nota es?', cx, H - 10);
        }
      }
      ctx.textAlign = 'left';
      return;
    }
    const narrow = W < 520;
    const nx0 = narrow ? 112 : 150;
    const show = R.queue.slice(R.idx, R.idx + (narrow ? 3 : 4));
    const gap = Math.min(110, (x1 - nx0) / show.length);
    show.forEach((n, i) => {
      const x = nx0 + i * gap;
      const y = n.clef === 'T' ? yT(n.d) : yB(n.d);
      const ledgers = [];
      if (n.clef === 'T') {
        for (let L = 28; L >= n.d; L -= 2) ledgers.push(yT(L));
        for (let L = 40; L <= n.d; L += 2) ledgers.push(yT(L));
      } else {
        for (let L = 16; L >= n.d; L -= 2) ledgers.push(yB(L));
        for (let L = 28; L <= n.d; L += 2) ledgers.push(yB(L));
      }
      const current = i === 0;
      let col = current ? '#f7f2e8' : 'rgba(231, 224, 211,0.28)';
      if (current && R.flash && now < R.flash.until) col = R.flash.kind === 'good' ? '#ddb978' : '#cf6e4c';
      ctx.strokeStyle = current ? 'rgba(216, 208, 194,0.75)' : 'rgba(216, 208, 194,0.25)';
      ctx.lineWidth = 1.4;
      for (const ly of ledgers) {
        ctx.beginPath();
        ctx.moveTo(x - 18, ly);
        ctx.lineTo(x + 18, ly);
        ctx.stroke();
      }
      // Redonda (cabeza hueca)
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.ellipse(x, y, 11, 7.5, -0.35, 0, Math.PI * 2);
      ctx.stroke();
      if (n.acc) {
        ctx.fillStyle = col;
        ctx.font = '700 26px "Segoe UI Symbol", system-ui, serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.acc === '#' ? '♯' : '♭', x - 16, n.acc === 'b' ? y - 5 : y);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
      if (current) {
        ctx.fillStyle = 'rgba(221, 185, 120,0.09)';
        ctx.fillRect(x - 30, 14, 60, H - 28);
        if (R.tries >= 2) {
          ctx.fillStyle = '#e6c15e';
          ctx.font = '700 15px "Atkinson Hyperlegible", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(readNoteName(n), x, H - 4);
          ctx.textAlign = 'left';
        }
      }
    });
  }

  // Tecladito de una octava para responder sin teclado MIDI (celular, mouse)
  (function buildReaderPad() {
    const whites = [0, 2, 4, 5, 7, 9, 11];
    const blacks = [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]]; // [pc, posición: después de la blanca n]
    let html = whites.map((pc, i) => `<button class="pad-white" data-pc="${pc}" style="left:${(i / 7) * 100}%">${pc === 0 ? 'Do' : ''}</button>`).join('');
    html += blacks.map(([pc, pos]) => `<button class="pad-black" data-pc="${pc}" style="left:calc(${(pos / 7) * 100}% - 5.5%)"></button>`).join('');
    $('readerPad').innerHTML = html;
  })();
  $('readerPad').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-pc]');
    if (!b) return;
    e.preventDefault();
    audio.init();
    const pc = Number(b.dataset.pc);
    // Se toma la octava más cercana a la nota pedida: acá solo importa cuál nota es
    const ref = R.running ? R.queue[R.idx].midi : 60;
    let m = ref - (((ref - pc) % 12) + 12) % 12;
    if (ref - m > 6) m += 12;
    audio.noteOn(m, 90, 'user');
    setTimeout(() => audio.noteOff(m, 'user'), 350);
    markActivity();
    b.classList.add('down');
    setTimeout(() => b.classList.remove('down'), 160);
    readerPress(m);
  });

  document.querySelectorAll('#readerTabs button').forEach(b =>
    b.addEventListener('click', () => {
      stopReader();
      openReader(b.dataset.rmode);
    })
  );
  $('readerReplay').addEventListener('click', () => R.running && playEar(true));

  ui.readerLevels.addEventListener('click', e => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    R.level = Number(b.dataset.level);
    stopReader();
    ui.readerFeedback.textContent = '';
    renderReader();
  });
  ui.readerOverlay.addEventListener('click', e => {
    const b = e.target.closest('[data-reader-next]');
    if (!b) return;
    R.level = Number(b.dataset.readerNext);
    stopReader();
    startReader();
  });
  ui.readerStart.addEventListener('click', () => {
    audio.init();
    startReader();
  });
  $('btnOpenChords').addEventListener('click', () => {
    closeModal('settingsModal');
    openChords('play');
  });
  $('btnOpenReader').addEventListener('click', () => {
    closeModal('settingsModal');
    openReader();
  });

  // --------------------------------------------------------------------------
  // ACORDES: tocar acordes por su nombre, progresiones a tempo y reconocer de oído.
  // Pensado para tocar canciones con cifrado (C, Am, F, G…) sin necesidad de leer partitura.
  // --------------------------------------------------------------------------
  const ROOT_EN = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const ROOT_ES = ['Do', 'Do#', 'Re', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
  const CHORD_TYPES = {
    '': { iv: [0, 4, 7], es: 'mayor', feel: 'alegre, estable' },
    m: { iv: [0, 3, 7], es: 'menor', feel: 'triste, melancólico' },
    7: { iv: [0, 4, 7, 10], es: 'séptima', feel: 'tenso, "quiere ir a otro lado"' },
    maj7: { iv: [0, 4, 7, 11], es: 'séptima mayor', feel: 'suave, soñador' },
    m7: { iv: [0, 3, 7, 10], es: 'menor séptima', feel: 'relajado, soul' },
    dim: { iv: [0, 3, 6], es: 'disminuido', feel: 'suspenso' },
    sus4: { iv: [0, 5, 7], es: 'suspendido 4', feel: 'abierto, épico' },
    sus2: { iv: [0, 2, 7], es: 'suspendido 2', feel: 'aireado' }
  };
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // "Am" → { root: 9, type: 'm', bass: null } · "C/E" → bajo en Mi
  function parseChord(sym) {
    const m = /^([A-G])(#|b)?(maj7|m7|m|7|dim|sus4|sus2)?(?:\/([A-G])(#|b)?)?$/.exec(sym);
    if (!m) throw new Error('Acorde inválido: ' + sym);
    const acc = a => (a === '#' ? 1 : a === 'b' ? -1 : 0);
    const root = (LETTER_PC[m[1]] + acc(m[2]) + 12) % 12;
    const bass = m[4] ? (LETTER_PC[m[4]] + acc(m[5]) + 12) % 12 : null;
    return { root, type: m[3] || '', bass };
  }
  const chordSym = c => ROOT_EN[c.root] + c.type + (c.bass != null ? '/' + ROOT_EN[c.bass] : '');
  const chordEs = c => `${ROOT_ES[c.root]} ${CHORD_TYPES[c.type].es}${c.bass != null ? ` con bajo en ${ROOT_ES[c.bass]}` : ''}`;
  const chordPcs = c => CHORD_TYPES[c.type].iv.map(i => (c.root + i) % 12);
  const pcName = pc => (settings.noteNames === 'en' ? ROOT_EN : ROOT_ES)[pc];

  // Posición en el teclado (alrededor del Do central); con 'prev', la inversión que menos mueve la mano
  function voicing(c, prev) {
    const pcs = chordPcs(c);
    const cands = [];
    for (let r = 0; r < pcs.length; r++) {
      const rot = pcs.slice(r).concat(pcs.slice(0, r));
      if (c.bass != null && rot[0] !== c.bass) continue;
      for (let low = 52; low <= 67; low++) {
        if (MT.pc(low) !== rot[0]) continue;
        const v = [low];
        for (let i = 1; i < rot.length; i++) {
          let n = v[i - 1] + 1;
          while (MT.pc(n) !== rot[i]) n++;
          v.push(n);
        }
        if (v[v.length - 1] <= 81) cands.push({ v, r });
      }
    }
    if (!cands.length) return pcs.map(p => 60 + p);
    const center = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    let best = null;
    for (const cd of cands) {
      let cost;
      if (!prev) cost = (cd.r === 0 || c.bass != null ? 0 : 6) + Math.abs(center(cd.v) - 64) * 0.5;
      else cost = cd.v.reduce((a, n) => a + Math.min(...prev.map(p => Math.abs(p - n))), 0) + Math.abs(center(cd.v) - 64) * 0.15;
      if (!best || cost < best.cost) best = { v: cd.v, cost };
    }
    return best.v;
  }

  const CHORD_LEVELS = [
    { id: 'c1', name: 'Nivel 1 · Do, Fa y Sol', desc: 'Los 3 acordes mayores de la tonalidad de Do. Con ellos ya acompañás cientos de canciones. Mayor = nota base + 4 semitonos + 3 semitonos.', chords: ['C', 'F', 'G'] },
    { id: 'c2', name: 'Nivel 2 · Los 6 de Do', desc: 'Sumamos los menores: Am, Dm y Em. Menor = nota base + 3 semitonos + 4 (la del medio baja medio tono).', chords: ['C', 'Dm', 'Em', 'F', 'G', 'Am'] },
    { id: 'c3', name: 'Nivel 3 · Mayores', desc: 'Acordes mayores sobre todas las teclas blancas. Algunos llevan teclas negras (D, E, A, B).', chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] },
    { id: 'c4', name: 'Nivel 4 · Menores', desc: 'Acordes menores sobre todas las teclas blancas.', chords: ['Cm', 'Dm', 'Em', 'Fm', 'Gm', 'Am', 'Bm'] },
    { id: 'c5', name: 'Nivel 5 · Teclas negras', desc: 'Mayores y menores que empiezan en tecla negra: los que aparecen en muchas canciones (Bb, Eb, F#m…).', chords: ['Bb', 'Eb', 'Ab', 'Db', 'F#', 'F#m', 'C#m', 'Bbm', 'Ebm', 'G#m'] },
    { id: 'c6', name: 'Nivel 6 · Séptimas', desc: 'Cuatro notas. 7 = mayor + séptima menor (tensión). maj7 = séptima mayor (soñador). m7 = menor + séptima (soul).', chords: ['G7', 'C7', 'D7', 'A7', 'E7', 'Cmaj7', 'Fmaj7', 'Am7', 'Dm7', 'Em7'] },
    { id: 'c7', name: 'Nivel 7 · Inversiones', desc: 'La barra indica la nota de abajo: C/E es Do mayor con Mi como nota más grave. Sirve para mover poco la mano.', chords: ['C/E', 'C/G', 'F/A', 'F/C', 'G/B', 'G/D', 'Am/C', 'Am/E', 'Dm/F', 'Em/G'] }
  ];

  const PROGS = [
    { id: 'p1', name: 'I – IV – V – I', desc: 'La base del rock and roll, el folk y miles de canciones.', degrees: ['I', 'IV', 'V', 'I'] },
    { id: 'p2', name: 'I – V – vi – IV', desc: 'Los "4 acordes del pop": suenan en cientos de hits de las últimas décadas.', degrees: ['I', 'V', 'vi', 'IV'] },
    { id: 'p3', name: 'vi – IV – I – V', desc: 'Los mismos 4 acordes empezando por el menor: suena más emotiva.', degrees: ['vi', 'IV', 'I', 'V'] },
    { id: 'p4', name: 'I – vi – IV – V', desc: 'La de los años 50 (doo-wop): romántica y clásica.', degrees: ['I', 'vi', 'IV', 'V'] },
    { id: 'p5', name: 'ii – V – I', desc: 'El corazón del jazz y la bossa nova, con séptimas.', degrees: ['ii7', 'V7', 'Imaj7', 'Imaj7'] },
    { id: 'p6', name: 'Blues de 12 compases', desc: 'La forma del blues y de mucho rock: 12 compases que se repiten.', degrees: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'] }
  ];
  const PROG_KEYS = [0, 7, 5, 2, 9]; // Do, Sol, Fa, Re, La (mayor)
  const DEGREE = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

  function degreeChord(deg, key) {
    const m = /^(i{1,3}|iv|v|vi{0,2}|I{1,3}|IV|V|VI{0,2})(maj7|7)?$/.exec(deg);
    const roman = m[1];
    const upper = roman === roman.toUpperCase();
    let type = upper ? '' : 'm';
    if (m[2] === '7') type = upper ? '7' : 'm7';
    if (m[2] === 'maj7') type = 'maj7';
    return { root: (key + DEGREE[roman.toUpperCase()]) % 12, type, bass: null };
  }

  const CEAR_LEVELS = [
    { id: 'h1', name: 'Nivel 1 · Mayor o menor', desc: 'Suena un acorde (primero junto, después nota por nota). ¿Es mayor (alegre) o menor (triste)?', kinds: ['', 'm'] },
    { id: 'h2', name: 'Nivel 2 · + séptima', desc: 'Mayor, menor o séptima de dominante (tenso, como que "pide" resolver).', kinds: ['', 'm', '7'] },
    { id: 'h3', name: 'Nivel 3 · Todos los colores', desc: 'Mayor, menor, séptima, séptima mayor, disminuido y suspendido.', kinds: ['', 'm', '7', 'maj7', 'dim', 'sus4'] },
    { id: 'h4', name: 'Nivel 4 · ¿Qué grado es?', desc: 'Suena Do mayor (la "casa") y después otro acorde de la tonalidad. ¿Cuál es? I, ii, iii, IV, V o vi.', degrees: ['I', 'ii', 'iii', 'IV', 'V', 'vi'] },
    { id: 'h5', name: 'Nivel 5 · ¿Qué progresión es?', desc: 'Suena una progresión de 4 acordes en cualquier tonalidad. ¿Cuál de las conocidas es?', progs: ['p1', 'p2', 'p3', 'p4'] }
  ];

  const CH_ROUND = 12;
  const CE_ROUND = 10;
  const K = {
    tab: 'play', level: 0, running: false, queue: [], idx: 0, firstTry: 0, tries: 0, times: [], noteAt: 0, armed: true, revealed: false,
    result: null, finishedAt: 0, pad: new Set(), flash: null, evalTimer: 0,
    prog: { id: 'p2', key: 0, bpm: 70, listen: false, show: true, running: false, startAt: 0, chords: [], voicings: [], judged: [], timer: 0, raf: 0, nextBeat: 0, total: 0, done: false },
    ear: { level: 0, running: false, queue: [], idx: 0, firstTry: 0, tries: 0, result: null, locked: false }
  };
  progress.chords = progress.chords || {};
  progress.progs = progress.progs || {};
  progress.chordEar = progress.chordEar || {};

  const chordsOpen = () => $('chordsModal').classList.contains('open');
  const recommendedChordLevel = () => CHORD_LEVELS.find(l => ((progress.chords[l.id] || {}).stars || 0) < 2) || CHORD_LEVELS[CHORD_LEVELS.length - 1];
  const starRow = n => [1, 2, 3].map(k => `<i class="${k <= n ? 'on' : ''}">★</i>`).join('');

  function openChords(tab = 'play') {
    pause();
    stopProg();
    K.tab = tab;
    K.running = false;
    K.result = null;
    K.pad.clear();
    K.level = CHORD_LEVELS.indexOf(recommendedChordLevel());
    const el = CEAR_LEVELS.find(l => ((progress.chordEar[l.id] || {}).stars || 0) < 2) || CEAR_LEVELS[0];
    K.ear.level = CEAR_LEVELS.indexOf(el);
    K.ear.running = false;
    K.ear.result = null;
    openModal('chordsModal');
    renderChords();
  }

  // Nombre del acorde que está sonando: "Cm (Do menor)"; si no es un acorde conocido, las notas
  function identifyChord(held) {
    const pcs = [...new Set(held.map(m => MT.pc(m)))];
    for (const root of pcs) {
      const rel = pcs.map(p => (p - root + 12) % 12).sort((a, b) => a - b);
      for (const [type, def] of Object.entries(CHORD_TYPES)) {
        if (def.iv.length === rel.length && def.iv.every((v, i) => v === rel[i])) {
          const bass = MT.pc(held[0]) !== root ? MT.pc(held[0]) : null;
          const c = { root, type, bass };
          return `${chordSym(c)} (${chordEs(c)})`;
        }
      }
    }
    return pcs.map(pcName).join(' + ');
  }

  function heldNotes() {
    const set = new Set([...S.userKeys.keys(), ...K.pad]);
    return [...set].sort((a, b) => a - b);
  }

  // Llega una nota (o se suelta) con la ventana de acordes abierta
  function chordInput(on) {
    if (K.tab === 'ear') {
      if (on != null) earAnswerFromKey(on);
      return;
    }
    clearTimeout(K.evalTimer);
    if (on == null) evaluateChord(); // al soltar: re-evaluar enseguida
    else K.evalTimer = setTimeout(evaluateChord, 110); // las notas de un acorde llegan con milisegundos de diferencia
    drawChordKeys();
  }

  function evaluateChord() {
    drawChordKeys();
    const held = heldNotes();
    if (K.tab === 'prog') return progCheck(held);
    if (!held.length) {
      K.armed = true;
      return;
    }
    if (!K.running) {
      if (K.result && performance.now() - K.finishedAt < 900) return;
      if (K.result && K.result.next != null && !MT.isBlackKey(held[0])) K.level = K.result.next;
      startChordRound();
      K.armed = false;
      return;
    }
    const target = K.queue[K.idx];
    const T = new Set(chordPcs(target));
    const H = new Set(held.map(m => MT.pc(m)));
    const okSet = H.size === T.size && [...T].every(p => H.has(p));
    const okBass = target.bass == null || MT.pc(held[0]) === target.bass;
    if (okSet && okBass) return chordSuccess(target);
    if (!K.armed || held.length < T.size) return;
    // Intento fallido: explicar qué pasó
    K.armed = false;
    K.tries++;
    const missing = [...T].filter(p => !H.has(p)).map(pcName);
    const extra = [...H].filter(p => !T.has(p)).map(pcName);
    const got = identifyChord(held);
    let msg;
    if (okSet && !okBass) msg = `Las notas están bien, pero la más grave tiene que ser <b>${pcName(target.bass)}</b>.`;
    else {
      msg = `Tocaste ${got ? `<b>${escapeHtml(got)}</b>` : 'otra cosa'}.`;
      if (missing.length) msg += ` Falta: <b>${missing.join(', ')}</b>.`;
      if (extra.length) msg += ` Sobra: <b>${extra.join(', ')}</b>.`;
    }
    if (K.tries >= 2) {
      K.revealed = true;
      msg += ' Mirá el tecladito: ahí está marcado.';
    }
    K.flash = { kind: 'bad', until: performance.now() + 300 };
    setChordFeedback(msg, 'warn');
    if (K.pad.size) setTimeout(() => {
      K.pad.clear();
      K.armed = true;
      drawChordKeys();
    }, 700);
    renderChordStage();
  }

  function chordSuccess(target) {
    const now = performance.now();
    if (K.tries === 0 && !K.revealed) K.firstTry++;
    K.times.push(now - K.noteAt);
    K.flash = { kind: 'good', until: now + 260 };
    setChordFeedback(`✓ <b>${chordSym(target)}</b>, ${chordEs(target)}`, 'good');
    K.idx++;
    K.tries = 0;
    K.revealed = false;
    K.armed = false;
    K.noteAt = now;
    K.pad.clear();
    if (K.idx >= K.queue.length) finishChordRound();
    renderChordStage();
    drawChordKeys();
  }

  function startChordRound() {
    const pool = CHORD_LEVELS[K.level].chords.map(parseChord);
    const q = [];
    while (q.length < CH_ROUND) {
      const c = pool[Math.floor(Math.random() * pool.length)];
      const prev = q[q.length - 1];
      if (prev && chordSym(prev) === chordSym(c) && pool.length > 1) continue;
      q.push(c);
    }
    Object.assign(K, { running: true, queue: q, idx: 0, firstTry: 0, tries: 0, times: [], result: null, revealed: false, noteAt: performance.now() });
    K.pad.clear();
    setChordFeedback('Tocá el acorde (en cualquier octava y posición). Si lo necesitás, Mostrame.', '');
    renderChords();
  }

  function finishChordRound() {
    K.running = false;
    K.finishedAt = performance.now();
    const lvl = CHORD_LEVELS[K.level];
    const acc = K.firstTry / CH_ROUND;
    const avg = mean(K.times) / 1000;
    const stars = acc >= 0.9 && avg <= 3 ? 3 : acc >= 0.9 ? 2 : acc >= 0.7 ? 1 : 0;
    const rec = progress.chords[lvl.id] || { stars: 0, rounds: 0 };
    const prev = rec.stars || 0;
    rec.stars = Math.max(prev, stars);
    rec.rounds = (rec.rounds || 0) + 1;
    progress.chords[lvl.id] = rec;
    todayRec().read = true;
    saveProgress();
    const next = CHORD_LEVELS[K.level + 1];
    let tip;
    if (stars >= 2 && next) tip = `¡Nivel superado! Seguí con <b>${escapeHtml(next.name)}</b>.`;
    else if (stars >= 2) tip = '¡Ya sabés todos los acordes del entrenador! Ahora usalos en Progresiones.';
    else tip = 'Otra ronda del mismo nivel. Truco: contá semitonos desde la nota base (mayor = 4 + 3, menor = 3 + 4).';
    if (stars === 2) tip += ' Para la ★★★: menos de 3 segundos por acorde.';
    K.result = { acc, avg, stars, tip, next: stars >= 2 && next ? K.level + 1 : null };
    audio.chime(stars > prev ? 'star' : 'success');
    renderChords();
  }

  function setChordFeedback(html, kind) {
    const el = $('chordFeedback');
    el.innerHTML = html;
    el.className = 'reader-feedback ' + (kind || '');
  }

  // ---------- Progresiones a tempo ----------
  function progSetup() {
    const p = PROGS.find(x => x.id === K.prog.id) || PROGS[1];
    const chords = p.degrees.map(d => degreeChord(d, K.prog.key));
    const voicings = [];
    chords.forEach((c, i) => voicings.push(voicing(c, i ? voicings[i - 1] : null)));
    K.prog.chords = chords;
    K.prog.voicings = voicings;
    return p;
  }

  function startProg() {
    stopProg();
    audio.init();
    progSetup();
    const P = K.prog;
    const beat = 60 / P.bpm;
    P.passes = 2;
    P.total = P.chords.length * P.passes;
    P.judged = new Array(P.total).fill(null);
    P.startAt = audio.now() + 0.25;
    P.nextBeat = 0;
    P.running = true;
    P.done = false;
    P.timer = setInterval(() => {
      // Programar clicks y acordes con anticipación (ritmo preciso)
      const horizon = audio.now() + 0.2;
      while (P.running && P.startAt + P.nextBeat * beat < horizon && P.nextBeat < 4 + P.total * 4) {
        const k = P.nextBeat;
        const when = P.startAt + k * beat;
        audio.click(k % 4 === 0, when);
        if (k >= 4 && (k - 4) % 4 === 0 && P.listen) {
          const bar = (k - 4) / 4;
          const v = P.voicings[bar % P.chords.length];
          for (const n of v) audio.playScheduled(n, 70, when, beat * 3.9);
          audio.playScheduled(chordRootBass(P.chords[bar % P.chords.length]), 74, when, beat * 3.9);
        }
        P.nextBeat++;
      }
      progCheck(heldNotes());
      renderProgCards();
      if (audio.now() > P.startAt + (4 + P.total * 4) * beat + 0.3) finishProg();
    }, 40);
    const loop = () => {
      if (!P.running) return;
      progCheck(heldNotes());
      renderProgCards();
      drawChordKeys();
      P.raf = requestAnimationFrame(loop);
    };
    P.raf = requestAnimationFrame(loop);
    setChordFeedback(P.listen ? 'Escuchá: la PC toca la progresión. Después probala vos.' : 'Cuenta de 4 y arrancá. Cambiá de acorde justo en el "1" de cada compás.', '');
    renderChords();
  }

  const chordRootBass = c => {
    let b = 36 + (c.bass != null ? c.bass : c.root);
    if (b < 40) b += 12;
    return b;
  };

  function progBeatPos() {
    const P = K.prog;
    return (audio.now() - P.startAt) / (60 / P.bpm) - 4; // en pulsos, 0 = primer acorde
  }

  function progCheck(held) {
    const P = K.prog;
    if (!P.running || P.listen) return;
    const pos = progBeatPos();
    if (pos < -0.6) return;
    const H = new Set(held.map(m => MT.pc(m)));
    // Compases que ya pasaron sin el acorde: no llegó
    for (let b = 0; b < P.total; b++) {
      if (P.judged[b] === null && pos > b * 4 + 3.6) P.judged[b] = 'miss';
    }
    if (!held.length) return;
    for (const b of [Math.floor(pos / 4), Math.floor(pos / 4) + 1]) {
      if (b < 0 || b >= P.total || P.judged[b] !== null) continue;
      const off = pos - b * 4;
      if (off < -0.6 || off > 3.6) continue;
      const T = chordPcs(P.chords[b % P.chords.length]);
      if (H.size === T.length && T.every(p => H.has(p))) {
        P.judged[b] = Math.abs(off) <= 0.5 ? 'ok' : 'late';
      }
    }
  }

  function stopProg() {
    const P = K.prog;
    if (P.timer) clearInterval(P.timer);
    if (P.raf) cancelAnimationFrame(P.raf);
    P.timer = 0;
    P.raf = 0;
    if (P.running) audio.stopAuto();
    P.running = false;
  }

  function finishProg() {
    const P = K.prog;
    stopProg();
    P.done = true;
    if (P.listen) {
      setChordFeedback('Listo. Ahora apagá "La PC toca" y tocala vos.', 'good');
      renderChords();
      return;
    }
    const ok = P.judged.filter(x => x === 'ok').length;
    const late = P.judged.filter(x => x === 'late').length;
    const miss = P.judged.filter(x => x === 'miss' || x === null).length;
    const score = (ok + late * 0.5) / P.total;
    const stars = score >= 0.95 ? 3 : score >= 0.8 ? 2 : score >= 0.6 ? 1 : 0;
    const rec = progress.progs[P.id] || { stars: 0, bpm: 0 };
    const prev = rec.stars || 0;
    rec.stars = Math.max(prev, stars);
    if (stars >= 2) rec.bpm = Math.max(rec.bpm || 0, P.bpm);
    progress.progs[P.id] = rec;
    todayRec().read = true;
    saveProgress();
    let tip;
    if (late > ok) tip = 'Llegás tarde a los cambios: mirá el acorde que viene y mové la mano en el pulso 4, antes del "1".';
    else if (miss > P.total / 3) tip = 'Bajá el tempo o prendé "La PC toca" para escucharla primero. Con "Posiciones" ves la forma más cómoda.';
    else if (stars >= 2) tip = P.bpm < 90 ? '¡Muy bien! Subí el tempo o probala en otra tonalidad.' : '¡Excelente! Probala en otra tonalidad: las formas de la mano se repiten.';
    else tip = 'Practicá los cambios de a dos acordes, sin tempo, hasta que salgan sin mirar.';
    setChordFeedback(`${starString(stars)} <b>${ok}</b> a tiempo, <b>${late}</b> tarde, <b>${miss}</b> no llegaron. ${tip}`, stars >= 2 ? 'good' : 'warn');
    audio.chime(stars > prev ? 'star' : 'success');
    renderChords();
  }

  function renderProgCards() {
    const P = K.prog;
    const box = $('progCards');
    if (!box) return;
    const pos = P.running ? progBeatPos() : -99;
    const cur = pos >= 0 ? Math.floor(pos / 4) : -1;
    const pass = cur >= 0 ? Math.floor(cur / P.chords.length) : 0;
    [...box.children].forEach((el, i) => {
      const b = pass * P.chords.length + i;
      el.classList.toggle('now', P.running && cur >= 0 && cur % P.chords.length === i);
      el.classList.toggle('next', P.running && (cur + 1) % P.chords.length === i && pos > cur * 4 + 2);
      const j = P.judged[b] || (pass > 0 ? P.judged[b - P.chords.length] : null);
      el.dataset.j = P.running || P.done ? j || '' : '';
    });
    const cnt = $('chordCount');
    if (P.running) cnt.textContent = pos < 0 ? `${Math.ceil(-pos)}…` : `Vuelta ${pass + 1}/${P.passes}`;
  }

  // ---------- Reconocer de oído ----------
  function earOptions(lvl) {
    if (lvl.kinds) return lvl.kinds.map(k => ({ v: k, label: k === '' ? 'Mayor' : k === 'm' ? 'Menor' : `${CHORD_TYPES[k].es} (${k})` }));
    if (lvl.degrees) return lvl.degrees.map(d => ({ v: d, label: `${d} (${chordSym(degreeChord(d, 0))})` }));
    return lvl.progs.map(id => ({ v: id, label: PROGS.find(p => p.id === id).name }));
  }

  function startEar() {
    const E = K.ear;
    const lvl = CEAR_LEVELS[E.level];
    const opts = earOptions(lvl);
    const q = [];
    while (q.length < CE_ROUND) {
      const o = opts[Math.floor(Math.random() * opts.length)];
      q.push({ answer: o.v, root: Math.floor(Math.random() * 12), key: PROG_KEYS[Math.floor(Math.random() * PROG_KEYS.length)] });
    }
    Object.assign(E, { running: true, queue: q, idx: 0, firstTry: 0, tries: 0, result: null, locked: false });
    setChordFeedback('Escuchá y elegí. También podés responder con el piano: Do = opción 1, Re = 2, Mi = 3…', '');
    renderChords();
    setTimeout(playEarChord, 300);
  }

  function playEarChord() {
    const E = K.ear;
    const q = E.queue[E.idx];
    if (!q) return;
    audio.init();
    const lvl = CEAR_LEVELS[E.level];
    let t = audio.now() + 0.08;
    const block = (c, at, dur) => voicing(c).forEach(n => audio.playScheduled(n, 78, at, dur));
    if (lvl.kinds) {
      const c = { root: q.root, type: q.answer, bass: null };
      block(c, t, 1.3);
      voicing(c).forEach((n, i) => audio.playScheduled(n, 74, t + 1.5 + i * 0.32, 0.5));
    } else if (lvl.degrees) {
      block({ root: 0, type: '', bass: null }, t, 1.0);
      block(degreeChord(q.answer, 0), t + 1.3, 1.4);
    } else {
      const p = PROGS.find(x => x.id === q.answer);
      let prev = null;
      p.degrees.forEach((d, i) => {
        const c = degreeChord(d, q.key);
        prev = voicing(c, prev);
        prev.forEach(n => audio.playScheduled(n, 74, t + i * 1.4, 1.3));
        audio.playScheduled(chordRootBass(c), 76, t + i * 1.4, 1.3);
      });
    }
  }

  function earAnswer(v) {
    const E = K.ear;
    if (!E.running || E.locked) return;
    const q = E.queue[E.idx];
    const lvl = CEAR_LEVELS[E.level];
    if (v === q.answer) {
      if (E.tries === 0) E.firstTry++;
      const lbl = earOptions(lvl).find(o => o.v === v).label;
      setChordFeedback(`✓ ¡Sí! Era <b>${escapeHtml(lbl)}</b>.`, 'good');
      advanceEar();
    } else {
      E.tries++;
      if (E.tries >= 2) {
        const lbl = earOptions(lvl).find(o => o.v === q.answer).label;
        setChordFeedback(`Era <b>${escapeHtml(lbl)}</b>. Escuchala otra vez y fijate en el "color".`, 'warn');
        E.reveal = q.answer;
        renderChordStage();
        playEarChord();
        advanceEar(3200);
      } else {
        setChordFeedback('No. Escuchá otra vez…', 'warn');
        playEarChord();
      }
    }
  }

  function advanceEar(delay = 900) {
    const E = K.ear;
    E.locked = true;
    setTimeout(() => {
      E.idx++;
      E.tries = 0;
      E.locked = false;
      E.reveal = null;
      if (E.idx >= CE_ROUND) return finishEar();
      renderChordStage();
      playEarChord();
    }, delay);
  }

  function earAnswerFromKey(midi) {
    const E = K.ear;
    if (!E.running) {
      if (E.result && performance.now() - (E.finishedAt || 0) < 900) return;
      if (E.result && E.result.next != null && !MT.isBlackKey(midi)) E.level = E.result.next;
      return startEar();
    }
    if (MT.isBlackKey(midi)) return playEarChord(); // negra = repetir
    const idx = [0, 2, 4, 5, 7, 9, 11].indexOf(MT.pc(midi));
    const opts = earOptions(CEAR_LEVELS[E.level]);
    if (idx >= 0 && idx < opts.length) earAnswer(opts[idx].v);
  }

  function finishEar() {
    const E = K.ear;
    E.running = false;
    E.finishedAt = performance.now();
    const lvl = CEAR_LEVELS[E.level];
    const acc = E.firstTry / CE_ROUND;
    const stars = acc >= 1 ? 3 : acc >= 0.8 ? 2 : acc >= 0.6 ? 1 : 0;
    const rec = progress.chordEar[lvl.id] || { stars: 0 };
    const prev = rec.stars || 0;
    rec.stars = Math.max(prev, stars);
    progress.chordEar[lvl.id] = rec;
    todayRec().read = true;
    saveProgress();
    const next = CEAR_LEVELS[E.level + 1];
    E.result = { stars, acc, next: stars >= 2 && next ? E.level + 1 : null };
    setChordFeedback(
      `${starString(stars)} <b>${E.firstTry} de ${CE_ROUND}</b> a la primera. ${stars >= 2 && next ? `¡Nivel superado! Tecla blanca: <b>${escapeHtml(next.name)}</b>.` : 'Tocá una tecla para otra ronda.'}`,
      stars >= 2 ? 'good' : 'warn'
    );
    audio.chime(stars > prev ? 'star' : 'success');
    renderChords();
  }

  // ---------- Dibujo ----------
  function renderChords() {
    document.querySelectorAll('#chordTabs button').forEach(b => b.classList.toggle('active', b.dataset.ctab === K.tab));
    const lv = $('chordLevels');
    const actions = $('chordActions');
    $('chordKeysWrap').classList.toggle('hidden', K.tab === 'ear');
    if (K.tab === 'play') {
      lv.innerHTML = CHORD_LEVELS.map((l, i) => `<button class="reader-level ${i === K.level ? 'active' : ''}" data-clevel="${i}" title="${escapeHtml(l.desc)}"><span>${escapeHtml(l.name)}</span><span class="reader-level-stars">${starRow((progress.chords[l.id] || {}).stars || 0)}</span></button>`).join('');
      $('chordDesc').textContent = CHORD_LEVELS[K.level].desc;
      actions.innerHTML = `${K.running ? '<button class="btn" id="chordHint">Mostrame</button>' : ''}<button class="btn btn-primary" id="chordStart">${K.running ? 'Reiniciar' : K.result ? 'Otra ronda' : 'Empezar ronda'}</button>`;
      $('chordCount').textContent = K.running || K.result ? `${Math.min(K.idx, CH_ROUND)}/${CH_ROUND}` : '';
      $('chordPace').textContent = K.times.length ? `${K.firstTry} a la primera, ${(mean(K.times) / 1000).toFixed(1)} s por acorde` : '';
    } else if (K.tab === 'prog') {
      const P = K.prog;
      lv.innerHTML = PROGS.map(p => `<button class="reader-level ${p.id === P.id ? 'active' : ''}" data-prog="${p.id}" title="${escapeHtml(p.desc)}"><span>${escapeHtml(p.name)}</span><span class="reader-level-stars">${starRow((progress.progs[p.id] || {}).stars || 0)}</span></button>`).join('');
      const p = PROGS.find(x => x.id === P.id);
      $('chordDesc').textContent = `${p.desc} Cada acorde dura un compás de 4 pulsos; se toca 2 veces.`;
      actions.innerHTML = `
        <div class="prog-opts">
          <span>Tonalidad</span><div class="seg seg-sm" id="progKey">${PROG_KEYS.map(k => `<button data-k="${k}" class="${k === P.key ? 'active' : ''}">${ROOT_EN[k]}</button>`).join('')}</div>
          <span>Tempo</span><div class="seg seg-sm" id="progBpm">${[60, 75, 90, 110].map(b => `<button data-b="${b}" class="${b === P.bpm ? 'active' : ''}">${b}</button>`).join('')}</div>
          <label class="loop-auto"><input type="checkbox" id="progListen" ${P.listen ? 'checked' : ''}/> La PC toca</label>
          <label class="loop-auto"><input type="checkbox" id="progShow" ${P.show ? 'checked' : ''}/> Posiciones</label>
        </div>
        <button class="btn btn-primary" id="progStart">${P.running ? 'Parar' : 'Tocar progresión'}</button>`;
      $('chordCount').textContent = '';
      $('chordPace').textContent = '';
    } else {
      const E = K.ear;
      lv.innerHTML = CEAR_LEVELS.map((l, i) => `<button class="reader-level ${i === E.level ? 'active' : ''}" data-elevel="${i}" title="${escapeHtml(l.desc)}"><span>${escapeHtml(l.name)}</span><span class="reader-level-stars">${starRow((progress.chordEar[l.id] || {}).stars || 0)}</span></button>`).join('');
      $('chordDesc').textContent = CEAR_LEVELS[E.level].desc;
      actions.innerHTML = `${E.running ? '<button class="btn" id="earReplay">Repetir</button>' : ''}<button class="btn btn-primary" id="earStart">${E.running ? 'Reiniciar' : E.result ? 'Otra ronda' : 'Empezar ronda'}</button>`;
      $('chordCount').textContent = E.running || E.result ? `${Math.min(E.idx + (E.running ? 1 : 0), CE_ROUND)}/${CE_ROUND}` : '';
      $('chordPace').textContent = '';
    }
    renderChordStage();
    drawChordKeys();
  }

  function renderChordStage() {
    const st = $('chordStage');
    const now = performance.now();
    if (K.tab === 'play') {
      if (K.result && !K.running) {
        const r = K.result;
        st.innerHTML = `<div class="chord-result"><div class="results-stars">${[1, 2, 3].map(k => `<span class="${k <= r.stars ? 'on' : 'off'}">★</span>`).join('')}</div>
          <b>${K.firstTry} de ${CH_ROUND} a la primera, ${r.avg.toFixed(1)} s por acorde</b><p>${r.tip}</p>
          ${r.next != null ? `<button class="btn btn-primary" data-cnext="${r.next}">Nivel siguiente</button>` : ''}
          <small class="piano-nav-inline">${r.next != null ? 'Tecla blanca: nivel siguiente · negra: otra ronda' : 'Tocá cualquier tecla para otra ronda'}</small></div>`;
      } else if (!K.running) {
        st.innerHTML = '<div class="reader-idle">Tocá cualquier tecla para empezar<br><small>Aparece el nombre de un acorde (como en las canciones con cifrado) y lo tocás. 12 por ronda.</small></div>';
      } else {
        const c = K.queue[K.idx];
        const nxt = K.queue[K.idx + 1];
        const flash = K.flash && now < K.flash.until ? K.flash.kind : '';
        st.innerHTML = `<div class="chord-big ${flash}"><div class="chord-sym">${chordSym(c)}</div><div class="chord-es">${chordEs(c)}</div>
          <div class="chord-feel">${CHORD_TYPES[c.type].feel}</div></div>${nxt ? `<div class="chord-next">Después: <b>${chordSym(nxt)}</b></div>` : ''}`;
        if (flash) setTimeout(renderChordStage, 280);
      }
    } else if (K.tab === 'prog') {
      progSetup();
      const P = K.prog;
      st.innerHTML = `<div id="progCards" class="prog-cards">${P.chords
        .map((c, i) => {
          const p = PROGS.find(x => x.id === P.id);
          const notes = P.voicings[i].map(n => pcName(MT.pc(n))).join('·');
          return `<div class="prog-card"><div class="pc-sym">${chordSym(c)}</div><div class="pc-deg">${p.degrees[i]}</div><div class="pc-notes">${P.show ? notes : ''}</div></div>`;
        })
        .join('')}</div>`;
      renderProgCards();
    } else {
      const E = K.ear;
      const lvl = CEAR_LEVELS[E.level];
      if (!E.running && !E.result) {
        st.innerHTML = '<div class="reader-idle">Tocá cualquier tecla para empezar<br><small>Suena un acorde (o una progresión) y elegís qué es. Con auriculares, mejor.</small></div>';
        return;
      }
      if (!E.running) {
        st.innerHTML = '<div class="reader-idle">Ronda terminada<br><small>Tecla blanca: seguir · o Otra ronda</small></div>';
        return;
      }
      const keysLbl = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La'];
      st.innerHTML = `<div class="ear-q">¿Qué escuchaste?</div><div class="ear-opts">${earOptions(lvl)
        .map((o, i) => `<button class="btn ear-opt ${E.reveal === o.v ? 'reveal' : ''}" data-ans="${escapeHtml(o.v)}"><span class="ear-key">${keysLbl[i]}</span>${escapeHtml(o.label)}</button>`)
        .join('')}</div>`;
    }
  }

  // Tecladito de 3 octavas: muestra lo que tocás, la posición sugerida y se puede tocar con el dedo
  function chordKeyRange() {
    const W = $('chordKeys').clientWidth || 600;
    return W < 520 ? [53, 79] : [48, 83];
  }
  function chordKeyGeom() {
    const cv = $('chordKeys');
    const W = cv.clientWidth || 600;
    const H = 96;
    const [lo, hi] = chordKeyRange();
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!MT.isBlackKey(m)) whites.push(m);
    const ww = W / whites.length;
    const geom = {};
    whites.forEach((m, i) => (geom[m] = { x: i * ww, w: ww, h: H, black: false }));
    for (let m = lo; m <= hi; m++) {
      if (!MT.isBlackKey(m) || !geom[m - 1]) continue;
      geom[m] = { x: geom[m - 1].x + ww * 0.66, w: ww * 0.68, h: H * 0.6, black: true };
    }
    return { W, H, geom, lo, hi };
  }

  function drawChordKeys() {
    if (!chordsOpen() || K.tab === 'ear') return;
    const cv = $('chordKeys');
    const { W, H, geom, lo, hi } = chordKeyGeom();
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const held = new Set(heldNotes());
    let hint = new Set();
    let nextHint = new Set();
    if (K.tab === 'play' && K.running && K.revealed) hint = new Set(voicing(K.queue[K.idx]));
    if (K.tab === 'prog' && K.prog.show) {
      const P = K.prog;
      const pos = P.running ? progBeatPos() : -1;
      const cur = Math.max(0, Math.floor(Math.max(0, pos) / 4)) % P.chords.length;
      if (P.voicings.length) {
        hint = new Set(P.voicings[cur]);
        if (P.running && pos > Math.floor(pos / 4) * 4 + 2) nextHint = new Set(P.voicings[(cur + 1) % P.chords.length]);
      }
    }
    for (const pass of [false, true]) {
      for (let m = lo; m <= hi; m++) {
        const g = geom[m];
        if (!g || g.black !== pass) continue;
        let fill = g.black ? '#1b1916' : '#f7f2e8';
        if (held.has(m)) fill = g.black ? '#47698c' : '#b3cbe2';
        else if (hint.has(m)) fill = g.black ? '#7f6330' : '#f2e4c2';
        ctx.fillStyle = fill;
        roundRect(ctx, g.x + 0.5, 0, g.w - 1, g.h, g.black ? 3 : 4);
        ctx.fill();
        if (!g.black) {
          ctx.strokeStyle = '#5a534b';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (nextHint.has(m) && !held.has(m)) {
          ctx.strokeStyle = '#e6c15e';
          ctx.lineWidth = 2.5;
          roundRect(ctx, g.x + 2.5, 2, g.w - 5, g.h - 4, 3);
          ctx.stroke();
        }
        if ((hint.has(m) || held.has(m)) && g.w > 14) {
          ctx.fillStyle = g.black ? '#f7f2e8' : '#1b1916';
          ctx.font = `700 ${Math.max(8, Math.min(11, Math.floor(g.w * 0.4)))}px "Atkinson Hyperlegible", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(pcName(MT.pc(m)), g.x + g.w / 2, g.h - (g.black ? 4 : 6));
        } else if (!g.black && MT.pc(m) === 0) {
          ctx.fillStyle = '#7b7369';
          ctx.font = '600 9px "Atkinson Hyperlegible", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(m === 60 ? 'Do4' : 'Do', g.x + g.w / 2, g.h - 5);
        }
      }
    }
  }

  // Tocar el tecladito con el dedo / mouse (para el celular): cada toque prende o apaga una tecla
  $('chordKeys').addEventListener('pointerdown', e => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const { geom, lo, hi } = chordKeyGeom();
    let hit = null;
    for (let m = lo; m <= hi; m++) {
      const g = geom[m];
      if (g && g.black && x >= g.x && x <= g.x + g.w && y <= g.h) hit = m;
    }
    if (hit == null) for (let m = lo; m <= hi; m++) {
      const g = geom[m];
      if (g && !g.black && x >= g.x && x <= g.x + g.w) hit = m;
    }
    if (hit == null) return;
    audio.init();
    markActivity();
    if (K.pad.has(hit)) K.pad.delete(hit);
    else {
      K.pad.add(hit);
      audio.noteOn(hit, 85, 'user');
      setTimeout(() => audio.noteOff(hit, 'user'), 400);
    }
    if (!K.pad.size) K.armed = true;
    chordInput(hit);
  });

  // Botones y pestañas
  $('chordTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-ctab]');
    if (!b) return;
    stopProg();
    K.tab = b.dataset.ctab;
    K.pad.clear();
    setChordFeedback('', '');
    renderChords();
  });
  $('chordsModal').addEventListener('click', e => {
    const t = e.target;
    const lv = t.closest('[data-clevel]');
    if (lv) {
      K.level = Number(lv.dataset.clevel);
      K.running = false;
      K.result = null;
      setChordFeedback('', '');
      return renderChords();
    }
    const pg = t.closest('[data-prog]');
    if (pg) {
      stopProg();
      K.prog.id = pg.dataset.prog;
      K.prog.done = false;
      setChordFeedback('', '');
      return renderChords();
    }
    const el = t.closest('[data-elevel]');
    if (el) {
      K.ear.level = Number(el.dataset.elevel);
      K.ear.running = false;
      K.ear.result = null;
      setChordFeedback('', '');
      return renderChords();
    }
    const nx = t.closest('[data-cnext]');
    if (nx) {
      K.level = Number(nx.dataset.cnext);
      return startChordRound();
    }
    const kk = t.closest('#progKey [data-k]');
    if (kk) {
      stopProg();
      K.prog.key = Number(kk.dataset.k);
      return renderChords();
    }
    const bb = t.closest('#progBpm [data-b]');
    if (bb) {
      stopProg();
      K.prog.bpm = Number(bb.dataset.b);
      return renderChords();
    }
    const ans = t.closest('[data-ans]');
    if (ans) return earAnswer(ans.dataset.ans);
    switch (t.id) {
      case 'chordStart':
        audio.init();
        return startChordRound();
      case 'chordHint':
        K.revealed = true;
        K.tries = Math.max(K.tries, 1);
        setChordFeedback(`Notas: <b>${chordPcs(K.queue[K.idx]).map(pcName).join(' – ')}</b> (marcadas en el tecladito).`, '');
        return drawChordKeys();
      case 'progStart':
        audio.init();
        return K.prog.running ? (stopProg(), renderChords()) : startProg();
      case 'earStart':
        audio.init();
        return startEar();
      case 'earReplay':
        return playEarChord();
      default:
    }
  });
  $('chordsModal').addEventListener('change', e => {
    if (e.target.id === 'progListen') K.prog.listen = e.target.checked;
    if (e.target.id === 'progShow') {
      K.prog.show = e.target.checked;
      renderChords();
    }
  });

  // --------------------------------------------------------------------------
  // MIDI (teclado USB)
  // --------------------------------------------------------------------------
  async function initMidi() {
    if (!navigator.requestMIDIAccess) {
      if (IS_TOUCH) {
        setMidiBadge(false, 'Sin teclado: tocá en la pantalla');
        ui.midiDevices.textContent = 'Este navegador no puede usar teclados MIDI (en iPhone ninguno puede). Tocá las teclas de la pantalla. En Android, con Chrome y un cable OTG, sí podés conectar tu teclado.';
        return;
      }
      setMidiBadge(false, 'Este navegador no soporta MIDI · usá Chrome o Edge');
      ui.midiDevices.textContent = 'Firefox y Safari no soportan teclados MIDI por USB en la web. Abrí esta página en Google Chrome o Microsoft Edge.';
      return;
    }
    try {
      S.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      S.midiAccess.onstatechange = refreshMidi;
      refreshMidi();
    } catch (err) {
      setMidiBadge(false, 'Permiso MIDI bloqueado · clic para reintentar');
      ui.midiDevices.textContent = 'El navegador bloqueó el acceso MIDI. Hacé clic en el candado de la barra de direcciones → permitir "Dispositivos MIDI", y recargá.';
    }
  }

  function setMidiBadge(connected, text) {
    ui.midiBadge.classList.toggle('connected', connected);
    ui.midiText.textContent = text;
  }

  function refreshMidi() {
    const acc = S.midiAccess;
    if (!acc) return;
    const inputs = [...acc.inputs.values()].filter(i => i.state === 'connected');
    const outputs = [...acc.outputs.values()].filter(o => o.state === 'connected');
    for (const input of inputs) {
      input.onmidimessage = handleMidi;
      if (input.connection !== 'open' && input.open) {
        input.open().catch(() => {
          toast(`"${escapeHtml(input.name)}" está ocupado por otro programa. Cerrá otras pestañas de PianoFlow, Synthesia, DAWs o apps de Yamaha y hacé clic en el indicador del teclado.`, 'warn', { ms: 10000 });
        });
      }
      if (!S.midiKnown.has(input.id)) {
        S.midiKnown.add(input.id);
        onKeyboardConnected(input);
      }
    }
    // Salida: preferimos la del mismo teclado
    const inName = inputs[0] ? inputs[0].name : '';
    S.midiOutput = outputs.find(o => o.name === inName) || outputs.find(o => !/microsoft|gs wavetable/i.test(o.name)) || null;
    applyAutoOut();

    if (inputs.length) {
      setMidiBadge(true, `${inputs.map(i => i.name).join(', ')}`);
    } else {
      setMidiBadge(false, 'Conectá tu teclado USB (clic para buscar)');
    }
    ui.midiDevices.innerHTML = inputs.length
      ? `Entradas: <b>${inputs.map(i => escapeHtml(i.name)).join(', ')}</b><br>Salida para acompañamiento: <b>${S.midiOutput ? escapeHtml(S.midiOutput.name) : 'ninguna'}</b>`
      : 'No hay teclados conectados. Usá el cable USB (en Yamaha: puerto <i>USB TO HOST</i>), encendé el teclado y hacé clic en el indicador de arriba.';
  }

  function onKeyboardConnected(input) {
    const isYamaha = /yamaha|digital keyboard|psr/i.test(`${input.name} ${input.manufacturer || ''}`);
    toast(`Teclado conectado: <b>${escapeHtml(input.name)}</b>`, 'good');
    if (settings.userSound === 'on') {
      setTimeout(() => {
        toast(
          isYamaha
            ? '¿Tu Yamaha ya suena por sus parlantes? Apagá el sonido de la PC para tus teclas (evita el sonido doble y el retraso).'
            : '¿Tu teclado ya suena solo? Apagá el sonido de la PC para tus teclas (evita el sonido doble).',
          '',
          {
            action: {
              label: 'Apagar sonido PC',
              fn: () => {
                settings.userSound = 'off';
                saveSettings();
                applySetting('userSound');
                syncSettingsUI();
              }
            },
            ms: 12000
          }
        );
      }, 1200);
    }
  }

  function applyAutoOut() {
    if (settings.autoOut === 'keyboard' && S.midiOutput) {
      if (S.midiOutput.open) S.midiOutput.open().catch(() => {});
      audio.setMidiOutput(S.midiOutput);
    } else {
      audio.setMidiOutput(null);
    }
  }

  let midiBlinkTimer = 0;
  function handleMidi(e) {
    const d = e.data;
    if (!d || d.length < 2) return;
    const st = d[0];
    if (st >= 0xf0) return; // reloj, active sensing, etc.
    const cmd = st & 0xf0;
    const ch = st & 0x0f;
    if (ch === 9) return; // batería de los estilos/ritmos
    if (settings.midiChannel === '1' && ch !== 0) return;
    const v = d.length > 2 ? d[2] : 0;
    if (cmd === 0x90 || cmd === 0x80) {
      const note = d[1] + 12 * (Number(settings.octaveShift) || 0);
      if (cmd === 0x90 && v > 0) onUserNoteOn(note, v);
      else onUserNoteOff(note);
      ui.midiBadge.classList.add('blink');
      clearTimeout(midiBlinkTimer);
      midiBlinkTimer = setTimeout(() => ui.midiBadge.classList.remove('blink'), 80);
    } else if (cmd === 0xb0) {
      if (d[1] === 64) {
        audio.setSustain(v >= 64);
        if (v >= 64 && !S.pedalDown) onPedalPress();
        S.pedalDown = v >= 64;
      }
      else if (d[1] === 123 || d[1] === 120) for (const m of [...S.userKeys.keys()]) onUserNoteOff(m);
    }
  }

  // --------------------------------------------------------------------------
  // Mouse / pantalla táctil sobre el teclado
  // --------------------------------------------------------------------------
  function midiAtPoint(clientX, clientY) {
    const r = pianoCanvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    for (const black of [true, false]) {
      for (let m = S.range.min; m <= S.range.max; m++) {
        const g = S.geom[m];
        if (g && g.black === black && x >= g.x && x <= g.x + g.w && y >= 0 && y <= g.h) return m;
      }
    }
    return null;
  }

  pianoCanvas.addEventListener('pointerdown', e => {
    audio.init();
    pianoCanvas.setPointerCapture(e.pointerId);
    const m = midiAtPoint(e.clientX, e.clientY);
    if (m === null) return;
    S.pointerNotes.set(e.pointerId, m);
    const r = pianoCanvas.getBoundingClientRect();
    const vel = Math.round(60 + 60 * clamp((e.clientY - r.top) / r.height, 0, 1));
    onUserNoteOn(m, vel);
  });
  pianoCanvas.addEventListener('pointermove', e => {
    if (!S.pointerNotes.has(e.pointerId)) return;
    const m = midiAtPoint(e.clientX, e.clientY);
    const prev = S.pointerNotes.get(e.pointerId);
    if (m !== null && m !== prev) {
      onUserNoteOff(prev);
      S.pointerNotes.set(e.pointerId, m);
      onUserNoteOn(m, 90);
    }
  });
  const endPointer = e => {
    const m = S.pointerNotes.get(e.pointerId);
    if (m === undefined) return;
    S.pointerNotes.delete(e.pointerId);
    onUserNoteOff(m);
  };
  pianoCanvas.addEventListener('pointerup', endPointer);
  pianoCanvas.addEventListener('pointercancel', endPointer);

  // --------------------------------------------------------------------------
  // Teclado de la PC
  // --------------------------------------------------------------------------
  const PC_MAP = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
    KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17
  };

  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' && e.target.type === 'text') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.code === 'Escape') {
      if (!anyModalOpen() && S.loop.on) return exitLoop();
      document.querySelectorAll('.modal.open').forEach(m => closeModal(m.id));
      return;
    }
    if (anyModalOpen() && !readerOpen() && !chordsOpen()) return;

    if (settings.pcKeyboard === 'on' && PC_MAP[e.code] !== undefined) {
      e.preventDefault();
      if (e.repeat || S.pcDown.has(e.code)) return;
      audio.init();
      const m = S.pcBase + PC_MAP[e.code];
      S.pcDown.set(e.code, m);
      onUserNoteOn(m, 96);
      return;
    }
    if (settings.pcKeyboard === 'on' && (e.code === 'KeyZ' || e.code === 'KeyX')) {
      S.pcBase = clamp(S.pcBase + (e.code === 'KeyZ' ? -12 : 12), 24, 96);
      toast(`Teclado de la PC: la A ahora es ${MT.name(S.pcBase, settings.noteNames, true)}`);
      return;
    }
    if (chordsOpen()) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        const b = $('chordStart') || $('progStart') || $('earReplay') || $('earStart');
        if (b) b.click();
      }
      return;
    }
    if (readerOpen()) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!R.running) startReader();
        else if (R.mode === 'ear') playEar(true);
      }
      return;
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        audio.init();
        togglePlay();
        break;
      case 'Enter':
      case 'NumpadEnter':
        e.preventDefault();
        restart();
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        if (!S.song) break;
        const b = barAt(Math.max(0, S.waiting ? S.waitTime : S.time));
        seekToBar(b + (e.code === 'ArrowLeft' ? -1 : 1));
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        setSpeed(S.speed + (e.code === 'ArrowUp' ? 0.05 : -0.05));
        break;
      case 'Digit1':
        setMode('listen');
        break;
      case 'Digit2':
        setMode('learn');
        break;
      case 'Digit3':
        setMode('rhythm');
        break;
      default:
    }
  });

  window.addEventListener('keyup', e => {
    const m = S.pcDown.get(e.code);
    if (m === undefined) return;
    S.pcDown.delete(e.code);
    onUserNoteOff(m);
  });

  function releaseAllInputs() {
    for (const m of S.pcDown.values()) onUserNoteOff(m);
    S.pcDown.clear();
    for (const m of S.pointerNotes.values()) onUserNoteOff(m);
    S.pointerNotes.clear();
  }

  window.addEventListener('blur', releaseAllInputs);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseAllInputs();
      if (S.playing) pause();
    }
  });

  // --------------------------------------------------------------------------
  // Manos en el piano: avanzar sin ir al mouse
  //  Tecla blanca (o pedal) = seguir · tecla negra = repetir / alternativa
  // --------------------------------------------------------------------------
  let autoNext = null;
  function startAutoNext(sec) {
    stopAutoNext();
    if (settings.autoNext !== 'on') return;
    let n = sec;
    const bar = $('resCountdown');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => {
      bar.style.transition = `width ${sec}s linear`;
      bar.style.width = '0%';
    });
    $('resCountdownWrap').classList.remove('hidden');
    autoNext = setInterval(() => {
      n--;
      if (n <= 0) {
        stopAutoNext();
        if ($('resultsModal').classList.contains('open')) ui.resNext.click();
      }
    }, 1000);
  }
  function stopAutoNext() {
    if (autoNext) clearInterval(autoNext);
    autoNext = null;
    $('resCountdownWrap').classList.add('hidden');
  }
  // Si usás el mouse o la PC, la cuenta regresiva se cancela (estás eligiendo vos)
  ['pointerdown', 'wheel', 'keydown'].forEach(ev => $('resultsModal').addEventListener(ev, stopAutoNext));

  const topModal = () => [...document.querySelectorAll('.modal.open')].pop();

  function pianoNav(kind) {
    if (settings.pianoNav !== 'on') return;
    if (performance.now() - (S.modalAt || 0) < 900) return; // ignora las últimas notas de la canción
    const m = topModal();
    if (!m) return;
    audio.init();
    if (m.id === 'resultsModal') {
      stopAutoNext();
      (kind === 'primary' ? ui.resNext : ui.resRetry).click();
    } else if (m.id === 'libraryModal') {
      const b = document.querySelector(kind === 'primary' ? '#homeToday [data-home="lesson"]' : sheetOn() ? '#homeToday [data-home="read"]' : '#homeToday [data-home="chords"]');
      if (b) b.click();
    } else if (m.id === 'welcomeModal') {
      $('btnWelcomeStart').click();
    }
  }

  function onPedalPress() {
    if (settings.pianoNav !== 'on') return;
    if (readerOpen()) {
      if (!R.running) startReader();
      else if (R.mode === 'ear') playEar(true);
      return;
    }
    if (chordsOpen()) {
      const b = $('chordStart') || $('progStart') || $('earReplay') || $('earStart');
      if (b && !(K.tab === 'prog' && K.prog.running)) b.click();
      return;
    }
    if (anyModalOpen()) return pianoNav('primary');
    if (!S.playing && S.song && S.record.mode === 'off') play();
  }

  // --------------------------------------------------------------------------
  // Modales
  // --------------------------------------------------------------------------
  function openModal(id) {
    if (id !== 'resultsModal') pause();
    $(id).classList.add('open');
    S.modalAt = performance.now();
    document.body.classList.toggle('piano-nav', settings.pianoNav === 'on');
  }
  function closeModal(id) {
    $(id).classList.remove('open');
    if (id === 'libraryModal' && S.pickFree) {
      S.pickFree = false;
      $('libraryModal').classList.remove('pick-mode');
      $('homeTitle').textContent = 'Tu práctica de hoy';
    }
    if (id === 'readerModal') stopReader();
    if (id === 'resultsModal') stopAutoNext();
    if (id === 'chordsModal') {
      stopProg();
      K.pad.clear();
      K.running = false;
      K.ear.running = false;
    }
    if (id === 'welcomeModal' && !settings.welcomed) {
      settings.welcomed = true;
      saveSettings();
    }
  }
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  document.querySelectorAll('.modal').forEach(m =>
    m.addEventListener('pointerdown', e => {
      if (e.target === m && m.id !== 'saveModal') closeModal(m.id);
    })
  );

  // ---------- Inicio: práctica de hoy + ruta de lecciones ----------
  function renderHome() {
    const t = todayRec();
    const lvl = recommendedReadLevel();
    const lesson = recommendedSong();
    const review = reviewCandidate(lesson && lesson.id);
    const scale = scaleOfTheDay();
    let lessonHtml;
    if (lesson) {
      const plan = planForRaw(lesson);
      const ni = nextStepIdx(lesson.id, plan);
      const st = plan[ni >= 0 ? ni : plan.length - 1];
      const done = stepsDoneCount(lesson.id, plan);
      const idx = LIB.BUILTIN_SONGS.indexOf(lesson);
      lessonHtml = `<div class="today-kicker">Después, tu lección</div>
        <div class="today-title">Lección ${idx + 1}: ${escapeHtml(lesson.title)}</div>
        <div class="today-sub">${ni >= 0 ? `Paso ${ni + 1} de ${plan.length}: ${escapeHtml(st.label)}` : 'Todos los pasos hechos: buscá la ★★'}</div>
        <div class="mini-progress" title="${done} de ${plan.length} pasos"><i style="width:${(done / plan.length) * 100}%"></i></div>
        <button class="btn btn-primary" data-home="lesson" data-id="${escapeHtml(lesson.id)}">${ICO_PLAY}Continuar</button>`;
    } else {
      lessonHtml = `<div class="today-kicker">Después, tu lección</div>
        <div class="today-title">¡Terminaste la ruta!</div>
        <div class="today-sub">Importá un .MID de una canción que te guste y aprendela con el mismo plan de pasos.</div>
        <button class="btn btn-primary" data-home="import">Importar .MID</button>`;
    }
    ui.homeToday.innerHTML = `
      ${sheetOn()
        ? `<div class="today-card ${t.read ? 'done' : ''}">
        <div class="today-kicker">Primero, unos 3 minutos</div>
        <div class="today-title">Lectura, oído y una escala</div>
        <div class="today-sub">Lectura: ${escapeHtml(lvl.name)}.${scale ? ` Escala del día: <b>${escapeHtml(scale.title.replace('Escala de ', ''))}</b>.` : ''}</div>
        <div class="today-btns">
          <button class="btn" data-home="read">Leer</button>
          <button class="btn" data-home="ear">Oído</button>
          ${scale ? `<button class="btn" data-home="scale" data-id="${escapeHtml(scale.id)}">Escala</button>` : ''}
        </div>
      </div>`
        : `<div class="today-card ${t.read ? 'done' : ''}">
        <div class="today-kicker">Primero, unos 3 minutos</div>
        <div class="today-title">Acordes, oído y una escala</div>
        <div class="today-sub">Acordes: ${escapeHtml(recommendedChordLevel().name)}.${scale ? ` Escala del día: <b>${escapeHtml(scale.title.replace('Escala de ', ''))}</b>.` : ''}</div>
        <div class="today-btns">
          <button class="btn" data-home="chords">Acordes</button>
          <button class="btn" data-home="prog">Progresión</button>
          <button class="btn" data-home="cear">Oído</button>
          ${scale ? `<button class="btn" data-home="scale" data-id="${escapeHtml(scale.id)}">Escala</button>` : ''}
        </div>
      </div>`}
      <div class="today-card main ${t.lesson ? 'done' : ''}">${lessonHtml}</div>
      <div class="today-card ${t.review ? 'done' : ''}">
        <div class="today-kicker">Al final, un repaso</div>
        ${review
          ? `<div class="today-title">${escapeHtml(review.song.title)}</div>
             <div class="today-sub">La tocaste hace ${review.age} días. Repasar lo aprendido es lo que lo fija en la memoria.</div>
             <button class="btn" data-home="review" data-id="${escapeHtml(review.song.id)}">${t.review ? '✓ Hecho · otra vez' : 'Repasar'}</button>`
          : `<div class="today-title">${t.review ? '✓ Repaso hecho' : 'Nada por ahora'}</div>
             <div class="today-sub">Cuando una canción llegue a ★★, va a volver acá unos días después para que no se olvide.</div>`}
      </div>
      <div class="today-card free-card">
        <div class="today-kicker">Cuando quieras</div>
        <div class="today-title">Tocar libre</div>
        <div class="today-sub">Sin plan ni puntaje: el piano solo, o cualquier pieza a tu ritmo.</div>
        <div class="today-btns">
          <button class="btn" data-home="freepiano">Piano libre</button>
          <button class="btn" data-home="freepick">Elegir una pieza</button>
        </div>
      </div>`;
  }

  ui.homeToday.addEventListener('click', e => {
    const b = e.target.closest('[data-home]');
    if (!b) return;
    audio.init();
    const what = b.dataset.home;
    if (what === 'read' || what === 'ear') {
      closeModal('libraryModal');
      openReader(what);
    } else if (what === 'chords' || what === 'prog' || what === 'cear') {
      closeModal('libraryModal');
      openChords(what === 'chords' ? 'play' : what === 'prog' ? 'prog' : 'ear');
    } else if (what === 'scale') {
      closeModal('libraryModal');
      openLesson(b.dataset.id, { autoplay: true });
    } else if (what === 'lesson' || what === 'review') {
      closeModal('libraryModal');
      openLesson(b.dataset.id, { autoplay: true });
    } else if (what === 'import') {
      ui.fileInput.click();
    } else if (what === 'freepiano') {
      closeModal('libraryModal');
      openFree(null);
    } else if (what === 'freepick') {
      S.pickFree = true;
      $('libraryModal').classList.add('pick-mode');
      $('homeTitle').textContent = 'Elegí una pieza para tocar libre';
      renderLibrary();
      $('libraryModal').querySelector('.modal-card').scrollTop = 0;
    }
  });

  // ---------- Tu semana (y el informe para mostrarle a un profe) ----------
  function weekData() {
    const days = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      const k = dayKey(d);
      days.push({ k, label: ['D', 'L', 'M', 'M', 'J', 'V', 'S'][d.getDay()], min: (progress.days[k] || 0) / 60 });
      d.setDate(d.getDate() + 1);
    }
    const from = days[0].k;
    let steps = 0;
    for (const rec of Object.values(progress.songs)) for (const day of Object.values(rec.steps || {})) if (day >= from) steps++;
    const log = (progress.log || []).filter(e => e.d >= from);
    const rhythm = log.filter(e => e.m === 'rhythm');
    const timed = rhythm.filter(e => typeof e.tm === 'number');
    const bestLevel = (levels, store) => {
      let best = null;
      levels.forEach((l, i) => {
        const st = (store[l.id] || {}).stars || 0;
        if (st > 0) best = { name: l.name, stars: st, i };
      });
      return best;
    };
    const played = [...new Set(log.map(e => e.s))].map(id => findSong(id)).filter(Boolean);
    return {
      days,
      totalMin: days.reduce((a, x) => a + x.min, 0),
      activeDays: days.filter(x => x.min >= 1).length,
      steps,
      takes: rhythm.length,
      acc: rhythm.length ? mean(rhythm.map(e => e.a)) : null,
      tm: timed.length ? mean(timed.map(e => e.tm)) : null,
      ts: timed.length ? mean(timed.map(e => e.ts)) : null,
      read: sheetOn() ? bestLevel(READ_LEVELS, progress.reading) : null,
      ear: bestLevel(EAR_LEVELS, progress.ear || {}),
      chords: bestLevel(CHORD_LEVELS, progress.chords),
      chordEar: bestLevel(CEAR_LEVELS, progress.chordEar),
      progs: PROGS.filter(p => ((progress.progs[p.id] || {}).stars || 0) > 0).map(p => `${p.name} ${'★'.repeat(progress.progs[p.id].stars)}`),
      played
    };
  }

  function tendencyText(w) {
    if (w.tm == null) return null;
    if (w.tm <= -25) return `se apura (${Math.round(-w.tm)} ms antes del pulso)`;
    if (w.tm >= 25) return `se atrasa (${Math.round(w.tm)} ms)`;
    return `pulso firme (±${Math.round(w.ts)} ms)`;
  }

  function renderWeek() {
    const w = weekData();
    const goal = Number(settings.dailyGoal) || 10;
    const maxMin = Math.max(goal * 1.4, ...w.days.map(x => x.min));
    const bars = w.days
      .map(x => `<div class="wk-day" title="${x.k}: ${Math.round(x.min)} min"><div class="wk-bar"><i class="${x.min >= goal ? 'met' : ''}" style="height:${(x.min / maxMin) * 100}%"></i></div><span>${x.label}</span></div>`)
      .join('');
    const chips = [
      `<b>${Math.round(w.totalMin)}</b> min en <b>${w.activeDays}</b>/7 días`,
      `<b>${w.steps}</b> pasos cumplidos`,
      w.acc != null ? `<b>${pct(w.acc)}</b> de precisión con ritmo` : null,
      tendencyText(w) ? `${tendencyText(w)}` : null
    ].filter(Boolean);
    $('homeWeek').innerHTML = `
      <div class="wk-chart" title="Minutos por día (verde = meta cumplida)">${bars}</div>
      <div class="wk-info">
        <div class="wk-chips">${chips.map(c => `<span>${c}</span>`).join('')}</div>
        <button class="btn" id="btnCopyReport" title="Copia un resumen de tu semana para mandárselo a un profe o guardarlo">Copiar informe para el profe</button>
      </div>`;
    $('btnCopyReport').onclick = copyReport;
  }

  function reportText() {
    const w = weekData();
    const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
    const lines = [
      `PianoFlow · mi semana (${w.days[0].k} a ${w.days[6].k})`,
      `Práctica: ${Math.round(w.totalMin)} min en ${w.activeDays} de 7 días · racha ${streakDays()} días`,
      `Pasos de lecciones cumplidos: ${w.steps}`
    ];
    if (w.played.length) {
      lines.push('Toqué:');
      for (const s of w.played) lines.push(`  · ${s.title} ${stars((progress.songs[s.id] || {}).stars || 0)}`);
    }
    if (w.takes) lines.push(`Con ritmo: ${w.takes} tomas, precisión media ${pct(w.acc)}${tendencyText(w) ? `, ${tendencyText(w)}` : ''}`);
    if (w.read) lines.push(`Lectura de notas: ${w.read.name} ${stars(w.read.stars)}`);
    if (w.ear) lines.push(`Oído (notas): ${w.ear.name} ${stars(w.ear.stars)}`);
    if (w.chords) lines.push(`Acordes: ${w.chords.name} ${stars(w.chords.stars)}`);
    if (w.chordEar) lines.push(`Reconocer acordes: ${w.chordEar.name} ${stars(w.chordEar.stars)}`);
    if (w.progs.length) lines.push(`Progresiones: ${w.progs.join(' · ')}`);
    const rec = recommendedSong();
    if (rec) lines.push(`Ahora estoy con: ${rec.title}`);
    return lines.join('\n');
  }

  async function copyReport() {
    const text = reportText();
    try {
      await navigator.clipboard.writeText(text);
      toast('Informe copiado. Pegalo en WhatsApp o en un mail para tu profe.', 'good', { ms: 5000 });
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      toast(ok ? 'Informe copiado.' : 'No se pudo copiar automáticamente.', ok ? 'good' : 'warn');
    }
  }

  function openHome() {
    renderHome();
    renderWeek();
    renderLibrary();
    openModal('libraryModal');
  }

  function renderLibrary() {
    const rec = recommendedSong();
    const card = (s, i) => {
      const p = progress.songs[s.id] || {};
      const stars = p.stars || 0;
      const isRec = rec && rec.id === s.id;
      const cls = ['song-card', S.song && S.song.id === s.id ? 'current' : '', isRec ? 'recommended' : ''].join(' ');
      const sub = s.isCustom ? escapeHtml(s.artist || '') + `, ${s.notes.length} notas` : escapeHtml(s.artist || '');
      let steps = '';
      if (!s.isCustom || p.steps) {
        const plan = planForRaw(s);
        const done = stepsDoneCount(s.id, plan);
        if (done) steps = `<span class="mini-progress" title="${done} de ${plan.length} pasos"><i style="width:${(done / plan.length) * 100}%"></i></span>`;
      }
      return `<div class="${cls}" data-song="${escapeHtml(s.id)}" role="button" tabindex="0">
        <span class="song-card-stars">${[1, 2, 3].map(k => `<span class="${k <= stars ? '' : 'off'}">★</span>`).join('')}</span>
        <span class="song-card-title">${i != null ? i + 1 + '. ' : ''}${escapeHtml(s.title)}</span>
        <span class="song-card-sub">${sub}</span>
        ${s.concept && !s.isCustom ? `<span class="song-card-concept">${escapeHtml(s.concept)}</span>` : ''}
        ${steps}
        ${isRec ? '<span class="badge">Te toca esta</span>' : ''}
        ${s.isCustom ? `<button class="song-card-delete" data-delete="${escapeHtml(s.id)}" title="Borrar"></button>` : ''}
      </div>`;
    };
    let html = '';
    for (const lvl of LIB.LEVELS) {
      const songs = LIB.BUILTIN_SONGS.map((s, i) => [s, i]).filter(([s]) => s.level === lvl.id);
      html += `<div class="level-block"><div class="level-title">${lvl.name}</div><div class="level-blurb">${lvl.blurb}</div>
        <div class="song-grid">${songs.map(([s, i]) => card(s, i)).join('')}</div></div>`;
    }
    if (LIB.TECHNIQUE && LIB.TECHNIQUE.length) {
      html += `<div class="level-block"><div class="level-title">Técnica diaria · escalas</div>
        <div class="level-blurb">2 minutos por día, con la digitación correcta: dedos parejos y paso del pulgar. El profe escucha si el volumen sale parejo.</div>
        <div class="song-grid">${LIB.TECHNIQUE.map(s => card(s, null)).join('')}</div></div>`;
    }
    html += `<div class="level-block"><div class="level-title">Mis grabaciones e importados</div>
      <div class="level-blurb">Grabá con Grabar, o importá un MIDI o MusicXML (abajo, en Más canciones, podés buscarlos en MuseScore).</div>
      ${customSongs.length ? `<div class="song-grid">${customSongs.map(s => card(s, null)).join('')}</div>` : '<div class="empty-note">Todavía no hay nada acá.</div>'}</div>`;
    ui.libraryList.innerHTML = html;
  }

  ui.libraryList.addEventListener('click', e => {
    const del = e.target.closest('[data-delete]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.delete;
      const s = customSongs.find(x => x.id === id);
      if (s && confirm(`¿Borrar "${s.title}"? No se puede deshacer.`)) {
        customSongs = customSongs.filter(x => x.id !== id);
        saveCustom();
        delete progress.songs[id];
        saveProgress();
        if (S.song && S.song.id === id) selectSong(LIB.BUILTIN_SONGS[0].id);
        renderLibrary();
      }
      return;
    }
    const c = e.target.closest('[data-song]');
    if (c) {
      const free = S.pickFree;
      closeModal('libraryModal');
      if (free) openFree(c.dataset.song);
      else openLesson(c.dataset.song);
    }
  });
  ui.libraryList.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.song) e.target.click();
  });

  ui.btnLibrary.addEventListener('click', openHome);

  // ---------- Barra del plan ----------
  ui.stepDots.addEventListener('click', e => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    audio.init();
    applyStep(Number(b.dataset.step), { autoplay: true });
  });
  ui.btnStepGo.addEventListener('click', () => {
    audio.init();
    const a = ui.btnStepGo.dataset.action;
    if (a === 'exitFree') return exitFree();
    if (a === 'step') applyStep(Number(ui.btnStepGo.dataset.step), { autoplay: true });
    else if (a === 'nextSong') {
      const n = nextLessonAfter(S.song.id);
      if (n) openLesson(n.id, { autoplay: true });
    } else openHome();
  });

  $('btnImport').addEventListener('click', () => ui.fileInput.click());
  // Abre cualquier archivo de canción: .mid/.midi, MusicXML (.musicxml/.xml/.mxl) o .json
  async function importFile(file) {
    if (!file) return;
    try {
      let song;
      if (/\.(musicxml|xml|mxl)$/i.test(file.name)) {
        song = await window.MusicXmlParser.parse(await file.arrayBuffer(), file.name);
      } else if (/\.json$/i.test(file.name)) {
        song = JSON.parse(await file.text());
        if (!song || !Array.isArray(song.notes) || !song.notes.length) throw new Error('El JSON no tiene notas.');
        song.id = 'custom_' + Date.now();
        song.isCustom = true;
        song.title = song.title || file.name;
      } else {
        song = window.MidiFileParser.parse(await file.arrayBuffer(), file.name);
      }
      if (song.notes.length > 20000) throw new Error('El archivo es demasiado grande (más de 20.000 notas).');
      customSongs.push(song);
      saveCustom();
      document.querySelectorAll('.modal.open').forEach(m => closeModal(m.id));
      S.free = false;
      S.freeEmpty = false;
      document.body.classList.remove('free-mode');
      openLesson(song.id);
      audio.chime('success');
      const hands = new Set(song.notes.map(n => n.hand));
      const fingers = song.notes.some(n => n.finger);
      toast(`"${escapeHtml(song.title)}" cargada: ${song.notes.length} notas${hands.size > 1 ? ', separadas en dos manos' : ''}${fingers ? ', con digitación' : ''}. Empezá escuchándola.`, 'good', { ms: 6000 });
    } catch (err) {
      toast('No se pudo leer el archivo: ' + escapeHtml(err.message), 'warn', { ms: 7000 });
    }
  }

  ui.fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    ui.fileInput.value = '';
    importFile(file);
  });

  // Arrastrar un archivo a la ventana
  const SONG_FILE = /\.(mid|midi|musicxml|xml|mxl|json)$/i;
  let dragDepth = 0;
  window.addEventListener('dragenter', e => {
    if (![...(e.dataTransfer && e.dataTransfer.types) || []].includes('Files')) return;
    dragDepth++;
    document.body.classList.add('dropping');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dropping');
  });
  window.addEventListener('dragover', e => {
    if ([...(e.dataTransfer && e.dataTransfer.types) || []].includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', e => {
    dragDepth = 0;
    document.body.classList.remove('dropping');
    const file = [...((e.dataTransfer && e.dataTransfer.files) || [])].find(f => SONG_FILE.test(f.name));
    if (!file) return;
    e.preventDefault();
    audio.init();
    importFile(file);
  });

  // App instalada en la PC: doble clic en un .mid/.mxl lo abre directo acá
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      for (const h of params.files || []) {
        const f = await h.getFile();
        if (SONG_FILE.test(f.name)) await importFile(f);
      }
    });
  }

  // Celular: "Compartir → PianoFlow" desde Descargas (el service worker guarda el archivo)
  async function importShared() {
    if (!/[?&]compartido=1/.test(location.search) || !('caches' in window)) return;
    history.replaceState(null, '', location.pathname);
    try {
      const cache = await caches.open('pianoflow-share');
      const key = new URL('compartido-archivo', location.href).href;
      const res = await cache.match(key);
      if (!res) return;
      const name = decodeURIComponent(res.headers.get('x-name') || 'cancion.mid');
      const blob = await res.blob();
      await cache.delete(key);
      importFile(new File([blob], name));
    } catch (_) {}
  }

  // Buscar en MuseScore (se abre aparte; después descargás el MIDI o el MusicXML y lo abrís acá)
  function searchMuseScore(q) {
    const query = (q || '').trim();
    if (!query) return;
    const withPiano = /piano/i.test(query) ? query : `${query} piano`;
    window.open(`https://musescore.com/sheetmusic?text=${encodeURIComponent(withPiano)}`, '_blank', 'noopener');
    toast('En MuseScore: abrí la partitura → Download → <b>MusicXML</b> (mejor: trae digitación) o <b>MIDI</b>. Después arrastrá el archivo acá o usá Importar.', '', { ms: 9000 });
  }
  $('museForm').addEventListener('submit', e => {
    e.preventDefault();
    searchMuseScore($('museQuery').value);
  });
  $('museChips').addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (b) searchMuseScore(b.dataset.q);
  });

  $('btnExport').addEventListener('click', () => {
    if (!S.song) return;
    const bytes = window.MidiFileParser.exportToMidiBytes(S.song.raw);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${S.song.title.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]/g, '_')}.mid`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ---------- Resultados ----------
  ui.resClose.addEventListener('click', () => closeModal('resultsModal'));
  ui.resRetry.addEventListener('click', () => {
    closeModal('resultsModal');
    restart();
  });

  // ---------- Bienvenida ----------
  $('btnWelcomeStart').addEventListener('click', () => {
    closeModal('welcomeModal');
    audio.init();
    openLesson(LIB.BUILTIN_SONGS[0].id, { autoplay: true });
  });

  // ---------- Ajustes ----------
  function syncSettingsUI() {
    document.querySelectorAll('[data-setting]').forEach(seg => {
      const key = seg.dataset.setting;
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', String(settings[key]) === b.dataset.value));
    });
    document.querySelectorAll('[data-volume]').forEach(r => (r.value = Math.round(settings.vol[r.dataset.volume] * 100)));
    ui.staffCard.style.display = settings.showStaff === 'on' ? '' : 'none';
  }

  function applySetting(key) {
    switch (key) {
      case 'range':
        computeRange();
        computeGeometry();
        break;
      case 'userSound':
        audio.setUserSound(settings.userSound === 'on');
        break;
      case 'autoOut':
        applyAutoOut();
        if (settings.autoOut === 'keyboard' && !S.midiOutput) toast('No encontré una salida MIDI hacia tu teclado: el acompañamiento sigue sonando en la PC.', 'warn', { ms: 5000 });
        break;
      case 'dailyGoal':
        updateDaily();
        break;
      case 'sheetMusic':
        planCache.clear();
        applyDisplay();
        updateStepper();
        break;
      default:
    }
    S.staffSig = '';
  }

  document.querySelectorAll('[data-setting]').forEach(seg => {
    seg.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => {
        settings[seg.dataset.setting] = b.dataset.value;
        saveSettings();
        applySetting(seg.dataset.setting);
        syncSettingsUI();
      })
    );
  });
  document.querySelectorAll('[data-volume]').forEach(r =>
    r.addEventListener('input', () => {
      const name = r.dataset.volume;
      settings.vol[name] = Number(r.value) / 100;
      audio.setVolume(name, settings.vol[name]);
      saveSettings();
    })
  );
  $('btnShowWelcome').addEventListener('click', () => {
    closeModal('settingsModal');
    openModal('welcomeModal');
  });
  $('btnResetProgress').addEventListener('click', () => {
    if (!confirm('¿Borrar estrellas, racha y minutos practicados? Tus grabaciones no se borran.')) return;
    progress.songs = {};
    progress.days = {};
    progress.goalToast = null;
    progress.reading = {};
    progress.ear = {};
    progress.chords = {};
    progress.progs = {};
    progress.chordEar = {};
    progress.log = [];
    progress.today = null;
    saveProgress();
    updateSongHeader();
    updateDaily();
    toast('Progreso borrado.');
  });
  ui.btnSettings.addEventListener('click', () => {
    syncSettingsUI();
    openModal('settingsModal');
  });

  audio.onStatusChange = st => {
    const txt = {
      idle: 'Sonido: se activa con el primer clic.',
      loading: 'Sonido: descargando el piano real (una sola vez)…',
      partial: 'Sonido: piano real (terminando de descargar)…',
      ready: 'Sonido: piano real ✓',
      error: 'Sonido: sintetizado (no se pudo descargar el piano real; revisá la conexión a internet).'
    };
    ui.soundStatus.textContent = txt[st] || '';
  };

  // --------------------------------------------------------------------------
  // Botones principales
  // --------------------------------------------------------------------------
  ui.btnPlay.addEventListener('click', () => {
    audio.init();
    togglePlay();
  });
  ui.btnRestart.addEventListener('click', () => {
    audio.init();
    restart();
  });
  ui.btnLoop.addEventListener('click', toggleLoop);
  $('btnLoopExit').addEventListener('click', () => exitLoop());
  function applyDisplay() {
    if (!sheetOn()) S.display = 'falling';
    document.body.classList.toggle('no-sheet', !sheetOn());
    document.body.classList.toggle('sheet-view', S.display === 'sheet');
    $('btnView').classList.toggle('active', S.display === 'sheet');
    S.staffSig = '';
  }
  $('btnView').addEventListener('click', () => {
    S.display = S.display === 'sheet' ? 'falling' : 'sheet';
    settings.display = S.display;
    saveSettings();
    applyDisplay();
    updateStepper();
    toast(S.display === 'sheet' ? 'Vista partitura: las notas pasan por el pentagrama. La línea verde es "ahora".' : 'Vista de notas que caen.', '', { ms: 3500 });
  });
  ui.loopAutoSpeed.addEventListener('change', () => {
    settings.loopAutoSpeed = ui.loopAutoSpeed.checked;
    saveSettings();
  });
  ui.btnMetronome.addEventListener('click', () => {
    audio.init();
    S.metronome = !S.metronome;
    settings.metronome = S.metronome;
    saveSettings();
    S.nextBeat = null;
    syncControls();
  });
  ui.btnRecord.addEventListener('click', () => (S.record.mode === 'off' ? startRecording() : stopRecording()));
  ui.midiBadge.addEventListener('click', async () => {
    if (S.midiAccess) refreshMidi();
    else await initMidi();
    const found = S.midiAccess && [...S.midiAccess.inputs.values()].some(i => i.state === 'connected');
    // Chrome en Windows a veces no ve un teclado enchufado con la página ya abierta: recargar lo soluciona.
    if (S.midiAccess && !found) {
      toast('No encuentro el teclado todavía. Si ya lo enchufaste y encendiste, esperá 5 segundos y recargá la página (tu progreso no se pierde).', 'warn', {
        action: { label: 'Recargar', fn: () => location.reload() },
        ms: 12000
      });
    }
  });
  document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#handSeg button').forEach(b => b.addEventListener('click', () => setHand(b.dataset.hand)));
  ui.speedRange.addEventListener('input', () => setSpeed(Number(ui.speedRange.value) / 100));

  // Que la barra espaciadora no "re-clickee" el último botón usado
  document.addEventListener('pointerup', e => {
    const el = e.target.closest && e.target.closest('button, input[type=range]');
    if (el && !el.closest('.modal')) setTimeout(() => el.blur(), 0);
  });
  // El navegador solo deja sonar audio después de un clic o tecla
  const unlockAudio = () => audio.init();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // --------------------------------------------------------------------------
  // Hábito: minutos por día y racha
  // --------------------------------------------------------------------------
  function markActivity() {
    S.lastActivity = performance.now();
    S.idleMisses = 0;
  }

  function tickPractice(dt) {
    const now = performance.now();
    const active =
      (S.playing && !(S.waiting && now - S.lastActivity > 15000)) ||
      now - S.lastActivity < 5000 ||
      S.record.mode === 'recording';
    if (!active || document.hidden) return;
    const k = dayKey(new Date());
    progress.days[k] = (progress.days[k] || 0) + dt;
    S.practiceDirty += dt;
    if (S.practiceDirty > 10) {
      S.practiceDirty = 0;
      saveProgress();
      updateDaily();
    }
  }

  function streakDays() {
    const d = new Date();
    let streak = 0;
    if ((progress.days[dayKey(d)] || 0) >= 60) streak++;
    d.setDate(d.getDate() - 1);
    while ((progress.days[dayKey(d)] || 0) >= 60) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function updateDaily() {
    const goal = Number(settings.dailyGoal) || 10;
    const k = dayKey(new Date());
    const mins = (progress.days[k] || 0) / 60;
    const streak = streakDays();
    ui.streakText.textContent = `${streak} día${streak === 1 ? '' : 's'}`;
    ui.streakText.title = 'Días seguidos practicando';
    ui.dailyText.textContent = `${Math.floor(mins)}/${goal} min`;
    ui.dailyFill.style.width = `${clamp(mins / goal, 0, 1) * 100}%`;
    const done = mins >= goal;
    ui.dailyChip.classList.toggle('done', done);
    if (done && progress.goalToast !== k) {
      progress.goalToast = k;
      saveProgress();
      toast(`¡Meta de hoy cumplida (${goal} min)! Si querés, seguí; si no, mañana más. La constancia gana.`, 'good', { ms: 6000 });
      audio.chime('star');
    }
  }

  // --------------------------------------------------------------------------
  // Bucle principal
  // --------------------------------------------------------------------------
  let lastUi = 0;
  function frame(ts) {
    const dt = Math.min(0.05, Math.max(0, (ts - (S.lastTs || ts)) / 1000));
    S.lastTs = ts;
    try {
      update(dt);
      S.frameTs = performance.now();
      updateRecording();
      updateParticles(dt);
      tickPractice(dt);
      drawStage();
      drawPiano();
      drawStaff();
      if (ts - lastUi > 120) {
        lastUi = ts;
        if (S.playing) updateTimeline();
        if (S.waiting && performance.now() - S.waitSince > 7000 && !ui.waitHint.classList.contains('wrong') && !ui.waitHint.dataset.nudged) {
          ui.waitHint.dataset.nudged = '1';
          ui.waitHint.innerHTML += '. Es la tecla que brilla abajo.';
        }
        if (!S.waiting) delete ui.waitHint.dataset.nudged;
      }
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(frame);
  }

  // --------------------------------------------------------------------------
  // Arranque
  // --------------------------------------------------------------------------
  const ro = new ResizeObserver(() => resizeCanvases());
  ro.observe(stageEl);
  ro.observe(pianoCanvas);

  for (const name of ['master', 'auto', 'fx']) audio.volumes[name] = settings.vol[name];
  audio.setUserSound(settings.userSound === 'on');
  audio.onStatusChange('idle');

  resizeCanvases();
  selectSong(findSong(settings.lastSong) ? settings.lastSong : LIB.BUILTIN_SONGS[0].id);
  syncSettingsUI();
  updateDaily();
  setInterval(updateDaily, 30000);
  initMidi();
  requestAnimationFrame(frame);
  if (!settings.welcomed) openModal('welcomeModal');
  else openHome();
  importShared();

  // App instalable: funciona sin internet y se puede instalar con ícono propio (PC y celular)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  let installPrompt = null;
  const btnInstall = $('btnInstall');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    btnInstall.classList.remove('hidden');
  });
  btnInstall.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    btnInstall.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    btnInstall.classList.add('hidden');
    toast('¡PianoFlow instalada! Ya la podés abrir desde su ícono, incluso sin internet.', 'good', { ms: 7000 });
  });

  // Para depurar desde la consola
  window.PianoFlowDebug = {
    S, R, K, audio, settings, progress, importFile, openFree, exitFree, selectSong, setMode, setHand, setSpeed, setLoop, seek, play, pause, onUserNoteOn, onUserNoteOff, lessonPlan, applyStep, openLesson,
    // Avanza la simulación a mano (útil para pruebas automáticas con la pestaña oculta)
    step(dt = 1 / 60, n = 1) {
      for (let i = 0; i < n; i++) {
        update(dt);
        S.frameTs = performance.now();
      }
    }
  };
})();
