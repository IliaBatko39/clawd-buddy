// Clawd scenes, group "work". Each function returns the strip's content (without <svg>), see core.ts.
// "While working" scenes stay at x <= 460: helpers(n) are drawn on the right (x 470..710).
import {
  type Anim, type Eyes, type Gear, C, EASE, EASE_IN, EASE_OUT, P, TOP,
  at, attr, clawd, fade, g, glyph, miniClawd, move, px, r, scaleAnim, squash,
} from './core'

// ── общие помощники сцен ──────────────────────────────────────────────────────

type Span = readonly [number, number] // отрезок времени цикла, с
const kt = (t: number, dur: number) => +(t / dur).toFixed(4)
const LIN = '0 0 1 1'
const FLOOR_SIT = 22 // верх сидящего на полу Клода (тело 7 + ноги 1 клетка), px
const CH_W_PX = 16 * P

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

// ключевые кадры для spline: [время, значение, сплайн участка, ведущего в этот кадр]
type Key = readonly [number, string, string?]
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

// дискретная дрожь: в отрезке [a, b) каждые step с значение чередуется между v1 и v0, вне — v0
function jitter(spans: Array<[number, number, number, string]>, v0: string, dur: number): string {
  const pts: Array<[number, string]> = [[0, v0]]
  for (const [a, b, step, v1] of spans) {
    let k = 0
    for (let t = a; t < b - 1e-6; t += step) pts.push([t, k++ % 2 === 0 ? v1 : v0])
    pts.push([b, v0])
  }
  return move(pts.map(p => p[1]).join(';'), `${dur}s`, { calc: 'discrete', keyTimes: pts.map(p => kt(p[0], dur)).join(';') })
}

// масштаб вокруг точки (cx, cy) в px
const scaleAround = (inner: string, cx: number, cy: number, anim: string) =>
  `<g transform="translate(${cx},${cy})">${g(`<g transform="translate(${-cx},${-cy})">${inner}</g>`, anim)}</g>`

// искра-частица: появляется в t0, улетает на (dx, dy) к t1 и гаснет
function burst(inner: string, t0: number, t1: number, dx: number, dy: number, dur: number): string {
  const m = moveK([[0, '0 0'], [t0, '0 0'], [t1, `${dx} ${dy}`, EASE_OUT], [Math.min(t1 + 0.05, dur - 0.01), `${dx} ${dy}`], [dur, '0 0']], dur)
  const f = fadeK([[0, '0'], [t0, '0'], [t0 + 0.06, '1', LIN], [t1, '0', EASE_IN], [dur, '0']], dur)
  return g(inner, m + f, ' opacity="0"')
}

// пар: пиксели поднимаются и тают, у каждого свой период
const steam = (x: number, y: number) =>
  [[0, 1.9, 0], [2, 2.3, 0.7], [0, 2.7, 1.4]]
    .map(([dx, d, b]) => g(px(x + dx!, y, 2, 2, C.steam),
      move('0 0;2 -5;0 -10', `${d}s`, { begin: `${b}s` }) + fade('0;0.9;0', `${d}s`, { keyTimes: '0;0.3;1', begin: `${b}s` }), ' opacity="0"'))
    .join('')

// слои позы Клода: каждая поза (глаза/руки/ноги) видна в своих отрезках цикла
type Pose = { eyes: Eyes; arms?: 'down' | 'type' | 'wave' | 'up' | 'none'; legs?: 'stand' | 'walk' | 'sit'; glint?: boolean }
const poses = (list: Array<[Span[], Pose]>, gear: Gear, dur: number) =>
  list.map(([spans, o]) => show(clawd({ ...o, gear, glint: o.glint ?? false }), spans, dur)).join('')

