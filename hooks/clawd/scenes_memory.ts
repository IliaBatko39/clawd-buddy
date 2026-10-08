// Memory scenes: Clawd at the memory card cabinet — recalls (pulls out a card) and memorizes (writes a new one and
// files it in a drawer). Each function returns the strip's content (without <svg>), see core.ts.
// Both are "while working" scenes: everything stays at x <= 460 (helpers are drawn on the right). SMIL only.
import {
  type Anim, type Eyes, type Gear, C, EASE, EASE_IN, EASE_OUT, TOP,
  at, attr, clawd, fade, g, glyph, move, px, r, scaleAnim, squash,
} from './core'

// ── таймлайны ────────────────────────────────────────────────────────────────

type Span = readonly [number, number] // отрезок времени цикла, с
type Key = readonly [number, string, string?] // [время, значение, сплайн участка, ведущего в этот кадр]
const LIN = '0 0 1 1'
const kt = (t: number, dur: number) => +(t / dur).toFixed(3)
const ev = (v: number) => Math.round(v / 2) * 2 // пиксели частиц и полётов — кратно 2

// видимость по отрезкам цикла: дискретная opacity 1 внутри отрезков, 0 вне их
function show(inner: string, spans: Span[], dur: number): string {
  const on = (t: number) => spans.some(([a, b]) => t >= a && t < b)
  const ts = [...new Set([0, ...spans.flat()])].filter(t => t >= 0 && t < dur).sort((a, b) => a - b)
  const pts: Array<[number, number]> = []
  for (const t of ts) {
    const v = on(t) ? 1 : 0
    if (pts.length === 0 || pts[pts.length - 1]![1] !== v) pts.push([t, v])
  }
  const anim = fade(pts.map(p => p[1]).join(';'), `${dur}s`, { calc: 'discrete', keyTimes: pts.map(p => kt(p[0], dur)).join(';') })
  return g(inner, anim, on(0) ? '' : ' opacity="0"')
}
// дополнение отрезков до цикла
function rest(spans: Span[], dur: number): Span[] {
  const out: Span[] = []
  let t = 0
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (a > t) out.push([t, a])
    t = Math.max(t, b)
  }
  if (t < dur) out.push([t, dur])
  return out
}

// плавная дорожка: первый кадр — в 0, последний — в dur (= первому значению, цикл бесшовный)
function kf(keys: Key[], dur: number): { values: string; o: Anim } {
  const all: Key[] = [...keys]
  if (all[0]![0] !== 0) all.unshift([0, all[0]![1]])
  if (all[all.length - 1]![0] !== dur) all.push([dur, all[0]![1]])
  return {
    values: all.map(k => k[1]).join(';'),
    o: { calc: 'spline', keyTimes: all.map(k => kt(k[0], dur)).join(';'), keySplines: all.slice(1).map(k => k[2] ?? EASE).join(';') },
  }
}
const moveK = (keys: Key[], dur: number) => { const k = kf(keys, dur); return move(k.values, `${dur}s`, k.o) }
const scaleK = (keys: Key[], dur: number) => { const k = kf(keys, dur); return scaleAnim(k.values, `${dur}s`, k.o) }
const fadeK = (keys: Key[], dur: number) => { const k = kf(keys, dur); return fade(k.values, `${dur}s`, k.o) }
const attrK = (name: string, keys: Key[], dur: number) => { const k = kf(keys, dur); return attr(name, k.values, `${dur}s`, k.o) }
// ступенчатый сдвиг: [время, "x y"], значение держится до следующего кадра
const moveD = (keys: Array<[number, string]>, dur: number) =>
  move(keys.map(k => k[1]).join(';'), `${dur}s`, { calc: 'discrete', keyTimes: keys.map(k => kt(k[0], dur)).join(';') })

// дискретная дрожь: в отрезке [a, b) каждые step с значение чередуется между v1 и v0, вне — v0
function jitter(spans: Array<[number, number, number, string]>, v0: string, dur: number): string {
  const pts: Array<[number, string]> = [[0, v0]]
  for (const [a, b, step, v1] of spans) {
    let k = 0
    for (let t = a; t < b - 1e-6; t += step) pts.push([+t.toFixed(3), k++ % 2 === 0 ? v1 : v0])
    pts.push([b, v0])
  }
  return moveD(pts, dur)
}
// полёт по кривой f(s), s ∈ (0, 1]: n линейных кадров от t0 до t1
function path(t0: number, t1: number, n: number, f: (s: number) => [number, number]): Key[] {
  const out: Key[] = []
  for (let k = 1; k <= n; k++) {
    const [x, y] = f(k / n)
    out.push([+(t0 + ((t1 - t0) * k) / n).toFixed(3), `${ev(x)} ${ev(y)}`, LIN])
  }
  return out
}
// масштаб вокруг точки (cx, cy) в px
const scaleAround = (inner: string, cx: number, cy: number, anim: string) =>
  `<g transform="translate(${cx},${cy})">${g(`<g transform="translate(${-cx},${-cy})">${inner}</g>`, anim)}</g>`
