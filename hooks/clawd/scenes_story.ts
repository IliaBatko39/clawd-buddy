// Clawd scenes, group "story". Each function returns the strip's content (without <svg>), see core.ts.
// Story scenes: compact (the conversation press, 36 s) and lost connection (plug into the socket, 8 s).
// All times are absolute seconds of the cycle T; keys are turned into keyTimes 0..1 by the helpers below.
import {
  type Gear, type Eyes, C, TOP,
  r, px, g, glyph, move, spin, scaleAnim, fade, attr, squash, clawd, legsStand, legsWalk,
} from './core'

// ── помощники таймлайна ──────────────────────────────────────────────────────

const LIN = '0 0 1 1'
// сплайны короче, чем в core (экономия размера SVG): плавно, разгон-торможение, торможение, разгон
const E = '.4 0 .6 1', EO = '0 0 .6 1', EI = '.4 0 1 1'
// число без ведущего нуля: 0.86 → .86
const nf = (n: number) => String(n).replace(/^(-?)0\./, '$1.')
// ближайшее чётное (сетка мелочей 2 px)
const ev = (n: number) => Math.round(n / 2) * 2
type Seg = [number, number]
type Key = [number, number[], string?] // [t, значения, сплайн входа в ключ]

// keyTimes с 3 знаками: соседние ключи через 0,01 с сливаются в мгновенный скачок (Chrome это допускает)
const ft = (t: number, T: number) => nf(Math.round((t / T) * 1000) / 1000)

// дискретные ступени [t, значение] (первая — t=0); одинаковые соседние склеиваются
function disc(pts: Array<[number, string]>, T: number) {
  const out: Array<[number, string]> = []
  for (const p of [...pts].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1]
    if (last && last[1] === p[1]) continue
    if (last && ft(last[0], T) === ft(p[0], T)) { out[out.length - 1] = p; continue }
    out.push(p)
  }
  return { values: out.map(p => p[1]).join(';'), keyTimes: out.map(p => ft(p[0], T)).join(';') }
}
const discAnim = (pts: Array<[number, string]>, T: number, mk: (v: string, d: string, o: { calc: 'discrete'; keyTimes: string }) => string) => {
  const d = disc(pts, T)
  return mk(d.values, `${T}s`, { calc: 'discrete', keyTimes: d.keyTimes })
}
const inside = (segs: Seg[], t: number) => segs.some(([a, b]) => t >= a && t < b)
// видимость по окнам времени
function show(inner: string, segs: Seg[], T: number): string {
  const ts = [0, ...segs.flat()].filter(t => t >= 0 && t < T)
  const pts = ts.map(t => [t, inside(segs, t) ? '1' : '0'] as [number, string])
  return g(inner, discAnim(pts, T, fade), inside(segs, 0) ? '' : ' opacity="0"')
}
// дополнение окон до [0,T]
function gaps(segs: Seg[], T: number): Seg[] {
  const s = [...segs].sort((a, b) => a[0] - b[0])
  const out: Seg[] = []
  let cur = 0
  for (const [a, b] of s) { if (a > cur) out.push([cur, a]); cur = Math.max(cur, b) }
  if (cur < T) out.push([cur, T])
  return out
}
// плавная дорожка по ключам (calc spline)
function trk(keys: Key[], T: number, fmt: (v: number[]) => string = v => v.map(nf).join(' ')) {
  const vals = keys.map(k => fmt(k[1]))
  return {
    values: vals.join(';'),
    keyTimes: keys.map(k => ft(k[0], T)).join(';'),
    // на участке без изменения значения сплайн не важен — короткий линейный
    keySplines: keys.slice(1).map((k, i) => vals[i] === vals[i + 1] ? LIN : k[2] ?? E).join(';'),
  }
}
// опции анимации по дорожке: все участки линейные → calc linear без keySplines (короче)
const opt = (k: ReturnType<typeof trk>) => k.keySplines.split(';').every(s => s === LIN)
  ? { calc: 'linear' as const, keyTimes: k.keyTimes }
  : { calc: 'spline' as const, keyTimes: k.keyTimes, keySplines: k.keySplines }
