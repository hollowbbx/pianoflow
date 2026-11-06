// ============================================================================
// PianoFlow — Biblioteca de lecciones (ruta progresiva para principiantes)
//
// Las canciones se escriben en una notación compacta y legible:
//   "C4/1/1"            -> nota Do4, dura 1 negra, dedo 1
//   "C3+E3+G3/4/5+3+1"  -> acorde (notas unidas con +), dura 4 negras, dedos 5,3,1
//   "-/2"               -> silencio de 2 negras
//   "|"                 -> barra de compás (solo para leer mejor; se valida)
// Todas las duraciones están en negras (1 = negra, 0.5 = corchea, 0.25 = semicorchea).
// Solo se usan obras de dominio público o ejercicios propios.
// ============================================================================
(function () {
  const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function noteToMidi(name) {
    if (typeof name === 'number') return name;
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    if (!m) throw new Error('Nota inválida: ' + name);
    let midi = NOTE_BASE[m[1]] + 12 * (Number(m[3]) + 1);
    if (m[2] === '#') midi++;
    if (m[2] === 'b') midi--;
    return midi;
  }

  function parseSeq(hand, startBeat, str) {
    const events = [];
    const bars = [];
    let beat = startBeat;
    let barStart = beat;
    for (const tok of str.trim().split(/\s+/)) {
      if (!tok) continue;
      if (tok === '|') {
        bars.push(beat - barStart);
        barStart = beat;
        continue;
      }
      const [notesPart, durPart, fingerPart] = tok.split('/');
      const dur = Number(durPart);
      if (!(dur > 0)) throw new Error('Duración inválida en "' + tok + '"');
      if (notesPart !== '-') {
        const names = notesPart.split('+');
        const fingers = fingerPart ? fingerPart.split('+').map(Number) : [];
        names.forEach((nm, i) => {
          events.push({ midi: noteToMidi(nm), beat, dur, hand, finger: fingers[i] || null });
        });
      }
      beat += dur;
    }
    if (beat > barStart + 1e-9) bars.push(beat - barStart);
    return { events, end: beat, bars };
  }

  // parts: [hand, beatInicial, "secuencia"]   extra: eventos sueltos {midi, beat, dur, hand, finger}
  function makeSong(meta, parts, extra = []) {
    const spq = 60 / meta.bpm;
    const raw = [];
    for (const [hand, start, str] of parts) raw.push(...parseSeq(hand, start, str).events);
    raw.push(...extra.map(e => ({ ...e, midi: noteToMidi(e.midi) })));
    const notes = raw
      .map(e => ({
        midi: e.midi,
        time: +(e.beat * spq).toFixed(4),
        duration: +(e.dur * spq).toFixed(4),
        hand: e.hand,
        finger: e.finger || null,
        velocity: e.hand === 'L' ? 76 : 92
      }))
      .sort((a, b) => a.time - b.time || a.midi - b.midi);
    return { timeSig: [4, 4], pickup: 0, builtin: true, ...meta, parts, notes };
  }

  // ---------------------------------------------------------------------------
  // Acordes reutilizables
  // ---------------------------------------------------------------------------
  const LH_C = 'C3+E3+G3';
  const LH_F = 'C3+F3+A3';
  const LH_G = 'B2+D3+G3';
  const RH_AM = 'C4+E4+A4';
  const RH_F = 'C4+F4+A4';
  const RH_C = 'C4+E4+G4';
  const RH_G = 'B3+D4+G4';

  // ---------------------------------------------------------------------------
  // Preludio en Do (Bach, BWV 846) — generado a partir de los acordes de cada compás
  // ---------------------------------------------------------------------------
  function bachPreludeEvents() {
    const bars = [
      ['C4', 'E4', 'G4', 'C5', 'E5'],
      ['C4', 'D4', 'A4', 'D5', 'F5'],
      ['B3', 'D4', 'G4', 'D5', 'F5'],
      ['C4', 'E4', 'G4', 'C5', 'E5'],
      ['C4', 'E4', 'A4', 'E5', 'A5'],
      ['C4', 'D4', 'F#4', 'A4', 'D5'],
      ['B3', 'D4', 'G4', 'D5', 'G5'],
      ['B3', 'C4', 'E4', 'G4', 'C5'],
      ['A3', 'C4', 'E4', 'G4', 'C5'],
      ['D3', 'A3', 'D4', 'F#4', 'C5'],
      ['G3', 'B3', 'D4', 'G4', 'B4'],
      ['C4', 'E4', 'G4', 'C5', 'E5']
    ];
    const ev = [];
    bars.forEach((names, i) => {
      const m = names.map(noteToMidi);
      const lowInt = m[1] - m[0];
      const lf = lowInt <= 2 ? 2 : lowInt <= 4 ? 3 : lowInt <= 5 ? 4 : 5;
      const rf2 = m[3] - m[2] <= 4 ? 2 : 3;
      for (const half of [0, 2]) {
        const t = i * 4 + half;
        ev.push({ midi: m[0], beat: t, dur: 2, hand: 'L', finger: lf });
        ev.push({ midi: m[1], beat: t + 0.25, dur: 1.75, hand: 'L', finger: 1 });
        for (let k = 0; k < 6; k++) {
          ev.push({ midi: m[2 + (k % 3)], beat: t + 0.5 + k * 0.25, dur: 0.25, hand: 'R', finger: [1, rf2, 5][k % 3] });
        }
      }
    });
    const end = bars.length * 4;
    ev.push({ midi: 'C3', beat: end, dur: 4, hand: 'L', finger: 5 });
    ev.push({ midi: 'C4', beat: end, dur: 4, hand: 'L', finger: 1 });
    ev.push({ midi: 'E4', beat: end, dur: 4, hand: 'R', finger: 1 });
    ev.push({ midi: 'G4', beat: end, dur: 4, hand: 'R', finger: 2 });
    ev.push({ midi: 'C5', beat: end, dur: 4, hand: 'R', finger: 5 });
    return ev;
  }

  // ---------------------------------------------------------------------------
  // Para Elisa — compases (3/8, en negras: 1 compás = 1.5)
  // ---------------------------------------------------------------------------
  const ELISE_M1 = 'E5/0.25/5 D#5/0.25/4 E5/0.25/5 B4/0.25/2 D5/0.25/4 C5/0.25/3 |';
  const ELISE_M2 = 'A4/0.5/1 -/0.25 C4/0.25/1 E4/0.25/2 A4/0.25/3 |';
  const ELISE_M3 = 'B4/0.5/4 -/0.25 E4/0.25/1 G#4/0.25/3 B4/0.25/4 |';
  const ELISE_M4 = 'C5/0.5/5 -/0.25 E4/0.25/1 E5/0.25/5 D#5/0.25/4 |';
  const ELISE_M7 = 'B4/0.5/4 -/0.25 E4/0.25/1 C5/0.25/5 B4/0.25/4 |';
  const ELISE_R_BODY = [ELISE_M1, ELISE_M2, ELISE_M3, ELISE_M4, ELISE_M1, ELISE_M2, ELISE_M7].join(' ');
  const ELISE_LA = 'A2/0.25/5 E3/0.25/2 A3/0.25/1 -/0.75 |';
  const ELISE_LE = 'E2/0.25/5 E3/0.25/2 G#3/0.25/1 -/0.75 |';
  const ELISE_L_BODY = ['-/1.5 |', ELISE_LA, ELISE_LE, ELISE_LA, '-/1.5 |', ELISE_LA, ELISE_LE].join(' ');

  // ---------------------------------------------------------------------------
  // Himno a la Alegría — frases
  // ---------------------------------------------------------------------------
  const ODE_A1 = 'E4/1/3 E4/1/3 F4/1/4 G4/1/5 | G4/1/5 F4/1/4 E4/1/3 D4/1/2 | C4/1/1 C4/1/1 D4/1/2 E4/1/3 | E4/1.5/3 D4/0.5/2 D4/2/2 |';
  const ODE_A2 = 'E4/1/3 E4/1/3 F4/1/4 G4/1/5 | G4/1/5 F4/1/4 E4/1/3 D4/1/2 | C4/1/1 C4/1/1 D4/1/2 E4/1/3 | D4/1.5/2 C4/0.5/1 C4/2/1 |';
  const ODE_B = 'D4/1/2 D4/1/2 E4/1/3 C4/1/1 | D4/1/2 E4/0.5/3 F4/0.5/4 E4/1/3 C4/1/1 | D4/1/2 E4/0.5/3 F4/0.5/4 E4/1/3 D4/1/2 | C4/1/1 D4/1/2 -/2 |';
  const ODE_LA1 = 'C3/4/5 | G3/4/1 | C3/4/5 | C3/2/5 G3/2/1 |';
  const ODE_LA2 = 'C3/4/5 | G3/4/1 | C3/4/5 | G3/2/1 C3/2/5 |';
  const ODE_LB = 'G3/2/1 C3/2/5 | G3/2/1 C3/2/5 | G3/4/1 | C3/2/5 G3/2/1 |';

  const SCALE_R = 'C4/1/1 D4/1/2 E4/1/3 F4/1/1 | G4/1/2 A4/1/3 B4/1/4 C5/1/5 | C5/1/5 B4/1/4 A4/1/3 G4/1/2 | F4/1/1 E4/1/3 D4/1/2 C4/1/1 |';
  const SCALE_L = 'C3/1/5 D3/1/4 E3/1/3 F3/1/2 | G3/1/1 A3/1/3 B3/1/2 C4/1/1 | C4/1/1 B3/1/2 A3/1/3 G3/1/1 | F3/1/2 E3/1/3 D3/1/4 C3/1/5 |';

  const LEVELS = [
    { id: 1, name: 'Nivel 1 · Primeros pasos', blurb: 'Ubicar las manos y usar cada dedo.' },
    { id: 2, name: 'Nivel 2 · Melodías y manos juntas', blurb: 'Tus primeras canciones con las dos manos.' },
    { id: 3, name: 'Nivel 3 · Técnica y ritmo', blurb: 'Paso del pulgar, compás de 3 y acordes.' },
    { id: 4, name: 'Nivel 4 · Clásicos', blurb: 'Obras reales en versión accesible.' }
  ];

  const BUILTIN_SONGS = [
    makeSong(
      {
        id: 'l1_do_re_mi', level: 1, title: 'Do, Re, Mi', artist: 'Lección 1 · Mano derecha',
        concept: 'Encontrar el Do central y usar los dedos 1, 2 y 3.',
        tip: 'El Do central es la tecla blanca justo a la izquierda del grupo de 2 teclas negras, en el medio del teclado. Poné el pulgar derecho (dedo 1) ahí.',
        bpm: 72
      },
      [['R', 0, 'C4/1/1 D4/1/2 E4/2/3 | E4/1/3 D4/1/2 C4/2/1 | C4/1/1 E4/1/3 D4/1/2 E4/1/3 | C4/4/1']]
    ),
    makeSong(
      {
        id: 'l1_cinco_dedos_der', level: 1, title: 'Cinco dedos: mano derecha', artist: 'Lección 2 · Posición de Do',
        concept: 'Un dedo por tecla: Do-Re-Mi-Fa-Sol = dedos 1-2-3-4-5.',
        tip: 'Dedos curvos, como si sostuvieras una pelota. Cada dedo vive sobre "su" tecla: no hace falta mover la mano.',
        bpm: 80
      },
      [['R', 0, 'C4/1/1 D4/1/2 E4/1/3 F4/1/4 | G4/4/5 | G4/1/5 F4/1/4 E4/1/3 D4/1/2 | C4/4/1 | C4/1/1 E4/1/3 G4/2/5 | G4/1/5 E4/1/3 C4/2/1 | C4/1/1 D4/1/2 E4/1/3 F4/1/4 | E4/1/3 D4/1/2 C4/2/1']]
    ),
    makeSong(
      {
        id: 'l1_cinco_dedos_izq', level: 1, title: 'Cinco dedos: mano izquierda', artist: 'Lección 3 · Posición de Do grave',
        concept: 'La izquierda está "al revés": el meñique (5) toca la nota más grave.',
        tip: 'Meñique izquierdo en el Do que está una octava abajo del Do central. Do-Re-Mi-Fa-Sol = dedos 5-4-3-2-1.',
        bpm: 80
      },
      [['L', 0, 'C3/1/5 D3/1/4 E3/1/3 F3/1/2 | G3/4/1 | G3/1/1 F3/1/2 E3/1/3 D3/1/4 | C3/4/5 | C3/1/5 E3/1/3 G3/2/1 | G3/1/1 E3/1/3 C3/2/5 | C3/1/5 D3/1/4 E3/1/3 F3/1/2 | E3/1/3 D3/1/4 C3/2/5']]
    ),
    makeSong(
      {
        id: 'l2_himno_alegria', level: 2, title: 'Himno a la Alegría', artist: 'Beethoven · Lección 4',
        concept: 'Melodía con la derecha + notas largas con la izquierda.',
        tip: 'Practicá primero "Solo derecha". La izquierda toca solo Do y Sol: el meñique en Do3 y el pulgar en Sol3.',
        bpm: 96
      },
      [
        ['R', 0, [ODE_A1, ODE_A2, ODE_B, ODE_A2].join(' ')],
        ['L', 0, [ODE_LA1, ODE_LA2, ODE_LB, ODE_LA2].join(' ')]
      ]
    ),
    makeSong(
      {
        id: 'l2_estrellita', level: 2, title: 'Estrellita, ¿dónde estás?', artist: 'Tradicional · Lección 5',
        concept: 'Estirar el meñique (Sol → La) y coordinar las dos manos.',
        tip: 'Mano derecha en posición de Do. Cuando aparece el La, estirá el dedo 5 una tecla y volvé.',
        bpm: 96
      },
      [
        ['R', 0, 'C4/1/1 C4/1/1 G4/1/5 G4/1/5 | A4/1/5 A4/1/5 G4/2/5 | F4/1/4 F4/1/4 E4/1/3 E4/1/3 | D4/1/2 D4/1/2 C4/2/1 | G4/1/5 G4/1/5 F4/1/4 F4/1/4 | E4/1/3 E4/1/3 D4/2/2 | G4/1/5 G4/1/5 F4/1/4 F4/1/4 | E4/1/3 E4/1/3 D4/2/2 | C4/1/1 C4/1/1 G4/1/5 G4/1/5 | A4/1/5 A4/1/5 G4/2/5 | F4/1/4 F4/1/4 E4/1/3 E4/1/3 | D4/1/2 D4/1/2 C4/2/1'],
        ['L', 0, 'C3/4/5 | F3/2/2 C3/2/5 | F3/2/2 C3/2/5 | G3/2/1 C3/2/5 | C3/2/5 F3/2/2 | C3/2/5 G3/2/1 | C3/2/5 F3/2/2 | C3/2/5 G3/2/1 | C3/4/5 | F3/2/2 C3/2/5 | F3/2/2 C3/2/5 | G3/2/1 C3/2/5']
      ]
    ),
    makeSong(
      {
        id: 'l2_acordes_do_fa_sol', level: 2, title: 'Tus primeros acordes: Do, Fa y Sol', artist: 'Lección 6 · Mano izquierda',
        concept: 'Los 3 acordes que alcanzan para cientos de canciones.',
        tip: 'Do = Do-Mi-Sol. Para Fa el meñique se queda en Do. Para Sol el pulgar se queda en Sol. ¡Mové lo mínimo!',
        bpm: 80
      },
      [['L', 0, [
        `${LH_C}/4/5+3+1 | ${LH_F}/4/5+2+1 | ${LH_G}/4/5+3+1 | ${LH_C}/4/5+3+1 |`,
        `${LH_C}/2/5+3+1 ${LH_C}/2/5+3+1 | ${LH_F}/2/5+2+1 ${LH_F}/2/5+2+1 | ${LH_G}/2/5+3+1 ${LH_G}/2/5+3+1 | ${LH_C}/4/5+3+1 |`,
        `${LH_C}/1/5+3+1 ${LH_C}/1/5+3+1 ${LH_C}/1/5+3+1 ${LH_C}/1/5+3+1 | ${LH_F}/1/5+2+1 ${LH_F}/1/5+2+1 ${LH_F}/1/5+2+1 ${LH_F}/1/5+2+1 | ${LH_G}/1/5+3+1 ${LH_G}/1/5+3+1 ${LH_G}/1/5+3+1 ${LH_G}/1/5+3+1 | ${LH_C}/4/5+3+1`
      ].join(' ')]]
    ),
    makeSong(
      {
        id: 'l3_escala_do', level: 3, title: 'Escala de Do mayor (paso del pulgar)', artist: 'Lección 7 · Técnica',
        concept: 'Pasar el pulgar por debajo para tocar más de 5 notas seguidas.',
        tip: 'Derecha: 1-2-3, el pulgar pasa por debajo al Fa, y sigue 1-2-3-4-5. Al bajar, el dedo 3 cruza por encima del pulgar. Primero cada mano, al final juntas.',
        bpm: 72
      },
      [
        ['R', 0, SCALE_R],
        ['L', 16, SCALE_L],
        ['R', 32, SCALE_R + ' C4/4/1'],
        ['L', 32, SCALE_L + ' C3/4/5']
      ]
    ),
    makeSong(
      {
        id: 'l3_cumpleanos', level: 3, title: 'Cumpleaños Feliz', artist: 'Tradicional · Lección 8',
        concept: 'Compás de 3 tiempos, anacrusa y un salto de octava.',
        tip: 'Empieza "antes" del primer compás (anacrusa). Contá 1-2-3 como un vals. El salto grande es en "que los cumplas...".',
        bpm: 90, timeSig: [3, 4], pickup: 1
      },
      [
        ['R', 0, 'G4/0.75/1 G4/0.25/1 | A4/1/2 G4/1/1 C5/1/4 | B4/2/3 G4/0.75/1 G4/0.25/1 | A4/1/2 G4/1/1 D5/1/5 | C5/2/4 G4/0.75/1 G4/0.25/1 | G5/1/5 E5/1/4 C5/1/2 | B4/1/1 A4/1/2 F5/0.75/5 F5/0.25/5 | E5/1/4 C5/1/2 D5/1/3 | C5/3/2'],
        ['L', 1, 'C3/3/5 | G3/3/1 | G3/3/1 | C3/3/5 | C3/3/5 | F3/3/2 | C3/2/5 G3/1/1 | C3/3/5']
      ]
    ),
    makeSong(
      {
        id: 'l3_cuatro_acordes', level: 3, title: 'Los 4 acordes del pop (Lam-Fa-Do-Sol)', artist: 'Lección 9 · Acordes con ritmo',
        concept: 'La progresión de miles de canciones, con mínimo movimiento.',
        tip: 'El pulgar derecho casi siempre queda en Do. Fijate que de un acorde al siguiente cambian solo 1 o 2 dedos.',
        bpm: 80
      },
      [
        ['R', 0, [
          `${RH_AM}/4/1+2+5 | ${RH_F}/4/1+3+5 | ${RH_C}/4/1+3+5 | ${RH_G}/4/1+2+5 |`,
          `${RH_AM}/1/1+2+5 ${RH_AM}/1/1+2+5 ${RH_AM}/1/1+2+5 ${RH_AM}/1/1+2+5 | ${RH_F}/1/1+3+5 ${RH_F}/1/1+3+5 ${RH_F}/1/1+3+5 ${RH_F}/1/1+3+5 | ${RH_C}/1/1+3+5 ${RH_C}/1/1+3+5 ${RH_C}/1/1+3+5 ${RH_C}/1/1+3+5 | ${RH_G}/1/1+2+5 ${RH_G}/1/1+2+5 ${RH_G}/1/1+2+5 ${RH_G}/1/1+2+5 |`,
          `${RH_C}/4/1+3+5`
        ].join(' ')],
        ['L', 0, 'A2/4/1 | F2/4/1 | C3/4/1 | G2/4/1 | A2/2/1 A2/2/1 | F2/2/1 F2/2/1 | C3/2/1 C3/2/1 | G2/2/1 G2/2/1 | C3/4/1']
      ]
    ),
    makeSong(
      {
        id: 'l4_preludio_bach', level: 4, title: 'Preludio en Do (versión inicial)', artist: 'J. S. Bach · Lección 10 · Hipnótico',
        concept: 'Arpegios que se repiten: ideal para entrar en "flow".',
        tip: 'Cada compás es el mismo dibujo dos veces: 2 notas con la izquierda y 3 notas que se repiten con la derecha. Aprendé la forma de la mano en cada compás.',
        bpm: 56
      },
      [],
      bachPreludeEvents()
    ),
    makeSong(
      {
        id: 'l4_canon', level: 4, title: 'Canon (versión en Do)', artist: 'Pachelbel · Lección 11',
        concept: 'Bajo que se repite + melodía que baja por grados.',
        tip: 'El bajo repite siempre las mismas 8 notas. Aprendelo de memoria con "Solo izquierda" y después sumá la melodía.',
        bpm: 66
      },
      [
        ['L', 0, 'C3/2 G2/2 | A2/2 E2/2 | F2/2 C2/2 | F2/2 G2/2 | C3/2 G2/2 | A2/2 E2/2 | F2/2 C2/2 | F2/2 G2/2 | C3+G3/4/5+1'],
        ['R', 0, 'E5/2/5 D5/2/4 | C5/2/3 B4/2/2 | A4/2/1 G4/2/1 | A4/2/2 B4/2/3 | C5/2/5 B4/2/4 | A4/2/3 G4/2/2 | F4/2/1 E4/2/1 | F4/2/2 D4/2/1 | E4+G4+C5/4/1+2+5']
      ]
    ),
    makeSong(
      {
        id: 'l4_para_elisa', level: 4, title: 'Para Elisa (tema principal)', artist: 'Beethoven · Lección 12',
        concept: 'Tecla negra (Re#), compás de 3/8 y manos que se turnan.',
        tip: 'Re# es la tecla negra entre Re y Mi. Las manos casi nunca tocan a la vez: se pasan la melodía. Empezá al 50% de velocidad.',
        bpm: 50, timeSig: [3, 8], pickup: 0.5
      },
      [
        ['R', 0, 'E5/0.25/5 D#5/0.25/4 | ' + ELISE_R_BODY + ' A4/0.5/3 -/0.5 E5/0.25/5 D#5/0.25/4 | ' + ELISE_R_BODY + ' A4/1.5/3'],
        ['L', 0, '-/0.5 | ' + ELISE_L_BODY + ' ' + ELISE_LA + ' ' + ELISE_L_BODY + ' A2/0.25/5 E3/0.25/2 A3/1/1']
      ]
    )
  ];

  // ---------------------------------------------------------------------------
  // 🖐️ Técnica diaria: escalas mayores de una octava, con la digitación estándar.
  // Subir y bajar en negras; cada mano por separado y después juntas (el plan lo guía).
  // ---------------------------------------------------------------------------
  function scaleSong(id, title, notes, rhUp, lhUp, concept, tip) {
    // notes: las 8 notas de la escala en la octava de la mano derecha (la izquierda, una octava abajo)
    const down = notes.slice(0, 7).reverse();
    const lower = n => n.replace(/(-?\d)$/, d => String(Number(d) - 1));
    const seq = (ns, up, dn) =>
      ns.map((n, i) => `${n}/1/${up[i]}`).join(' ') + ' ' + down.map((n, i) => `${n}/${i === 6 ? 2 : 1}/${dn[i]}`).join(' ');
    const lhNotes = notes.map(lower);
    const rhDown = rhUp.slice(0, 7).reverse();
    const lhDown = lhUp.slice(0, 7).reverse();
    const lhSeq =
      lhNotes.map((n, i) => `${n}/1/${lhUp[i]}`).join(' ') + ' ' + lhNotes.slice(0, 7).reverse().map((n, i) => `${n}/${i === 6 ? 2 : 1}/${lhDown[i]}`).join(' ');
    return makeSong(
      { id, level: 'tec', title, artist: 'Técnica · escala', concept, tip, bpm: 72, technique: true },
      [
        ['R', 0, seq(notes, rhUp, rhDown)],
        ['L', 0, lhSeq]
      ]
    );
  }
  const RH_STD = [1, 2, 3, 1, 2, 3, 4, 5]; // Do, Sol, Re, La, Mi mayor
  const LH_STD = [5, 4, 3, 2, 1, 3, 2, 1];
  const TECHNIQUE = [
    scaleSong('tec_do', 'Escala de Do mayor', ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], RH_STD, LH_STD,
      'Solo teclas blancas. Derecha: el pulgar pasa por abajo después del 3. Izquierda: el 3 cruza por arriba del pulgar.',
      'Muñeca quieta y a la altura del teclado; que el pulgar se deslice sin que el codo salte. Todas las notas con el mismo volumen.'),
    scaleSong('tec_sol', 'Escala de Sol mayor', ['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5'], RH_STD, LH_STD,
      'Un sostenido: Fa♯. Misma digitación que Do.',
      'El Fa♯ lo toca el dedo 4 en la derecha y el 2 en la izquierda (bajando y subiendo). Anticipalo con la mano.'),
    scaleSong('tec_fa', 'Escala de Fa mayor', ['F4', 'G4', 'A4', 'Bb4', 'C5', 'D5', 'E5', 'F5'], [1, 2, 3, 4, 1, 2, 3, 4], LH_STD,
      'Un bemol: Si♭. Ojo: la derecha cambia de digitación (1-2-3-4, 1-2-3-4).',
      'En la derecha el pulgar pasa después del 4, para que el 4 caiga en Si♭. La izquierda es igual que en Do.'),
    scaleSong('tec_re', 'Escala de Re mayor', ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5'], RH_STD, LH_STD,
      'Dos sostenidos: Fa♯ y Do♯.',
      'Con dos teclas negras la mano se "acomoda" más adentro del teclado. Mantené los dedos curvos.'),
    scaleSong('tec_la', 'Escala de La mayor', ['A4', 'B4', 'C#5', 'D5', 'E5', 'F#5', 'G#5', 'A5'], RH_STD, LH_STD,
      'Tres sostenidos: Fa♯, Do♯ y Sol♯.',
      'Practicá primero cada mano lenta. Escuchá que el paso del pulgar no se note: ningún "pozo" en el sonido.'),
    scaleSong('tec_mi', 'Escala de Mi mayor', ['E4', 'F#4', 'G#4', 'A4', 'B4', 'C#5', 'D#5', 'E5'], RH_STD, LH_STD,
      'Cuatro sostenidos: Fa♯, Do♯, Sol♯ y Re♯.',
      'Es la escala más cómoda para la mano: los dedos largos caen en las teclas negras.')
  ];

  window.PianoFlowLibrary = {
    LEVELS,
    BUILTIN_SONGS,
    TECHNIQUE,
    noteToMidi,
    parseSeq
  };
})();
