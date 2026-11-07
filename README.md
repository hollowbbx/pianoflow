# 🎹 PianoFlow — Aprendé piano con tu teclado MIDI

App para aprender piano desde cero con un teclado conectado por USB. Se abre con un ícono,
en su propia ventana, y funciona sin internet (también se puede instalar en el celular).
Las notas caen sobre un teclado en pantalla (estilo Synthesia), pero todo está pensado para
**aprender de verdad**, no solo para "seguir lucecitas".

> La versión anterior (la que armó Antigravity) quedó guardada en `_original_antigravity/`.
> Tus grabaciones e importaciones viejas se conservan.

---

## ▶️ Cómo abrirla

1. Conectá el teclado por USB y encendelo.
2. Doble clic en el ícono **PianoFlow** del escritorio (o en `PianoFlow.vbs`).
   Se abre en su propia ventana, sin ventana negra. Atrás queda un servidor chiquito e invisible
   (`servidor.py`) que se reutiliza si lo abrís otra vez.
3. La primera vez, la app pregunta si permitís "dispositivos MIDI" → **Permitir**.
4. Hacé un clic en la página (los navegadores no dejan sonar audio hasta que hacés clic).

**Opcional: instalarla.** En Edge/Chrome aparece el botón **📲 Instalar app** arriba (o el ícono de instalar
en la barra de direcciones). Instalada, queda en el menú Inicio y abre aunque el servidor no esté andando
ni haya internet (usa una copia guardada; las actualizaciones llegan cuando la abrís con el ícono del escritorio).

Tu progreso se guarda en el navegador para la dirección `http://localhost:8085`: entrá siempre por ahí.
Necesita Chrome o Edge (Firefox y Safari no soportan teclados MIDI por USB) y Python instalado.

### 📱 En el celular
La pantalla se adapta al celular, vertical u horizontal: teclas más grandes para el dedo, y en la lectura
de notas un tecladito para responder sin teclado MIDI. Ideal para practicar lectura acostado.
- Para instalarla en el celular, la app tiene que estar publicada en internet con https (por ejemplo, GitHub Pages
  o Netlify, gratis). Después: **Android** → Chrome → menú ⋮ → *Instalar app*. **iPhone** → Safari → Compartir → *Agregar a inicio*.
- En el celular el progreso es aparte del de la PC.
- **Android + cable OTG:** podés conectar el Yamaha al celular (Chrome soporta MIDI). En iPhone no se puede.

---

## 🧭 Cómo se usa (el método)

La app está armada como las apps profesionales (Simply Piano, Skoove, Flowkey, Piano Marvel)
y como una clase con profesor: rutina diaria corta, lecciones en pasos chicos y lectura de partitura aparte.

### 🏠 Inicio: tu práctica de hoy
Cada vez que abrís la app aparece una rutina de 3 partes (como una clase):
1. **Calentamiento** (≈3 min), con tres opciones:
   - **🎼 Lectura de notas:** aparece una nota en el pentagrama y la tocás. 6 niveles: Do–Sol → clave de Sol →
     clave de Fa → las dos claves → líneas adicionales → sostenidos y bemoles. Pasás de nivel con 18 de 20 a la primera.
   - **👂 Oído:** suena un Do de referencia y después una nota misteriosa; la buscás en el teclado. 4 niveles.
   - **🖐️ Escala del día:** escalas mayores (Do, Sol, Fa, Re, La, Mi) con la digitación correcta.
2. **🎯 Tu lección:** el botón **▶ Continuar** te lleva directo al próximo paso que te toca.
3. **🔁 Repaso:** una canción que ya sabías (★★) y que hace 2 días o más que no tocás.
   Repasar espaciado es lo que pasa las canciones a la memoria de largo plazo.

### 📋 Cada lección viene en pasos (la barra "Plan")
Debajo de los controles hay una fila de números: es el plan de la lección. La app configura sola
el modo, la mano, la velocidad y el tramo de cada paso, y cuando lo cumplís te lleva al siguiente:
- 👀 **Escuchar** la canción entera.
- 🎯 **Aprender por partes:** las canciones largas se dividen en partes de ~8 compases. En cada parte:
  mano derecha → mano izquierda → manos juntas (meta: 80 % de precisión).