const moveK = (keys: Key[], T: number) => { const k = trk(keys, T); return move(k.values, `${T}s`, opt(k)) }
const attrK = (name: string, keys: Key[], T: number) => { const k = trk(keys, T); return attr(name, k.values, `${T}s`, opt(k)) }
const fadeK = (keys: Key[], T: number) => attrK('opacity', keys, T)
// поворот по ключам вокруг (cx, cy)
const spinK = (keys: Key[], cx: number, cy: number, T: number) => { const k = trk(keys, T, v => `${v[0]} ${cx} ${cy}`); return spin(k.values, `${T}s`, opt(k)) }
// сжатие/растяжение по ступеням [t, 'sx sy'] (плавно между ними)
const squashK = (inner: string, pts: Array<[number, string]>, T: number) => {
  const k = trk([...pts].sort((a, b) => a[0] - b[0]).map(([t, v]) => [t, v.split(' ').map(Number)] as Key), T)
  return squash(inner, k.values, `${T}s`, opt(k))
}
// вспышки-выбросы: из from в to за d с в моменты times (вне вспышек — в from, невидимо)
function burstMove(times: number[], d: number, from: number[], to: number[], T: number, s = EO): string {
  const keys: Key[] = [[0, from]]
  for (const t of times) keys.push([t, from, LIN], [t + d, to, s], [t + d + 0.01, from, LIN])
  keys.push([T, from, LIN])
  return moveK(keys, T)
}
function burstFade(times: number[], d: number, T: number, peak = 1): string {
  const keys: Key[] = [[0, [0]]]
  for (const t of times) keys.push([t, [0], LIN], [t + Math.min(0.12, d / 3), [peak], LIN], [t + d, [0], LIN])
  keys.push([T, [0], LIN])
  return fadeK(keys, T)
}
// веер искр из точки (cx, cy) тремя кольцами-кадрами (пиксели не масштабируются): близко → середина → далеко и чуть вниз;
// головы dirs жёлтые, хвосты к центру красные; vis(i) — анимация видимости i-го кольца
const RINGS: Array<[number, number, number]> = [[0.3, 0.12, 0], [0.62, 0.42, 0], [1, 0.76, 4]] // [голова, хвост, провис вниз px]
function sparkRings(cx: number, cy: number, dirs: Array<[number, number]>, vis: (i: number) => string): string {
  return `<g transform="translate(${cx},${cy})">` + RINGS.map(([h, t, dy], i) => g(
    pth(C.red, dirs.map(([x, y]) => [ev(x * t), ev(y * t + dy / 2), 2, 2] as Rc)) + pth(C.yellow, dirs.map(([x, y]) => [ev(x * h), ev(y * h + dy), 2, 2] as Rc)),
    vis(i), ' opacity="0"')).join('') + '</g>'
}
// кадры колец: доли 0..a, a..b, b..c от момента вспышки
const RING_T = [0, 0.1, 0.22, 0.4]
const nf2 = (n: number) => nf(Math.round(n * 1000) / 1000)
// поворот группы зеркалом по таймлайну (1 — вправо, -1 — влево) вокруг середины спрайта
function facing(inner: string, pts: Array<[number, string]>, T: number): string {
  return `<g transform="translate(32,0)"><g>${discAnim(pts, T, (v, d, o) => `<animateTransform attributeName="transform" type="scale" values="${v}" dur="${d}" calcMode="discrete" keyTimes="${o.keyTimes}" repeatCount="indefinite"/>`)}<g transform="translate(-32,0)">${inner}</g></g></g>`
}
// Клод с меняющимися глазами: копии clawd() по окнам (в очках глаза закрыты стёклами — одна копия)
function faces(gear: Gear, eyes: Array<[Eyes, Seg[]]>, T: number): string {
  if (gear.glasses) return clawd({ gear, arms: 'none', legs: 'none' })
  // базовая копия видна всегда; копии с другими глазами рисуются поверх (их тело закрывает базовые глаза)
  return clawd({ eyes: 'open', arms: 'none', legs: 'none' }) +
    eyes.map(([e, segs]) => show(clawd({ eyes: e, arms: 'none', legs: 'none', blink: false }), segs, T)).join('')
}
// ноги: стоит / шагает по окнам
const legsBy = (walk: Seg[], T: number) => show(legsStand(), gaps(walk, T), T) + show(legsWalk(), walk, T)
const ARMS_DOWN = r(0, 3, 2, 2, C.orange) + r(14, 3, 2, 2, C.orange)
const ARMS_UP = r(0, 0, 2, 2, C.orange) + r(0, -1, 1, 1, C.orange) + r(14, 0, 2, 2, C.orange) + r(15, -1, 1, 1, C.orange)