// искра: появляется в t0, улетает на (dx, dy) к t1 и гаснет
function burst(inner: string, t0: number, t1: number, dx: number, dy: number, dur: number): string {
  // после t1 искра невидима — возврат в 0 0 идёт за кадром; гаснет линейно (без keySplines — короче SVG)
  const m = move(`0 0;0 0;${dx} ${dy};0 0`, `${dur}s`, { calc: 'spline', keyTimes: `0;${kt(t0, dur)};${kt(t1, dur)};1`, keySplines: `${LIN};${EASE_OUT};${LIN}` })
  const f = fade('0;0;1;0;0', `${dur}s`, { calc: 'linear', keyTimes: `0;${kt(t0, dur)};${kt(t0 + 0.05, dur)};${kt(t1, dur)};1` })
  return g(inner, m + f, ' opacity="0"')
}
// упаковка готовой сцены: подряд идущие простые <rect>/<path> одного цвета → один <path>
// (порядок слоёв сохраняется; склеиваются только соседи — картинка та же, SVG короче)
const TOK = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"\/>|<path d="([^"]+)" fill="([^"]+)"\/>/y
function pack(s: string): string {
  let out = '', i = 0, fill = '', d = ''
  const flush = () => { if (fill) out += `<path d="${d}" fill="${fill}"/>`; fill = ''; d = '' }
  while (i < s.length) {
    TOK.lastIndex = i
    const m = TOK.exec(s)
    if (m) {
      const f = m[5] ?? m[7] ?? ''
      if (f !== fill) flush()
      fill = f
      d += m[6] ?? `M${m[1]} ${m[2]}h${m[3]}v${m[4]}h-${m[3]}z`
      i = TOK.lastIndex
    } else {
      flush()
      const j = s.indexOf('<', i + 1)
      const e = j < 0 ? s.length : j
      out += s.slice(i, e)
      i = e
    }
  }
  flush()
  return out
}
// взгляд по таймлайну [время начала, глаза]: одна копия clawd() на каждый вид глаз, видна в своих отрезках.
// Моргание — отдельные короткие отрезки 'closed' (блинк core с периодом 5 с не делит цикл)
function eyesTrack(seq: Array<[number, Eyes]>, gear: Gear, dur: number, glintOn: Eyes): string {
  // в очках глаз не видно (стёкла закрывают все виды глаз) — одна копия с бликом
  if (gear.glasses) return clawd({ eyes: 'open', arms: 'none', blink: false, gear })
  const spans = new Map<Eyes, Span[]>()
  seq.forEach(([t, e], i) => {
    const end = i + 1 < seq.length ? seq[i + 1]![0] : dur
    const l = spans.get(e) ?? []
    l.push([t, end])
    spans.set(e, l)
  })
  let s = ''
  for (const [e, sp] of spans) s += show(clawd({ eyes: e, arms: 'none', blink: false, gear, glint: e === glintOn }), sp, dur)
  return s
}

// ── картотека памяти (общая декорация обеих сцен) ─────────────────────────────
// Шкаф 64×40 px на полу (x 184..248, y 14..54): 2 столбца × 3 ряда ящиков с ярлычком и ручкой,
// сверху — стопка чистых карточек и розовый пиксельный мозг.

const CX = 184
const CY = 14
const CW = 64
const CH = 40
const FACE = '#a8734e'
const FACE_S = '#7a4a30'
const SLOT = '#3b2416'
const PINK = '#f2a0bf'
const PINK_D = '#c45f88'
const GLOW = '#ffe7a6'
// левый верх лицевой панели ящика i (0..5: слева направо, сверху вниз)
const dPos = (i: number): [number, number] => [CX + 4 + (i % 2) * 30, CY + 4 + Math.floor(i / 2) * 12]
const faceL = (x: number, y: number) => [px(x, y, 26, 10, FACE), px(x, y + 8, 26, 2, FACE_S), px(x + 9, y + 2, 8, 4, C.paper), px(x + 10, y + 6, 6, 2, C.ink2)]
const face = (x: number, y: number) => faceL(x, y).join('')
// выдвинутый ящик ближе к зрителю: панель крупнее
const faceNear = (x: number, y: number) =>
  px(x - 2, y - 2, 30, 12, FACE) + px(x - 2, y + 8, 30, 2, FACE_S) + px(x + 8, y, 10, 4, C.paper) + px(x + 9, y + 4, 8, 2, C.ink2)
