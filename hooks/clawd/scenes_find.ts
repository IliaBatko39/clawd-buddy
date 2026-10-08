// Clawd scenes, group "find": searching (magnifier), on the web (globe and packets), asking (a "?" sign).
// Each function returns the strip's content (without <svg>), see core.ts. SMIL only.
// "While working" scenes stay at x <= 460: the mini-Clawd helpers are drawn on the right.
import {
  type Eyes, type Gear, C, EASE, EASE_IN, EASE_OUT, TOP,
  at, attr, clawd, fade, g, glyph, legsStand, legsWalk, move, px, r, scaleAnim, spin, squash,
} from './core'

// ── таймлайны ────────────────────────────────────────────────────────────────
// Кадр: [время, с; значение; easing отрезка, который КОНЧАЕТСЯ этим кадром]
type KF = [number, string, string?]
type Iv = [number, number]

const frac = (t: number, dur: number) => String(Math.round((t / dur) * 10000) / 10000)
const kt = (dur: number, f: KF[]) => f.map(k => frac(k[0], dur)).join(';')
const vals = (f: KF[]) => f.map(k => k[1]).join(';')
const ks = (f: KF[], def: string) => f.slice(1).map(k => k[2] ?? def).join(';')
const sp = (dur: number, f: KF[], def = EASE) => ({ calc: 'spline' as const, keyTimes: kt(dur, f), keySplines: ks(f, def) })

// плавные дорожки (кадры от 0 до dur включительно)
const mvT = (dur: number, f: KF[], def = EASE) => move(vals(f), `${dur}s`, sp(dur, f, def))
const spinT = (dur: number, f: KF[], def = EASE) => spin(vals(f), `${dur}s`, sp(dur, f, def))
const scaleT = (dur: number, f: KF[], def = EASE) => scaleAnim(vals(f), `${dur}s`, sp(dur, f, def))
const attrT = (name: string, dur: number, f: KF[], def = EASE) => attr(name, vals(f), `${dur}s`, sp(dur, f, def))
const fadeLin = (dur: number, f: KF[]) => fade(vals(f), `${dur}s`, { calc: 'linear', keyTimes: kt(dur, f) })
// ступенчатые дорожки (значение держится до следующего кадра)
const mvD = (dur: number, f: KF[]) => move(vals(f), `${dur}s`, { calc: 'discrete', keyTimes: kt(dur, f) })
const attrD = (name: string, dur: number, f: KF[]) => attr(name, vals(f), `${dur}s`, { calc: 'discrete', keyTimes: kt(dur, f) })

// видимость по интервалам (дискретно): [[a,b],…] — отсортированы, не пересекаются
function vis(dur: number, on: Iv[]): string {
  const f: KF[] = [[0, on.some(([a]) => a <= 0) ? '1' : '0']]
  for (const [a, b] of on) {
    if (a > 0) f.push([a, '1'])
    if (b < dur) f.push([b, '0'])
  }
  return fade(vals(f), `${dur}s`, { calc: 'discrete', keyTimes: kt(dur, f) })
}
const shown = (inner: string, dur: number, on: Iv[]) =>
  g(inner, vis(dur, on), on.some(([a]) => a <= 0) ? '' : ' opacity="0"')
const complement = (dur: number, on: Iv[]): Iv[] => {
  const out: Iv[] = []
  let t = 0
  for (const [a, b] of on) {
    if (a > t) out.push([t, a])
    t = b
  }
  if (t < dur) out.push([t, dur])
  return out
}

// след, который появляется в момент a и тает за life секунд; через конец цикла переходит бесшовно
function trace(dur: number, a: number, life: number, peak = 0.8): string {
  const p = String(peak)
  if (a + life <= dur) {
    const f: KF[] = a > 0 ? [[0, '0'], [a, '0'], [a + 0.02, p], [a + life, '0']] : [[0, p], [life, '0']]
    if (a + life < dur) f.push([dur, '0'])
    return fadeLin(dur, f)
  }
  const v0 = String(Math.round(peak * (1 - (dur - a) / life) * 100) / 100)
  return fadeLin(dur, [[0, v0], [a + life - dur, '0'], [a, '0'], [a + 0.02, p], [dur, v0]])
}

// пиксельная картинка из строк: символ → цвет, cell — размер точки (px); соседние точки в строке сливаются
function pix(x: number, y: number, rows: string[], pal: Record<string, string>, cell = 2): string {
  let s = ''
  rows.forEach((row, yy) => {
    let xx = 0
    while (xx < row.length) {
      const ch = row[xx]!
      const col = pal[ch]
      if (!col) { xx++; continue }
      let w = 1
      while (row[xx + w] === ch) w++
      s += px(x + xx * cell, y + yy * cell, w * cell, cell, col)
      xx += w
    }
  })
  return s
}

