// The shared pixel-Clawd frame and the SVG primitives the scenes are built from.
// Everything is drawn in a STRIP_W x STRIP_H CSS px strip; animation is SMIL only (<animate>, <animateTransform>, <set>):
// the engine guarantees SMIL in the isInteractive Svg sandbox, while <style>/CSS animations and scripts are not allowed.
// Character coordinates are in P x P px cells; the standing Clawd sprite is 16 x 10 cells, feet on the FLOOR line.

export const STRIP_W = 720
export const STRIP_H = 58
export const P = 4 // пиксель персонажа, CSS px
export const FLOOR = STRIP_H - 4 // y линии пола, px
export const CH_W = 16 // ширина спрайта, клеток
export const CH_H = 10 // высота спрайта стоя (тело 7 + ноги 3), клеток
export const TOP = FLOOR - CH_H * P // верх стоящего Клода, px (= 14)
// длительности сцен простоя (с): прогулка — ровно туда и обратно, кофе, праздник после хода
export const WALK_S = 24
export const COFFEE_S = 16
export const CELEBRATE_S = 4

// Палитра: читается и на светлой (#f0efea), и на тёмной (#262624) теме десктопа.
// Тёмное (ink) на тёмной теме пропадает — у тёмных предметов делайте светлую кромку (edge).
export const C = {
  orange: '#D97757', // Клод
  orangeDark: '#b45a3c', // тень Клода
  ink: '#1f1f1f', // глаза, очки
  ink2: '#3a3a3a', // корпус ноутбука, техника
  edge: '#8a8a8a', // светлая кромка тёмных предметов
  white: '#ffffff',
  paper: '#f4efe4',
  paperEdge: '#c9bda6',
  blue: '#3d6fd9',
  sky: '#8fb8ff',
  green: '#5fbf6e',
  greenLight: '#7fd18b',
  red: '#e5484d',
  yellow: '#f2b134',
  purple: '#9b6bd6',
  grey: '#9a9a9a',
  brown: '#6b3f26',
  wood: '#8a5a3c',
  steam: '#b8b8b8',
} as const

export type Gear = { glasses: boolean }
export const NO_GEAR: Gear = { glasses: false }

// ── анимация ──────────────────────────────────────────────────────────────────

export type Anim = {
  calc?: 'discrete' | 'linear' | 'spline' | 'paced'
  keyTimes?: string
  keySplines?: string
  begin?: string
  once?: boolean // без repeatCount (сыграть один раз и замереть — fill="freeze")
}
const tail = (o: Anim) =>
  (o.calc ? ` calcMode="${o.calc}"` : '') +
  (o.keyTimes ? ` keyTimes="${o.keyTimes}"` : '') +
  (o.keySplines ? ` keySplines="${o.keySplines}"` : '') +
  (o.begin ? ` begin="${o.begin}"` : '') +
  (o.once ? ' fill="freeze"' : ' repeatCount="indefinite"')

// сдвиг группы: values "x y;x y;…" в px
export const move = (values: string, dur: string, o: Anim = {}) =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}"${tail(o)}/>`
// поворот: values "угол cx cy;…" (cx, cy — в px системы координат группы)
export const spin = (values: string, dur: string, o: Anim = {}) =>
  `<animateTransform attributeName="transform" type="rotate" values="${values}" dur="${dur}"${tail(o)}/>`
// масштаб: values "sx sy;…" (вокруг начала координат группы — см. squash)
export const scaleAnim = (values: string, dur: string, o: Anim = {}) =>
  `<animateTransform attributeName="transform" type="scale" values="${values}" dur="${dur}"${tail(o)}/>`
export const fade = (values: string, dur: string, o: Anim = {}) =>
  `<animate attributeName="opacity" values="${values}" dur="${dur}"${tail(o)}/>`
export const attr = (name: string, values: string, dur: string, o: Anim = {}) =>
  `<animate attributeName="${name}" values="${values}" dur="${dur}"${tail(o)}/>`