const BRAIN = [
  '..PPP.PP..',
  '.PWPPDPPP.',
  'PPPDPPPDPP',
  'PDPPPDPPDP',
  '.PPDPPDPP.',
  '..PPP.PPP.',
]
const BX = CX + 38 // мозг: 20×12 px на крышке
const BY = CY - 12
function brain(pal: Record<string, string>): string {
  // пиксели не пересекаются: по цветам и горизонтальными отрезками
  let s = ''
  for (const ch of ['P', 'D', 'W']) {
    BRAIN.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== ch) continue
        let n = 1
        while (row[x + n] === ch) n++
        s += px(BX + x * 2, BY + y * 2, n * 2, 2, pal[ch]!)
        x += n - 1
      }
    })
  }
  return s
}
// ореол по силуэту мозга: клетки (2 px) на расстоянии ≤ k от мозга; строки выше полосы (y < 0) отбрасываются
function brainRing(k: number, fill: string): string {
  const on = (x: number, y: number) => (BRAIN[y]?.[x] ?? '.') !== '.'
  let s = ''
  for (let y = -k; y < BRAIN.length + k; y++) {
    if (BY + y * 2 < 0) continue
    let run = -1
    for (let x = -k; x <= 10 + k; x++) {
      let hit = false
      for (let yy = y - k; yy <= y + k && !hit; yy++) for (let xx = x - k; xx <= x + k && !hit; xx++) hit = on(xx, yy)
      if (hit && x < 10 + k && run < 0) run = x
      if ((!hit || x === 10 + k) && run >= 0) { s += px(BX + run * 2, BY + y * 2, (x - run) * 2, 2, fill); run = -1 }
    }
  }
  return s
}
const BRAIN_LIT = { P: '#ff8fc0', D: '#d93f7c', W: C.white }
// вспышка мозга в отрезке [a, b): under — ореол ПОД мозгом (кольца по силуэту), over — мозг мигает яркой палитрой,
// искры разлетаются снаружи силуэта
function brainFlash(a: number, b: number, dur: number): { under: string; over: string } {
  const under = show(g(brainRing(2, C.yellow), fade('0.45;1;0.45', '0.2s')) + brainRing(1, '#fff3c4'), [[a, b]], dur)
  const lit = show(brain(BRAIN_LIT), [[a, a + 0.1], [a + 0.18, b]], dur)
  const sparks = burst(px(BX - 8, BY + 4, 2, 2, C.yellow), a, a + 0.5, -8, -2, dur) + burst(px(BX + 26, BY + 4, 2, 2, C.yellow), a + 0.04, a + 0.55, 8, -2, dur) +
    burst(px(BX - 6, BY + 10, 2, 2, PINK_D), a + 0.08, a + 0.6, -8, 4, dur) + burst(px(BX + 24, BY + 10, 2, 2, PINK_D), a + 0.1, a + 0.6, 8, 4, dur)
  return { under, over: lit + sparks }
}
// четырёхлучевая искорка 6×6 (не крестик ✗): лучи жёлтые, сердцевина белая
const star = (x: number, y: number) => px(x + 2, y, 2, 6, C.yellow) + px(x, y + 2, 6, 2, C.yellow) + px(x + 2, y + 2, 2, 2, C.white)