// ── думает ────────────────────────────────────────────────────────────────────
// Цикл 8 с: облачко → шестерёнки → «??» (стучит по подбородку) → эврика: лампочка, прыжок → облачко гаснет.
export function sceneThink(gear: Gear): string {
  const D = 8
  const X = 56, Y = FLOOR_SIT
  // Клод сидит; глаза по битам
  const bodies = poses([
    [[[0, 0.9], [7.75, 8]], { eyes: 'open', arms: 'none', legs: 'sit', glint: true }],
    [[[7.2, 7.75]], { eyes: 'left', arms: 'none', legs: 'sit' }],
    [[[0.9, 1.9], [3.4, 4.85]], { eyes: 'up', arms: 'none', legs: 'sit' }],
    [[[1.9, 2.5]], { eyes: 'left', arms: 'none', legs: 'sit' }],
    [[[2.5, 3.0]], { eyes: 'right', arms: 'none', legs: 'sit' }],
    [[[3.0, 3.4]], { eyes: 'closed', arms: 'none', legs: 'sit' }],
    [[[4.85, 5.9]], { eyes: 'wide', arms: 'none', legs: 'sit' }],
    [[[5.9, 7.2]], { eyes: 'happy', arms: 'none', legs: 'sit' }],
  ], gear, D)
  const armL = r(0, 3, 2, 2, C.orange)
  // правая рука у подбородка: плечо вбок, предплечье вверх, кулак у щеки (палец — тёмная клетка); в «??» стучит по щеке
  const tap = jitter([[3.4, 4.85, 0.2, '0 -4']], '0 0', D)
  const chin = show(r(14, 4, 3, 2, C.orange) + r(14, 5, 3, 1, C.orangeDark) +
    g(r(16, 1, 1, 4, C.orange) + r(14, 1, 2, 2, C.orange) + r(14, 2, 2, 1, C.orangeDark) + r(13, 2, 1, 1, C.orangeDark), tap),
    [[0, 4.85], [7.2, 8]], D)
  // эврика: палец вверх, рука подрагивает
  const raised = show(g(r(14, 1, 2, 2, C.orange) + r(15, -1, 1, 2, C.orange), move('0 0;0 -2', '0.4s', { calc: 'discrete' })), [[4.85, 7.2]], D)
  const sq = scaleK([[0, '1 1'], [4.7, '1 1'], [4.9, '1.14 0.86'], [5.05, '0.9 1.12', EASE_OUT], [5.3, '1 1'], [5.5, '1.12 0.88', EASE_IN], [5.7, '1 1'], [7.5, '1 1'], [7.65, '1.08 0.92'], [7.95, '1 1']], D)
  const jump = moveK([[0, '0 0'], [4.95, '0 0'], [5.22, '0 -8', EASE_OUT], [5.5, '0 0', EASE_IN], [8, '0 0']], D)
  const hero = at(X, Y, scaleAround(bodies + armL + chin + raised, (CH_W_PX) / 2, 8 * P, sq), jump)

  // пузырьки мыслей от головы к облаку
  const dot = (x: number, y: number, s: number) => px(x, y, s, s, C.paperEdge) + (s > 4 ? px(x + 2, y + 2, s - 4, s - 4, C.white) : '')
  const dots = show(dot(118, 16, 2), [[0.15, 7.5]], D) + show(dot(124, 10, 4), [[0.35, 7.5]], D) + show(dot(132, 6, 6), [[0.55, 7.5]], D)
  // облако: обводка + заливка (силуэт из прямоугольников)
  const CX = 144
  const blobs: Array<[number, number, number, number]> = [[4, 6, 52, 18], [12, 2, 16, 8], [28, 0, 18, 10], [0, 10, 8, 10], [52, 10, 8, 10], [10, 20, 20, 6], [34, 20, 14, 6]]
  const cloud = blobs.map(([x, y, w, h]) => px(CX + x, y, w, h, C.paperEdge)).join('') +
    blobs.map(([x, y, w, h]) => px(CX + x + 2, y + 2, w - 4, h - 4, C.white)).join('')

  // шестерёнки (большая и малая крутятся навстречу)
  // поворот пиксельно: два нарисованных кадра (зубцы по осям ↔ по диагоналям) чередуются дискретно, малая — в противофазе
  const flip = (a: string, b: string, per: string) =>
    g(a, fade('1;0', per, { calc: 'discrete' })) + g(b, fade('0;1', per, { calc: 'discrete' }), ' opacity="0"')
  const gearBig = (cx: number, cy: number) => {
    const t = (x: number, y: number) => px(cx + x, cy + y, 4, 4, C.ink2)
    return px(cx - 4, cy - 6, 8, 12, C.ink2) + px(cx - 6, cy - 4, 12, 8, C.ink2) +
      flip(t(-2, -8) + t(-2, 4) + t(-8, -2) + t(4, -2), t(4, -8) + t(-8, -8) + t(-8, 4) + t(4, 4), '0.36s') +
      px(cx - 2, cy - 2, 4, 4, C.white)
  }
  const gearSmall = (cx: number, cy: number) => {
    const t = (x: number, y: number) => px(cx + x, cy + y, 2, 2, C.grey)
    return px(cx - 3, cy - 3, 6, 6, C.grey) +
      flip(t(-4, -5) + t(2, -5) + t(-4, 3) + t(2, 3), t(-1, -5) + t(-1, 3) + t(-5, -1) + t(3, -1), '0.24s') +
      px(cx - 1, cy - 1, 2, 2, C.white)
  }
  const gears = show(gearBig(166, 12) + gearSmall(181, 17), [[1.0, 3.1]], D)

  // «??» мигают по очереди и качаются
  const q1 = show(g(glyph('?', 162, 5, C.purple), jitter([[3.1, 4.7, 0.25, '2 0']], '0 0', D)), [[3.1, 3.5], [3.65, 4.05], [4.2, 4.7]], D)
  const q2 = show(glyph('?', 180, 9, C.blue), [[3.4, 3.8], [3.95, 4.35], [4.45, 4.7]], D)

  // лампочка: серая → вспыхивает (мигнула) → горит с ореолом и лучами
  const bx = 174
  const glass = (f: string) => px(bx - 4, 3, 8, 2, f) + px(bx - 6, 5, 12, 8, f) + px(bx - 4, 13, 8, 2, f) + px(bx - 2, 15, 4, 2, f)
  const halo = show(g(px(bx - 10, 5, 20, 8, '#ffe7a6') + px(bx - 8, 1, 16, 16, '#ffe7a6'), fade('0.55;1;0.55', '0.6s')), [[5.16, 7.5]], D)
  const rays = show(
    g(px(bx - 14, 8, 4, 2, C.yellow) + px(bx + 10, 8, 4, 2, C.yellow) + px(bx - 12, 18, 2, 2, C.yellow) + px(bx + 10, 18, 2, 2, C.yellow), fade('1;0', '0.4s', { calc: 'discrete' })) +
    g(px(bx - 12, 2, 2, 2, C.yellow) + px(bx + 10, 2, 2, 2, C.yellow) + px(bx - 14, 13, 4, 2, C.yellow) + px(bx + 10, 13, 4, 2, C.yellow), fade('0;1', '0.4s', { calc: 'discrete' })),
    [[5.16, 7.0]], D)
  const bulb = show(
    halo + rays + glass(C.steam) + px(bx - 1, 8, 2, 5, C.grey) +
    show(glass(C.yellow) + px(bx - 4, 6, 2, 4, C.white) + px(bx - 1, 8, 2, 5, C.white), [[5.0, 5.08], [5.16, 7.5]], D) +
    px(bx - 3, 17, 6, 2, C.grey) + px(bx - 2, 19, 4, 2, C.ink2),
    [[4.7, 7.5]], D)
  // искры «*» и «+» вылетают из облака
  const sparks =
    burst(glyph('*', 196, 0, C.yellow), 5.15, 6.1, 14, 2, D) +
    burst(glyph('+', 200, 14, C.orange), 5.25, 6.2, 14, 8, D) +
    burst(glyph('*', 150, 18, C.yellow), 5.3, 6.3, -2, 14, D) +
    burst(px(186, 22, 2, 2, C.orange), 5.2, 6.0, 8, 12, D)

  const inside = scaleAround(show(cloud + gears + q1 + q2 + bulb, [[0.6, 7.5]], D), 174, 13,
    scaleK([[0, '0.3 0.3'], [0.6, '0.3 0.3'], [0.8, '1.1 1.1', EASE_OUT], [0.95, '1 1'], [5.0, '1 1'], [5.1, '1.08 1.08', EASE_OUT], [5.3, '1 1'], [7.0, '1 1'], [7.5, '0.8 0.8', EASE_IN], [8, '0.3 0.3']], D))
  const fadeOut = fadeK([[0, '1'], [7.0, '1'], [7.5, '0', EASE_IN], [7.9, '0'], [8, '1', LIN]], D)
  return hero + g(dots + inside, fadeOut) + sparks
}

