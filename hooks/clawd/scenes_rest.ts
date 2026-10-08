// Clawd scenes, group "rest" (idle): celebrate, walk, coffee, sleep. Each function returns the strip's content
// (without <svg>), see core.ts. The character is built in layers: body with eyes — clawd({arms:'none', legs:'none'}),
// arms and legs — their own cells of the same geometry, sunglasses — glasses() on top; poses switch by discrete
// opacity on the scene's shared timeline, movement uses splines.
import {
  type Eyes, type Gear, C, CELEBRATE_S, COFFEE_S, EASE, EASE_IN, EASE_OUT, FLOOR, P, TOP, WALK_S,
  at, attr, clawd, fade, g, glasses, glyph, legsStand, legsWalk, mirror, move, px, r, scaleAnim,
} from './core'

// ── шкалы ─────────────────────────────────────────────────────────────────────

// число покороче: 3 знака, без ведущего нуля (.125) — экономит размер SVG
const f4 = (n: number) => String(+n.toFixed(3)).replace(/^(-?)0\./, '$1.')
const LIN = '0 0 1 1'
const DRAG = '0.1 0.6 0.4 1' // резкий старт, долгое торможение (камешек, конфетти)
const WIN = '0.45 0 0.75 0.75' // разгон до ровного шага
const WOUT = '0.25 0.25 0.55 1' // с ровного шага до остановки

// ключ: [время, с; значение; сплайн участка, который кончается в этом ключе]
type K = [number, string, string?]
function spl(dur: number, ks: K[], def = EASE) {
  return {
    values: ks.map(k => k[1]).join(';'),
    o: {
      calc: 'spline' as const,
      keyTimes: ks.map(k => f4(k[0] / dur)).join(';'),
      keySplines: ks.slice(1).map(k => k[2] ?? def).join(';'),
    },
  }
}
const mvK = (dur: number, ks: K[], def = EASE, begin?: number) => {
  const s = spl(dur, ks, def)
  return move(s.values, `${dur}s`, begin ? { ...s.o, begin: `${-begin}s` } : s.o)
}
const scK = (dur: number, ks: K[], def = EASE) => {
  const s = spl(dur, ks, def)
  return scaleAnim(s.values, `${dur}s`, s.o)
}
const opK = (dur: number, ks: [number, string][]) =>
  fade(ks.map(k => k[1]).join(';'), `${dur}s`, { keyTimes: ks.map(k => f4(k[0] / dur)).join(';') })

// дискретная шкала: [начало, значение] (первое — с 0), одинаковые соседние склеиваются
function steps(dur: number, segs: [number, string][]) {
  const v: string[] = []
  const t: string[] = []
  for (const [tt, val] of segs) {
    if (v[v.length - 1] === val) continue
    v.push(val)
    t.push(f4(tt / dur))
  }
  return { values: v.join(';'), keyTimes: t.join(';'), first: v[0] ?? '1', n: v.length }
}
const dmove = (dur: number, segs: [number, string][]) => {
  const s = steps(dur, segs)
  return s.n > 1 ? move(s.values, `${dur}s`, { calc: 'discrete', keyTimes: s.keyTimes }) : ''
}
// переключатель вариантов: в каждый момент видна ровно одна часть из parts
function sw(dur: number, segs: [number, string][], parts: Record<string, string>): string {
  return Object.entries(parts)
    .map(([key, svg]) => {
      const s = steps(dur, segs.map(([t, k]) => [t, k === key ? '1' : '0'] as [number, string]))
      if (s.n === 1) return s.first === '1' ? svg : ''
      return g(svg, fade(s.values, `${dur}s`, { calc: 'discrete', keyTimes: s.keyTimes }), ` opacity="${s.first}"`)
    })
    .join('')
}
// сжатие/растяжение вокруг точки опоры (fx, fy) в px системы группы
const squashAt = (inner: string, anim: string, fx: number, fy: number) =>
  `<g transform="translate(${fx},${fy})">${g(`<g transform="translate(${-fx},${-fy})">${inner}</g>`, anim)}</g>`
// детерминированный «шум» 0..1 (без Math.random: SVG одинаков при каждой отрисовке)
const rnd = (i: number, k: number) => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return s - Math.floor(s)
}

// картинка из строк («#» — точка cell×cell px), точки в строке склеены в полосы
function bitmap(rows: string[], cell: number, fill: (ch: string) => string | null): string {
  let s = ''
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x] ?? ' '
      let e = x + 1
      while (e < row.length && row[e] === ch) e++
      const col = fill(ch)
      if (col) s += px(x * cell, y * cell, (e - x) * cell, cell, col)
      x = e
    }
  })
  return s
}

// ── части Клода (клетки спрайта) ─────────────────────────────────────────────

const O = C.orange
const armL = r(0, 3, 2, 2, O)
const armR = r(14, 3, 2, 2, O)
const armLUp = r(0, 0, 2, 2, O) + r(0, -1, 1, 1, O)
const armRUp = r(14, 0, 2, 2, O) + r(15, -1, 1, 1, O)
const ARMS_DOWN = armL + armR
const ARMS_UP = armLUp + armRUp
// машет: два положения правой руки на целых клетках, оба касаются тела (вверх / наклон наружу)
const ARMS_WAVE = armL +
  g(armRUp, fade('1;0', '0.6s', { calc: 'discrete' })) +
  g(r(14, 1, 2, 2, O) + r(16, 0, 1, 1, O), fade('0;1', '0.6s', { calc: 'discrete' }), ' opacity="0"')