// глаза поверх базового Клода: тело без рук и ног с другими глазами, видимое в интервалах.
// В очках глаза скрыты стёклами — накладки не нужны (и закрыли бы очки базового спрайта).
// Свои направления взгляда (в core нет): вверх-вправо (за пакетами/вдаль) и вниз-вправо (на лупу у пола, по строкам).
type Look = Eyes | 'upRight' | 'downRight'
const LOOK: Record<'upRight' | 'downRight', number> = { upRight: 1, downRight: 3 }
function lookFace(e: Look): string {
  if (e === 'upRight' || e === 'downRight') {
    const y = LOOK[e]
    return r(2, 0, 12, 7, C.orange) + r(6, y, 1, 2, C.ink) + r(11, y, 1, 2, C.ink)
  }
  return clawd({ eyes: e, blink: false, arms: 'none', legs: 'none' })
}
function eyesOver(gear: Gear, dur: number, list: [Look, Iv[]][]): string {
  if (gear.glasses) return ''
  return list.map(([e, on]) => shown(lookFace(e), dur, on)).join('')
}

// всплывающий значок с пружиной: центр (cx, cy), появление в t0, исчезновение в t1
function popGlyph(ch: string, cx: number, cy: number, fill: string, cell: number, dur: number, t0: number, t1: number, big = 1.3): string {
  const w = 5 * cell, h = (ch === '?' || ch === '!' ? 6 : 5) * cell
  const f: KF[] = [[0, '0 0'], [t0, '0 0'], [t0 + 0.12, `${big} ${big}`, EASE_OUT], [t0 + 0.24, '0.85 0.85'], [t0 + 0.34, '1.08 1.08'],
    [t0 + 0.44, '1 1'], [t1, '1 1'], [t1 + 0.14, '0 0', EASE_IN], [dur, '0 0']]
  return at(cx, cy, at(-w / 2, -h / 2, glyph(ch, 0, 0, fill, cell)), scaleT(dur, f))
}

// пылинки из-под ног: две точки разлетаются от (x, y) в момент t
const dust = (dur: number, x: number, y: number, t: number) => {
  const life = Math.min(0.5, dur - t - 0.04)
  return [-1, 1].map(d => g(px(x, y, 2, 2, C.steam),
    mvT(dur, [[0, '0 0'], [t, '0 0'], [t + life, `${d * 8} -4`, EASE_OUT], [t + life + 0.02, '0 0'], [dur, '0 0']]) +
    fadeLin(dur, [[0, '0'], [t, '0'], [t + 0.04, '0.9'], [t + life, '0'], [dur, '0']]), ' opacity="0"')).join('')
}