- ⏱️ **Con ritmo** al 60 % → 80 % → 100 % de velocidad (metas: 75 % → 80 % → 90 %).

Las **ayudas se van apagando solas**: al 80 % ya no aparecen los nombres de las notas, al 100 % no hay ayudas,
y el último paso es **🎼 tocarla leyendo la partitura**, sin notas que caen.

Podés hacer clic en cualquier número para ir a ese paso, o usar los controles a mano cuando quieras.

### 🎸 Acordes y progresiones (sin partitura)
Para tocar canciones con cifrado (C, Am, F, G…) como en los cancioneros y sitios de acordes.
Se abre desde Inicio (calentamiento) o en ⚙️ → *Acordes y progresiones*. Tiene 3 modos:
- **🎹 Tocar:** aparece el nombre de un acorde y lo tocás en cualquier octava o posición. Si te equivocás,
  te dice qué tocaste y qué nota falta o sobra; con **💡 Mostrame** lo ves en el tecladito. 7 niveles:
  Do-Fa-Sol → los 6 de Do → mayores → menores → con teclas negras → séptimas → inversiones.
- **🔁 Progresiones:** I–IV–V–I, I–V–vi–IV (pop), vi–IV–I–V, I–vi–IV–V, ii–V–I (jazz) y blues de 12 compases,
  en Do, Sol, Fa, Re o La, a tempo y con metrónomo. Te sugiere las **posiciones que menos mueven la mano**
  (inversiones), marca el próximo acorde y dice si cambiaste a tiempo, tarde o no llegaste. Con
  **🔊 La PC toca** la escuchás antes de tocarla.
- **👂 Reconocer:** mayor o menor, séptimas y otros colores, qué grado es (I, ii, IV, V, vi…) y qué progresión
  suena. Respondés con el mouse o con el piano (Do = opción 1, Re = 2…; una tecla negra repite).

**¿No te interesa leer partitura?** En ⚙️ → *Leer partitura* elegí **No** (es lo que viene por defecto):
desaparecen el pentagrama, la vista partitura y el paso de leerla, y el calentamiento pasa a ser de acordes.
Cuando quieras aprender a leer, lo activás.

### 🎵 Tus canciones (MuseScore, MIDI y MusicXML)
En Inicio, abajo de todo, **Más canciones** tiene un buscador que abre MuseScore con la búsqueda lista
(por ejemplo "Dirtmouth easy piano"). Descargá el arreglo como **MusicXML** (mejor: trae la separación exacta
de manos y la digitación del arreglador) o como **MIDI**, y abrilo en PianoFlow de cualquiera de estas formas:
- **arrastrando** el archivo a la ventana;
- con **doble clic** en el archivo (con la app instalada en la PC);
- en el celular (Android, app instalada): desde Descargas, **Compartir → PianoFlow**;
- con el botón **Importar MIDI o MusicXML**.

Cada canción importada recibe su propio plan de pasos, igual que las lecciones. MuseScore no tiene una API pública
(la cerró), por eso la integración es abrir la búsqueda y recibir el archivo que descargás vos.

### 🎹 Tocar libre
En Inicio, **Tocar libre**: el **piano libre** (sin canción: ves en grande qué nota o acorde estás tocando y podés
grabar) o **cualquier pieza a tu ritmo**, sin plan, sin puntaje y sin resultados.

### 🎹 Manos en el piano (sin mouse)
Toda la práctica se puede manejar desde el teclado del piano:
- **Tocá cualquier tecla** para empezar una canción o una ronda de lectura/oído.
- En las ventanas (resultados, Inicio, bienvenida): **tecla blanca o pedal = seguir**, **tecla negra = repetir**
  (en Inicio, la negra abre el calentamiento de lectura).
- Después de cada resultado, una **cuenta regresiva** pasa sola al próximo paso. Si tocás el mouse, se frena.
- Al terminar de escuchar una canción, la app pasa sola al paso siguiente.
Se puede apagar en ⚙️ → Teclado MIDI.