// руки в прыжке: «\o/» — вскинуты вверх-наружу, клешни торчат по диагонали (не выше верха тела — не вылезают за полосу)
const ARMS_JUMP = r(0, 1, 2, 2, O) + r(-1, 0, 1, 1, O) + r(14, 1, 2, 2, O) + r(16, 0, 1, 1, O)
const face = (eyes: Eyes, blink = false) => clawd({ eyes, blink, arms: 'none', legs: 'none' })
const specs = (gear: Gear, glint = true) => (gear.glasses ? glasses(glint) : '')
// пыль из-под ног: n серых точек разлетаются и тают в момент t (с) шкалы dur
function dust(dur: number, t: number, xPx: number, yPx: number, dirs: number[]): string {
  return at(xPx, yPx, dirs.map((d, i) =>
    px(0, 0, 2, 2, C.steam, mvK(dur, [[0, '0 0'], [t, '0 0'], [t + 0.35, `${d} ${-2 - (i % 2) * 2}`, EASE_OUT], [dur, '0 0', LIN]]))).join(''),
  opK(dur, [[0, '0'], [t, '0'], [t + 0.02, '0.9'], [t + 0.4, '0'], [dur, '0']]))
}

// ── 1. праздник: ход закончен (CELEBRATE_S = 4 с) ─────────────────────────────

export function sceneCelebrate(gear: Gear): string {
  const D = CELEBRATE_S
  const X = 8
  const cx = X + 32
  const eyes = sw(D, [[0, 'c'], [0.36, 'h'], [3.1, 'o']], { c: face('closed'), h: face('happy'), o: face('open', true) })
  const pump =
    g(armLUp + armR, fade('1;0', '0.36s', { calc: 'discrete' })) +
    g(armL + armRUp, fade('0;1', '0.36s', { calc: 'discrete' }), ' opacity="0"')
  const arms = sw(D, [[0, 'd'], [0.36, 'u'], [0.44, 'j'], [1.12, 'u'], [1.6, 'p'], [2.68, 'u'], [2.95, 'd']], { d: ARMS_DOWN, u: ARMS_UP, j: ARMS_JUMP, p: pump })
  const legs = sw(D, [[0, 's'], [0.54, 't'], [1.1, 's']], { s: legsStand(3), t: legsStand(1) })
  const body = legs + eyes + arms + specs(gear)
  const sq = scK(D, [
    [0, '1 1'], [0.3, '1.18 0.82'], [0.38, '1.18 0.82'], [0.5, '0.88 1.1', EASE_OUT], [0.6, '0.94 1.05'], [0.74, '1 1'], [1.0, '1 1'],
    [1.18, '0.94 1.06'], [1.3, '1.22 0.78', EASE_IN], [1.45, '0.94 1.06'], [1.6, '1.04 0.97'], [1.75, '1 1'],
    [1.95, '1.08 0.92'], [2.06, '0.96 1.04'], [2.2, '1.08 0.92'], [2.31, '0.96 1.04'], [2.45, '1.06 0.94'],
    [2.6, '1 1'], [2.9, '1 1'], [3.0, '1.04 0.96'], [3.15, '1 1'], [D, '1 1'],
  ])
  const hop = mvK(D, [
    [0, '0 0'], [0.38, '0 0'], [0.76, '0 -12', EASE_OUT], [0.96, '0 -12', LIN], [1.3, '0 0', EASE_IN],
    [1.95, '0 0'], [2.06, '0 -4', EASE_OUT], [2.2, '0 0', EASE_IN], [2.31, '0 -4', EASE_OUT], [2.45, '0 0', EASE_IN], [D, '0 0'],
  ])
  const hero = at(X, TOP, squashAt(body, sq, 32, 40), hop)
  // тень на полу: сжимается, когда Клод в воздухе
  const shadow = at(cx, FLOOR + 1, px(-18, 0, 36, 2, C.grey),
    scK(D, [[0, '1 1'], [0.3, '1.2 1'], [0.38, '1.2 1'], [0.76, '0.5 1', EASE_OUT], [0.96, '0.5 1'], [1.3, '1.25 1', EASE_IN], [1.6, '1 1'], [D, '1 1']]))

  // конфетти: 22 кусочка вылетают из-за спины двумя залпами, летят дугами, падают на пол и тают
  const COLORS = [C.red, C.yellow, C.blue, C.green, C.purple, C.sky]
  let confetti = ''
  for (let i = 0; i < 20; i++) {
    const left = i % 4 === 1
    const ox = cx - 10 + Math.round(rnd(i, 1) * 10) * 2
    const oy = 20 + Math.round(rnd(i, 2) * 3) * 2
    const dx = left ? -Math.round(8 + rnd(i, 3) * 20) : Math.round(14 + rnd(i, 3) * 230)
    const h = Math.round(oy - 2 - rnd(i, 4) * (oy - 6)) // подъём: вершина дуги не выше y=2
    const t0 = (i < 13 ? 0.5 : 1.3) + rnd(i, 5) * 0.25
    const up = 0.3 + rnd(i, 6) * 0.15
    const land = t0 + up + 0.95 + rnd(i, 7) * 0.7
    const gone = Math.min(land + 0.35, D - 0.15)
    const fall = (i % 3 ? 50 : 52) - oy
    const color = COLORS[i % COLORS.length] ?? C.red
    const flip = attr('width', '4;2', `${f4(0.2 + rnd(i, 8) * 0.12)}s`, { calc: 'discrete' })
    const op = opK(D, [[0, '0'], [t0, '0'], [t0 + 0.02, '1'], [land - 0.05, '1'], [gone, '0'], [D, '0']])
    const piece = px(ox, oy, 4, i % 3 ? 4 : 2, color, flip + op).replace('<rect ', '<rect opacity="0" ')
    // одна траектория: взлёт с торможением, у вершины — разгон до ровного «порхающего» падения
    const ax = Math.round(dx * 0.55)
    const path = mvK(D, [[0, '0 0'], [t0, '0 0'], [t0 + up, `${ax} ${-h}`, EASE_OUT], [land, `${dx} ${fall}`, WIN], [gone, `${dx} ${fall}`, LIN], [D, '0 0', LIN]])
    confetti += g(piece, path)
  }

  // искры «*» и большая галочка «✓»: выскакивают с перелётом масштаба и гаснут
  const pop = (t: number, life = 0.75): K[] => [
    [0, '0 0'], [t, '0 0'], [t + 0.14, '1.35 1.35', EASE_OUT], [t + 0.28, '1 1'], [t + life - 0.18, '1 1'], [t + life, '0 0', EASE_IN], [D, '0 0'],
  ]
  const sparks: [number, number, number, string][] = [
    [92, 8, 0.62, C.yellow], [100, 26, 0.9, C.yellow], [150, 32, 1.15, C.purple], [86, 34, 1.45, C.yellow],
    [190, 12, 1.75, C.yellow], [160, 8, 2.1, C.sky], [128, 8, 2.45, C.yellow],
  ]
  // через одну — глиф «*», остальные — четырёхлучевой блик (крест 10×10)
  const twinkle = (col: string) => px(-5, -1, 10, 2, col) + px(-1, -5, 2, 10, col)
  const sparkles = sparks.map(([sx, sy, t, col], i) => at(sx, sy, i % 2 ? twinkle(col) : glyph('*', -5, -5, col), scK(D, pop(t, 0.7)))).join('')
  const check = at(120, 22,
    g(glyph('✓', -10, -10, C.green, 4), scK(D, [[0, '0 0'], [0.7, '0 0'], [0.86, '1.3 1.3', EASE_OUT], [1.02, '1 1'], [D, '1 1']])),
    mvK(D, [[0, '0 0'], [1.02, '0 0'], [2.9, '6 -4'], [3.5, '8 -6'], [D, '0 0', LIN]]) +
      opK(D, [[0, '1'], [2.9, '1'], [3.5, '0'], [D, '0']]))
  return shadow.replace('<g transform', '<g opacity="0.45" transform') + confetti + hero + check + sparkles
}