// ── работает в терминале ──────────────────────────────────────────────────────
// Цикл 10 с: печатает (строки уезжают вверх) → зелёная ✓, искры, радость → откинулся, глоток кофе → снова печатает.
export function sceneWork(gear: Gear): string {
  const D = 10
  const X = 40, Y = 18 // сидит на подушке (низ 50)
  const typing: Span[] = [[0, 2.4], [2.9, 4.2], [8.0, 10]]
  const bodies = poses([
    [typing, { eyes: 'right', arms: 'type', legs: 'sit', glint: true }],
    [[[2.4, 2.9]], { eyes: 'up', arms: 'type', legs: 'sit' }],
    [[[4.2, 5.2]], { eyes: 'happy', arms: 'up', legs: 'sit' }],
    [[[5.2, 5.9]], { eyes: 'left', arms: 'none', legs: 'sit' }],
    [[[5.9, 7.1]], { eyes: 'closed', arms: 'none', legs: 'sit' }],
    [[[7.1, 8.0]], { eyes: 'right', arms: 'none', legs: 'sit' }],
  ], gear, D)
  const armR = show(r(14, 3, 2, 2, C.orange), [[5.2, 8.0]], D)
  const armL = show(r(0, 3, 2, 2, C.orange), [[5.2, 5.6], [7.6, 8.0]], D)
  // радость на ✓: подпрыгнул на подушке
  const sq = scaleK([[0, '1 1'], [4.2, '1 1'], [4.32, '1.12 0.88'], [4.45, '0.92 1.1', EASE_OUT], [4.75, '1 1'], [4.95, '1.1 0.9', EASE_IN], [5.15, '1 1'], [10, '1 1']], D)
  const hop = moveK([[0, '0 0'], [4.4, '0 0'], [4.65, '0 -6', EASE_OUT], [4.95, '0 0', EASE_IN], [10, '0 0']], D)
  const lean = moveK([[0, '0 0'], [5.2, '0 0'], [5.6, '-4 0'], [7.6, '-4 0'], [8.0, '0 0'], [10, '0 0']], D)
  const thinking = show([0, 1, 2].map(i => g(r(5 + i * 2, -2, 1, 1, C.grey), fade('0.2;1;0.2', '1.2s', { begin: `${i * 0.2}s` }))).join(''), typing, D)
  const hero = at(X, Y, g(scaleAround(bodies + armR + armL, CH_W_PX / 2, 8 * P, sq), hop) + thinking, lean)
  const cushion = px(42, 50, 60, 4, C.purple) + px(44, 48, 56, 2, C.purple)

  // стол и ноутбук
  const desk = px(104, 42, 74, 4, C.wood) + px(108, 46, 4, 8, C.wood) + px(170, 46, 4, 8, C.wood)
  const laptop = px(112, 4, 52, 34, C.edge) + px(114, 6, 48, 32, C.ink2) + px(116, 8, 44, 26, '#151515') +
    px(106, 38, 60, 4, C.ink2) + px(106, 38, 60, 2, C.edge) + px(150, 40, 8, 2, '#151515')
  // код на экране: 8 строк (шаг 4 px), прокрутка вверх по строке; две копии подряд — бесшовно
  type Chunk = readonly [number, number, string]
  const L: Chunk[][] = [
    [[0, 6, C.purple], [8, 10, C.sky]],
    [[4, 8, C.orange], [14, 14, C.white]],
    [[4, 4, C.purple], [10, 16, C.greenLight]],
    [[8, 12, C.sky], [22, 6, C.yellow]],
    [[8, 18, C.greenLight]],
    [[4, 6, C.orange], [12, 8, C.white], [22, 10, C.sky]],
    [[0, 4, C.purple]],
    [[0, 10, C.yellow], [12, 14, C.white]],
  ]
  const codeSet = (y0: number) => L.map((line, i) => line.map(([dx, w, f]) => px(118 + dx, y0 + i * 4, w, 2, f)).join('')).join('')
  const stepsAt = [0.6, 1.2, 1.9, 2.5, 3.2, 3.8, 8.7, 9.4]
  const scroll = move(['0 0', ...stepsAt.map((_, i) => `0 ${-4 * (i + 1)}`)].join(';'), `${D}s`,
    { calc: 'discrete', keyTimes: [0, ...stepsAt.map(t => kt(t, D))].join(';') })
  const code = `<clipPath id="cw-work-scr"><rect x="116" y="8" width="44" height="20"/></clipPath>` +
    `<g clip-path="url(#cw-work-scr)">${g(codeSet(10) + codeSet(42), scroll)}</g>`
  // строка ввода: «>» и буквы появляются по одной; при прокрутке строка уходит вверх — ввод с нуля
  // в [9.4, 10] не печатает — строка пустая, мигает курсор: на шве 10→0 ввод начинается с нуля
  const segs: Array<[number, number]> = [[0, 0.6], [0.6, 1.2], [1.2, 1.9], [1.9, 2.5], [2.5, 3.2], [3.2, 3.8], [3.8, 4.2], [8.0, 8.7], [8.7, 9.4], [9.4, 9.45]]
  const wPts: Array<[number, number]> = []
  segs.forEach(([a, b], si) => {
    const startW = si === 7 ? 4 * Math.round((4.2 - 3.8) / 0.1) : 0 // после кофе дописывает начатую строку
    let w = startW
    for (let t = a; t < b - 1e-6 && w <= 32; t += 0.1) { wPts.push([t, w]); w += 4 }
  })
  const wVals = wPts.map(p => p[1])
  const wKeys = wPts.map(p => kt(p[0], D)).join(';')
  const inputWords = px(122, 30, 6, 2, C.greenLight) + px(130, 30, 10, 2, C.white) + px(142, 30, 4, 2, C.sky) + px(148, 30, 8, 2, C.white)
  const input = px(118, 30, 2, 2, C.orange) +
    `<clipPath id="cw-work-in"><rect x="122" y="28" width="0" height="6">${attr('width', wVals.join(';'), `${D}s`, { calc: 'discrete', keyTimes: wKeys })}</rect></clipPath>` +
    `<g clip-path="url(#cw-work-in)">${inputWords}</g>` +
    g(px(122, 28, 2, 4, C.greenLight, attr('x', wVals.map(w => 122 + w).join(';'), `${D}s`, { calc: 'discrete', keyTimes: wKeys })), fade('1;0', '0.5s', { calc: 'discrete' }))
  // тесты прошли: экран вспыхивает зелёным с ✓
  const pass = show(px(116, 8, 44, 26, '#173d22') + glyph('✓', 128, 10, C.greenLight, 4), [[4.2, 4.45], [4.55, 5.3]], D)
  // искры из-под клавиш
  const sparks =
    burst(px(124, 36, 2, 2, C.yellow), 4.22, 5.0, -8, -14, D) +
    burst(px(134, 36, 2, 2, C.greenLight), 4.26, 5.1, -2, -20, D) +
    burst(px(144, 36, 2, 2, C.orange), 4.3, 5.05, 6, -16, D) +
    burst(px(154, 36, 2, 2, C.yellow), 4.24, 4.95, 12, -10, D) +
    burst(glyph('*', 160, 30, C.yellow), 4.3, 5.2, 10, -22, D)

  // кружка на полу слева; во время перерыва рука несёт её ко рту и наклоняет
  // кружка в трёх нарисованных наклонах (0 / ~20° / ~40° к Клоду), переключаются дискретно — без размытого поворота
  const mugAt = (sh: number[]) => sh.map((dx, row) =>
    px(dx, row * 2, 8, 2, row === 0 ? C.brown : C.blue) + (row >= 2 && row <= 3 ? px(dx + 2, row * 2, 2, 2, C.sky) : '') +
    (row >= 1 && row <= 3 ? px(dx + 8, row * 2, 2, 2, C.blue) : '')).join('')
  const mugs = show(mugAt([0, 0, 0, 0, 0]), [[0, 6.15], [7.2, 10]], D) +
    show(mugAt([2, 2, 2, 0, 0]), [[6.15, 6.3], [7.05, 7.2]], D) + show(mugAt([4, 4, 2, 2, 0]), [[6.3, 7.05]], D)
  // рука-кулак держит кружку и всегда касается тела (на полу — тянется вниз к левому боку)
  const hand = show(px(10, -4, 10, 8, C.orangeDark), [[5.6, 7.6]], D)
  const carry = moveK([[0, '0 0'], [5.6, '0 0'], [5.75, '0 -2'], [6.15, '12 -16'], [7.1, '12 -16'], [7.55, '0 0'], [10, '0 0']], D)
  const mug = at(24, 44, g(mugs + hand + steam(2, -4), carry))

  return cushion + desk + laptop + code + input + pass + hero + sparks + mug
}