// ── 1. Ищет: детектив с лупой (10 с) ─────────────────────────────────────────
// t=0–0.5 стоит, 0.5–3.4 бредёт вправо (следы тают), 3.4 стоп (пыль, шляпа по инерции),
// 3.7–4.9 водит лупой: вверх-вдаль, вниз, оглядывается, 4.9–6.45 склоняется к полу, «?»,
// 5.7 под лупой блестит монетка (глаза широкие), 6.5 сжатие → «!» с пружиной, кулак вверх, глаза ^ ^,
// 7.35 монетка прыгает в шляпу, 7.8–9.7 разворот и обратно, 9.7 стоп и разворот лицом вправо.
export function sceneSearch(gear: Gear): string {
  const D = 10
  const X0 = 40, X1 = 214
  const walkIv: Iv[] = [[0.5, 3.4], [7.8, 9.7]]

  // ноги: шаг во время ходьбы, иначе стоят
  const legs = shown(legsWalk(), D, walkIv) + shown(legsStand(), D, complement(D, walkIv))

  // левая рука: опущена / кулак вверх на «!» — плечо у тела, предплечье и кулак выше полей шляпы
  const armUp = r(0, 1, 2, 2, C.orange) + r(0, -1, 1, 2, C.orange) + g(r(-1, -3, 2, 2, C.orange), move('0 0;0 2', '0.3s', { calc: 'discrete' }))
  const leftArm = shown(r(0, 3, 2, 2, C.orange), D, complement(D, [[6.6, 7.6]])) + shown(armUp, D, [[6.6, 7.6]])

  // лупа в правой руке: заранее нарисованные позы (пиксели чёткие) + короткий доворот spin вокруг кисти (60,16) при смене позы.
  // Ручка двухцветная: светлая верхняя кромка видна на тёмной теме.
  const handle = (cells: [number, number][]) => cells.map(([x, y]) => r(x, y, 1, 1, C.wood) + px(x * 4, y * 4, 4, 2, '#c08a5e')).join('')
  const ring = (x: number, y: number) =>
    r(x + 1, y, 4, 1, C.grey) + r(x + 1, y + 4, 4, 1, C.grey) + r(x, y + 1, 1, 3, C.grey) + r(x + 5, y + 1, 1, 3, C.grey) +
    g(r(x + 1, y + 1, 4, 3, C.sky), '', ' opacity="0.85"') + r(x + 2, y + 1, 1, 1, C.white) + px((x + 4) * 4, (y + 3) * 4, 2, 2, C.white)
  const POSE = {
    level: handle([[16, 3], [17, 2]]) + ring(17, -2), // вперёд
    up: handle([[16, 2], [17, 1]]) + ring(18, -3), // вдаль-вверх
    far: handle([[16, 4], [17, 4]]) + ring(18, 4), // к полу, дальше
    near: handle([[16, 5]]) + ring(17, 5), // к полу, ближе
  }
  const poseIv: Record<keyof typeof POSE, Iv[]> = {
    level: [[0, 3.7], [4.2, 4.9], [7.6, D]],
    up: [[3.7, 4.2], [6.5, 7.6]],
    far: [[4.9, 5.2], [5.45, 5.7], [5.95, 6.2]],
    near: [[5.2, 5.45], [5.7, 5.95], [6.2, 6.5]],
  }
  const lens = (Object.keys(POSE) as (keyof typeof POSE)[]).map(k => shown(POSE[k], D, poseIv[k])).join('')
  // доворот: поза появляется чуть повёрнутой со стороны, откуда пришла, и за 0.12 с встаёт ровно
  const settle = (t: number, a: number): KF[] => [[t - 0.01, '0 60 16'], [t, `${a} 60 16`], [t + 0.12, '0 60 16', EASE_OUT]]
  const lensArm = g(lens, spinT(D, [
    [0, '0 60 16'], [3.4, '0 60 16'], [3.48, '10 60 16', EASE_OUT], [3.6, '0 60 16'],
    ...settle(3.7, 10), ...settle(4.2, -8), ...settle(4.9, -8), ...settle(6.5, 10), ...settle(7.6, -8), [10, '0 60 16'],
  ]))

  // шляпа детектива: поля, тулья с лентой; запаздывает на остановках и подпрыгивает на «!»
  const hat = g(
    r(1, -1, 14, 1, C.wood) + r(4, -3, 8, 2, C.wood) + r(4, -2, 8, 1, C.brown) + px(20, -12, 8, 2, C.brown),
    mvT(D, [[0, '0 0'], [3.4, '0 0'], [3.5, '2 0'], [3.7, '0 0'], [6.5, '0 0'], [6.62, '0 -2', EASE_OUT], [6.8, '0 0'],
      [7.7, '0 0'], [7.78, '0 2'], [7.9, '0 0'], [9.7, '0 0'], [9.8, '2 0'], [9.95, '0 0'], [10, '0 0']]))

  const face = clawd({ eyes: 'right', arms: 'none', legs: 'none', gear }) + eyesOver(gear, D, [
    ['closed', [[1.7, 1.85], [8.7, 8.85]]],
    ['upRight', [[3.75, 4.2]]],
    ['left', [[4.45, 4.9]]],
    ['downRight', [[4.95, 5.65]]],
    ['wide', [[5.65, 6.55]]],
    ['happy', [[6.6, 7.75]]],
  ])

  // покачивание на ходу: тело на 2 px ниже на каждом втором шаге (шаг 0.25 с, в такт ногам)
  const bobVals = Array.from({ length: 40 }, (_, k) => {
    const t = k * 0.25 + 0.01
    return walkIv.some(([a, b]) => t >= a && t < b) && k % 2 === 1 ? '0 2' : '0 0'
  }).join(';')
  const body = g(face + leftArm + lensArm + r(14, 3, 2, 2, C.orange) + hat, move(bobVals, `${D}s`, { calc: 'discrete' }))

  const sprite = squash(legs + body, vals(SQ_SEARCH), `${D}s`, sp(D, SQ_SEARCH))
  // разворот: лицом вправо, с 7.8 — влево, с 9.7 снова вправо
  const flip = `<g transform="translate(32,0)">${g(`<g transform="translate(-32,0)">${sprite}</g>`,
    scaleAnim('1 1;-1 1;1 1', `${D}s`, { calc: 'discrete', keyTimes: `0;${frac(7.8, D)};${frac(9.7, D)}` }))}</g>`

  // значки у головы, сразу за полями шляпы (над самой шляпой места нет: её тулья у верха полосы)
  const marks = popGlyph('?', 66, 2, C.blue, 2, D, 5.1, 6.35) + popGlyph('!', 64, 0, C.red, 2, D, 6.6, 7.6, 1.35)

  const actor = at(0, TOP, flip + marks, mvT(D, [
    [0, `${X0} 0`], [0.5, `${X0} 0`], [3.4, `${X1} 0`, '0.3 0 0.6 1'], [7.8, `${X1} 0`], [9.7, `${X0} 0`, '0.3 0 0.6 1'], [10, `${X0} 0`],
  ]))

  // следы: задняя нога оставляет пару точек, они тают
  const ease = bezier(0.3, 0, 0.6, 1)
  const xAt = (t: number, t0: number, t1: number, a: number, b: number) => a + (b - a) * ease((t - t0) / (t1 - t0))
  const when = (pred: (t: number) => boolean, t0: number, t1: number) => {
    for (let t = t0; t <= t1; t += 0.01) if (pred(t)) return t
    return -1
  }
  let prints = ''
  for (let x = X0 + 12; x <= X1 + 4; x += 16) { // вправо: задняя нога — клетка 3 (rel 12)
    const t = when(tt => xAt(tt, 0.5, 3.4, X0, X1) + 12 >= x + 8, 0.5, 3.4)
    if (t > 0) prints += g(px(x, 55, 2, 2, C.grey) + px(x + 4, 56, 2, 2, C.grey), trace(D, t, 2.2), ' opacity="0"')
  }
  for (let x = X1 + 48; x >= X0 + 56; x -= 16) { // влево: задняя нога — rel 48
    const t = when(tt => xAt(tt, 7.8, 9.7, X1, X0) + 48 <= x - 8, 7.8, 9.7)
    if (t > 0) prints += g(px(x, 55, 2, 2, C.grey) + px(x + 4, 56, 2, 2, C.grey), trace(D, t, 2.2), ' opacity="0"')
  }

  // монетка под лупой: проявляется, блестит, прыгает в шляпу
  const cx = X1 + 76, cy = 48
  const coin = g(
    px(cx + 2, cy, 4, 2, C.yellow) + px(cx, cy + 2, 8, 2, C.yellow) + px(cx + 2, cy + 4, 4, 2, C.orangeDark) +
    px(cx, cy + 4, 2, 2, C.orangeDark) + px(cx + 6, cy + 4, 2, 2, C.orangeDark) + px(cx + 2, cy + 2, 2, 2, C.white),
    mvT(D, [[0, '0 0'], [7.35, '0 0'], [7.5, '-12 -30', EASE_OUT], [7.66, '-38 -40'], [7.72, '-44 -36', EASE_IN], [7.74, '0 0'], [10, '0 0']]) +
    fadeLin(D, [[0, '0'], [5.6, '0'], [5.9, '1'], [7.7, '1'], [7.72, '0'], [10, '0']]), ' opacity="0"')
  const sparkle = (x: number, y: number, ph: number) => shown(
    g(px(x, y - 2, 2, 6, C.yellow) + px(x - 2, y, 6, 2, C.yellow) + px(x, y, 2, 2, C.white),
      fade('1;0;1', '0.5s', { calc: 'discrete', keyTimes: `0;${ph};${ph + 0.3}` })), D, [[5.95, 7.35]])

  return prints + dust(D, X1 + 54, 52, 3.4) + dust(D, X0 + 10, 52, 9.7) + actor + coin +
    sparkle(cx - 4, 44, 0.1) + sparkle(cx + 10, 48, 0.5)
}