type Drawer = {
  i: number // активный ящик
  slide: string // сдвиг панели (выдвигается вниз-вперёд на 8 px)
  open: Span[] // когда показана «ближняя» панель
  inside: string // содержимое ящика (видно в щели, когда выдвинут)
  onClosed?: string // поверх закрытой панели (ярлычок горит и т.п.)
  onOpen?: string // поверх выдвинутой панели
  brainFx?: { under: string; over: string }
  jolt?: string // дрожь всего шкафа (одна и та же анимация на всех слоях)
}
// слои шкафа: back — корпус и щель ящика, front — активная панель, top — крышка с мозгом.
// Между слоями сцена кладёт то, что должно быть за панелью ящика (карточка, ныряющая внутрь)
function cabinet(d: Drawer, dur: number): { back: string; front: string; top: string } {
  const [x, y] = dPos(d.i)
  // панели не пересекаются — слои по цветам, чтобы pack склеил их в 4 пути
  const fl = [0, 1, 2, 3, 4, 5].filter(j => j !== d.i).map(j => faceL(...dPos(j)))
  const faces = [0, 1, 2, 3].map(k => fl.map(f => f[k]!).join('')).join('')
  const rails = show(px(x - 2, y, 2, 8, FACE_S) + px(x + 26, y, 2, 8, FACE_S), d.open, dur)
  const back = px(CX, CY, CW, CH, C.wood) + px(CX - 2, CY, CW + 4, 2, FACE) + px(CX - 2, CY + 2, CW + 4, 2, FACE_S) +
    px(CX, CY + CH - 2, CW, 2, FACE_S) + faces + px(x, y, 26, 8, SLOT) + rails + d.inside
  const front = g(show(face(x, y) + (d.onClosed ?? ''), rest(d.open, dur), dur) + show(faceNear(x, y) + (d.onOpen ?? ''), d.open, dur), d.slide)
  // стопка чистых карточек и мозг; блик на мозге мерцает (период 2 с делит цикл)
  // стопка: кромки карточек темнее фона, строчки и цветные закладки — читается на обеих темах
  const stack = px(CX + 2, CY - 8, 14, 8, C.paperEdge) + px(CX + 4, CY - 6, 10, 2, C.paper) + px(CX + 4, CY - 2, 10, 2, C.paper) +
    px(CX + 6, CY - 6, 6, 2, C.grey) + px(CX + 6, CY - 2, 4, 2, C.grey) + px(CX + 4, CY - 10, 4, 2, C.blue) + px(CX + 10, CY - 10, 4, 2, C.green)
  const twinkle = g(px(BX + 4, BY + 2, 2, 2, C.white), fade('1;0.3;1', '2s'))
  const top = stack + (d.brainFx?.under ?? '') + brain({ P: PINK, D: PINK_D, W: '#ffe0ec' }) + twinkle + (d.brainFx?.over ?? '')
  const j = d.jolt ?? ''
  return j ? { back: g(back, j), front: g(front, j), top: g(top, j) } : { back, front, top }
}

// карточка 20×14: цветная полоса сверху, кромка, строки текста
function card(x: number, y: number, band: string, lines: boolean, tick = false): string {
  let s = px(x, y, 20, 14, C.paperEdge) + px(x + 2, y + 2, 16, 10, C.paper) + px(x, y, 20, 2, band)
  if (lines) s += px(x + 4, y + 4, 10, 2, C.ink2) + px(x + 4, y + 8, tick ? 4 : 8, 2, C.blue)
  if (tick) s += px(x + 10, y + 8, 2, 2, C.green) + px(x + 12, y + 10, 2, 2, C.green) + px(x + 14, y + 8, 2, 2, C.green) + px(x + 16, y + 6, 2, 2, C.green)
  return s
}
// мягкое свечение вокруг карточки (пульс 0.4 с — делит цикл)
const cardGlow = (x: number, y: number) => g(px(x - 2, y - 2, 24, 18, GLOW), fade('0.55;1;0.55', '0.4s'))

