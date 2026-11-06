// ============================================================================
// PianoFlow · Prueba automática del recorrido "manos en el piano"
//
// Para cada lección y escala: sigue el plan como lo haría alguien sin mouse
// (toca, acepta lo que propone la app en los resultados y sigue) hasta completar
// todos los pasos. Detecta atascos: canciones que no terminan, tramos sin salida,
// pasos imposibles de cumplir o propuestas que se repiten sin avanzar.
//
// Uso: abrir la app (con ?test o desde la consola) y ejecutar:
//   await PianoFlowTest.todo()            → todas las lecciones, perfecto y con errores
//   await PianoFlowTest.leccion('l4_canon', { errores: true })
// ============================================================================
window.PianoFlowTest = (() => {
  const D = () => window.PianoFlowDebug;
  const $ = id => document.getElementById(id);
  const modalOpen = id => $(id).classList.contains('open');

  function tecla(m) {
    D().onUserNoteOn(m, 90);
    D().onUserNoteOff(m);
  }

  // Toca la configuración actual hasta que la canción/vuelta termine o aparezca una ventana
  function tocar(conErrores, rng) {
    const S = D().S;
    const notas = S.song.notes;
    const esMia = n => S.mode !== 'listen' && (S.hand === 'both' || n.hand === S.hand);
    let i = 0;
    let ultimo = S.time;
    const reubicar = () => {
      i = 0;
      while (i < notas.length && notas[i].time < S.time - 1e-3) i++;
    };
    reubicar();
    // Un alumno real mejora: se equivoca en la primera vuelta del tramo, después lo toca bien
    const vuelta0 = S.loop.laps;
    const err = () => conErrores && S.loop.laps === vuelta0;
    const limite = 120 * 60 * 6; // 6 minutos de canción como máximo
    for (let g = 0; g < limite; g++) {
      if (!S.playing || modalOpen('resultsModal')) return { ok: true };
      D().step(1 / 120);
      if (S.time < ultimo - 0.01) reubicar(); // volvió al inicio de un tramo
      ultimo = S.time;
      if (S.mode === 'learn' && S.waiting) {
        for (const n of S.waitGroup.filter(x => x.status === 'pending')) {
          if (err() && rng() < 0.45) tecla(n.midi + 2);
          tecla(n.midi);
        }
      } else if (S.mode === 'rhythm') {
        while (i < notas.length && notas[i].time <= S.time) {
          const n = notas[i++];
          if (n.status !== 'pending' || !esMia(n)) continue;
          if (err() && rng() < 0.4) continue; // se la saltea
          tecla(n.midi);
        }
      }
    }
    return { ok: false, motivo: `la canción no terminó nunca (modo ${S.mode}, tramo ${S.loop.on ? `${S.loop.startBar}-${S.loop.endBar}` : 'no'})` };
  }

  function semilla(n) {
    let x = n || 1;
    return () => ((x = (x * 16807) % 2147483647) / 2147483647);
  }

  async function leccion(id, { errores = false, maxAcciones = 80 } = {}) {
    const d = D();
    const S = d.S;
    const rng = semilla(id.length * 97 + (errores ? 7 : 1));
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    d.openLesson(id);
    d.pause();
    const plan = d.lessonPlan(S.song);
    const hecho = () => plan.filter(st => ((d.progress.songs[id] || {}).steps || {})[st.id]).length;
    const acciones = [];
    let intentos = 0;
    let sinAvance = 0;
    let previo = -1;
    for (let k = 0; k < maxAcciones; k++) {
      const h = hecho();
      if (h === plan.length) return { id, ok: true, acciones: acciones.length };
      sinAvance = h === previo ? sinAvance + 1 : 0;
      previo = h;
      if (sinAvance > 25) return { id, ok: false, motivo: `${sinAvance} acciones sin cumplir ningún paso`, paso: $('stepLabel').textContent, ultimas: acciones.slice(-6) };
      if (modalOpen('resultsModal')) {
        acciones.push(`resultado → "${$('resNext').textContent}"`);
        $('resNext').click(); // lo mismo que la cuenta regresiva o una tecla blanca
        continue;
      }
      const conErrores = errores && intentos++ < 3;
      if (!S.playing) {
        if (S.mode === 'listen' || S.time >= S.song.duration - 0.05) d.seek(-2);
        d.play();
        acciones.push(`tocar ${S.mode}${S.loop.on ? ` tramo ${S.loop.startBar}-${S.loop.endBar}` : ''}${conErrores ? ' con errores' : ''}`);
      }
      const r = tocar(conErrores, rng);
      if (!r.ok) return { id, ok: false, motivo: r.motivo, paso: $('stepLabel').textContent, ultimas: acciones.slice(-6) };
      await null;
    }
    return { id, ok: false, motivo: `no completó el plan en ${maxAcciones} acciones (${hecho()}/${plan.length} pasos)`, paso: $('stepLabel').textContent, ultimas: acciones.slice(-8) };
  }

  async function todo() {
    const L = window.PianoFlowLibrary;
    const ids = L.BUILTIN_SONGS.concat(L.TECHNIQUE || []).map(s => s.id);
    const out = [];
    for (const errores of [false, true]) {
      for (const id of ids) {
        localStorage.removeItem('pf2_progress');
        const p = D().progress;
        p.songs = {};
        const r = await leccion(id, { errores });
        r.modo = errores ? 'con errores' : 'perfecto';
        out.push(r);
      }
    }
    return { fallas: out.filter(r => !r.ok), total: out.length, ok: out.filter(r => r.ok).length };
  }

  // Casos borde: alumno que nunca acierta, alumno que se fue, tramo sin notas para la mano elegida
  async function casosBorde() {
    const d = D();
    const S = d.S;
    const r = {};
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));

    d.openLesson('l1_do_re_mi');
    d.setMode('learn');
    d.setLoop(1, 2, { goal: 2 });
    d.play();
    let g = 0;
    while (S.loop.laps < 7 && g++ < 200000) {
      d.step(1 / 60);
      if (S.waiting) for (const n of S.waitGroup.filter(x => x.status === 'pending')) { tecla(n.midi + 2); tecla(n.midi); }
    }
    r.nuncaAcierta = [...document.querySelectorAll('.toast')].some(t => t.innerText.includes('Salir del tramo')) ? 'ok: avisa y ofrece salir' : 'FALLA: no ofrece salir';
    d.pause();

    d.openLesson('l1_do_re_mi');
    const plan = d.lessonPlan(S.song);
    d.applyStep(plan.findIndex(x => x.id === 'rhythm-60'), { quiet: true });
    d.play();
    S.lastActivity = performance.now() - 25000; // simula 25 s sin tocar
    for (g = 0; g < 600 && S.playing; g++) d.step(1 / 60);
    r.seFue = S.playing ? 'FALLA: sigue sonando solo' : 'ok: se pausa sola';

    d.openLesson('l1_do_re_mi');
    d.setMode('rhythm');
    d.seek(-1);
    d.play();
    for (g = 0; g < 120 * 30 && S.playing && !modalOpen('resultsModal'); g++) {
      S.lastActivity = performance.now(); // está, pero no toca ninguna tecla
      d.step(1 / 120);
    }
    const cuenta = !$('resCountdownWrap').classList.contains('hidden');
    r.sinNotas = modalOpen('resultsModal') && !cuenta ? 'ok: no avanza solo y sugiere revisar el teclado' : `FALLA: modal=${modalOpen('resultsModal')} cuenta=${cuenta}`;
    $('resClose').click();

    // Para Elisa: en la anacrusa (compás 0) la mano izquierda no toca → tramo vacío para esa mano
    d.openLesson('l4_para_elisa');
    d.setMode('learn');
    d.setHand('L');
    d.setLoop(0, 0);
    d.play();
    for (g = 0; g < 120 * 20 && S.loop.on; g++) d.step(1 / 120);
    r.tramoVacio = S.loop.on ? 'FALLA: el tramo vacío sigue girando' : 'ok: sale solo y avisa';
    d.pause();
    return r;
  }

  return { leccion, todo, tocar, casosBorde };
})();