// ── 2. прогулка: туда и обратно ровно за WALK_S = 24 с ─────────────────────────

export function sceneWalk(gear: Gear): string {
  const D = WALK_S
  // путь (левый край спрайта, px): разгон/торможение у остановок, прыжки над камешком — ровным шагом
  const xk: K[] = [
    [0, '8 0'], [0.5, '8 0'], [2.7, '180 0'], [4.5, '180 0'], [6.4, '336 0'],
    [6.55, '332 0'], [6.72, '340 0', EASE_OUT], [6.95, '336 0'], [7.2, '336 0'],
    [9.05, '500 0', WIN], [9.75, '564 0', LIN], [10.6, '640 0', WOUT], [11.4, '640 0'],
    [12.4, '568 0'], [12.55, '572 0'], [12.72, '564 0', EASE_OUT], [12.95, '568 0'], [13.2, '568 0'],
    [14.5, '470 0'], [17.0, '470 0'], [17.8, '400 0', WIN], [18.45, '340 0', LIN], [22.1, '8 0', WOUT], [D, '8 0'],
  ]
  const legs = sw(D, [
    [0, 's'], [0.5, 'w'], [2.7, 's'], [4.5, 'w'], [6.4, 's'], [6.68, 'k'], [6.95, 's'], [7.2, 'w'],
    [9.0, 's'], [9.12, 't'], [9.66, 's'], [9.8, 'w'], [10.6, 's'], [11.4, 'w'], [12.4, 's'], [12.68, 'k'], [12.95, 's'],
    [13.2, 'w'], [14.5, 's'], [17.0, 'w'], [17.75, 's'], [17.87, 't'], [18.38, 's'], [18.5, 'w'], [22.1, 's'],
  ], {
    s: legsStand(3),
    w: legsWalk('0.4s'),
    t: legsStand(1),
    // пинок: передняя нога выброшена вперёд-вверх
    k: [3, 6, 9].map(x => r(x, 7, 1, 3, O)).join('') + r(12, 7, 1, 1, O) + r(13, 8, 2, 1, O),
  })
  // глаза в своей системе спрайта (при развороте влево всё зеркалится: 'left' смотрит вправо)
  const eyes = sw(D, [
    [0, 'r'], [2.7, 'o'], [2.9, 'h'], [4.3, 'o'], [4.45, 'r'], [6.68, 'w'], [7.0, 'r'],
    [9.05, 'h'], [9.75, 'r'], [10.6, 'o'], [11.0, 'r'], [12.68, 'w'], [13.0, 'r'],
    [14.5, 'l'], [14.85, 'u'], [15.25, 'r'], [16.0, 'u'], [16.4, 'l'], [16.75, 'h'], [17.0, 'r'],
    [17.8, 'h'], [18.45, 'r'], [22.1, 'o'], [23.3, 'r'],
  ], { r: face('right', true), o: face('open', true), h: face('happy'), w: face('wide'), l: face('left'), u: face('up') })
  const arms = sw(D, [[0, 'd'], [2.88, 'v'], [4.3, 'd']], { d: ARMS_DOWN, v: ARMS_WAVE })
  const body = legs + eyes + arms + specs(gear)
  // разворот: дискретное зеркало вокруг середины спрайта
  const flip = scaleAnim('1 1;-1 1;1 1', `${D}s`, { calc: 'discrete', keyTimes: `0;${f4(11.0 / D)};${f4(22.6 / D)}` })
  const turned = squashAt(body, flip, 32, 0)
  const sq = scK(D, [
    [0, '1 1'], [0.4, '1 1'], [0.5, '1.05 0.95'], [0.62, '1 1'], [2.7, '1 1'], [2.8, '1.06 0.94'], [2.95, '1 1'],
    [3.3, '1 1'], [3.42, '0.97 1.03'], [3.55, '1 1'], [3.9, '1 1'], [4.02, '0.97 1.03'], [4.15, '1 1'],
    [6.4, '1 1'], [6.55, '0.95 1.05'], [6.72, '1.08 0.92', EASE_OUT], [6.95, '1 1'],
    [8.95, '1 1'], [9.05, '1.12 0.88'], [9.2, '0.94 1.06', EASE_OUT], [9.45, '1 1'], [9.68, '0.96 1.04'], [9.76, '1.14 0.86', EASE_IN], [9.92, '1 1'],
    [10.6, '1 1'], [10.68, '1.05 0.95'], [10.8, '1 1'], [10.9, '1 1'], [11.0, '1.08 0.92'], [11.12, '0.96 1.04'], [11.25, '1 1'],
    [12.4, '1 1'], [12.55, '0.95 1.05'], [12.72, '1.08 0.92', EASE_OUT], [12.95, '1 1'],
    [14.5, '1 1'], [14.6, '1.05 0.95'], [14.72, '1 1'], [16.75, '1 1'], [16.85, '1.04 0.96'], [16.95, '1 1'],
    [17.7, '1 1'], [17.8, '1.12 0.88'], [17.94, '0.94 1.06', EASE_OUT], [18.15, '1 1'], [18.38, '0.96 1.04'], [18.46, '1.14 0.86', EASE_IN], [18.6, '1 1'],
    [22.1, '1 1'], [22.2, '1.06 0.94'], [22.32, '1 1'], [22.5, '1 1'], [22.6, '1.08 0.92'], [22.72, '0.96 1.04'], [22.85, '1 1'], [D, '1 1'],
  ])
  const hop = mvK(D, [
    [0, '0 0'], [9.05, '0 0'], [9.4, '0 -12', EASE_OUT], [9.75, '0 0', EASE_IN],
    [10.95, '0 0'], [11.05, '0 -4', EASE_OUT], [11.18, '0 0', EASE_IN],
    [17.8, '0 0'], [18.12, '0 -12', EASE_OUT], [18.45, '0 0', EASE_IN],
    [22.55, '0 0'], [22.65, '0 -4', EASE_OUT], [22.78, '0 0', EASE_IN], [D, '0 0'],
  ])
  const hero = at(0, TOP, g(squashAt(turned, sq, 32, 40), hop), mvK(D, xk))

  // камешек: пинок вперёд (катится, подпрыгивая), на обратном пути — пинок назад на место
  const roll = (a: number, b: number, fwd: boolean): [number, string][] => {
    const out: [number, string][] = []
    let t = a
    let k = 0
    const ofs = fwd ? ['0 0', '4 0', '6 2', '2 2'] : ['2 2', '6 2', '4 0', '0 0']
    while (t < b) {
      out.push([t, ofs[k % 4] ?? '0 0'])
      k++
      t += 0.06 + ((t - a) / (b - a)) ** 2 * 0.3
    }
    return out
  }
  const shine = dmove(D, [[0, '0 0'], ...roll(6.72, 8.1, true), [8.1, '0 0'], ...roll(12.72, 14.1, false), [14.1, '0 0']])
  const pebbleArt = px(2, 0, 8, 2, C.grey) + px(0, 2, 12, 4, C.grey) + px(0, 6, 12, 2, '#6f6f6f') + px(2, 2, 2, 2, '#d6d6d6', shine)
  const bounce = (t: number): K[] => [[t, '0 0'], [t + 0.18, '0 -8', EASE_OUT], [t + 0.36, '0 0', EASE_IN], [t + 0.48, '0 -3', EASE_OUT], [t + 0.6, '0 0', EASE_IN]]
  const pebble = at(400, FLOOR - 8,
    g(pebbleArt, mvK(D, [[0, '0 0'], ...bounce(6.72), ...bounce(12.72), [D, '0 0']])),
    mvK(D, [[0, '0 0'], [6.72, '0 0'], [8.1, '160 0', DRAG], [12.72, '160 0'], [14.1, '0 0', DRAG], [D, '0 0']]))

  // бабочка: порхает над Клодом, он следит глазами
  const wingsOpen = px(0, 2, 6, 6, C.purple) + px(8, 2, 6, 6, C.purple) + px(2, 8, 4, 4, C.yellow) + px(8, 8, 4, 4, C.yellow) +
    px(2, 4, 2, 2, C.yellow) + px(10, 4, 2, 2, C.yellow)
  const wingsShut = px(3, 2, 3, 8, C.purple) + px(8, 2, 3, 8, C.purple) + px(4, 8, 2, 2, C.yellow) + px(8, 8, 2, 2, C.yellow)
  const bfly =
    g(wingsOpen, fade('1;0', '0.24s', { calc: 'discrete' })) +
    g(wingsShut, fade('0;1', '0.24s', { calc: 'discrete' }), ' opacity="0"') +
    px(6, 2, 2, 10, C.brown) + px(4, 0, 2, 2, C.brown) + px(8, 0, 2, 2, C.brown)
  const butterfly = g(
    g(g(bfly, mvK(0.6, [[0, '0 0'], [0.3, '0 -2'], [0.6, '0 0']])),
      mvK(D, [
        [0, '640 6'], [13.8, '660 8'], [14.5, '590 12'], [14.95, '520 2'], [15.4, '470 6'], [15.75, '436 4'],
        [16.15, '500 2'], [16.55, '546 10'], [17.0, '486 4'], [17.6, '404 2'], [18.2, '330 6'], [D, '640 6', LIN],
      ])),
    opK(D, [[0, '0'], [13.8, '0'], [14.1, '1'], [17.8, '1'], [18.2, '0'], [D, '0']]), ' opacity="0"')

  const puffs =
    dust(D, 6.72, 398, 50, [-6, 6, 10]) + dust(D, 9.76, 584, 50, [-8, 8]) +
    dust(D, 12.72, 570, 50, [-10, -6, 6]) + dust(D, 18.46, 360, 50, [-8, 8]) + dust(D, 0.5, 20, 50, [-6, -10])
  return pebble + puffs + hero + butterfly
}