### 🎧 El profe te escucha
Al terminar, además de la precisión, la app comenta **cómo** tocaste, como lo haría un profesor:
- si te apurás o te atrasás respecto del pulso (en milisegundos) y si el pulso sale irregular;
- si las dos manos no caen juntas;
- si una mano suena más fuerte que la otra o si el volumen sale desparejo (con teclados sensibles al toque, como el PSR-E383);
- si soltás las teclas antes de tiempo (falta de legato);
- en 🎯 Aprender, en qué compás dudaste más.

### 🎼 Vista partitura
El botón **🎼 Partitura** cambia las notas que caen por un pentagrama de piano real que avanza: derecha en clave de Sol,
izquierda en clave de Fa, y la línea verde marca "ahora". Es el puente entre las notas que caen y leer partitura de verdad.

### 📊 Tu semana
En Inicio ves los minutos de cada día, los pasos cumplidos, tu precisión y tu tendencia de pulso. El botón
**📋 Copiar informe para el profe** copia un resumen para mandarlo por WhatsApp o mail.

### Los 3 modos
| Modo | Qué pasa | Para qué sirve |
|---|---|---|
| 👀 **Escuchar** | La PC toca todo | Que el oído y la vista conozcan la canción antes que las manos |
| 🎯 **Aprender** | Las notas **se frenan y te esperan** | Aprender qué tecla y qué dedo, sin presión de tiempo |
| ⏱️ **Con ritmo** | La canción sigue a tempo y mide si llegás a tiempo (Perfecto / Bien / Temprano / Tarde) | Tocar *música*, no notas sueltas |

Al terminar cada canción, la app te dice **cuál es el próximo paso concreto**: otra mano,
pasar a Con ritmo, subir la velocidad o repetir *los compases exactos* donde fallaste.

### Estrellas (para saber cuándo seguir)
- ★ La terminaste en 🎯 Aprender.
- ★★ Con ritmo, ambas manos, 75 % o más.
- ★★★ Con ritmo, ambas manos, 90 % o más, a velocidad normal.

Regla práctica: **pasá a la lección siguiente con ★★**, y volvé más adelante por la ★★★.

### Las herramientas que más hacen la diferencia
- **Manos separadas:** practicás una mano y la PC toca la otra (suena completo igual).
- **Repetir tramo:** arrastrá con el mouse sobre la línea de tiempo para elegir compases.
  Con **⚡ Subir velocidad sola**, cada vuelta con 90 % o más sube 5 % la velocidad, hasta 100 %.
  Esto es lo que más acelera el aprendizaje: pedazos chicos, lento, y que la velocidad llegue sola.
- **Números de dedo** en cada nota que cae y sobre la tecla que hay que tocar.
- **Guía sin castigo:** si te equivocás, te dice hacia dónde ir ("2 teclas blancas a la izquierda 👈")
  y detecta si tocaste la nota correcta en otra octava. No hay sonidos de error ni vidas.
- **Pentagrama de ayuda:** muestra las próximas notas escritas como partitura real. Mirarlo de reojo
  te enseña a leer de a poco.
- **Detector de acordes:** te dice qué nota, intervalo o acorde estás tocando.
- **Racha y meta diaria:** cuenta minutos *reales* de práctica por día (meta configurable).
- **Tocá cualquier tecla para empezar:** no hace falta soltar el piano para ir al mouse.
- **Grabar:** tocá libre y se convierte en una canción practicable. Con el metrónomo prendido, la grabación queda alineada a compases.
- **Importar .MID:** cualquier archivo MIDI (por ejemplo de musescore.com o bitmidi.com).

### Atajos
`Espacio` empezar/pausar · `Enter` reiniciar · `←` `→` compás anterior/siguiente ·
`↑` `↓` velocidad · `1` `2` `3` modo · `Esc` cerrar ventanas.
Sin teclado MIDI: `A W S E D F T G Y H U J K…` funcionan como teclas de piano (`Z`/`X` cambian de octava).

---

## 🎹 Guía para Yamaha PSR-E383 (y similares: PSR-E373, PSR-E463, EZ-300…)

### Conexión
- Usá el puerto **USB TO HOST** de atrás del teclado y un cable **USB-A a USB-B** (tipo "cable de impresora")
  que sea de **datos** (algunos cables solo cargan).