// набор n одинаковых keySplines для calc:'spline' (n = число значений − 1)
export const EASE = '0.42 0 0.58 1'
export const EASE_OUT = '0 0 0.58 1'
export const EASE_IN = '0.42 0 1 1'
export const splines = (n: number, s = EASE) => Array.from({ length: n }, () => s).join(';')

// ── рисование ─────────────────────────────────────────────────────────────────

// прямоугольник в клетках; inner — анимации внутри rect
export const r = (x: number, y: number, w: number, h: number, fill: string, inner = '') => {
  const a = `x="${x * P}" y="${y * P}" width="${w * P}" height="${h * P}" fill="${fill}"`
  return inner ? `<rect ${a}>${inner}</rect>` : `<rect ${a}/>`
}
// прямоугольник в px (для мелочей: пар, искры, конфетти, мини-клодики)
export const px = (x: number, y: number, w: number, h: number, fill: string, inner = '') => {
  const a = `x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"`
  return inner ? `<rect ${a}>${inner}</rect>` : `<rect ${a}/>`
}
// группа: inner, анимации группы, атрибуты (' opacity="0"' и т.п.)
export const g = (inner: string, anim = '', attrs = '') => `<g${attrs}>${anim}${inner}</g>`
// сдвинуть содержимое в точку (px); anim — анимация вложенной группы (у неё нет своего transform)
export const at = (xPx: number, yPx: number, inner: string, anim = '') =>
  `<g transform="translate(${xPx},${yPx})">${g(inner, anim)}</g>`
// поставить Клода на пол в точке x (px): верх спрайта на TOP
export const stand = (xPx: number, inner: string, anim = '') => at(xPx, TOP, inner, anim)
// сжатие/растяжение вокруг ступней спрайта (values "sx sy;…": 1.15 0.85 — сплющился, 0.9 1.12 — вытянулся)
export function squash(inner: string, values: string, dur: string, o: Anim = {}) {
  const cx = (CH_W * P) / 2
  const fy = CH_H * P
  return `<g transform="translate(${cx},${fy})">${g(`<g transform="translate(${-cx},${-fy})">${inner}</g>`, scaleAnim(values, dur, o))}</g>`
}
// зеркало по горизонтали вокруг середины спрайта (Клод смотрит влево)
export const mirror = (inner: string) => `<g transform="translate(${CH_W * P},0) scale(-1,1)">${inner}</g>`