// ── 3. кофе на табурете (COFFEE_S = 16 с) ────────────────────────────────────

// кружка: ручка слева (4 px) + корпус 12×12, сверху видно кофе; mirror — ручка справа
function mug(handleRight = false): string {
  const b = handleRight ? 0 : 4
  const h = handleRight ? 12 : 0
  const handle = handleRight
    ? px(h, 2, 4, 2, C.blue) + px(h + 2, 4, 2, 4, C.blue) + px(h, 8, 4, 2, C.blue)
    : px(h, 2, 4, 2, C.blue) + px(h, 4, 2, 4, C.blue) + px(h, 8, 4, 2, C.blue)
  return handle + px(b, 0, 12, 12, C.blue) + px(b + 2, 0, 8, 2, C.brown) + px(b + 2, 4, 2, 4, C.sky)
}

// кружка (ручка справа), наклонённая к лицу примерно на 30°: нарисована по клеткам 2 px — край с кофе идёт
// снизу-слева вверх-вправо, ниже всех — левый нижний угол; ручка на месте ручки прямой кружки, сдвинутой на 4 px влево
const MUG_TILT = [
  '......BB..',
  '....KKBBH.',
  '..KKBBBB.H',
  'BBBBBBBB.H',
  'BBSBBBBBH.',
  '.BSBBBBB..',
  '..BBBBB...',
  '...BB.....',
]
const mugTilted = () => at(-4, 0, bitmap(MUG_TILT, 2, ch => (ch === 'B' || ch === 'H' ? C.blue : ch === 'K' ? C.brown : ch === 'S' ? C.sky : null)))