- En Windows 10/11 **no hace falta driver**: el teclado se reconoce solo. Suele aparecer con un nombre como
  *"Digital Keyboard"*. El driver "Yamaha USB-MIDI" es opcional.
- Conectalo directo a la PC (mejor sin hubs USB). Encendé el teclado **antes** de abrir la página;
  si lo conectás después, hacé clic en el indicador del teclado (arriba) para volver a buscarlo.

### Ajustes recomendados en la app
- ⚙️ → **Mis teclas suenan en la PC: No.** Tu Yamaha ya suena por sus parlantes; si suena también la PC,
  escuchás doble y con un pequeño retraso. (La app te lo ofrece sola al conectar el teclado.)
- ⚙️ → **Acompañamiento sale por: Teclado** (opcional). La mano que toca la PC suena con el piano
  de tu Yamaha, por sus parlantes, por el canal MIDI 2. Queda todo con el mismo sonido.
- ⚙️ → **Teclado en pantalla: 61** si querés que la pantalla sea idéntica a tu teclado
  (en "Auto" se agranda para mostrar solo la zona que usa cada canción).

### Ajustes recomendados en el teclado
- **Voz:** piano de cola (normalmente la voz 001).
- **Sensibilidad al toque (Touch):** activada. Así la app recibe qué tan fuerte tocás.
- **Ritmos/Estilos y Demo apagados** mientras practicás. Si los usás, en ⚙️ elegí *Escuchar canales: Solo el 1*
  para que esas notas no se confundan con las tuyas (la batería ya se ignora siempre).
- **Transpose y Octave en 0.** Si están corridos, todo llega desplazado. Si pasa, la app lo detecta
  ("venís tocando las notas bien pero una octava más grave…") y te ofrece corregirlo.
- **Pedal de sustain:** si tenés uno (por ejemplo Yamaha FC5), también llega por USB.
- Si al tocar **tu teclado no suena**, revisá que **Local Control** esté en *On* (menú Function).
  Consultá el manual de tu modelo para la ubicación exacta de estas funciones.

### Problemas conocidos y soluciones
| Problema | Solución |
|---|---|
| "Permiso MIDI bloqueado" | Candado de la barra de direcciones → Dispositivos MIDI → Permitir. Recargá. |
| El teclado aparece pero no responde | En Windows, **solo un programa a la vez** puede usar el teclado. Cerrá otras pestañas de PianoFlow, Synthesia, DAWs o apps de Yamaha, y hacé clic en el indicador. |
| No aparece el teclado | Esperá ~5 segundos después de enchufarlo (Windows 11 tarda en publicarlo) y **recargá la página (F5)**. Si sigue sin aparecer: otro cable (de datos), otro puerto USB. |
| En el Administrador de dispositivos aparece "Digital Keyboard" con error (código 10) | Es la parte de *audio por USB* del teclado; no afecta al MIDI. Mientras haya otro "Digital Keyboard" sin error, la app funciona. |
| No se oye nada de la PC | Hacé un clic en la página (bloqueo de audio del navegador) y revisá los volúmenes en ⚙️. |
| El sonido de la PC llega tarde | Los **auriculares Bluetooth** agregan mucho retraso: usá los parlantes del teclado o auriculares con cable. |
| Suena "electrónico" | El piano real se descarga de internet la primera vez (unos 2 MB). Sin conexión se usa un sintetizador. En ⚙️ dice qué sonido está activo. |
| Todo una octava corrida | Transpose/Octave del teclado, o ⚙️ → Corrección de octava. |

---

## 📅 ¿Se puede tocar "decentemente" en un año? Plan sugerido

Sí, es realista con **constancia**: 15–30 minutos **todos los días** rinden mucho más que sesiones largas y salteadas.
Esta app cubre muy bien la parte de *qué teclas, con qué dedos y a tiempo*. Para tocar de verdad
también necesitás leer partitura, técnica sin tensión y tocar sin ayudas: el plan lo incluye.