// ── вспоминает ────────────────────────────────────────────────────────────────
// Цикл 8 с: «?» и взгляд вверх → выдвигает ящик, перебирает карточки (каждая выглядывает над ящиком, глаза
// следят) → находка: карточка вылетает, светится, перелетает в поднятую руку → подносит к лицу и читает
// (взгляд на карточку) → огоньки от карточки бегут в голову, мозг на шкафу вспыхивает → «!» и прыжок →
// карточка улетает обратно в ящик, ящик задвигается.
export function sceneRecall(gear: Gear): string {
  const D = 8
  const X = 116 // Клод: тело x 124..172, правая рука касается шкафа
  const [dx, dy] = dPos(0) // верхний левый ящик: 188, 18

  // карточки в ящике (видны верхушки-закладки); перебирает по одной: 0, 1, 3, затем находит 2.
  // Перебираемая карточка поднимается на 6 px: над ящиком выглядывает белый край с закладкой
  const bands = [C.blue, C.green, C.yellow, C.purple]
  const tabX = (k: number) => dx + 2 + 6 * k
  const tab = (k: number) => px(tabX(k), dy + 2, 4, 8, C.paper) + px(tabX(k), dy + 2, 4, 2, bands[k]!)
  const flick = (k: number, t: number) => g(tab(k), moveD([[0, '0 0'], [t, '0 -6'], [t + 0.25, '0 0']], D))
  const found = show(
    g(show(px(tabX(2) - 2, dy - 2, 8, 8, GLOW), [[3.15, 3.5]], D) + tab(2), moveD([[0, '0 0'], [2.85, '0 -6'], [3.15, '0 -10'], [7.0, '0 0']], D)),
    [[0, 3.5], [7.0, 8]], D)
  const inside = flick(0, 1.8) + flick(1, 2.15) + flick(3, 2.5) + found

  const cab = cabinet({
    i: 0,
    slide: moveK([[0, '0 0'], [1.4, '0 0'], [1.75, '0 8', EASE_OUT], [7.05, '0 8'], [7.35, '0 0', EASE_IN]], D),
    open: [[1.55, 7.2]],
    inside,
    // находка: ярлычок ящика загорается
    onOpen: show(px(dx + 8, dy, 10, 4, C.yellow), [[3.15, 4.0]], D),
    brainFx: brainFlash(5.25, 5.85, D),
  }, D)

  // Клод: глаза следят за каждой поднятой карточкой; читая, смотрит на карточку у лица (влево)
  const eyes = eyesTrack([
    [0, 'open'], [0.15, 'closed'], [0.25, 'open'], [0.4, 'up'], [1.3, 'right'],
    [2.0, 'open'], [2.15, 'right'], [2.35, 'up'], [2.5, 'right'], [2.7, 'open'], [2.85, 'right'],
    [3.15, 'wide'], [3.55, 'right'], [3.95, 'up'], [4.2, 'left'], [4.95, 'closed'], [5.2, 'up'],
    [5.35, 'wide'], [5.55, 'happy'], [6.45, 'up'], [6.65, 'right'], [7.5, 'open'], [7.75, 'closed'], [7.85, 'open'],
  ], gear, D, 'open')
  // левая рука: опущена → поднята (ловит) → в два шага опускается, поднося карточку к лицу
  const armL = show(r(0, 3, 2, 2, C.orange), [[0, 4.35], [4.65, 8]], D)
  const armLUp = show(r(0, 1, 2, 2, C.orange), [[4.35, 4.55]], D)
  const armLMid = show(r(0, 2, 2, 2, C.orange), [[4.55, 4.65]], D)
  const armR = show(r(14, 3, 2, 2, C.orange), [[0, 1.35], [3.5, 6.95], [7.45, 8]], D)
  // рука в ящике: тянется к каждой карточке и подталкивает её вверх, потом задвигает ящик
  const pokes: Array<[number, string]> = [[0, '0 0']]
  for (const [t, x] of [[1.8, 0], [2.15, 4], [2.5, 12], [2.85, 8]] as const) pokes.push([t - 0.08, `${x} 0`], [t, `${x} -2`], [t + 0.12, `${x} 0`])
  pokes.push([3.15, '8 -4'], [3.3, '8 0'], [3.5, '0 0'])
  const reach = show(g(r(14, 2, 5, 2, C.orange), moveD(pokes, D)), [[1.35, 3.5], [6.95, 7.45]], D)
  // карточка у лица (x 104..124, y 16..30 — на уровне глаз, рука держит её снизу-справа); пока читает — светится
  const held = show(g(show(cardGlow(0, 0), [[4.45, 5.3]], D) + card(0, 0, C.yellow, true),
    moveD([[0, '-20 -2'], [4.55, '-16 0'], [4.65, '-12 2']], D)), [[4.45, 6.45]], D)
  const sq = kf([
    [0, '1 1'], [1.2, '1 1'], [1.3, '1.06 0.94'], [1.42, '1 1'],
    [4.45, '1 1'], [4.52, '1.06 0.94'], [4.65, '1 1'],
    [5.45, '1 1'], [5.55, '1.12 0.88'], [5.66, '0.92 1.1', EASE_OUT], [5.85, '1 1'], [5.98, '1.1 0.9', EASE_IN], [6.12, '1 1'],
  ], D)
  const jump = moveK([[0, '0 0'], [5.6, '0 0'], [5.78, '0 -6', EASE_OUT], [5.96, '0 0', EASE_IN]], D)
  const hero = at(X, TOP, squash(eyes + held + armL + armLUp + armLMid + armR + reach, sq.values, `${D}s`, sq.o), jump)

  // «?» над головой покачивается; «!» выскакивает справа от головы
  const q = show(g(glyph('?', 144, 2, C.purple), jitter([[0.4, 1.3, 0.2, '0 -2']], '0 0', D)), [[0.4, 1.3]], D)
  const bang = show(scaleAround(glyph('!', 170, 2, C.orange), 174, 14,
    scaleK([[0, '1 1'], [5.35, '1 1'], [5.36, '0.4 0.4'], [5.46, '1.2 1.2', EASE_OUT], [5.56, '1 1']], D)), [[5.35, 6.3]], D)

  // карточка из ящика: выскакивает, зависает со свечением и перелетает над головой в левую руку (поверх всего)
  const HX = 96, HY = 12 // где карточку ловит поднятая рука
  const out = show(at(HX, HY, cardGlow(0, 0) + card(0, 0, C.yellow, true), moveK([
    [0, '98 -2'], [3.5, '98 -2'], [3.75, '98 -12', EASE_OUT], [3.85, '98 -10'], [3.95, '98 -12'],
    ...path(3.95, 4.45, 10, s => [98 * (1 - s), -12 + 12 * s ** 3]),
    [4.5, '0 0'],
  ], D)), [[3.5, 4.45]], D)
  // обратно: от лица вверх, над головой (позади неё) и вниз в ящик — за панель
  const back = show(at(HX, HY, card(0, 0, C.yellow, true), moveK([
    [0, '8 4'], [6.45, '8 4'], [6.58, '4 -12', EASE_OUT], [6.85, '98 -12'], [7.0, '98 10', EASE_IN], [7.05, '98 10'],
  ], D)), [[6.45, 7.0]], D)

  // огоньки бегут от карточки у лица к макушке; на макушке вспышка
  const dotsAt: Array<[number, number]> = [[110, 10], [118, 6], [126, 4], [134, 4], [142, 6], [148, 10]]
  const dots = show(dotsAt.map(([x, y], i) =>
    g(px(x, y, 4, 4, C.yellow) + px(x + 2, y, 2, 2, C.white), fade('0.6;1;0.6', '0.4s', { keyTimes: '0;0.3;1', begin: `${(i * 0.06).toFixed(2)}s` }))).join(''),
    [[4.7, 5.3]], D)
  const flash = show(px(148, 6, 2, 8, C.yellow) + px(144, 8, 10, 2, C.yellow) + px(148, 8, 2, 2, C.white), [[5.2, 5.4]], D)

  const sparks =
    burst(star(178, 2), 3.7, 4.2, -6, 2, D) +
    burst(px(216, 2, 2, 2, C.yellow), 3.75, 4.2, 8, -2, D) +
    burst(px(214, 14, 2, 2, C.orange), 3.8, 4.3, 8, 4, D) +
    burst(px(184, 6, 2, 2, C.yellow), 4.05, 4.45, 4, 8, D) +
    burst(px(156, 8, 2, 2, C.yellow), 4.2, 4.6, 2, 6, D) +
    burst(px(130, 12, 2, 2, C.orange), 4.32, 4.7, 0, 6, D) +
    burst(star(88, 6), 4.45, 4.85, -6, -4, D) +
    burst(px(94, 26, 2, 2, C.yellow), 4.47, 4.9, -6, 4, D)
  const dust = burst(px(184, 34, 4, 4, C.edge), 7.35, 7.75, -6, -2, D) + burst(px(214, 34, 4, 4, C.edge), 7.35, 7.75, 6, -2, D)

  return pack(cab.back + back + cab.front + cab.top + hero + q + bang + dots + flash + out + sparks + dust)
}