export function sceneCoffee(gear: Gear): string {
  const D = COFFEE_S
  const X = 8
  // табурет и ящик-столик (ящик правее Клода)
  const stool = r(1, 7, 14, 1, C.wood) + px(4, 28, 56, 2, '#a87452') + r(1, 8, 1, 2, C.wood) + r(14, 8, 1, 2, C.wood) +
    px(4, 32, 2, 8, C.edge) + px(58, 32, 2, 8, C.edge)
  const crate = px(84, 38, 28, 16, C.wood) + px(84, 38, 28, 2, '#a87452') + px(84, 46, 28, 2, C.brown) + px(88, 40, 2, 14, C.brown) + px(106, 40, 2, 14, C.brown) +
    px(84, 40, 2, 14, C.edge) + px(110, 40, 2, 14, C.edge)
  const pair = (xs: number[], h: number) => xs.map(x => r(x, 7, 1, h, O)).join('')
  // ноги болтаются: пары по очереди то свисают (2 клетки), то поджаты вперёд (1)
  const dangle = (xs: number[], ph: string) =>
    g(pair(xs, 2), fade(ph, '0.8s', { calc: 'discrete' }), ` opacity="${ph.slice(0, 1)}"`) + pair(xs, 1)
  const legs = dangle([3, 9], '1;0') + dangle([6, 12], '0;1')
  // шкала: стол → взял → дует → пьёт → ♪ → поставил → потянулся/зевнул → взял → долгий глоток → ♥ → огляделся → поставил
  const S: [number, string][] = [
    [0, 'table'], [1.4, 'reach'], [1.65, 'hold'], [2.0, 'blow'], [4.0, 'sip'], [5.3, 'hold'], [7.6, 'reach'], [7.85, 'table'],
    [10.4, 'reach'], [10.65, 'hold'], [10.9, 'sip'], [12.6, 'hold'], [15.2, 'reach'], [15.45, 'table'],
  ]
  const armRight = sw(D, S.map(([t, s]) => [t, s === 'reach' ? 'reach' : s === 'sip' ? 'raise' : 'side'] as [number, string]), {
    side: armR,
    reach: armR + r(16, 4, 4, 1, O),
    raise: r(14, 4, 2, 3, O),
  })
  // во время потягивания обе руки вверх (поверх обычных — обычные прячем)
  const armsAll = sw(D, [[0, 'n'], [8.0, 'u'], [10.0, 'n']], {
    n: armL + armRight,
    u: ARMS_UP,
  })
  const eyes = sw(D, [
    [0, 'r'], [1.65, 'r'], [4.0, 'c'], [5.3, 'h'], [6.8, 'o'], [7.6, 'r'], [8.0, 'c'], [10.0, 'o'], [10.4, 'r'],
    [10.9, 'c'], [12.6, 'h'], [14.0, 'l'], [14.6, 'o'], [14.9, 'r'],
  ], { r: face('right', true), c: face('closed'), h: face('happy'), o: face('open', true), l: face('left') })
  // зевок: открытый рот с языком
  const yawn = g(r(7, 4, 2, 2, C.ink) + px(30, 20, 4, 2, C.red),
    fade('0;1;0', `${D}s`, { calc: 'discrete', keyTimes: `0;${f4(8.4 / D)};${f4(9.7 / D)}` }), ' opacity="0"')
  const body = legs + eyes + yawn + armsAll + specs(gear)
  const sq = scK(D, [
    [0, '1 1'], [1.4, '1 1'], [1.52, '1.03 0.97'], [1.65, '1 1'],
    [4.3, '1 1'], [4.45, '1.03 0.97'], [4.6, '1 1'], [4.8, '1 1'], [4.95, '1.03 0.97'], [5.1, '1 1'],
    [5.3, '1 1'], [5.45, '0.97 1.03'], [5.6, '1 1'],
    [8.0, '1 1'], [8.6, '0.94 1.08'], [9.6, '0.94 1.08'], [9.9, '1.06 0.94'], [10.05, '0.98 1.02'], [10.2, '1.03 0.97'], [10.35, '1 1'],
    [11.2, '1 1'], [11.35, '1.03 0.97'], [11.5, '1 1'], [11.7, '1 1'], [11.85, '1.03 0.97'], [12.0, '1 1'], [12.2, '1 1'], [12.35, '1.03 0.97'], [12.5, '1 1'],
    [12.6, '1 1'], [12.75, '0.97 1.03'], [12.9, '1 1'], [D, '1 1'],
  ])
  const hero = at(X, TOP, squashAt(body, sq, 32, 28))

  // кружка: стол / в руке / у губ (дует) / пьёт (у лица, ручка справа)
  // пока рука тянется (reach), кружка стоит на столе: и когда её берут, и когда ставят
  const mugStates: [number, string][] = S.map(([t, s]) => [t, s === 'reach' ? 'table' : s])
  const gulps = [4.3, 4.8, 11.2, 11.7, 12.2]
  // глоток: кружка наклоняется к лицу и чуть поднимается; кисть (4×4) держит ручку поверх неё
  const hand = px(12, 4, 4, 4, O)
  const sipMug = sw(D, [[0, 'u'], ...gulps.flatMap(t => [[t, 't'], [t + 0.3, 'u']] as [number, string][])], {
    u: mug(true) + hand,
    t: at(0, -4, mugTilted() + hand),
  })
  const mugs = sw(D, mugStates, {
    table: at(84 + 4, 26, mug()),
    hold: at(70, 22, mug()),
    blow: at(68, 24, mug()),
    // у рта, вплотную к правому глазу, ручка справа в руке; на каждом глотке наклоняется к лицу (дискретно 0 → −30° → 0)
    sip: at(56, 28, sipMug),
  })
  // верх кружки (центр) по состояниям — туда переезжает пар
  const top: Record<string, string> = { table: '98 26', hold: '80 22', blow: '78 24', sip: '62 28' }
  const steamPos = dmove(D, mugStates.map(([t, s]) => [t, top[s] ?? '98 26'] as [number, string]))
  // обычный пар: три струйки с разными фазами
  const wisp = (dur: number, beginS: number, sway: number, w: number) =>
    px(-1, -2, w, 2, C.steam,
      mvK(dur, [[0, '0 0'], [dur * 0.35, `${sway} -4`], [dur * 0.7, `${-sway} -8`], [dur, `${sway} -12`]], EASE, beginS) +
      fade('0;0.9;0.6;0', `${dur}s`, { keyTimes: '0;0.15;0.6;1', begin: `${-beginS}s` }))
  const steamCalm = wisp(1.6, 0, 2, 2) + wisp(1.6, 0.55, -2, 2) + wisp(1.6, 1.05, 2, 4)
  // когда дует: пар срывается вправо и закручивается
  const gust = (beginS: number, dy: number) =>
    px(0, -2, 2, 2, C.steam,
      mvK(0.8, [[0, '0 0'], [0.25, `4 ${-4 + dy}`], [0.5, `10 ${-2 + dy}`], [0.8, `16 ${-8 + dy}`]], EASE, beginS) +
      fade('0;1;0', '0.8s', { keyTimes: '0;0.2;1', begin: `${-beginS}s` }))
  const steamGust = gust(0, 0) + gust(0.27, 2) + gust(0.53, -2)
  const blowOn = (on: boolean) => fade(on ? '0;1;0' : '1;0;1', `${D}s`, { calc: 'discrete', keyTimes: `0;${f4(2.1 / D)};${f4(3.95 / D)}` })
  const steam = g(g(steamCalm, blowOn(false)) + g(steamGust, blowOn(true), ' opacity="0"'), steamPos)
  // дуновение: короткие чёрточки от лица к кружке
  const breath = g([0, 0.13, 0.26].map(b =>
    px(54, 30 + (b === 0.13 ? 2 : 0), 4, 2, C.sky,
      mvK(0.4, [[0, '0 0'], [0.4, '10 -4']], EASE_OUT, b) +
      fade('0;1;0', '0.4s', { keyTimes: '0;0.3;1', begin: `${-b}s` }))).join(''), blowOn(true), ' opacity="0"')

  // ноты и сердечко после глотков
  const floatUp = (ch: string, col: string, x0: number, t: number) =>
    g(glyph(ch, 0, 0, col),
      mvK(D, [[0, `${x0} 12`], [t, `${x0} 12`], [t + 0.5, `${x0 + 6} 7`], [t + 1.0, `${x0 + 2} 3`], [t + 1.4, `${x0 + 8} 0`], [D, `${x0} 12`, LIN]]) +
        opK(D, [[0, '0'], [t, '0'], [t + 0.15, '1'], [t + 1.0, '1'], [t + 1.4, '0'], [D, '0']]), ' opacity="0"')
  const notes = floatUp('♪', C.purple, 66, 5.4) + floatUp('♪', C.blue, 84, 5.95) + floatUp('♥', C.red, 66, 12.8) + floatUp('♪', C.purple, 88, 13.4)
  return at(X, TOP, stool) + crate + hero + mugs + steam + breath + notes
}