| Meses | Objetivo | En la app |
|---|---|---|
| 1–2 | Ubicarte en el teclado, 5 dedos, manos juntas en cosas simples | Lecciones 1–6 hasta ★★. Lectura de notas niveles 1–2. Meta diaria de 10–15 min. |
| 3–4 | Paso del pulgar, compás de 3, acordes básicos | Lecciones 7–9. Lectura niveles 3–4. Escalas de Do y Sol todos los días (2 min). Cambiá "En las notas que caen" a **Dedo** (sin nombres). |
| 5–6 | Primeras obras reales | Lecciones 10–12 + MIDIs simples que te gusten. Lectura niveles 5–6. Usá mucho *Repetir tramo*. Empezá a mirar el pentagrama de ayuda. |
| 7–9 | Leer partitura simple y acompañar con acordes | Pasá "En las notas que caen" a **Nada** y apoyate en el pentagrama. Sumá un libro de método para adultos. |
| 10–12 | Repertorio propio de 5–10 piezas | Tocá cada pieza **sin la app** desde la partitura o de memoria; grabate con ● Grabar y escuchate. |

Tres consejos que valen oro:
1. **Lento y bien > rápido y mal.** Lo que practicás con errores, lo aprendés con errores.
2. **Repasá canciones viejas** cada tanto: así pasan a la memoria de largo plazo.
3. Si podés, **una clase con un profesor cada tanto** para revisar postura y tensión en las manos:
   es lo único que una app no puede ver.

---

## 🎨 Diseño

La interfaz evita las señales típicas de las apps "hechas con IA" (degradés violetas, emojis como íconos,
etiquetas en MAYÚSCULAS, todo en tarjetas redondeadas con brillo). Los colores salen del propio piano:
**ébano** (fondo), **marfil** (texto y teclas), **bronce** de los pedales (acción principal y mano derecha),
**acero** (mano izquierda), **terracota** (corrección) y **fieltro rojo** (grabar). Títulos en *Fraunces*,
interfaz en *Atkinson Hyperlegible* (muy legible de lejos, mientras tocás). Los íconos son dibujos propios.
Las fuentes se descargan la primera vez y quedan guardadas para usar sin internet.

## 🛠️ Archivos

- `index.html` — estructura de la interfaz.
- `styles.css` — diseño oscuro y calmo (verde = derecha, celeste = izquierda, ámbar = corrección).
- `app.js` — motor de práctica (modos, tiempos, bucle, estrellas, racha, dibujo, MIDI, grabador).
- `audio.js` — piano real (muestras Salamander Grand Piano) + sintetizador de respaldo + salida MIDI al teclado.
- `midi-parser.js` — lector/exportador de archivos `.mid` y detector de acordes.
- `musicxml.js` — lector de MusicXML (.musicxml y .mxl comprimido), con manos, ligaduras, anacrusa, tempo y digitación.
- `songs.js` — las 12 lecciones, escritas en una notación compacta y validada compás por compás.
- `PianoFlow.vbs` — abre la app en su ventana (lo usa el ícono del escritorio). `iniciar_piano.bat` hace lo mismo.
- `servidor.py` — servidor local invisible en `localhost:8085`.
- `manifest.webmanifest`, `sw.js`, `icons/` — lo que la hace instalable y le permite funcionar sin internet.
- `tests/recorrido.js` — prueba automática: recorre todas las lecciones y escalas sin mouse (tocando perfecto y con
  errores) y casos borde (alumno que se va, tramo que nunca sale, tramo sin notas). Se carga en la consola del navegador
  con la app abierta y se corre con `await PianoFlowTest.todo()` y `await PianoFlowTest.casosBorde()`.

### Ideas a futuro
- **Canciones con cifrado:** pegar los acordes de una canción (C Am F G…) y practicarla con la progresión a tempo,
  eligiendo el patrón de la mano izquierda (plano, arpegio, balada).
- Entrenador de ritmo: leer y marcar ritmos escritos con una sola tecla.
- Arpegios y acordes con inversiones en todas las tonalidades.
- Lectura de notas con ritmo (compases enteros) y con acordes.
- Separación de manos más inteligente al importar MIDIs de una sola pista.
- Que el teclado del PSR muestre qué tecla tocar (algunos modelos con luces lo permiten; el PSR-E383 no tiene luces).