// сжатие/растяжение (вокруг ступней): стоп, склон к полу, упреждение и пружина на «!», ловит монетку, стоп
const SQ_SEARCH: KF[] = [
  [0, '1 1'], [3.4, '1 1'], [3.5, '1.06 0.94', EASE_OUT], [3.65, '0.98 1'], [3.8, '1 1'],
  [5.2, '1 1'], [5.6, '1.08 0.88'], [6.35, '1.08 0.88'], [6.5, '1.13 0.82'], [6.62, '0.95 1', EASE_OUT], [6.75, '1.03 0.98'], [6.9, '1 1'],
  [7.7, '1 1'], [7.78, '1.04 0.96'], [7.9, '1 1'],
  [9.7, '1 1'], [9.8, '1.05 0.95', EASE_OUT], [9.92, '1 1'], [10, '1 1'],
]

// кубическая кривая Безье для расчёта моментов (как keySplines): x1,y1,x2,y2 → f(u)
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const b = (a1: number, a2: number, s: number) => 3 * a1 * s * (1 - s) ** 2 + 3 * a2 * s * s * (1 - s) + s ** 3
  return (u: number) => {
    if (u <= 0) return 0
    if (u >= 1) return 1
    let lo = 0, hi = 1
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2
      if (b(x1, x2, m) < u) lo = m
      else hi = m
    }
    return b(y1, y2, (lo + hi) / 2)
  }
}