// пиксельные значки 5×5 (символ → строки, «#» — закрашено); cell — размер точки, px
const GLYPHS: Record<string, string[]> = {
  '?': [' ### ', '#   #', '   # ', '  #  ', '     ', '  #  '],
  '!': ['  #  ', '  #  ', '  #  ', '  #  ', '     ', '  #  '],
  Z: ['#####', '   # ', '  #  ', ' #   ', '#####'],
  z: ['###', ' # ', '###'],
  '♪': ['  ## ', '  # #', '  #  ', '###  ', '###  '],
  '♥': [' # # ', '#####', '#####', ' ### ', '  #  '],
  '✓': ['    #', '   # ', '#  # ', ' ##  ', '  #  '],
  '✗': ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  '+': ['  #  ', '  #  ', '#####', '  #  ', '  #  '],
  '*': ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  '.': ['     ', '     ', '     ', '     ', '  #  '],
  '0': [' ### ', '#   #', '#   #', '#   #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', ' ### '],
  '2': [' ### ', '#   #', '  ## ', ' #   ', '#####'],
  '3': ['#### ', '    #', ' ### ', '    #', '#### '],
  '4': ['#  # ', '#  # ', '#####', '   # ', '   # '],
  '5': ['#####', '#    ', '#### ', '    #', '#### '],
  '6': [' ### ', '#    ', '#### ', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', '  #  '],
  '8': [' ### ', '#   #', ' ### ', '#   #', ' ### '],
  '9': [' ### ', '#   #', ' ####', '    #', ' ### '],
}
export function glyph(ch: string, xPx: number, yPx: number, fill: string, cell = 2): string {
  const rows = GLYPHS[ch]
  if (!rows) return ''
  let s = ''
  rows.forEach((row, yy) => {
    for (let xx = 0; xx < row.length; xx++) if (row[xx] === '#') s += px(xPx + xx * cell, yPx + yy * cell, cell, cell, fill)
  })
  return s
}

// ── Клод ──────────────────────────────────────────────────────────────────────

export type Eyes = 'open' | 'closed' | 'happy' | 'left' | 'right' | 'up' | 'wide' | 'dizzy'
export type Arms = 'down' | 'type' | 'wave' | 'up' | 'none'
export type Legs = 'stand' | 'walk' | 'sit' | 'none'

function eyesSvg(e: Eyes, blink: boolean): string {
  const D = C.ink
  switch (e) {
    case 'closed':
      return r(4, 3, 2, 1, D) + r(10, 3, 2, 1, D)
    case 'happy': // ^ ^
      return r(4, 3, 1, 1, D) + r(5, 2, 1, 1, D) + r(6, 3, 1, 1, D) + r(9, 3, 1, 1, D) + r(10, 2, 1, 1, D) + r(11, 3, 1, 1, D)
    case 'dizzy': // × ×
      return [4, 9].map(x => r(x, 2, 1, 1, D) + r(x + 2, 2, 1, 1, D) + r(x + 1, 3, 1, 1, D) + r(x, 4, 1, 1, D) + r(x + 2, 4, 1, 1, D)).join('')
    case 'wide':
      return r(4, 2, 2, 2, D) + r(10, 2, 2, 2, D) + r(4, 2, 1, 1, C.white) + r(10, 2, 1, 1, C.white)
    default: {
      const pos = { open: [5, 10, 2], left: [4, 9, 2], right: [6, 11, 2], up: [5, 10, 1] }[e]
      const [lx, rx, y] = pos!
      const eyes = r(lx!, y!, 1, 2, D) + r(rx!, y!, 1, 2, D)
      return blink ? g(eyes, fade('1;0;1', '5s', { calc: 'discrete', keyTimes: '0;0.95;0.98' })) : eyes
    }
  }
}

function armsSvg(a: Arms): string {
  const L = r(0, 3, 2, 2, C.orange)
  const R = r(14, 3, 2, 2, C.orange)
  switch (a) {
    case 'none':
      return ''
    case 'type': // попеременно стучат по клавиатуре
      return g(L, move('0 0;0 4', '0.3s', { calc: 'discrete' })) + g(R, move('0 4;0 0', '0.3s', { calc: 'discrete' }))
    case 'wave': // правая рука вверх и машет
      return L + g(r(14, 0, 2, 2, C.orange) + r(15, -1, 1, 1, C.orange), move('0 0;3 -2;0 0', '0.6s', { calc: 'discrete' }))
    case 'up': // обе вверх
      return r(0, 0, 2, 2, C.orange) + r(0, -1, 1, 1, C.orange) + r(14, 0, 2, 2, C.orange) + r(15, -1, 1, 1, C.orange)
    default:
      return L + R
  }
}

export const legsStand = (h = 3) => [3, 6, 9, 12].map(x => r(x, 7, 1, h, C.orange)).join('')
// шаг: пары ног по очереди короче (период 0.5 с)
export const legsWalk = (period = '0.5s') =>
  g([3, 9].map(x => r(x, 7, 1, 3, C.orange)).join('') + [6, 12].map(x => r(x, 7, 1, 2, C.orange)).join(''),
    fade('1;0', period, { calc: 'discrete' })) +
  g([3, 9].map(x => r(x, 7, 1, 2, C.orange)).join('') + [6, 12].map(x => r(x, 7, 1, 3, C.orange)).join(''),
    fade('0;1', period, { calc: 'discrete' }), ' opacity="0"')

// крутые чёрные очки (режим ultra): перемычка, сплошные стёкла со ступенькой, блик; glint — пробегающий отблеск.
// Перемычка на клетку уже тела с каждой стороны: во всю ширину она на тёмной теме сливалась с фоном и резала голову
export function glasses(glint = true): string {
  const D = C.ink
  const base =
    r(3, 1, 10, 1, D) +
    r(3, 2, 4, 2, D) + r(4, 4, 2, 1, D) +
    r(9, 2, 4, 2, D) + r(10, 4, 2, 1, D) +
    r(4, 2, 1, 1, C.white) + r(10, 2, 1, 1, C.white) +
    r(5, 3, 1, 1, '#4a4a4a') + r(11, 3, 1, 1, '#4a4a4a')
  if (!glint) return base
  // косая полоска света пробегает по стёклам раз в 4 с
  const shine = g(px(14, 8, 2, 2, C.white) + px(16, 6, 2, 2, C.white), move('0 0;0 0;32 0;32 0', '4s', { keyTimes: '0;0.7;0.85;1' }) +
    fade('0;0;0.9;0;0', '4s', { keyTimes: '0;0.7;0.78;0.85;1' }), ' opacity="0"')
  return base + shine
}

// Клод целиком в своих клетках (0..16 × −?..10): тело, глаза, руки, ноги и очки (gear)
export function clawd(o: { eyes?: Eyes; blink?: boolean; arms?: Arms; legs?: Legs; gear?: Gear; glint?: boolean } = {}): string {
  const eyes = eyesSvg(o.eyes ?? 'open', o.blink ?? true)
  const legs = o.legs === 'walk' ? legsWalk() : o.legs === 'sit' ? legsStand(1) : o.legs === 'none' ? '' : legsStand(3)
  const gl = o.gear?.glasses ? glasses(o.glint ?? true) : ''
  return r(2, 0, 12, 7, C.orange) + armsSvg(o.arms ?? 'down') + legs + eyes + gl
}

// мини-клодик (помощник-сабагент) в px: масштаб 0.5, с ноутбучком; x, y — левый верх; delay — сдвиг анимации
export function miniClawd(xPx: number, yPx: number, delay = 0): string {
  const s = 2 // пиксель мини-клодика
  const q = (x: number, y: number, w: number, h: number, f: string) => px(xPx + x * s, yPx + y * s, w * s, h * s, f)
  const arms = g(q(0, 3, 2, 2, C.orange), move('0 0;0 2', '0.3s', { calc: 'discrete', begin: `${delay}s` })) +
    g(q(14, 3, 2, 2, C.orange), move('0 2;0 0', '0.3s', { calc: 'discrete', begin: `${delay}s` }))
  return q(2, 0, 12, 7, C.orange) + arms + q(5, 2, 1, 2, C.ink) + q(10, 2, 1, 2, C.ink) +
    [3, 6, 9, 12].map(x => q(x, 7, 1, 1, C.orange)).join('') +
    q(16, 2, 10, 6, C.ink2) + q(17, 3, 8, 4, '#151515') + q(15, 8, 12, 1, C.edge) +
    g(q(18, 4, 5, 1, C.greenLight), attr('width', `0;${5 * s};${5 * s}`, '1.6s', { keyTimes: '0;0.7;1', begin: `${delay}s` }))
}

// обёртка SVG полосы: пол + содержимое сцены
export function strip(inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${STRIP_W}" height="${STRIP_H}" viewBox="0 0 ${STRIP_W} ${STRIP_H}" shape-rendering="crispEdges">` +
    `<rect x="0" y="${FLOOR}" width="${STRIP_W}" height="1" fill="#d9d4cc" opacity="0.7"/>` +
    inner +
    `</svg>`
  )
}