// ── правит файл ───────────────────────────────────────────────────────────────
// Цикл 8 с: подходит к мольберту → стирает красную строку (крошки) → пишет зелёную → штамп ✓ → радость → сброс.
export function sceneEdit(gear: Gear): string {
  const D = 8
  const X = 30
  // идёт только вперёд (к листу и вдоль строки при записи); стирая и отходя назад — стоит и переступает мелкими шажками
  const walk: Span[] = [[0.8, 1.3], [3.3, 5.3]]
  const bodies = poses([
    [[[0, 0.8], [1.3, 2.9], [5.3, 5.8]], { eyes: 'right', arms: 'none', glint: true }],
    [walk, { eyes: 'right', arms: 'none', legs: 'walk' }],
    [[[2.9, 3.3]], { eyes: 'up', arms: 'none' }],
    [[[5.8, 6.2]], { eyes: 'wide', arms: 'none' }],
    [[[6.2, 7.6]], { eyes: 'happy', arms: 'none' }],
    [[[7.6, 8]], { eyes: 'open', arms: 'none' }],
  ], gear, D)
  const armL = r(0, 3, 2, 2, C.orange)
  // длинный карандаш в правой руке — пиксельной лесенкой (ступень 12×4 px, подъём 4 px); кончик: x = X + сдвиг + 116, y = TOP + 16 + dy − 12
  const pencil = [0, 1, 2, 3].map(i => px(i * 12, -2 - i * 4, 12, 4, C.yellow) + px(i * 12, -i * 4, 12, 2, '#d9962a')).join('') +
    px(48, -14, 4, 4, '#e3c08f') + px(52, -14, 4, 4, C.ink2)
  const scrub = jitter([[1.3, 2.9, 0.1, '-2 0'], [3.3, 5.3, 0.12, '0 -2']], '0 0', D)
  const dy = moveK([[0, '0 8'], [0.8, '0 8'], [1.25, '0 4'], [2.9, '0 4'], [3.05, '0 -2', EASE_OUT], [3.25, '0 4', EASE_IN], [5.3, '0 4'], [5.6, '0 8'], [8, '0 8']], D)
  const tool = at(60, 16, g(pencil, scrub) + px(-4, -4, 8, 8, C.orange), dy)
  const sq = kf([[0, '1 1'], [6.2, '1 1'], [6.32, '1.14 0.86'], [6.45, '0.9 1.12', EASE_OUT], [6.75, '1 1'], [6.95, '1.12 0.88', EASE_IN], [7.15, '1 1'], [8, '1 1']], D)
  // отскок назад от листа (5.3–5.8) и прыжок радости (6.4–6.95)
  const jump = moveK([[0, '0 0'], [5.3, '0 0'], [5.55, '0 -6', EASE_OUT], [5.8, '0 0', EASE_IN], [6.4, '0 0'], [6.65, '0 -8', EASE_OUT], [6.95, '0 0', EASE_IN], [8, '0 0']], D)
  // стирая (1.3–2.9), отступает влево пятью шажками по 8 px: шаг 0.12 с, между шагами трёт на месте; ширина красной строки — те же ключи
  const steps: Key[] = []
  const redSteps: Key[] = []
  for (let k = 1; k <= 5; k++) {
    const t1 = 1.3 + 0.32 * k, t0 = t1 - 0.12
    steps.push([t0, `${64 - 8 * (k - 1)} 0`], [t1, `${64 - 8 * k} 0`])
    redSteps.push([t0, `${40 - 8 * (k - 1)}`], [t1, `${40 - 8 * k}`])
  }
  const slide = moveK([[0, '0 0'], [0.8, '0 0'], [1.3, '64 0'], ...steps, [3.3, '24 0'], [5.3, '68 0', LIN], [5.8, '0 0'], [8, '0 0']], D)
  // карандаш внутри squash — при прыжке рука с карандашом сжимается вместе с телом и не отрывается
  const hero = at(X, TOP, g(squash(bodies + armL + tool, sq.values, `${D}s`, sq.o), jump), slide)

  // мольберт: две ноги, задняя стойка, полочка, зажим
  const leg = (x0: number, dir: number) => [0, 1, 2, 3, 4, 5].map(i => px(x0 + dir * i * 2, 10 + i * 8, 4, 8, C.wood)).join('')
  const easel = px(190, 0, 4, 54, C.brown) + leg(170, -2) + leg(210, 2)
  const tray = px(150, 46, 84, 4, C.wood) + px(150, 46, 84, 2, '#a8734e')
  const clamp = px(186, 0, 12, 4, C.ink2) + px(186, 0, 12, 2, C.edge)
  // лист: текст полосками-словами; строка 22 — правка
  type Chunk = readonly [number, number, string]
  const rows: Array<[number, Chunk[]]> = [
    [10, [[164, 16, C.blue], [182, 12, C.ink2]]],
    [16, [[164, 8, C.purple], [174, 22, C.ink2], [198, 10, C.grey]]],
    [28, [[168, 14, C.ink2], [184, 20, C.grey]]],
    [34, [[168, 10, C.purple], [180, 16, C.ink2]]],
    [40, [[164, 20, C.ink2], [186, 8, C.grey]]],
  ]
  const text = rows.map(([y, cs]) => cs.map(([x, w, f]) => px(x, y, w, 2, f)).join('')).join('')
  const paper = px(156, 4, 72, 42, C.paperEdge) + px(158, 6, 68, 38, C.paper)
  // красная строка стирается справа налево (вместе с кончиком), в конце цикла возвращается
  const redW = kf([[0, '40'], [1.3, '40'], ...redSteps, [7.65, '0'], [7.95, '40', LIN], [8, '40']], D)
  const red = `<clipPath id="cw-edit-red"><rect x="168" y="20" width="40" height="6">${attr('width', redW.values, `${D}s`, redW.o)}</rect></clipPath>` +
    `<g clip-path="url(#cw-edit-red)">${px(166, 21, 44, 4, '#fbe1e1')}${px(168, 22, 10, 2, C.red)}${px(180, 22, 14, 2, C.red)}${px(196, 22, 12, 2, C.red)}</g>`
  // зелёная строка пишется слева направо
  const grW = kf([[0, '0'], [3.3, '0'], [5.3, '44', LIN], [8, '44']], D)
  const green = `<clipPath id="cw-edit-grn"><rect x="168" y="20" width="0" height="6">${attr('width', grW.values, `${D}s`, grW.o)}</rect></clipPath>` +
    g(`<g clip-path="url(#cw-edit-grn)">${px(166, 21, 48, 4, '#dff3e2')}${px(168, 22, 12, 2, C.green)}${px(182, 22, 8, 2, C.green)}${px(192, 22, 18, 2, C.green)}</g>`,
      fadeK([[0, '0'], [3.25, '0'], [3.3, '1', LIN], [7.5, '1'], [7.8, '0', LIN], [8, '0']], D))
  // крошки ластика сыплются на полочку
  const crumbs = [[200, 1.45, C.red], [192, 1.75, C.paperEdge], [184, 2.05, C.red], [176, 2.35, C.paperEdge], [170, 2.65, C.red]] as const
  const crumbSvg = crumbs.map(([x, t, f], i) => burst(px(x, 24, 2, 2, f), t, t + 0.5, i % 2 ? 4 : -2, 20, D)).join('')
  // штамп ✓: падает с размаху, лист вздрагивает, пыль
  const stampInner = px(206, 30, 16, 2, C.green) + px(206, 42, 16, 2, C.green) + px(206, 30, 2, 14, C.green) + px(220, 30, 2, 14, C.green) +
    glyph('✓', 209, 32, C.green)
  const stamp = g(scaleAround(stampInner, 214, 37, scaleK([[0, '2 2'], [5.8, '2 2'], [5.95, '1 1', EASE_IN], [7.8, '1 1'], [7.85, '2 2'], [8, '2 2']], D)),
    fadeK([[0, '0'], [5.8, '0'], [5.85, '1', LIN], [7.5, '1'], [7.8, '0', LIN], [8, '0']], D), ' opacity="0"')
  const dust = burst(px(204, 44, 2, 2, C.grey), 5.95, 6.3, -6, 2, D) + burst(px(222, 44, 2, 2, C.grey), 5.95, 6.3, 6, 2, D) +
    burst(px(222, 28, 2, 2, C.grey), 5.95, 6.3, 6, -6, D) + burst(px(204, 28, 2, 2, C.grey), 5.95, 6.3, -6, -6, D)
  const jolt = moveK([[0, '0 0'], [5.95, '0 0'], [6.0, '0 2', EASE_OUT], [6.15, '0 0'], [8, '0 0']], D)
  // лист не поворачивается (поворот ломал пиксели) — только вздрагивает от штампа
  const sheet = g(paper + text + red + green + crumbSvg + stamp + dust, jolt)

  return easel + sheet + tray + clamp + hero
}
// ── помощники-сабагенты ───────────────────────────────────────────────────────
// n мини-клодиков (до 4) справа (x 478..702): сидят на подушках, у каждого свой ритм, иногда «!» или «✓» с подскоком.
// один мини-клодик на месте i (0…3, x = 478 + 56·i): свой период, реплики «!» и «♪», подскок на реплику
export function helperAt(i: number): string {
  {
    const x = 478 + i * 56, y = 36
    const per = [6.2, 7.4, 8.6, 9.8][i % 4]!
    const delay = [0, 0.13, 0.27, 0.41][i % 4]!
    // реплики «!» и «✓» в своих долях цикла (у всех разные), каждая видна 1.3 с
    const tA = [0.15, 0.35, 0.05, 0.3][i % 4]! * per, tB = [0.55, 0.75, 0.45, 0.7][i % 4]! * per
    const bubble = (ch: string, f: string, t0: number) => {
      const t1 = t0 + 1.3
      const inner = px(x + 8, y - 18, 14, 16, C.paperEdge) + px(x + 10, y - 16, 10, 12, C.white) + px(x + 12, y - 2, 4, 2, C.paperEdge) +
        glyph(ch, x + 10, y - 16, f)
      const pop = moveK([[0, '0 4'], [t0, '0 4'], [t0 + 0.2, '0 0', EASE_OUT], [t1, '0 0'], [per, '0 4']], per)
      return g(g(inner, pop), fadeVis(t0, t1, per), ' opacity="0"')
    }
    // реакция на реплику — сжатие и вытягивание вокруг низа (y = 54): ноутбук не отрывается от пола
    const bounceAt = (t0: number) => [[t0, '1 1'], [t0 + 0.1, '1 0.86'], [t0 + 0.22, '1 1.1', EASE_OUT], [t0 + 0.4, '1 1']] as Key[]
    const bounce = scaleK([[0, '1 1'], ...[tA, tB].sort((a, b) => a - b).flatMap(bounceAt), [per, '1 1']], per)
    return px(x + 4, 52, 24, 2, C.purple) + scaleAround(miniClawd(x, y, delay), x + 16, 54, bounce) +
      bubble('!', C.red, tA) + bubble('♪', C.purple, tB) // ✓ — только «агент закончил» (уход помощника)
  }
}

export function helpers(n: number): string {
  const k = Math.max(0, Math.min(4, Math.floor(n)))
  let s = ''
  for (let i = 0; i < k; i++) s += helperAt(i)
  return s
}
// дискретно видно в [t0, t1) цикла per
const fadeVis = (t0: number, t1: number, per: number) =>
  fade('0;1;0', `${per}s`, { calc: 'discrete', keyTimes: `0;${kt(t0, per)};${kt(t1, per)}` })