// ── 2. В интернете: глобус, Wi-Fi, пакеты, браузер (8 с) ─────────────────────
// t=0–0.55 набирает адрес (стучит по окну), 0.6–1.4 запрос улетает к глобусу, 1.4 глобус вспыхивает, Wi-Fi частит,
// 1.75–5.05 пять пакетов летят по дуге к окну, глаза за ними вверх-вниз, полоса загрузки растёт с каждым,
// 5.15 загрузилось: прыжок со сжатием, рука вверх, «✓», глаза ^ ^; 5.6–7.85 страница проявляется, Клод читает.
export function sceneWeb(gear: Gear): string {
  const D = 8
  const X = 40
  const GX = 296, GY = 14 // глобус 32×32 px (16×16 точек по 2 px)

  // ── глобус ──
  const R = 8
  const disk: string[] = []
  for (let j = 0; j < 16; j++) {
    let row = ''
    for (let i = 0; i < 16; i++) row += (i + 0.5 - R) ** 2 + (j + 0.5 - R) ** 2 <= (R - 0.2) ** 2 ? '#' : ' '
    disk.push(row)
  }
  const clip = `<clipPath id="cw-web-globe">${pix(GX, GY, disk, { '#': '#000' })}</clipPath>`
  const land = [
    '                                ',
    '     ##             #           ',
    '    ####          ####          ',
    '   ######        ######   ##    ',
    '  #######       #######  ####   ',
    '  ######         #####  #####   ',
    '   ####           ###    ###    ',
    '    ###           ####        # ',
    '     ##          ######      ## ',
    '      ##          #####     ### ',
    '      ###          ###      ##  ',
    '       ##           ##          ',
    '        #           #           ',
    '                         ##     ',
    '                        ####    ',
    '                                ',
  ]
  const inDisk = (i: number, j: number) => disk[j]?.[i] === '#'
  const rim = Array.from({ length: 18 }, (_, b) => Array.from({ length: 18 }, (_, a) => {
    const i = a - 1, j = b - 1
    return !inDisk(i, j) && (inDisk(i - 1, j) || inDisk(i + 1, j) || inDisk(i, j - 1) || inDisk(i, j + 1)) ? '#' : ' '
  }).join(''))
  const landRows = land.map(s => s + s) // две копии подряд — прокрутка без шва
  const shade: string[] = disk.map((row, j) => [...row].map((c, i) =>
    c === '#' && (i + 0.5 - 6.5) ** 2 + (j + 0.5 - 6.5) ** 2 > 8.2 ** 2 ? 's' : ' ').join(''))
  const scroll = Array.from({ length: 32 }, (_, k) => `${-2 * k} 0`).join(';')
  const globe = clip + `<g clip-path="url(#cw-web-globe)">` +
    px(GX, GY, 32, 32, C.blue) +
    g(pix(GX, GY, landRows, { '#': C.green }), move(scroll, `${D}s`, { calc: 'discrete' })) +
    g(pix(GX, GY, shade, { s: C.ink }), '', ' opacity="0.28"') +
    `</g>` + px(GX + 8, GY + 6, 4, 2, C.white) + px(GX + 6, GY + 8, 2, 2, C.white) +
    // вспышка приёма: белый ободок на точку снаружи круга (сам глобус не бледнеет)
    g(pix(GX - 2, GY - 2, rim, { '#': C.white }), fadeLin(D, [[0, '0'], [1.38, '0'], [1.45, '1'], [1.9, '0'], [D, '0']]), ' opacity="0"')
  const stand = px(GX + 14, 46, 4, 4, C.wood) + px(GX + 8, 50, 16, 4, C.wood) + px(GX + 8, 50, 16, 2, C.paperEdge)

  // ── Wi-Fi над глобусом: точка и три дуги, частят во время обмена ──
  const WX = GX + 4 // 24×12 px, центр над глобусом
  const arcs = [
    ['    ####    ', '   #    #   '],
    ['  ########  ', ' #        # '],
    ['############', '#          #'],
  ]
  const pulseAt = [0.2, 1.45, 1.95, 2.45, 2.95, 3.45, 3.95, 4.45, 4.95, 6.2, 7.2]
  const wifi = px(WX + 10, 10, 4, 2, C.blue) + arcs.map((rows, k) => {
    const y = 6 - k * 3
    const f: KF[] = [[0, '0.4']]
    for (const p0 of pulseAt) {
      const t = p0 + (2 - k) * 0.1 // от внутренней дуги к внешней
      f.push([t, '0.4'], [t + 0.08, '1'], [t + 0.4, '0.4'])
    }
    f.push([D, '0.4'])
    return g(pix(WX, y, rows, { '#': C.blue }), fadeLin(D, f), ' opacity="0.4"')
  }).join('')

  // ── пакеты данных по дуге ──
  const path: [number, number][] = [[298, 24], [262, 8], [222, 2], [182, 4], [150, 14], [134, 24]]
  const lens: number[] = [0]
  for (let i = 1; i < path.length; i++) lens.push(lens[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]))
  const total = lens[lens.length - 1]!
  const flight = (t0: number, fl: number, back: boolean): KF[] => {
    const pts = back ? [...path].reverse() : path
    const ls = back ? lens.map(l => total - l).reverse() : lens
    const f: KF[] = [[0, `${pts[0]![0]} ${pts[0]![1]}`]]
    pts.forEach((p, i) => f.push([t0 + (fl * ls[i]!) / total, `${p[0]} ${p[1]}`]))
    f.push([D, `${pts[pts.length - 1]![0]} ${pts[pts.length - 1]![1]}`])
    return f
  }
  const packet = (t0: number, fl: number, col: string, back = false) => g(
    px(0, 0, 6, 6, col) + px(back ? -4 : 8, 2, 2, 2, col) + px(0, 0, 2, 2, C.white),
    move(vals(flight(t0, fl, back)), `${D}s`, { calc: 'linear', keyTimes: kt(D, flight(t0, fl, back)) }) + vis(D, [[t0, t0 + fl]]),
    ' opacity="0"')
  const down: [number, number, string][] = [[1.75, 0.95, C.blue], [2.3, 0.85, C.green], [2.85, 0.9, C.purple], [3.5, 0.95, C.red], [4.15, 0.9, C.blue]]
  const packets = packet(0.6, 0.8, C.orange, true) + down.map(([t0, fl, c]) => packet(t0, fl, c)).join('')

  // ── окно браузера в правой руке (rel px: 64..112 × 0..32) ──
  const page = 66
  const skeleton = g(px(70, 12, 24, 4, C.paperEdge) + px(70, 18, 14, 8, C.paperEdge) +
    px(88, 18, 18, 2, C.paperEdge) + px(88, 22, 14, 2, C.paperEdge) + px(88, 26, 16, 2, C.paperEdge),
    fade('0.45;1;0.45', '1s'))
  const wipe = (x: number, y: number, w: number, h: number, col: string, t: number) =>
    px(x, y, 0, h, col, attrT('width', D, [[0, '0'], [t, '0'], [t + 0.25, String(w), EASE_OUT], [7.85, String(w)], [7.9, '0'], [D, '0']]))
  const content =
    wipe(70, 12, 24, 4, C.orange, 5.6) + wipe(70, 18, 14, 8, C.sky, 5.75) +
    shown(px(72, 22, 4, 4, C.green) + px(76, 24, 4, 2, C.green) + px(80, 20, 2, 2, C.yellow), D, [[5.95, 7.85]]) +
    wipe(88, 18, 18, 2, C.ink2, 5.85) + wipe(88, 22, 14, 2, C.ink2, 5.95) + wipe(88, 26, 16, 2, C.ink2, 6.05)
  const arrive = down.map(([t0, fl]) => t0 + fl)
  const bar = shown(px(page, 8, 44, 2, C.paperEdge) + px(page, 8, 0, 2, C.blue, attrT('width', D, [
    [0, '0'], [1.75, '0'], [2.0, '4', EASE_OUT], [arrive[0]!, '4'], [arrive[0]! + 0.15, '8', EASE_OUT],
    [arrive[1]!, '8'], [arrive[1]! + 0.15, '18', EASE_OUT], [arrive[2]!, '18'], [arrive[2]! + 0.15, '26', EASE_OUT],
    [arrive[3]!, '26'], [arrive[3]! + 0.15, '36', EASE_OUT], [arrive[4]!, '36'], [arrive[4]! + 0.15, '44', EASE_OUT],
    [6.0, '44'], [6.05, '0'], [D, '0'],
  ])), D, [[1.75, 5.6]])
  const url = px(82, 4, 26, 2, C.edge) + px(82, 4, 0, 2, C.white, attrD('width', D, [
    [0, '0'], [0.08, '4'], [0.16, '8'], [0.24, '10'], [0.34, '14'], [0.42, '18'], [0.5, '22'], [7.9, '0'],
  ]))
  const win = g(
    r(14, 3, 2, 2, C.orange) +
    px(64, 0, 48, 32, C.edge) + px(66, 2, 44, 6, C.ink2) +
    px(68, 4, 2, 2, C.red) + px(72, 4, 2, 2, C.yellow) + px(76, 4, 2, 2, C.green) + url +
    px(page, 8, 44, 22, C.white) + skeleton + content + bar,
    mvD(D, [[0, '0 0'], [0.1, '0 2'], [0.2, '0 0'], [0.3, '0 2'], [0.4, '0 0'], [0.5, '0 2'], [0.6, '0 0'],
      ...arrive.flatMap((a): KF[] => [[a, '0 2'], [a + 0.1, '0 0']])]))

  // ── Клод ──
  const upIv: Iv[] = [[0.85, 1.2], ...down.map(([t0, fl]): Iv => [t0 + 0.2 * fl, t0 + 0.6 * fl])]
  // взгляд: вверх-вправо за пакетами; при чтении — бегает по строкам (вправо / вправо-вниз)
  const face = clawd({ eyes: 'right', arms: 'none', legs: 'none', gear }) + eyesOver(gear, D, [
    ['upRight', upIv],
    ['happy', [[5.25, 6.3]]],
    ['downRight', [[6.45, 6.7], [6.95, 7.25], [7.45, 7.6]]],
    ['closed', [[7.62, 7.74]]],
  ])
  const armUp = r(0, 0, 2, 2, C.orange) + r(0, -1, 1, 1, C.orange)
  const leftArm = shown(r(0, 3, 2, 2, C.orange), D, complement(D, [[5.3, 6.3]])) +
    shown(g(armUp, move('0 0;0 2', '0.34s', { calc: 'discrete' })), D, [[5.3, 6.3]])
  // кивает на каждый принятый пакет, затем прыжок со сжатием
  const nods = arrive.slice(0, 4).flatMap((a): KF[] => [[a, '1 1'], [a + 0.08, '1.04 0.96', EASE_OUT], [a + 0.22, '1 1']])
  const sq: KF[] = [[0, '1 1'], ...nods, [5.15, '1 1'], [5.3, '1.1 0.88'], [5.42, '0.94 1.06', EASE_OUT], [5.55, '1 1'], [5.68, '1 1'],
    [5.76, '1.12 0.86', EASE_IN], [5.92, '0.98 1.02'], [6.05, '1 1'],
    [7.0, '1 1'], [7.08, '1.04 0.95', EASE_OUT], [7.22, '1 1'], [D, '1 1']] // кивок «понял» на чтении
  const sprite = squash(legsStand() + face + leftArm + win, vals(sq), `${D}s`, sp(D, sq))
  const actor = at(X, TOP, sprite, mvT(D, [[0, '0 0'], [5.42, '0 0'], [5.56, '0 -8', EASE_OUT], [5.72, '0 0', EASE_IN], [D, '0 0']]))

  const check = popGlyph('✓', 166, 9, C.green, 2, D, 5.2, 6.3)
  return wifi + stand + globe + packets + actor + check
}