// ── запоминает ────────────────────────────────────────────────────────────────
// Цикл 8 с: держит карточку низко у левого бока и пишет (карандаш в правой руке наклонён к карточке, дрожит,
// строчки появляются по одной), задумался — постукивает, ставит галочку → кладёт карандаш на макушку →
// выдвигает ящик, замах карточкой вверх-влево и бросок по дуге за головой — карточка ныряет в ящик, ящик
// захлопывается (пыль, дрожь шкафа), ярлычок горит зелёным, «+1», мозг светится → прыжок радости, отряхивает
// руки (хлопки, облачка пыли) → гордо смотрит на шкаф и кивает (ярлычок и мозг отзываются) → новая чистая
// карточка со стопки прилетает в руку, карандаш с макушки — снова в руку.
export function sceneMemorize(gear: Gear): string {
  const D = 8
  const X = 116
  const [dx, dy] = dPos(2) // средний левый ящик: 188, 30

  const inside = [0, 1, 3].map(k => {
    const x = dx + 2 + 6 * k, band = [C.blue, C.purple, C.yellow, C.green][k]!
    return px(x, dy + 2, 4, 8, C.paper) + px(x, dy + 2, 4, 2, band)
  }).join('')
  const jolt = jitter([[3.98, 4.1, 0.04, '2 0']], '0 0', D)
  const fx = brainFlash(4.05, 4.6, D)
  const cab = cabinet({
    i: 2,
    slide: moveK([[0, '0 0'], [2.75, '0 0'], [3.05, '0 8', EASE_OUT], [3.88, '0 8'], [3.98, '0 0', EASE_IN]], D),
    open: [[2.88, 3.93]],
    inside,
    // ярлычок «записано»: вспышка белым, горит зелёным; пока Клод любуется — ещё два коротких пульса
    onClosed: show(px(dx + 9, dy + 2, 8, 4, C.white), [[3.98, 4.08], [6.05, 6.12], [6.2, 6.27]], D) +
      show(px(dx + 9, dy + 2, 8, 4, C.greenLight) + px(dx + 13, dy + 3, 2, 2, C.green), [[4.08, 6.05], [6.12, 6.2], [6.27, 7.7]], D),
    brainFx: { under: fx.under, over: fx.over + show(brain(BRAIN_LIT), [[6.1, 6.3]], D) },
    jolt,
  }, D)

  // Клод
  const eyes = eyesTrack([
    [0, 'left'], [1.35, 'up'], [1.8, 'left'], [2.15, 'happy'], [2.6, 'right'], [3.95, 'wide'], [4.15, 'happy'],
    [5.7, 'right'], [6.0, 'happy'], [6.4, 'right'], [6.55, 'closed'], [6.65, 'right'], [6.8, 'up'], [7.1, 'left'],
  ], gear, D, 'left')
  // карточка: низко у левого бока (x 4..24, y 24..38 в px героя) → замах вверх-влево в два шага → бросок;
  // новая прилетает в поднятую руку и в два шага опускается к боку
  const CXr = 4, CYr = 24
  const w1 = attrK('width', [[0, '0'], [0.1, '0'], [0.75, '10', LIN], [3.35, '10'], [3.4, '0', LIN]], D)
  const w2 = attrK('width', [[0, '0'], [0.85, '0'], [1.3, '4', LIN], [3.35, '4'], [3.4, '0', LIN]], D)
  const tickAt: Array<[number, number, number]> = [[10, 8, 1.88], [12, 10, 1.95], [14, 8, 2.04], [16, 6, 2.12]]
  const writing = card(0, 0, C.sky, false) +
    px(4, 4, 0, 2, C.ink2, w1) + px(4, 8, 0, 2, C.blue, w2) +
    tickAt.map(([x, y, t]) => show(px(x, y, 2, 2, C.green), [[t, 3.3]], D)).join('')
  const heldCard = show(g(writing, moveD([[0, `${CXr} ${CYr}`], [3.05, '-14 10'], [3.15, '-20 -2'], [7.35, '-14 10'], [7.45, `${CXr} ${CYr}`]], D)),
    [[0, 3.3], [7.2, 8]], D)
  // левая рука держит карточку (низко / на полпути / вверху), в остальное время у бока; отряхивая — хлопки вверх-вниз
  const armLow = show(r(0, 5, 2, 2, C.orange), [[0, 3.05], [7.45, 8]], D)
  const armLMid = show(r(0, 3, 2, 2, C.orange), [[3.05, 3.15], [7.35, 7.45]], D)
  const armLUp = show(r(0, 1, 2, 2, C.orange), [[3.15, 3.35], [7.2, 7.35]], D)
  const armL = show(g(r(0, 3, 2, 2, C.orange), jitter([[4.85, 5.65, 0.1, '0 -8']], '0 0', D)), [[3.35, 7.2]], D)
  const armR = show(g(r(14, 3, 2, 2, C.orange), jitter([[4.95, 5.65, 0.1, '0 -8']], '0 0', D)), [[3.98, 7.3]], D)
  const armRUp = show(r(14, 0, 2, 2, C.orange) + r(15, -1, 1, 1, C.orange), [[2.4, 2.75], [7.3, 7.5]], D)

  // карандаш в правой руке лесенкой вниз-влево: кончик (0,0) на карточке, кисть — правая рука у бока;
  // ниже глаз и стёкол очков. Когда кончик уходит вправо, рука вытягивается из бока
  const pencilDiag = px(0, 0, 2, 2, C.ink2) + px(2, -2, 4, 4, '#e3c08f') +
    px(6, -4, 14, 2, C.yellow) + px(20, -6, 14, 2, C.yellow) + px(6, -2, 14, 2, '#d9962a') + px(20, -4, 14, 2, '#d9962a') +
    px(30, -8, 26, 8, C.orange)
  const shake = jitter([[0.1, 0.75, 0.08, '0 -2'], [0.85, 1.3, 0.08, '0 -2'], [1.45, 1.78, 0.12, '0 2']], '0 0', D)
  const tip = (x: number, y: number) => `${CXr + x} ${CYr + y}` // точка на карточке → px героя
  const pen = show(g(g(pencilDiag, shake), moveK([
    [0, tip(4, 4)], [0.1, tip(4, 4)], [0.75, tip(12, 4), LIN], [0.85, tip(4, 8)], [1.3, tip(8, 8), LIN], [1.42, tip(10, 2)], [1.78, tip(10, 2)],
    [1.86, tip(10, 8)], [1.94, tip(12, 10), LIN], [2.04, tip(14, 8), LIN], [2.12, tip(16, 6), LIN], [2.4, tip(16, 6)], [2.45, tip(4, 4), LIN],
  ], D)), [[0, 2.4], [7.5, 8]], D)
  // карандаш на макушке: из поднятой руки ложится на голову и потом возвращается в руку
  const pencilFlat = px(0, 0, 2, 2, C.edge) + px(2, -2, 4, 4, '#e3c08f') + px(6, -2, 12, 4, C.yellow) + px(6, 0, 12, 2, '#d9962a') + px(18, -2, 4, 4, '#e88a9a')
  const penTop = show(g(pencilFlat, moveK([
    [0, '40 -6'], [2.4, '40 -6'], [2.5, '32 -6'], [2.62, '22 -2', EASE_IN], [7.3, '22 -2'], [7.42, '40 -6', EASE_OUT],
  ], D)), [[2.4, 7.5]], D)

  const sq = kf([
    [0, '1 1'], [3.1, '1 1'], [3.22, '1.08 0.92'], [3.35, '0.94 1.06', EASE_OUT], [3.55, '1 1'],
    [4.2, '1 1'], [4.3, '1.1 0.9'], [4.4, '0.92 1.1', EASE_OUT], [4.6, '1 1'], [4.72, '1.08 0.92', EASE_IN], [4.85, '1 1'],
    [5.85, '1 1'], [5.92, '1.04 0.94'], [6.0, '1 1'], [6.08, '1.04 0.94'], [6.16, '1 1'],
    [7.2, '1 1'], [7.26, '1.05 0.95'], [7.38, '1 1'],
  ], D)
  const jump = moveK([[0, '0 0'], [4.38, '0 0'], [4.55, '0 -6', EASE_OUT], [4.72, '0 0', EASE_IN]], D)
  const hero = at(X, TOP, squash(eyes + heldCard + armLow + armLMid + armLUp + armL + armR + armRUp + pen + penTop, sq.values, `${D}s`, sq.o), jump)
  // рука на ручке ящика (поверх панели): выдвигает, держит, захлопывает
  const reach = show(at(X, TOP, r(14, 4, 5, 2, C.orange)), [[2.75, 3.98]], D)

  // бросок из поднятой руки: дуга позади головы, карточка ныряет в выдвинутый ящик (за панель)
  const HX = X - 20, HY = TOP - 2 // 96, 12 — карточка в поднятой руке
  const toss = show(at(HX, HY, card(0, 0, C.sky, true, true), moveK([
    [0, '0 0'], [3.35, '0 0'], ...path(3.35, 3.8, 8, s => [96 * s, 22 * s - 64 * s * (1 - s)]), [3.85, '96 22'],
  ], D)), [[3.35, 3.85]], D)
  // новая чистая карточка со стопки летит позади головы в поднятую руку
  const take = show(at(HX, HY, card(0, 0, C.sky, false), moveK([
    [0, '90 -10'], [6.85, '90 -10'], ...path(6.85, 7.2, 7, s => [90 * (1 - s), -10 * (1 - s * s)]), [7.25, '0 0'],
  ], D)), [[6.85, 7.2]], D)

  // «+1» всплывает над шкафом
  const plus = g(glyph('+', 202, 0, C.green) + glyph('1', 212, 0, C.green),
    moveK([[0, '0 2'], [4.05, '0 2'], [4.5, '0 0', EASE_OUT], [5.2, '0 0'], [5.3, '0 2']], D) +
    fadeK([[0, '0'], [4.05, '0'], [4.15, '1', LIN], [4.85, '1'], [5.15, '0', LIN]], D), ' opacity="0"')

  // искры галочки, пыль от захлопнутого ящика, облачка пыли с рук при хлопках
  const puff = (x: number, y: number) => px(x, y, 4, 4, C.edge) + px(x + 4, y + 2, 2, 2, C.edge)
  const sparks =
    burst(px(146, 46, 2, 2, C.yellow), 2.14, 2.5, 6, -6, D) + burst(px(146, 50, 2, 2, C.greenLight), 2.16, 2.55, 8, 2, D) +
    burst(px(184, 40, 4, 4, C.edge), 3.98, 4.4, -8, -4, D) + burst(px(182, 46, 2, 2, C.edge), 4.0, 4.4, -8, 2, D) +
    burst(px(214, 40, 4, 4, C.edge), 3.98, 4.4, 8, -4, D) + burst(px(216, 46, 2, 2, C.edge), 4.0, 4.4, 8, 2, D) +
    burst(px(186, 30, 2, 2, C.yellow), 3.98, 4.4, -6, -8, D) + burst(px(214, 30, 2, 2, C.yellow), 3.98, 4.4, 6, -8, D) +
    burst(puff(108, 22), 4.95, 5.4, -6, 10, D) + burst(puff(108, 18), 5.25, 5.7, -8, 12, D) +
    burst(puff(180, 22), 5.0, 5.45, 4, 10, D) + burst(puff(180, 18), 5.3, 5.75, 6, 12, D)

  return pack(cab.back + toss + take + hero + cab.front + reach + cab.top + plus + sparks)
}