// ── 4. сон: ночь, колпак, «z z Z», пузырь (12 с) ──────────────────────────────

// пиксельный круг-пузырь n×n клеток по 2 px (обводка голубая, внутри светлый, блик)
function bubble(n: number): string {
  const c = (n - 1) / 2
  const R = n / 2
  const hl = Math.round(c * 0.6)
  const rows = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => {
    const d = Math.hypot(x - c, y - c)
    return d > R - 0.25 ? ' ' : d > R - 1.25 ? 'o' : n >= 4 && x === hl && y === hl ? 'w' : 'i'
  }).join(''))
  return bitmap(rows, 2, ch => (ch === 'o' ? C.sky : ch === 'i' ? '#eef5ff' : ch === 'w' ? C.white : null))
}

export function sceneSleep(gear: Gear): string {
  const D = 12
  const X = 40
  const Y = FLOOR - 8 * P // сидит: тело 7 + ножки 1 клетка
  // ночной колпак: синий конус, белая опушка, кончик свисает с помпоном (рисуется зеркально — влево, справа место для пузыря)
  const cap =
    r(2, -1, 12, 1, C.white) + px(8, -4, 48, 1, C.paperEdge) +
    r(3, -2, 10, 1, C.blue) + r(4, -3, 8, 1, C.blue) + r(6, -4, 7, 1, C.blue) +
    r(5, -2, 2, 1, C.sky) + r(9, -3, 2, 1, C.sky) + r(8, -4, 1, 1, C.sky) +
    r(12, -4, 2, 1, C.blue) + r(13, -3, 2, 1, C.blue) + r(14, -2, 1, 1, C.blue)
  // помпон на свисающем кончике — качается в такт дыханию, на хлопке подпрыгивает
  const pompom = g(r(14, -1, 2, 2, C.white) + px(56, -4, 8, 1, C.paperEdge) + px(56, 3, 8, 1, C.paperEdge) + px(56, -4, 1, 8, C.paperEdge) + px(63, -4, 1, 8, C.paperEdge),
    mvK(D, [[0, '0 0'], [1.5, '0 2'], [3, '0 0'], [4.5, '0 2'], [6.0, '0 0'], [6.15, '0 -6', EASE_OUT], [6.4, '0 2', EASE_IN], [6.6, '0 -2'], [6.8, '0 0'], [9.0, '0 2'], [10.5, '0 0'], [D, '0 0']]))
  const eyes = sw(D, [[0, 'c'], [6.05, 'w'], [6.5, 'l'], [6.85, 'r'], [7.2, 'c']], {
    c: face('closed'), w: face('wide'), l: face('left'), r: face('right'),
  })
  const body = legsStand(1) + eyes + ARMS_DOWN + specs(gear, false) + mirror(cap + pompom)
  // дыхание: вдох-выдох по 3 с, на хлопке пузыря — вздрогнул
  const sq = scK(D, [
    [0, '1 1'], [1.5, '0.98 1.04'], [3.0, '1 1'], [4.5, '0.98 1.04'], [6.0, '1 1'],
    [6.08, '0.9 1.1', EASE_OUT], [6.25, '1.08 0.92'], [6.4, '1 1'],
    [7.6, '1 1'], [9.0, '0.98 1.04'], [10.5, '1 1'], [11.25, '0.99 1.02'], [D, '1 1'],
  ])
  const startle = mvK(D, [[0, '0 0'], [6.05, '0 0'], [6.18, '0 -4', EASE_OUT], [6.32, '0 0', EASE_IN], [D, '0 0']])
  const hero = at(X, Y, squashAt(body, sq, 32, 32), startle)

  // пузырь у носа: растёт ступенями на выдохах и лопается в 6.0 с
  // левый-нижний угол пузыря прижат к правому краю лица на уровне глаз; растёт вверх-вправо, вне силуэта
  const bx = X + 14 * P
  const by = Y + 3 * P
  const sizes = [2, 3, 4, 5, 6, 8]
  const bub = sw(D, [[0, '0'], [3.2, '1'], [3.8, '2'], [4.4, '3'], [4.9, '4'], [5.35, '5'], [5.7, '6'], [6.0, '0']],
    Object.fromEntries(sizes.map((n, i) => [String(i + 1), at(bx, by - 2 * n, bubble(n))])))
  // искры разлетаются наружу — вверх и вправо, в пустое небо
  const pc = [bx + 6, by - 10]
  const sparksB = [[-4, -12], [6, -14], [14, -10], [16, -2], [14, 6], [4, -16], [20, -6]].map(([dx, dy], i) =>
    px(pc[0]!, pc[1]!, 2, 2, i % 2 ? C.sky : C.white, mvK(D, [[0, '0 0'], [6.0, '0 0'], [6.35, `${dx} ${dy}`, EASE_OUT], [D, '0 0', LIN]]))).join('')
  const pop = g(sparksB, opK(D, [[0, '0'], [6.0, '0'], [6.02, '1'], [6.4, '0'], [D, '0']]), ' opacity="0"')

  // «z z Z»: поднимаются сбоку от головы до верха полосы, раскачиваются и тают (два выпуска за цикл);
  // каждая следующая чуть правее и больше — лесенкой, не налезают друг на друга
  const zz = (ch: string, col: string, t1: number, t2: number, dx: number) => {
    const life = 2.6
    const x0 = X + 68 + dx
    const y0 = Y + 8
    const path = (t: number): K[] => [[t, `${x0} ${y0}`], [t + life * 0.33, `${x0 + 6} ${y0 - 10}`], [t + life * 0.66, `${x0 + 2} ${y0 - 20}`], [t + life, `${x0 + 10} ${y0 - 30}`]]
    const k: K[] = [[0, `${x0} ${y0}`], ...path(t1), [t2 - 0.01, `${x0} ${y0}`, LIN], ...path(t2).slice(1), [D, `${x0} ${y0}`, LIN]]
    const o: [number, string][] = [[0, '0'], [t1, '0'], [t1 + 0.3, '1'], [t1 + 1.7, '1'], [t1 + life, '0'], [t2, '0'], [t2 + 0.3, '1'], [t2 + 1.7, '1'], [t2 + life, '0'], [D, '0']]
    const rows = ch === 'z' ? ['####', '  ##', '##  ', '####'] : ['######', '    # ', '   #  ', '  #   ', ' #    ', '######']
    const art = bitmap(rows, 2, c => (c === '#' ? col : null))
    return g(art, mvK(D, k) + opK(D, o), ' opacity="0"')
  }
  const zs = zz('z', C.blue, 0.2, 7.6, 0) + zz('z', C.purple, 1.1, 8.5, 6) + zz('Z', C.blue, 2.0, 9.3, 12)

  // небо: месяц, мерцающие звёзды, падающая звезда
  const MOON = ['...####.', '.####...', '.###....', '###.....', '###.....', '###.....', '###.....', '.###....', '.####...', '...####.']
  const moon = bitmap(MOON, 2, ch => (ch === '#' ? C.yellow : null))
  const moonG = at(640, 4, moon,
    fade('1;0.75;1', '6s', { calc: 'spline', keyTimes: '0;0.5;1', keySplines: `${EASE};${EASE}` }))
  const star = (x: number, y: number, col: string, dur: number, ofs: number) =>
    at(x, y,
      px(4, 4, 2, 2, col) +
        g(px(4, 0, 2, 4, col) + px(4, 6, 2, 4, col) + px(0, 4, 4, 2, col) + px(6, 4, 4, 2, col),
          fade('1;0;1', `${dur}s`, { calc: 'discrete', keyTimes: '0;0.45;0.7', begin: `${-ofs}s` })),
      fade('1;0.35;1', `${dur}s`, { calc: 'spline', keyTimes: '0;0.5;1', keySplines: `${EASE};${EASE}`, begin: `${-ofs}s` }))
  const stars =
    star(250, 4, C.yellow, 2, 0) + star(330, 22, C.blue, 3, 1.1) + star(410, 2, C.yellow, 2.4, 0.6) +
    star(480, 26, C.purple, 4, 2.2) + star(548, 8, C.yellow, 1.5, 0.4) + star(686, 30, C.blue, 3, 2.0) + star(180, 24, C.yellow, 6, 3.5)
  // падающая звезда: голова 4×4 с белой серединкой, хвост из 4 клеток с убывающей яркостью
  const tail = [0.75, 0.5, 0.3, 0.15].map((o, i) => g(px(4 + i * 4, -2 - i * 2, 4, 2, C.yellow), '', ` opacity="${o}"`)).join('')
  const shooting = g(
    px(0, 0, 4, 4, C.yellow) + px(0, 0, 2, 2, C.white) + tail,
    mvK(D, [[0, '600 4'], [9.0, '600 4'], [9.9, '520 40', LIN], [D, '600 4', LIN]]) + opK(D, [[0, '0'], [9.0, '0'], [9.1, '1'], [9.65, '1'], [9.9, '0'], [D, '0']]),
    ' opacity="0"')
  // «!» над головой, когда пузырь лопнул
  const alarm = g(glyph('!', X + 68, Y - 16, C.red),
    opK(D, [[0, '0'], [6.04, '0'], [6.06, '1'], [6.6, '1'], [6.8, '0'], [D, '0']]) + mvK(D, [[0, '0 0'], [6.04, '0 4'], [6.2, '0 0', EASE_OUT], [D, '0 0']]), ' opacity="0"')
  return moonG + stars + shooting + zs + hero + bub + pop + alarm
}