// ── 3. Спрашивает: табличка «?» и ждёт ответа (6 с) ──────────────────────────
// t=0–0.5 смотрит на зрителя, 0.5–1.6 косится влево-вправо, 1.6–2.4 закатывает глаза и стучит ножкой,
// 2.6–3.5 «эй!»: машет второй рукой, глаза широкие, табличку трясёт, «!»; 3.7–4.4 качает табличкой вверх-вниз (^ ^),
// 4.6–5.4 снова постукивает ножкой; всё время над головой «…» — ждёт ответа.
export function sceneAsk(gear: Gear): string {
  const D = 6
  const X = 48

  // табличка на палочке в правой руке (rel px 60..88 × −12..20). Наклон без поворота (поворот рвёт пиксели):
  // доска из двух полос, верхняя уходит вбок на 4 px, нижняя на 2, хвост палки под кулаком — на 2 px в другую сторону,
  // кулак неподвижен — читается как наклон вокруг кулака.
  const Q = { top: [' ### ', '#   #', '   # '], bot: ['  #  ', '     ', '  #  '] }
  const qMark = (rows: string[], y: number, col: string) => pix(64, y, rows, { '#': col }, 4)
  const red: Iv[] = [[2.6, 3.5]]
  const boardTop = px(60, -12, 28, 16, C.wood) + px(62, -10, 24, 14, C.paper) +
    qMark(Q.top, -8, C.blue) + shown(qMark(Q.top, -8, C.red), D, red)
  const boardBot = px(60, 4, 28, 16, C.wood) + px(62, 4, 24, 12, C.paper) + px(62, 16, 24, 2, C.paperEdge) +
    qMark(Q.bot, 4, C.blue) + shown(qMark(Q.bot, 4, C.red), D, red)
  const stick = px(72, 20, 4, 16, C.wood)
  const hand = r(14, 4, 2, 2, C.orange) + r(16, 5, 3, 2, C.orange)
  // наклон k: −1 влево, 0 прямо, 1 вправо (дискретные кадры)
  const lean: [number, number][] = [[0, 0], [0.4, 1], [0.8, 0], [1.2, -1], [1.6, 0], [2.0, 1], [2.4, 0],
    [2.65, -1], [2.75, 1], [2.85, -1], [2.95, 1], [3.05, -1], [3.15, 1], [3.25, 0],
    [4.6, 1], [5.0, 0], [5.4, -1], [5.8, 0], [D, 0]]
  const leanBy = (m: number) => mvD(D, lean.map(([t, k]): KF => [t, `${k * m} 0`]))
  const sign = g(g(stick, leanBy(-2)) + g(boardBot, leanBy(2)) + g(boardTop, leanBy(4)) + hand,
    mvT(D, [[0, '0 0'], [3.7, '0 0'], [3.85, '0 4', EASE_OUT], [4.0, '0 0'], [4.15, '0 4', EASE_OUT], [4.32, '0 0'], [D, '0 0']]))

  // ноги: три стоят, правая постукивает (вверх на 4 px)
  const tapUp: Iv[] = [[1.65, 1.8], [1.95, 2.1], [2.25, 2.4], [4.65, 4.8], [4.95, 5.1], [5.25, 5.4]]
  const tapF: KF[] = [[0, '0 0']]
  for (const [a, b] of tapUp) tapF.push([a, '0 -4'], [b, '0 0'])
  const legs = [3, 6, 9].map(x => r(x, 7, 1, 3, C.orange)).join('') + g(r(12, 7, 1, 3, C.orange), mvD(D, tapF))

  // левая рука: опущена / машет «эй!»
  // машет: плечо поднято, кисть качается влево-вправо
  const wave = r(0, 1, 2, 2, C.orange) +
    g(r(-1, -1, 2, 2, C.orange), fade('1;0', '0.3s', { calc: 'discrete' })) +
    g(r(1, -1, 2, 2, C.orange), fade('0;1', '0.3s', { calc: 'discrete' }), ' opacity="0"')
  const leftArm = shown(r(0, 3, 2, 2, C.orange), D, complement(D, [[2.6, 3.5]])) + shown(wave, D, [[2.6, 3.5]])

  const face = clawd({ eyes: 'open', arms: 'none', legs: 'none', gear }) + eyesOver(gear, D, [
    ['left', [[0.5, 1.05]]],
    ['right', [[1.05, 1.6]]],
    ['up', [[1.6, 2.45]]],
    ['wide', [[2.6, 3.5]]],
    ['happy', [[3.65, 4.45]]],
    ['closed', [[5.5, 5.62]]],
  ])
  const sq: KF[] = [[0, '1 1'], [2.5, '1 1'], [2.6, '1.07 0.93', EASE_OUT], [2.75, '0.97 1.03'], [2.9, '1 1'],
    [3.7, '1 1'], [3.85, '1.03 0.97'], [4.0, '1 1'], [4.15, '1.03 0.97'], [4.32, '1 1'], [D, '1 1']]
  // дыхание: лёгкое сжатие-вытягивание с периодом 2 с (в 6 с ровно три вдоха — без шва)
  const breathe: KF[] = [[0, '1 1'], [1, '1.03 0.97'], [2, '1 1']]
  const sprite = squash(squash(legs + face + leftArm + sign, vals(sq), `${D}s`, sp(D, sq)), vals(breathe), '2s', sp(2, breathe))
  const actor = at(X, TOP, sprite)

  // пузырь «…» над головой: точки-клетки по очереди подпрыгивают и загораются
  const bx = X + 2
  const bubble = pix(bx, 0, [
    ' ################ ',
    '#wwwwwwwwwwwwwwww#',
    '#wwwwwwwwwwwwwwww#',
    '#wwwwwwwwwwwwwwww#',
    '#wwwwwwwwwwwwwwww#',
    ' ################ ',
    '   #w#            ',
  ], { '#': C.edge, w: C.white })
  const dots = [0, 1, 2].map(i => g(px(bx + 6 + i * 10, 4, 4, 4, C.ink2),
    move('0 0;0 -2;0 0;0 0', '1.2s', { calc: 'discrete', keyTimes: '0;0.15;0.3;1', begin: `${i * 0.2}s` }) +
    fade('0.55;1;0.55;0.55', '1.2s', { calc: 'discrete', keyTimes: '0;0.15;0.45;1', begin: `${i * 0.2}s` }), ' opacity="0.55"')).join('')

  const hey = popGlyph('!', X - 12, 8, C.red, 2, D, 2.65, 3.4)
  return actor + bubble + dots + hey
}