// много прямоугольников одного цвета одним <path> (x, y, w, h в px) — экономит размер SVG
type Rc = [number, number, number, number]
const pth = (fill: string, rs: Rc[], inner = '') => {
  const d = rs.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join('')
  return inner ? `<path d="${d}" fill="${fill}">${inner}</path>` : `<path d="${d}" fill="${fill}"/>`
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
// кристалл-«саммари» 8×8 px в точке (x, y)
const crystal = (x: number, y: number) =>
  pth(C.sky, [[x, y, 6, 6]]) + pth(C.blue, [[x + 6, y, 2, 8], [x, y + 6, 6, 2]]) + pth(C.white, [[x + 2, y + 2, 2, 2]])
// блёстка-крестик 6×6 px
const twinkle = (x: number, y: number, fill: string, dur: string, begin: string) =>
  pth(fill, [[x + 2, y, 2, 6], [x, y + 2, 6, 2]], fade('0;1;0;0', dur, { keyTimes: '0;0.25;0.5;1', begin }))
// мягкое свечение w×h вокруг кристалла
const glow = (x: number, y: number, w: number, h: number, dur: string) =>
  pth(C.sky, [[x, y, w, h]], fade('.2;.55;.2', dur))

// ── компакт: пресс переписки ─────────────────────────────────────────────────

// компакт: сжатие переписки (долгая сценка)
export function sceneCompact(gear: Gear): string {
  const T = 36
  const XB = 336 // у коробки «архив»
  const XS = 52 // у стопки
  const XP = 120 // у пресса (правая рука на рычаге)
  const XW = 108 // отступил от пресса — смотрит
  const XC = 316 // у конца конвейера
  const trips = [4.4, 6.8, 9.2, 11.6] // моменты, когда Клод берёт листы
  const drops = trips.map(p => p + 1.2) // бросает в окно пресса
  const PULL = 14.2 // дёрнул рычаг
  const SL1 = 14.7, SL2 = 16.2 // удары плиты (через 1,5 с — кратно циклу 36 с: искры и пар идут периодом 1,5 с)
  const LET = 16.5 // отпустил рычаг
  const CUBE_IN = 17.9, CUBE_PICK = 22.6, CUBE_BOX = 25.8, DONE = 26.4, RESET = 33
  const falls = [0, 1, 2, 3].map(j => 32.0 + 0.7 * j) // пачки по 2 листа сыплются сверху
  const N = 10 // листов в полной стопке (2 нижних остаются всегда)

  // ─ стопка переписки слева: 10 листов (40 px — выше Клода с каской), видимая высота — окно клипа
  const OFF = [0, 2, -2, 2, 0, -2, 2, 0, -2, 2]
  const sheetsArt = (ks: number[]) =>
    pth(C.white, ks.map(k => [8 + (OFF[k] ?? 0), 50 - 4 * k, 40, 2] as Rc)) +
    pth(C.paperEdge, ks.map(k => [8 + (OFF[k] ?? 0), 52 - 4 * k, 40, 2] as Rc)) +
    pth(C.edge, ks.flatMap(k => [[8 + (OFF[k] ?? 0), 50 - 4 * k, 2, 4], [46 + (OFF[k] ?? 0), 50 - 4 * k, 2, 4], [14 + (OFF[k] ?? 0) + (k % 3) * 4, 50 - 4 * k, 12 + (k % 2) * 6, 2]] as Rc[]))
  const sway = move('0 0;0 0;2 0;0 0;0 0;-2 0', '2.6s', { calc: 'discrete' })
  const nPts: Array<[number, string]> = [[0, String(54 - 4 * N)]]
  trips.forEach((p, j) => nPts.push([p, String(54 - 4 * (N - 2 * (j + 1)))]))
  falls.forEach((f, j) => nPts.push([f + 0.35, String(54 - 4 * (2 + 2 * (j + 1)))]))
  const stackClip = `<clipPath id="cw-compact-stack"><rect x="0" y="14" width="70" height="44">${discAnim(nPts, T, (v, d, o) => attr('y', v, d, o))}</rect></clipPath>`
  const stack = stackClip + `<g clip-path="url(#cw-compact-stack)">` +
    sheetsArt([0, 1, 2, 3, 4]) + g(sheetsArt([5, 6, 7, 8, 9]), sway) + '</g>' +
    // одна падающая пачка (2 листа) — 4 раза, каждый раз садится на 8 px выше
    show(g(sheetsArt([0, 1]), moveK([[0, [0, -50]], ...falls.flatMap((f, j) => [[f, [0, -50], LIN], [f + 0.35, [0, -8 * (j + 1)], EI], [f + 0.36, [0, -50], LIN]] as Key[]), [T, [0, -50], LIN]], T)),
      falls.map(f => [f, f + 0.36] as Seg), T)

  // ─ пресс (x 184..290): станина с окном загрузки слева, стол, плита на штоке, шестерни, манометр, лампа, прогресс, выхлоп
  const gearArt = (cx: number, cy: number, s: number, keys: Key[]) =>
    g(pth(C.grey, [[cx - s, cy - s, 2 * s, 2 * s], [cx - 2, cy - s - 2, 4, 2 * s + 4], [cx - s - 2, cy - 2, 2 * s + 4, 4]]) + pth(C.ink2, [[cx - 2, cy - 2, 4, 4]]),
      spinK(keys, cx, cy, T))
  const gears =
    gearArt(194, 8, 4, [[0, [0]], [14.4, [0]], [18.0, [720], EI], [21.8, [900], EO], [21.81, [0], LIN], [T, [0]]]) +
    gearArt(208, 6, 2, [[0, [0]], [14.4, [0]], [18.0, [-1080], EI], [21.8, [-1350], EO], [21.81, [0], LIN], [T, [0]]])
  // плита: вверх-упреждение, удар, второй удар, затем уходит высоко (освобождает стол под кристалл) и опускается в покой
  const ram: Key[] = [[0, [0, 0]], [PULL, [0, 0]], [14.45, [0, -2], EO], [SL1, [0, 10], EI], [15.3, [0, 10]], [15.85, [0, -2]],
    [SL2, [0, 10], EI], [16.9, [0, 10]], [17.6, [0, -6]], [19.6, [0, -6]], [20.4, [0, 0]], [T, [0, 0]]]
  const ramArt = g(pth(C.grey, [[218, 12, 8, 14]]) + pth(C.ink2, [[200, 28, 44, 4]]) + pth(C.edge, [[200, 26, 44, 2]]) + pth(C.red, [[204, 30, 36, 2]]), moveK(ram, T))
  // стол со стопкой заброшенных листов (по одному на рейс) и сплющенный «пласт» после удара
  const pileY = disc([[0, '42'], ...drops.map((d, k) => [d + 0.34, String(40 - 2 * k)] as [number, string]), [SL1, '42']], T)
  const pile = `<clipPath id="cw-compact-pile"><rect x="200" y="42" width="44" height="12">${attr('y', pileY.values, `${T}s`, { calc: 'discrete', keyTimes: pileY.keyTimes })}</rect></clipPath>` +
    `<g clip-path="url(#cw-compact-pile)">${pth(C.white, [[202, 40, 38, 2], [202, 36, 38, 2]])}${pth(C.paperEdge, [[204, 38, 38, 2], [204, 34, 38, 2]])}</g>`
  // летящий лист: с рук над головой вперёд-вниз и в окно загрузки на уровне стола (под стойкой, не над крышей)
  const sheet = (inner = '') => g(pth(C.white, [[0, 0, 40, 2]]) + pth(C.paperEdge, [[0, 2, 40, 2]]) + pth(C.edge, [[0, 0, 2, 4], [38, 0, 2, 4], [6, 0, 14, 2]]), inner)
  // (рейсы через 2,4 с — кратно циклу: полёт один и тот же, периодом 2,4 с, видим только в окна бросков)
  const flyer = show(sheet(move('130 0;150 16;176 34;202 38;202 38', '2.4s',
    { calc: 'spline', keyTimes: '0;.05;.1;.142;1', keySplines: `${EO};${LIN};${EO};${LIN}`, begin: `${nf(Math.round((drops[0]! % 2.4) * 100) / 100)}s` })),
    drops.map(d => [d, d + 0.34] as Seg), T)
  const slab = show(pth(C.yellow, [[204, 40, 36, 2]]) + pth(C.white, [[210, 40, 6, 2]]), [[SL1, CUBE_IN]], T)
  // манометр: стрелка вскидывается на ударах
  const gauge = pth(C.red, [[256, 20, 2, 6]], spinK([[0, [-40]], [14.5, [-40]], [SL1 + 0.1, [55], EO], [15.7, [35]],
    [SL2 + 0.1, [75], EO], [18.6, [15]], [23, [-30]], [T, [-40]]], 257, 26, T)) + pth(C.ink, [[256, 24, 2, 2]])
  const lamp = show(pth(C.green, [[266, 20, 8, 8]]) + pth(C.white, [[268, 22, 2, 2]]), [[DONE, RESET]], T)
  const progW = disc([[0, '0'], [SL1, '8'], [SL2, '16'], [CUBE_IN, '24'], [20, '28'], [CUBE_PICK, '32'], [24.4, '36'], [DONE, '40'], [RESET, '0']], T)
  const progress =
    `<rect x="202" y="12" width="0" height="4" fill="${C.green}">${attr('width', progW.values, `${T}s`, { calc: 'discrete', keyTimes: progW.keyTimes })}</rect>`
  const check = show(glyph('✓', 260, 0, C.green), [[DONE, 27.0], [27.25, 27.8], [28.0, 32.8]], T)
  // рычаг у левой стойки: вверху / дёрнут вниз (180° вокруг оси — ровно в пиксели), отпущен — пружинит
  const lever = g(pth(C.grey, [[180, 18, 2, 12]]) + pth(C.red, [[178, 14, 4, 4]]),
    discAnim([[0, '0 182 30'], [PULL, '180 182 30'], [LET, '-20 182 30'], [LET + 0.1, '12 182 30'], [LET + 0.2, '-6 182 30'], [LET + 0.3, '0 182 30']], T, spin)) +
    pth(C.ink2, [[180, 28, 4, 4]])
  // неподвижные части пресса — по одному <path> на цвет (порядок цветов = порядок слоёв)
  const frame =
    pth(C.ink2, [[188, 18, 8, 12], [248, 18, 28, 14], [184, 12, 92, 6], [190, 46, 84, 8], [276, 22, 10, 6], [286, 18, 4, 14]]) +
    pth(C.edge, [[188, 18, 2, 12], [188, 28, 8, 2], [274, 18, 2, 14], [248, 32, 28, 2], [214, 18, 16, 2], [184, 10, 92, 2], [188, 42, 88, 2], [190, 46, 2, 8],
      [250, 18, 16, 16], [266, 20, 8, 8], [184, 28, 4, 4], [276, 20, 10, 2], [276, 28, 10, 2], [290, 18, 2, 14]]) +
    pth(C.white, [[252, 20, 12, 10]]) + pth(C.paperEdge, [[252, 30, 12, 2]]) + pth('#151515', [[268, 22, 4, 4], [200, 12, 44, 4]]) +
    pth(C.grey, [[188, 44, 88, 2]]) +
    pth(C.yellow, [[194, 50, 8, 2], [218, 50, 8, 2], [242, 50, 8, 2]]) + pth(C.ink, [[206, 50, 8, 2], [230, 50, 8, 2], [254, 50, 8, 2]])
  // тряска машины на ударах
  const shakePts: Array<[number, string]> = [[0, '0 0']]
  for (const s of [SL1, SL2]) ['2 0', '-2 0', '2 0', '-2 0', '0 0'].forEach((v, i) => shakePts.push([s + i * 0.07, v]))
  const machine = g(gears + ramArt + pile + slab + frame + gauge + lamp + progress + lever, discAnim(shakePts, T, move))
  // пар из бокового выхлопа: 3 клуба за удар (период 1,5 с), растут и уходят вправо-вверх; белый верх, серый низ — видно на обеих темах
  const puff = (b: number) => `<g transform="translate(296,24)">` + g(
    g(pth(C.steam, [[-4, -6, 8, 2], [-6, -4, 2, 4], [4, -4, 2, 4]]) + pth(C.white, [[-4, -4, 8, 4]]) + pth(C.grey, [[-4, 0, 8, 2]]),
      scaleAnim('.6 .6;1.8 1.8', '1.5s', { begin: `${b}s` })),
    move('0 0;36 -14', '1.5s', { calc: 'spline', keyTimes: '0;1', keySplines: EO, begin: `${b}s` }) + fade('1;.9;0', '1.5s', { keyTimes: '0;.5;1', begin: `${b}s` }), ' opacity="0"') + '</g>'
  const steam = g(puff(1.2) + puff(1.7) + puff(2.2),
    fadeK([[0, [0]], [SL1 - 0.05, [0], LIN], [SL1 + 0.25, [1], LIN], [18.2, [1], LIN], [18.9, [0], LIN], [T, [0], LIN]], T), ' opacity="0"')
  // искры из-под плиты на ударах: два веера (жёлтые головы, красные хвосты), период 1,5 с совпадает с ударами
  const spB = `${nf(Math.round((SL1 % 1.5) * 100) / 100)}s`
  const sparks = show(
    sparkRings(222, 40, [[-44, 0], [-36, -12], [-26, -22], [-12, -28], [4, -30], [16, -26], [28, -20], [38, -10], [44, 0], [-22, 2], [-18, -14], [24, -8]],
      i => fade(i ? '0;1;0' : '1;0', '1.5s', { calc: 'discrete', keyTimes: i ? `0;${nf2(RING_T[i]! / 1.5)};${nf2(RING_T[i + 1]! / 1.5)}` : `0;${nf2(RING_T[1]! / 1.5)}`, begin: spB })),
    [[SL1 - 0.05, 16.8]], T)

  // ─ конвейер (x 290..388) с бегущими полосками ленты и кристаллом
  const belt: Key[] = [[0, [0, 0]], [18.35, [0, 0]], [21.8, [160, 0], LIN], [23.0, [160, 0]], [23.01, [0, 0], LIN], [T, [0, 0]]]
  const stripeRs: Rc[] = []
  for (let x = 116; x < 388; x += 16) stripeRs.push([x, 42, 6, 2])
  const conveyor =
    `<clipPath id="cw-compact-belt"><rect x="276" y="42" width="112" height="2"/></clipPath>` +
    pth(C.grey, [[276, 42, 112, 2], [278, 46, 4, 4], [382, 46, 4, 4]]) + `<g clip-path="url(#cw-compact-belt)">${pth(C.ink2, stripeRs, moveK(belt, T))}</g>` +
    pth(C.ink2, [[276, 46, 112, 2]]) + pth(C.edge, [[276, 44, 112, 2], [292, 48, 4, 6], [368, 48, 4, 6]])
  // кристалл появляется на столе (плита уже высоко), подпрыгивает и едет по ленте
  const cubeKeys: Key[] = [[0, [218, 34]], [CUBE_IN, [218, 34]], [18.05, [218, 28], EO], [18.25, [218, 34], EI], [18.35, [218, 34]],
    [21.8, [378, 34], LIN], [23.0, [378, 34]], [23.01, [218, 34], LIN], [T, [218, 34]]]
  const cube = show(g(glow(-2, 0, 12, 8, '0.9s') + crystal(0, 0) + twinkle(-8, -6, C.yellow, '1.1s', '0s') + twinkle(12, -8, C.white, '1.3s', '0.4s'),
    moveK(cubeKeys, T)), [[CUBE_IN, CUBE_PICK]], T)

  // ─ коробка «архив» (x 396..452): створки открыты, пока Клод кладёт кристалл
  const FLAPS: Seg = [25.0, 26.6]
  const boxCube = show(g(crystal(0, 0), moveK([[0, [400, 22]], [CUBE_BOX, [400, 22]], [26.1, [420, 38], EI], [26.11, [400, 22], LIN], [T, [400, 22]]], T)), [[CUBE_BOX, 26.1]], T)
  const box =
    show(pth(C.wood, [[396, 22, 4, 12], [448, 22, 4, 12]]), [FLAPS], T) +
    show(pth(C.wood, [[398, 30, 52, 4]]) + pth('#a8754f', [[398, 30, 52, 2]]), gaps([FLAPS], T), T) +
    pth(C.wood, [[400, 34, 48, 20]]) + pth('#a8754f', [[400, 34, 48, 2], [420, 36, 8, 18]]) + pth(C.paper, [[406, 40, 10, 8]]) + pth(C.edge, [[408, 42, 6, 2]])

  // ─ Клод: каска, позы рук, глаза, ноги, движение
  const xKeys: Key[] = [[0, [XB, TOP]], [0.3, [XB, TOP]], [3.3, [XS, TOP]]]
  const face: Array<[number, string]> = [[0, '-1 1']]
  const walk: Seg[] = [[0.3, 3.3]]
  trips.forEach((p, k) => {
    xKeys.push([p + 0.3, [XS, TOP]], [p + 1.1, [XP, TOP]])
    face.push([p + 0.2, '1 1'])
    walk.push([p + 0.3, p + 1.1])
    if (k < trips.length - 1) {
      xKeys.push([p + 1.7, [XP, TOP]], [p + 2.3, [XS, TOP]])
      face.push([p + 1.6, '-1 1'])
      walk.push([p + 1.7, p + 2.3])
    }
  })
  // отпустил рычаг и отпрыгнул назад, потом к конвейеру, к коробке, прыжок радости
  xKeys.push([LET + 0.05, [XP, TOP]], [16.75, [114, TOP - 4], EO], [16.95, [XW, TOP], EI],
    [19.0, [XW, TOP]], [22.0, [XC, TOP]], [24.8, [XC, TOP]], [25.4, [XB, TOP]], [28.8, [XB, TOP]], [29.0, [XB, TOP - 6], EO], [29.3, [XB, TOP], EI],
    [29.75, [XB, TOP]], [29.85, [XB, TOP - 3], EO], [29.95, [XB, TOP], EI], [T, [XB, TOP]])
  face.push([31.6, '-1 1'])
  walk.push([19.0, 22.0], [24.8, 25.4])

  const sq: Array<[number, string]> = [[0, '1 1']]
  for (const p of trips) sq.push([p - 0.25, '1 1'], [p - 0.05, '1.12 .86'], [p + 0.25, '1 1'])
  sq.push([13.9, '1 1'], [14.1, '.96 1.04'], [PULL + 0.05, '1.12 .86'], [14.45, '.96 1.04'], [SL1 - 0.02, '1 1'])
  for (const s of [SL1, SL2]) sq.push([s + 0.08, '1.1 .9'], [s + 0.3, '1 1'])
  sq.push([LET + 0.05, '1 1'], [16.62, '1.1 .9'], [16.78, '.94 1.06'], [16.98, '1.1 .9'], [17.15, '1 1'],
    [17.85, '1 1'], [17.95, '.92 1.1'], [18.2, '1 1'],
    [22.3, '1 1'], [22.55, '1.12 .86'], [22.75, '.95 1.05'], [22.9, '1 1'],
    [25.4, '1 1'], [25.7, '1.1 .9'], [26.0, '1 1'],
    [28.6, '1 1'], [28.8, '1.15 .85'], [28.9, '.94 1.06'], [29.0, '1 1'], [29.3, '1.15 .85'], [29.5, '1 1'],
    [29.75, '.95 1.05'], [29.95, '1.08 .92'], [30.1, '1 1'],
    [32.1, '1 1'], [32.25, '.94 1.07'], [32.5, '1 1'], [34.2, '1 1'], [34.45, '1.05 .95'], [34.8, '1 1'], [T, '1 1'])

  const carry: Seg[] = trips.map((p, k) => [p - 0.05, drops[k]!] as Seg)
  const LEVER_UP: Seg = [13.6, PULL], LEVER_DOWN: Seg = [PULL, LET]
  const HOLD: Seg = [CUBE_PICK, CUBE_BOX], WIPE: Seg = [26.8, 28.4], CHEER: Seg = [28.6, 30.2]
  const OR = C.orange
  const arms =
    show(ARMS_DOWN, gaps([...carry, LEVER_UP, LEVER_DOWN, HOLD, WIPE, CHEER], T), T) +
    // лист над головой: 4 px толщиной, на 2 px выше каски, ходит в руках; кисти поверх листа
    show(pth(OR, [[0, 4, 8, 8], [4, -4, 4, 8], [56, 4, 8, 8], [56, -4, 4, 8]]) +
      g(pth(C.white, [[10, -14, 44, 2]]) + pth(C.paperEdge, [[10, -12, 44, 2]]) + pth(C.edge, [[10, -14, 2, 4], [52, -14, 2, 4], [16, -14, 14, 2], [34, -14, 8, 2]]),
        move('0 0;2 0;0 0;-2 0', '0.6s', { calc: 'discrete' })) +
      pth(OR, [[8, -12, 4, 8], [52, -12, 4, 8]]), carry, T) +
    show(pth(OR, [[0, 12, 8, 8], [56, 8, 8, 8], [60, 4, 4, 4]]), [LEVER_UP], T) +
    show(pth(OR, [[0, 12, 8, 8], [56, 16, 8, 8], [60, 24, 4, 4]]), [LEVER_DOWN], T) +
    show(pth(OR, [[0, 12, 8, 8], [56, 12, 8, 8], [64, 16, 8, 4]]) + glow(62, 6, 12, 12, '0.8s') + crystal(64, 8), [HOLD], T) +
    // вытирает пот: рука у виска ↔ ладонь по лбу над глазами (не шире тела)
    show(pth(OR, [[0, 12, 8, 8], [56, 4, 8, 8]]) +
      pth(OR, [[60, -4, 4, 8]], fade('1;0', '0.4s', { calc: 'discrete' })) +
      pth(C.orangeDark, [[38, 8, 18, 4]], fade('0;1', '0.4s', { calc: 'discrete' })), [WIPE], T) +
    show(ARMS_UP, [CHEER], T)
  const hat = pth(C.yellow, [[20, -8, 24, 4], [12, -4, 40, 2]]) + pth('#c98a1c', [[12, -2, 40, 2], [30, -8, 2, 6]]) + pth('#fff3c4', [[24, -8, 4, 2]])
  const body = faces(gear, [
    ['right', [[3.3, 4.2], [13.0, 13.9], [15.6, SL2], [17.15, CUBE_IN], [22.0, 22.6], [30.4, 31.4], [31.6, 32.1]]],
    ['closed', [[PULL, 14.45], [SL1, 15.0], [SL2, LET], [26.8, 28.4], [34.2, 34.8]]],
    ['wide', [[14.45, SL1], [15.0, 15.6], [CUBE_IN, 18.6], [CUBE_PICK, 23.4], [32.1, 34.2]]],
    ['happy', [[LET, 17.15], [23.4, 25.0], [25.8, 26.8], [28.4, 30.4]]],
  ], T)
  const rig = facing(legsBy(walk, T) + body + hat + arms, face, T)
  // значок «!» у головы (не зеркалится): кристалл появился, сверху сыплются листы
  const bang = show(glyph('!', 66, -14, C.red), [[CUBE_IN, 18.6]], T) + show(glyph('!', -10, -14, C.red), [[32.1, 32.9]], T)
  const clawdAll = g(squashK(rig, sq, T) + bang, moveK(xKeys, T))

  // эмоции поверх: ♥ над кристаллом, ♪ на прыжке, капля пота при вытирании и при новой стопке
  const heart = show(g(glyph('♥', 388, 2, C.red), move('0 2;0 0', '.5s', { calc: 'discrete' })), [[23.6, 24.9]], T)
  const note = show(g(glyph('♪', 316, 2, C.purple), move('0 0;-2 -2', '.4s', { calc: 'discrete' })), [[28.9, 29.9]], T)
  const sweat = show(pth(C.sky, [[398, 16, 2, 4], [400, 18, 2, 2]], move('0 0;4 4;8 10;12 18', '.6s', { calc: 'discrete' })), [[27.3, 27.9]], T) +
    show(pth(C.sky, [[340, 12, 2, 4], [338, 14, 2, 2]], move('0 0;0 2;0 4;0 4', '0.9s', { calc: 'discrete' })), [[32.5, 35.4]], T)

  return pack(stack + machine + conveyor + cube + boxCube + box + clawdAll + flyer + heart + note + sweat + steam + sparks + check)
}


// ── разрыв соединения ─────────────────────────────────────────────────────────

// пиксельная иконка Wi-Fi (клетка 2 px), левый верх (x, y)
function wifi(x: number, y: number, fill: string): string {
  const rows = ['  #####  ', ' #     # ', '#  ###  #', '  #   #  ', '         ', '    #    ']
  let s = ''
  rows.forEach((row, yy) => { for (let xx = 0; xx < row.length; xx++) if (row[xx] === '#') s += px(x + xx * 2, y + yy * 2, 2, 2, fill) })
  return s
}

// разрыв соединения / повтор запроса
export function sceneOffline(gear: Gear): string {
  const T = 8
  const CX = 124 // где стоит Клод
  const MISS = 2.2, IN = 3.6, POP = 4.6
  // Клод: присел за вилкой, прицелился, промах (отскок), вставил, вилка выскочила
  const xk: Key[] = [[0, [CX]], [1.3, [CX]], [1.6, [120]], [2.0, [120]], [MISS, [124], EI], [2.4, [116], EO], [2.9, [118]],
    [IN, [124], EI], [POP, [124]], [4.8, [120], EO], [6.4, [120]], [7.4, [CX]], [T, [CX]]]
  // вилка (левый верх) — пока в руке, x = Клод + 66; поднимается только когда рука её схватила
  const pk: Key[] = [[0, [176, 44]], [1.15, [176, 44]], [1.6, [186, 38], EO], [2.0, [186, 38]], [MISS, [190, 30], EI], [2.4, [182, 30], EO],
    [2.9, [184, 38]], [IN, [190, 38], EI], [POP, [190, 38]], [4.85, [188, 10], EO], [5.2, [178, 44], EI], [5.35, [176, 40], EO],
    [5.5, [176, 44], EI], [T, [176, 44]]]
  // вилка с кромкой по всем сторонам (видна на тёмной теме), латунные штыри
  const plug = g(px(0, 0, 8, 10, C.edge) + px(2, 2, 4, 6, C.ink2) + px(8, 2, 4, 2, C.yellow) + px(8, 6, 4, 2, C.yellow), moveK(pk, T))
  // кабель: по полу до вилки и стояк к ней
  const ck = (f: (v: number[]) => number) => trk(pk, T, v => String(f(v)))
  const cW = ck(v => v[0]! - 2), rX = ck(v => v[0]! - 2), rY = ck(v => v[1]! + 4), rH = ck(v => 50 - v[1]!)
  const cable =
    `<rect x="0" y="52" width="174" height="2" fill="${C.grey}">${attr('width', cW.values, `${T}s`, opt(cW))}</rect>` +
    `<rect x="174" y="48" width="2" height="6" fill="${C.grey}">${attr('x', rX.values, `${T}s`, opt(rX))}${attr('y', rY.values, `${T}s`, opt(rY))}${attr('height', rH.values, `${T}s`, opt(rH))}</rect>`

  // роутер с антенной и розеткой (x 196..244)
  const OK: Seg = [IN + 0.05, POP]
  const router =
    px(200, 38, 44, 16, C.ink2) + px(200, 38, 44, 2, C.edge) + px(242, 38, 2, 16, C.edge) +
    px(214, 46, 4, 2, C.ink) + px(222, 46, 4, 2, C.ink) +
    g(px(230, 46, 4, 2, C.red), fade('1;0.2;1', '0.6s', { calc: 'discrete' })) +
    show(px(214, 46, 4, 2, C.greenLight) + px(222, 46, 4, 2, C.greenLight) + px(230, 46, 4, 2, C.greenLight), [OK], T) +
    // антенна качается, когда вилка выскакивает: три пиксельных кадра (прямо / наклон влево / вправо) ступенькой от основания
    show(px(236, 20, 2, 18, C.edge) + px(234, 16, 6, 4, C.red), gaps([[POP, POP + 0.48]], T), T) +
    show(px(236, 32, 2, 6, C.edge) + px(234, 26, 2, 6, C.edge) + px(232, 20, 2, 6, C.edge) + px(228, 16, 6, 4, C.red), [[POP, POP + 0.12], [POP + 0.24, POP + 0.36]], T) +
    show(px(236, 32, 2, 6, C.edge) + px(238, 26, 2, 6, C.edge) + px(240, 20, 2, 6, C.edge) + px(238, 16, 6, 4, C.red), [[POP + 0.12, POP + 0.24], [POP + 0.36, POP + 0.48]], T) +
    px(196, 36, 10, 14, C.white) + px(196, 36, 10, 2, C.paperEdge) + px(196, 48, 10, 2, C.paperEdge) + px(196, 36, 2, 14, C.paperEdge) +
    px(200, 40, 2, 2, C.ink) + px(200, 44, 2, 2, C.ink)
  const flash = g(px(192, 30, 56, 24, C.green), fadeK([[0, [0]], [IN, [0], LIN], [IN + 0.08, [0.45], LIN], [IN + 0.5, [0], LIN], [T, [0], LIN]], T), ' opacity="0"')
  // Wi-Fi: серый с мигающим ✗; на миг зелёный с полосками сигнала
  const bad = gaps([OK], T)
  const wifiIcon = show(wifi(206, 2, C.grey), bad, T) + show(wifi(206, 2, C.green), [OK], T) +
    show(g(glyph('✗', 226, 2, C.red), fade('1;1;0', '0.7s', { calc: 'discrete', keyTimes: '0;0.6;0.8' })), bad, T) +
    [0, 1, 2].map(i => show(px(228 + i * 6, 10 - i * 4, 4, 4 + i * 4, C.green), [[IN + 0.1 + i * 0.15, POP]], T)).join('')
  // бегущие «…» на полу справа: заметная база, на пике — полная яркость и подскок
  const dots = [0, 1, 2].map(i => g(px(256 + i * 8, 48, 4, 4, C.grey),
    fade('.45;1;.45;.45', '1.2s', { keyTimes: '0;.2;.5;1', begin: `${i * 0.2}s` }) + move('0 0;0 -2;0 0;0 0', '1.2s', { calc: 'discrete', keyTimes: '0;.1;.3;1', begin: `${i * 0.2}s` }),
    ' opacity=".45"')).join('')
  // искры промаха (веер жёлто-красных с хвостами) и вспышка контакта
  const sparks =
    sparkRings(198, 36, [[-20, -12], [-10, -22], [4, -24], [16, -14], [-22, 2], [18, 0], [10, -6]],
      i => discAnim([[0, '0'], [MISS + RING_T[i]!, '1'], [MISS + RING_T[i + 1]!, '0']], T, fade)) +
    g(glyph('*', 192, 30, C.yellow), burstFade([MISS], 0.25, T), ' opacity="0"') +
    ([[196, 38, -8, -8, C.greenLight], [196, 46, -8, 6, C.greenLight]] as const)
      .map(([x, y, dx, dy, f]) => g(px(x, y, 2, 2, f), burstMove([IN], 0.35, [0, 0], [dx, dy], T) + burstFade([IN], 0.35, T), ' opacity="0"')).join('')

  // Клод
  const LOW: Seg = [0.8, 1.45], REACH: Seg[] = [[1.45, MISS - 0.15], [2.6, POP]], HIGH: Seg = [MISS - 0.15, 2.6]
  const arms =
    show(ARMS_DOWN, gaps([LOW, ...REACH, HIGH], T), T) +
    show(r(0, 3, 2, 2, C.orange) + r(14, 6, 3, 2, C.orange), [LOW], T) +
    show(r(0, 3, 2, 2, C.orange) + r(14, 5, 3, 2, C.orange), REACH, T) +
    show(r(0, 3, 2, 2, C.orange) + r(14, 3, 3, 2, C.orange), [HIGH], T)
  const body = faces(gear, [
    ['wide', [[0, 0.6], [POP, 5.4], [7.6, T]]],
    ['right', [[1.6, MISS], [2.9, IN], [7.2, 7.6]]],
    ['dizzy', [[MISS, 2.9], [5.4, 6.0]]],
    ['happy', [[IN + 0.1, POP]]],
    ['closed', [[6.0, 6.6]]],
    ['left', [[6.6, 7.2]]],
  ], T)
  // присел глубоко за вилкой (рука достаёт до неё), промах — отдача, вставил, выскочила — вздрогнул, вздох — осел
  const sq: Array<[number, string]> = [[0, '1 1'], [0.6, '1 1'], [0.95, '1.16 .8'], [1.2, '1.16 .8'], [1.45, '.96 1.04'], [1.6, '1 1'],
    [MISS - 0.05, '.94 1.06'], [2.35, '1.1 .9'], [2.6, '1 1'], [IN - 0.1, '.94 1.07'], [IN + 0.1, '1.06 .94'], [IN + 0.3, '1 1'],
    [POP, '1 1'], [4.7, '.92 1.08'], [4.9, '1.06 .95'], [5.1, '1 1'], [6.0, '1 1'], [6.2, '1.08 .9'], [6.6, '1.08 .9'], [6.8, '1 1'], [T, '1 1']]
  const xk2 = trk(xk, T, v => `${v[0]} ${TOP}`)
  const rig = legsStand() + body + arms
  // значки над головой: «?» — смотрит на кабель; в очках глаз не видно — промах ✗ и контакт ✓ значками
  const marks = show(glyph('?', 26, -14, C.purple), [[6.7, 7.4]], T) +
    (gear.glasses ? show(glyph('✗', 26, -12, C.red), [[MISS, 2.9]], T) + show(glyph('✓', 26, -12, C.green), [[IN + 0.1, POP]], T) : '')
  const clawdAll = g(squashK(rig, sq, T) + marks, move(xk2.values, `${T}s`, opt(xk2)))
  // капля пота у виска (не на радостном миге) и «!» при выскакивании
  const sweat = show(g(px(0, 0, 2, 4, C.sky) + px(-2, 2, 2, 2, C.sky), move('0 0;0 2;0 4;0 6;0 6', '1.1s', { calc: 'discrete' })),
    gaps([OK], T), T)
  const sweatAt = g(sweat, moveK(xk.map(k => [k[0], [k[1][0]! + 4, 16], k[2]] as Key), T))
  const bang = show(glyph('!', 176, 0, C.red), [[POP + 0.05, 5.6]], T)

  return pack(cable + router + flash + clawdAll + plug + sweatAt + wifiIcon + dots + sparks + bang)
}
