// Pixel Clawd above the prompt: following what the session does, he thinks, works in the terminal, edits a file,
// searches with a magnifier, browses the web, asks the user, compacts the conversation, fixes the connection,
// recalls and memorizes at the memory cabinet, celebrates the end of a turn, walks, drinks coffee, sleeps;
// mini-Clawds work beside him while subagents run. In ultra mode he wears cool black sunglasses.
// The scenes live in ./clawd/*; this file picks the scene and assembles the SVG.

import type { BuddyMode } from '../types'
import {
  C, CELEBRATE_S, CH_W, COFFEE_S, EASE, EASE_OUT, type Gear, NO_GEAR, P, STRIP_H, STRIP_W, TOP, WALK_S, at, clawd, fade, g, glyph,
  mirror, move, px, scaleAnim, strip,
} from './clawd/core'
import { SCENE_META, type SceneMeta } from './clawd/meta'
import { sceneCelebrate, sceneCoffee, sceneSleep, sceneWalk } from './clawd/scenes_rest'
import { sceneAsk, sceneSearch, sceneWeb } from './clawd/scenes_find'
import { sceneMemorize, sceneRecall } from './clawd/scenes_memory'
import { sceneCompact, sceneOffline } from './clawd/scenes_story'
import { helperAt, helpers, sceneEdit, sceneThink, sceneWork } from './clawd/scenes_work'

export { NO_GEAR, STRIP_H, STRIP_W }
export type { Gear }

// ── инструмент → сцена ────────────────────────────────────────────────────────

export type ToolKind = 'search' | 'web' | 'edit' | 'work' | 'ask' | 'recall' | 'memorize'

const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'Read', 'ToolSearch', 'LS'])
// MCP servers that go to the web or drive a browser
const WEB_SERVER_RE = /^mcp__(?:claude-in-chrome|chrome-devtools|playwright|scrapling|firecrawl[^_]*|computer-use|openrouter|perplexity)__/
// слова в имени MCP-инструмента (после последнего «__», через «_»)
const SEARCH_WORDS = new Set(['search', 'find', 'fetch', 'get', 'read', 'list', 'query', 'scrape', 'grep', 'lookup', 'snapshot', 'screenshot'])
const EDIT_WORDS = new Set(['create', 'update', 'edit', 'write', 'set', 'patch', 'add', 'append', 'upload', 'publish', 'send', 'delete', 'move', 'rename'])
// первая команда Bash, которая ищет или читает
const BASH_SEARCH_RE = /^\s*(?:sudo\s+)?(?:grep|rg|egrep|find|fd|locate|ls|tree|cat|head|tail|less|wc|jq)\b/
const BASH_WEB_RE = /^\s*(?:sudo\s+)?(?:curl|wget|ssh|scp|rsync)\b/

// ── память: вспоминает / запоминает ───────────────────────────────────────────

// Claude Code's auto-memory folder — .../.claude/projects/<project>/memory, a path relative to ~/.claude included
const MEMORY_PATH_RE = /(?:^|[\s/'"=])projects\/-[\w.-]+\/memory(?:\/|\b)/
// a shell command that writes into that folder: git add/commit, an index blob, an in-place edit, a Python write
const MEMORY_WRITE_CMD_RE =
  /\bgit\b[^|;&\n]*\b(?:commit|add)\b|hash-object -w|\bsed -i\b|\bopen\([^)]*,\s*['"][wa]['"]|\.write_text\(/
// a memory MCP server or tool: a word of its server or tool name (split on "_" and "-") is one of these
const MEMORY_WORDS = new Set(['memory', 'memories', 'mem0', 'remember', 'recall'])
// a memory tool whose name starts with one of these writes; any other memory tool reads
const MEMORY_WRITE_RE = /^(?:write|save|add|update|delete|forget|remember|store|create|insert|upsert|put|set|edit|append)/

export type MemoryKind = '' | 'recall' | 'memorize'

export function memoryKind(tool: string, input?: Record<string, unknown>): MemoryKind {
  // a memory MCP tool: write_note, add_memory and the like — memorizes; search, get, list, stats and the rest — recalls
  if (tool.startsWith('mcp__')) {
    const parts = tool.slice('mcp__'.length).split('__')
    const name = (parts.length > 1 ? parts[parts.length - 1]! : '').toLowerCase()
    const words = parts.join('_').toLowerCase().split(/[_-]+/)
    if (words.some(w => MEMORY_WORDS.has(w))) return MEMORY_WRITE_RE.test(name) ? 'memorize' : 'recall'
  }
  const path = [input?.file_path, input?.path, input?.notebook_path].find((v): v is string => typeof v === 'string')
  if (path && MEMORY_PATH_RE.test(path)) {
    if (EDIT_TOOLS.has(tool)) return 'memorize'
    if (SEARCH_TOOLS.has(tool)) return 'recall'
  }
  if (tool === 'Bash' && typeof input?.command === 'string') {
    const cmd = input.command
    if (MEMORY_PATH_RE.test(cmd)) return MEMORY_WRITE_CMD_RE.test(cmd) ? 'memorize' : 'recall'
  }
  return ''
}

export function toolKind(tool: string, input?: Record<string, unknown>): ToolKind {
  const mem = memoryKind(tool, input)
  if (mem) return mem
  if (ASK_TOOLS.has(tool)) return 'ask'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (WEB_TOOLS.has(tool) || WEB_SERVER_RE.test(tool)) return 'web'
  if (SEARCH_TOOLS.has(tool)) return 'search'
  if (tool === 'Bash') {
    const cmd = typeof input?.command === 'string' ? input.command : ''
    return BASH_SEARCH_RE.test(cmd) ? 'search' : BASH_WEB_RE.test(cmd) ? 'web' : 'work'
  }
  if (tool.startsWith('mcp__')) {
    const words = (tool.split('__').pop() ?? '').toLowerCase().split('_')
    if (SEARCH_WORDS.has(words[0] ?? '') || words.includes('search')) return 'search'
    if (EDIT_WORDS.has(words[0] ?? '')) return 'edit'
  }
  return 'work'
}

// the older name: search or not
export function modeForTool(tool: string, input?: Record<string, unknown>): 'work' | 'search' {
  return toolKind(tool, input) === 'search' ? 'search' : 'work'
}

// ── простой ───────────────────────────────────────────────────────────────────

// после хода: праздник 4 с, потом по кругу прогулка 24 с (ровно туда и обратно) и кофе 16 с; ≥ 20 мин — сон
export const CELEBRATE_MS = CELEBRATE_S * 1000
export const WALK_MS = WALK_S * 1000
export const IDLE_CYCLE_MS = (WALK_S + COFFEE_S) * 1000
export const SLEEP_AFTER_MS = 20 * 60_000

export function idleMode(now: number, idleSince: number, celebrate = false): BuddyMode {
  const since = idleSince || now
  const rel = now - since
  if (rel >= SLEEP_AFTER_MS) return 'sleep'
  if (celebrate && rel < CELEBRATE_MS) return 'celebrate'
  const pos = (celebrate ? rel - CELEBRATE_MS : rel) % IDLE_CYCLE_MS
  return pos < WALK_MS ? 'walk' : 'coffee'
}

// через сколько мс сменится занятие в простое (перерисовка ровно на границе)
export function msToNextIdleChange(now: number, idleSince: number, celebrate = false): number {
  const since = idleSince || now
  const rel = now - since
  if (rel >= SLEEP_AFTER_MS) return SLEEP_AFTER_MS // спит до следующего хода
  let toPhase: number
  if (celebrate && rel < CELEBRATE_MS) toPhase = CELEBRATE_MS - rel
  else {
    const pos = (celebrate ? rel - CELEBRATE_MS : rel) % IDLE_CYCLE_MS
    toPhase = pos < WALK_MS ? WALK_MS - pos : IDLE_CYCLE_MS - pos
  }
  return Math.max(250, Math.min(toPhase, SLEEP_AFTER_MS - rel))
}

// ── выбор сцены ───────────────────────────────────────────────────────────────

export type SpinnerMode = '' | 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'
export const OFFLINE_HOLD_MS = 3 * 60_000 // сколько показывать «нет связи» после хода, оборванного ошибкой

export const COMPACT_MAX_MS = 15 * 60_000 // страховка: компакт дольше не бывает — флаг считаем зависшим
export const OFFLINE_WAIT_MS = 90_000 // ответ сервера не начался за 1,5 мин (повторы при перегрузке) — «нет связи»

export type BuddyView = {
  isWorking: boolean // идёт ход главной сессии или работают помощники
  mainWorking?: boolean // идёт ход именно главной сессии (по умолчанию = isWorking)
  tool: '' | ToolKind // инструмент главного цикла: идёт сейчас или только что был (держится несколько секунд)
  flash?: '' | ToolKind // вспышка от вставки движка (подобрал заметки памяти к промпту, сохранил память)
  flashUntil?: number
  spinner: SpinnerMode // что говорит строка хода (думает / пишет / инструмент)
  wordTool?: '' | ToolKind // вид работы из слова строки хода на десктопе («Creating notes.md» → правка)
  compacting: boolean
  compactSince?: number
  offlineSince: number // 0 — связь в порядке
  idleSince: number
  celebrate: boolean // ход закончился ответом — сначала праздник
}

export function pickMode(v: BuddyView, now: number): BuddyMode {
  if (v.compacting && (!v.compactSince || now - v.compactSince < COMPACT_MAX_MS)) return 'compact'
  const main = v.mainWorking ?? v.isWorking
  if (v.offlineSince && (main || now - v.offlineSince < OFFLINE_HOLD_MS)) return 'offline'
  if (v.isWorking) {
    if (v.tool) return v.tool
    if (v.flash && now < (v.flashUntil ?? 0)) return v.flash
    if (v.spinner === 'thinking' || v.spinner === 'requesting') return 'think'
    if (v.wordTool) return v.wordTool
    return 'work'
  }
  return idleMode(now, v.idleSince, v.celebrate)
}

// Слово строки хода на десктопе — что делает шаг (фразы движка 2.1.289): «Reading app.py», «Searching for foo»,
// «Finding *.ts», «Editing notes.md», «Writing notes.md», «Fetching https://…», «Searching the web», «Running …».
// По нему правка видна, пока модель ещё пишет содержимое файла. В терминале там случайный глагол одним словом
// («Sauteing», «Creating») — однословное не разбираем
export function kindFromWord(word: string | null | undefined): '' | ToolKind {
  if (typeof word !== 'string') return ''
  const w = word.trim()
  if (!/^\S+\s+\S/.test(w)) return ''
  // встроенная память движка: «Saving memory notes.md», «Reading memory», «Listing memory documents»
  if (/^(?:Saving|Writing|Editing|Updating) memory\b/.test(w)) return 'memorize'
  if (/^(?:Reading|Listing|Searching) memory\b/.test(w)) return 'recall'
  if (/^(?:Editing|Writing|Creating|Updating|Saving)\s/.test(w)) return 'edit'
  if (/^Searching the web\b/.test(w) || /^Fetching\s/.test(w)) return 'web'
  if (/^(?:Reading|Searching|Finding|Listing)\s/.test(w)) return 'search'
  return ''
}

// текст строки хода, который значит «нет связи / повтор»
const OFFLINE_RE = /retr|reconnect|connection|offline|overload|network|timed? ?out|повтор|переподкл|соедин|сеть|нет связи/i
export function spinnerOffline(message: string | null | undefined): boolean {
  return typeof message === 'string' && OFFLINE_RE.test(message)
}

// ── режим ultra (очки) ────────────────────────────────────────────────────────

// запись транскрипта: тип вставки (ultra_effort_enter / ultra_effort_exit)
export function ultraFromAttachment(name: string | undefined): boolean | null {
  if (name === 'ultra_effort_enter') return true
  if (name === 'ultra_effort_exit') return false
  return null
}
// текст переписки (проход при старте): вставка, которая НАЧИНАЕТСЯ с «Ultracode is on/still on/off»
const ULTRA_RE = /<system-reminder>\s*Ultracode is (?:still |now )?(on|off)\b/gi
export function ultraMarker(text: string): boolean | null {
  let last: boolean | null = null
  for (const m of text.matchAll(ULTRA_RE)) last = m[1]!.toLowerCase() === 'on'
  return last
}

// ── начало сцены ──────────────────────────────────────────────────────────────

// Scenes change every few seconds (think -> terminal -> think) and each starts from the beginning — the late beats of
// a cycle are rarely reached. So on entry a scene sometimes jumps straight to such a beat: work — a sip of coffee
// now and then while working, at most once in 40 s
export const ENTRY_HIGHLIGHT: Partial<Record<BuddyMode, { at: number; everyMs: number }>> = {
  work: { at: 5.3, everyMs: 40_000 },
}

// с какой секунды цикла начать сцену при входе в неё: с яркого бита, если его давно не было, иначе с начала
export function entryStart(mode: BuddyMode, now: number, lastHighlightAt: number | undefined): number {
  const h = ENTRY_HIGHLIGHT[mode]
  if (!h) return 0
  return lastHighlightAt === undefined || now - lastHighlightAt >= h.everyMs ? h.at : 0
}

// сдвиг времени всех анимаций: сцена начинается с секунды startAt своего цикла (SMIL — отрицательный begin)
export function shiftTimeline(svg: string, startAt: number): string {
  if (!startAt) return svg
  const fmt = (x: number) => `${Math.round(x * 1000) / 1000}s`
  return svg.replace(/<(animate|animateTransform|set)\b([^>]*?)(\/?)>/g, (tag, name: string, attrs: string, close: string) => {
    const b = /\sbegin="(-?\d+(?:\.\d+)?)s"/.exec(attrs)
    if (b) return `<${name}${attrs.replace(b[0], ` begin="${fmt(Number(b[1]) - startAt)}"`)}${close}>`
    if (/\sbegin="/.test(attrs)) return tag // начало от события или другой анимации не трогаем
    return `<${name}${attrs} begin="${fmt(-startAt)}"${close}>`
  })
}

// ── сборка ────────────────────────────────────────────────────────────────────

const SCENES: Record<BuddyMode, (gear: Gear) => string> = {
  think: sceneThink,
  work: sceneWork,
  edit: sceneEdit,
  search: sceneSearch,
  web: sceneWeb,
  ask: sceneAsk,
  recall: sceneRecall,
  memorize: sceneMemorize,
  compact: sceneCompact,
  offline: sceneOffline,
  celebrate: sceneCelebrate,
  walk: sceneWalk,
  coffee: sceneCoffee,
  sleep: sceneSleep,
}

export const MODE_ALT: Record<BuddyMode, string> = {
  think: 'Clawd is thinking',
  work: 'Clawd is working at the laptop',
  edit: 'Clawd is editing a file',
  search: 'Clawd is searching with a magnifier',
  web: 'Clawd is on the web',
  ask: 'Clawd is waiting for your answer',
  recall: 'Clawd is recalling',
  memorize: 'Clawd is memorizing',
  compact: 'Clawd is compacting the conversation',
  offline: 'Clawd is fixing the connection: the server is not answering or failed',
  celebrate: 'Clawd is celebrating: done',
  walk: 'Clawd is taking a walk',
  coffee: 'Clawd is drinking coffee',
  sleep: 'Clawd is sleeping',
}

// сцены, во время которых справа могут работать мини-клодики-помощники
const WITH_HELPERS = new Set<BuddyMode>(['think', 'work', 'edit', 'search', 'web', 'ask', 'recall', 'memorize', 'compact', 'offline'])

export function buddyAlt(mode: BuddyMode, gear: Gear, helperCount = 0): string {
  const base = gear.glasses ? `${MODE_ALT[mode]}, in sunglasses` : MODE_ALT[mode]
  return helperCount > 0 && WITH_HELPERS.has(mode) ? `${base}; helpers: ${helperCount}` : base
}

// startAt — с какой секунды цикла начать сцену (entryStart); помощники справа идут своим временем
export function buddySvg(mode: BuddyMode, gear: Gear = NO_GEAR, helperCount = 0, startAt = 0): string {
  const scene = SCENES[mode] ?? sceneWalk
  const extra = helperCount > 0 && WITH_HELPERS.has(mode) ? helpers(Math.min(helperCount, 4)) : ''
  return strip(shiftTimeline(scene(gear), startAt) + extra)
}

// ── плавная смена сцен ────────────────────────────────────────────────────────
// Smooth switching, and "wherever he stops, he does the new thing there": searching with the magnifier, then starting to
// code — he stops on that spot, puts the magnifier away and takes out the laptop; searching again — takes the magnifier
// and walks on. A new scene is placed exactly where Clawd stands: shifted horizontally, mirrored near an edge (props on
// the other side); the old one fades out, the new one fades in over FADE_S. He walks only if the scene fits neither
// way. Helpers sit on the free side of the strip. A walk continues from where he is.
// Where Clawd is at every moment of every scene was measured from rendered frames (clawd/meta.ts).

export const FADE_S = 0.3
const WALK_SPEED = 140 // px/с
const WALK_MIN_S = 0.4
const WALK_MAX_S = 2
const ROAM = new Set<BuddyMode>(['walk']) // Клод сам ходит по полосе: подбирается момент цикла, а не место сцены
// сцены с украшениями во всю полосу (конфетти, звёзды): обрезка краёв не страшна — ставим просто под Клода
const CLIP_OK = new Set<BuddyMode>(['celebrate', 'sleep'])
// помощники (helpers) нарисованы справа, x 478…702; слева — тот же рисунок, сдвинутый на HELPERS_LEFT
const HELPERS_LEFT = -470

const sceneMeta = (mode: BuddyMode): SceneMeta | undefined => SCENE_META[mode]

// где центр Клода (px, в координатах сцены) на секунде phase её цикла
export function clawdX(mode: BuddyMode, phase: number): number {
  const m = sceneMeta(mode)
  if (!m || m.x.length === 0) return 40
  const t = ((phase % m.cycle) + m.cycle) % m.cycle
  const i = t / m.step
  const i0 = Math.floor(i)
  const a = m.x[i0 % m.x.length]!
  const b = m.x[(i0 + 1) % m.x.length]!
  return a + (b - a) * (i - i0)
}

// секунда цикла сцены, начатой с секунды startAt, через elapsedS
export function phaseOf(mode: BuddyMode, startAt: number, elapsedS: number): number {
  const cycle = sceneMeta(mode)?.cycle ?? 10
  const t = startAt + Math.max(0, elapsedS)
  return Math.round((((t % cycle) + cycle) % cycle) * 1000) / 1000
}

// Где сцена на полосе: точка x сцены → x0 + x (как нарисована) или x0 − x (зеркально: Клод смотрит в другую сторону)
export type Placement = { mode: BuddyMode; startAt: number; x0: number; flip: boolean }
const toStrip = (p: Placement, x: number) => (p.flip ? p.x0 - x : p.x0 + x)

// Куда поставить сцену, чтобы Клод (центр сейчас в xFrom) остался ровно на месте: как нарисована, иначе зеркально,
// иначе — как можно ближе к нему (тогда он дойдёт пешком)
export function placeScene(mode: BuddyMode, startAt: number, xFrom?: number): Placement {
  const m = sceneMeta(mode)
  if (!m || xFrom === undefined) return { mode, startAt, x0: 0, flip: false }
  if (ROAM.has(mode)) {
    let best = 0
    let bestD = Infinity
    m.x.forEach((x, i) => {
      const d = Math.abs(x - xFrom)
      if (d < bestD - 0.5) {
        bestD = d
        best = i * m.step
      }
    })
    return { mode, startAt: best, x0: 0, flip: false }
  }
  const c = clawdX(mode, startAt)
  const plain = Math.round(xFrom - c)
  const mirr = Math.round(xFrom + c)
  if (CLIP_OK.has(mode) || (plain + m.minX >= 0 && plain + m.maxX <= STRIP_W)) return { mode, startAt, x0: plain, flip: false }
  if (mirr - m.maxX >= 0 && mirr - m.minX <= STRIP_W) return { mode, startAt, x0: mirr, flip: true }
  const plainX = Math.max(-m.minX, Math.min(STRIP_W - m.maxX, plain))
  const mirrX = Math.max(m.maxX, Math.min(STRIP_W + m.minX, mirr))
  return Math.abs(plainX - plain) <= Math.abs(mirrX - mirr)
    ? { mode, startAt, x0: plainX, flip: false }
    : { mode, startAt, x0: mirrX, flip: true }
}

export type Walk = { x0: number; x1: number; dur: number }

// переход пешком (центр Клода из x0 в x1), если сцена не встала прямо под ним
export function walkBetween(x0: number, x1: number): Walk | undefined {
  const d = Math.abs(x1 - x0)
  if (d < 6) return undefined
  const dur = Math.min(WALK_MAX_S, Math.max(WALK_MIN_S, d / WALK_SPEED))
  return { x0: Math.round(x0), x1: Math.round(x1), dur: Math.round(dur * 100) / 100 }
}

// где центр Клода через elapsedS после начала показа сцены (с переходом пешком в начале)
export function stageX(p: Placement, walk: Walk | undefined, elapsedS: number): number {
  if (walk && elapsedS < walk.dur) {
    const s = Math.max(0, elapsedS / walk.dur)
    return walk.x0 + (walk.x1 - walk.x0) * s * s * (3 - 2 * s)
  }
  return toStrip(p, clawdX(p.mode, phaseOf(p.mode, p.startAt, elapsedS - (walk?.dur ?? 0))))
}

export type StageState = { place: Placement; since: number; walk?: Walk }
export type StageStep = { place: Placement; walk?: Walk; from?: Placement & { phase: number } }

// Следующая сцена (чистая логика смены): куда поставить, нужен ли переход пешком и какую сцену растворить.
// cur — что показано сейчас (с какого момента now), startAt — с какой секунды цикла войти в новую сцену.
// В прогулку не идём пешком: она сама начинается с ближайшего к Клоду места, а шагающий переход рядом с
// идущей сценой даёт двух Клодов. Переход ещё идёт — старую сцену не растворяем (она не проявилась)
export function nextStage(cur: StageState | null, want: BuddyMode, now: number, startAt: number): StageStep {
  if (!cur) return { place: placeScene(want, startAt) }
  const el = (now - cur.since) / 1000
  const settled = el >= (cur.walk?.dur ?? 0) + FADE_S
  const xFrom = stageX(cur.place, cur.walk, el)
  const place = placeScene(want, startAt, xFrom)
  const walk = ROAM.has(want) ? undefined : walkBetween(xFrom, toStrip(place, clawdX(want, place.startAt)))
  const from = settled ? { ...cur.place, phase: phaseOf(cur.place.mode, cur.place.startAt, el - (cur.walk?.dur ?? 0)) } : undefined
  return { place, walk, from }
}

const placed = (p: Placement, gear: Gear, phase: number) =>
  `<g transform="translate(${p.x0},0)${p.flip ? ' scale(-1,1)' : ''}">${shiftTimeline((SCENES[p.mode] ?? sceneWalk)(gear), phase)}</g>`

// помощникам — свободная сторона полосы: справа, если сцена туда не заходит, иначе слева, если там свободно
export function helpersSide(p: Placement): 'right' | 'left' {
  const m = sceneMeta(p.mode)
  if (!m) return 'right'
  const a = toStrip(p, m.minX)
  const b = toStrip(p, m.maxX)
  if (Math.max(a, b) <= 466) return 'right'
  if (Math.min(a, b) >= 244) return 'left'
  return 'right'
}

// SVG полосы со сменой сцены: старая (from, на своей секунде цикла) тает, Клод доходит пешком (walk), новая (to)
// проявляется и идёт со своей секунды startAt. Без from и walk — просто сцена. Метка <!--stage …--> — для тестов
export function stageSvg(o: {
  to: Placement
  gear: Gear
  helperCount?: number
  crew?: Crew
  from?: Placement & { phase: number }
  walk?: Walk
}): string {
  const t0 = o.walk?.dur ?? 0
  const total = Math.round((t0 + FADE_S) * 100) / 100
  const k = (t0 / total).toFixed(4)
  let s = `<!--stage to=${o.to.mode} start=${o.to.startAt} x0=${o.to.x0}${o.to.flip ? ' flip=1' : ''}` +
    `${o.from ? ` from=${o.from.mode}` : ''}${o.walk ? ` walk=${o.walk.dur}` : ''}-->`
  if (o.from) s += g(placed(o.from, o.gear, o.from.phase), fade('1;0', `${FADE_S}s`, { once: true }))
  if (o.walk) {
    const w = o.walk
    const half = (CH_W * P) / 2
    const body = clawd({ legs: 'walk', gear: o.gear })
    const go = move(`${w.x0 - half} 0;${w.x1 - half} 0`, `${w.dur}s`, { calc: 'spline', keyTimes: '0;1', keySplines: EASE, once: true })
    s += g(at(0, TOP, w.x1 < w.x0 ? mirror(body) : body, go), fade('1;1;0', `${total}s`, { keyTimes: `0;${k};1`, once: true }))
  }
  const scene = placed(o.to, o.gear, o.to.startAt - t0)
  if (o.from || o.walk) {
    const show = t0 ? fade('0;0;1', `${total}s`, { keyTimes: `0;${k};1`, once: true }) : fade('0;1', `${FADE_S}s`, { once: true })
    s += g(scene, show, ' opacity="0"')
  } else s += scene
  const crew = o.crew ?? { slots: Array.from({ length: Math.min(o.helperCount ?? 0, CREW_SLOTS) }, (_, i) => ({ slot: i, state: 'work' as const, age: 0 })), extra: 0 }
  if ((crew.slots.length || crew.extra) && WITH_HELPERS.has(o.to.mode)) {
    const h = crewSvg(crew)
    s += helpersSide(o.to) === 'left' ? `<g transform="translate(${HELPERS_LEFT},0)">${h}</g>` : h
  }
  return strip(s)
}

// ── helpers: agents of the main session ───────────────────────────────────────────
// As many mini-Clawds as the main session has agents running; an agent finished — a green check mark over its
// mini-Clawd, a hop, and it dissolves. Each keeps its own slot 0..3 (nobody shifts when someone leaves);
// extra ones wait in a queue (a "+N" badge) and take the slot that frees up.

export const CREW_SLOTS = 4
export const ARRIVE_MS = 450
export const LEAVE_MS = 1_600

export type CrewEntry = { id: string; slot: number | null; since: number; leaving?: number; wf?: boolean; seen: number }

function freeSlot(crew: CrewEntry[]): number | null {
  const used = new Set(crew.filter(c => c.slot !== null).map(c => c.slot))
  for (let i = 0; i < CREW_SLOTS; i++) if (!used.has(i)) return i
  return null
}

// новый агент: первое свободное место, нет мест — в очередь
export function crewJoin(crew: CrewEntry[], id: string, now: number, wf = false): CrewEntry[] {
  if (crew.some(c => c.id === id)) return crew
  return [...crew, { id, slot: freeSlot(crew), since: now, wf, seen: now }]
}

// агент закончил: на месте — галочка и растворение (место свободно через LEAVE_MS); из очереди — просто уходит
export function crewLeave(crew: CrewEntry[], id: string, now: number): CrewEntry[] {
  return crew.flatMap(c => (c.id !== id || c.leaving ? [c] : c.slot === null ? [] : [{ ...c, leaving: now }]))
}

// убрать растворившихся; свободные места — первым из очереди (они выпрыгивают на место)
export function crewPrune(crew: CrewEntry[], now: number): CrewEntry[] {
  const out = crew.filter(c => !(c.leaving && now - c.leaving >= LEAVE_MS)).map(c => ({ ...c }))
  for (const c of out) {
    if (c.slot !== null || c.leaving) continue
    const slot = freeSlot(out)
    if (slot === null) break
    c.slot = slot
    c.since = now
  }
  return out
}

export type CrewView = { slot: number; state: 'arrive' | 'work' | 'leave'; age: number }
export type Crew = { slots: CrewView[]; extra: number }

// что рисовать: места с состоянием, сколько ждут в очереди, сколько работают
export function crewView(crew: CrewEntry[], now: number): Crew & { active: number } {
  const slots: CrewView[] = []
  let extra = 0
  let active = 0
  for (const c of crew) {
    if (!c.leaving) active++
    if (c.slot === null) {
      if (!c.leaving) extra++
      continue
    }
    if (c.leaving) slots.push({ slot: c.slot, state: 'leave', age: now - c.leaving })
    else slots.push({ slot: c.slot, state: now - c.since < ARRIVE_MS ? 'arrive' : 'work', age: now - c.since })
  }
  return { slots: slots.sort((a, b) => a.slot - b.slot), extra, active }
}

// меняется — картинку пересобрать (выпрыгивание и уход играют от начала своей анимации)
export const crewKey = (v: Crew) => v.slots.map(s => `${s.slot}${s.state === 'leave' ? 'l' : 'w'}`).join(',') + (v.extra ? `+${v.extra}` : '')

const helperX = (slot: number) => 478 + slot * 56
const around = (inner: string, cx: number, cy: number, anim: string) =>
  `<g transform="translate(${cx},${cy})"><g>${anim}<g transform="translate(${-cx},${-cy})">${inner}</g></g></g>`

// выпрыгнул на место: из точки до перелёта и обратно к своему размеру
function helperArrive(slot: number): string {
  const x = helperX(slot)
  const pop = scaleAnim('0.2 0.2;1.15 1.15;1 1', '0.45s', { calc: 'spline', keyTimes: '0;0.6;1', keySplines: `${EASE_OUT};${EASE}`, once: true })
  return g(around(helperAt(slot), x + 16, 54, pop), fade('0;1', '0.15s', { once: true }))
}

// закончил: зелёная галочка над ним, подскок, растворение и искорки (LEAVE_MS)
function helperLeave(slot: number): string {
  const x = helperX(slot)
  const d = `${LEAVE_MS / 1000}s`
  const badge = g(
    px(x + 6, 8, 20, 18, C.green) + px(x + 8, 10, 16, 14, C.white) + glyph('✓', x + 11, 12, C.green) + px(x + 13, 26, 6, 2, C.green),
    move('0 8;0 0;0 0;0 -6', d, { keyTimes: '0;0.12;0.75;1', once: true }) + fade('0;1;1;0', d, { keyTimes: '0;0.08;0.8;1', once: true }),
    ' opacity="0"',
  )
  const hop = scaleAnim('1 1;1.15 0.85;0.9 1.12;1 1;1 1', d, { keyTimes: '0;0.12;0.25;0.38;1', once: true })
  const body = g(around(helperAt(slot), x + 16, 54, hop), fade('1;1;0;0', d, { keyTimes: '0;0.4;0.85;1', once: true }))
  const spark = (dx: number, dy: number, f: string) =>
    g(px(x + 15, 42, 2, 2, f), move(`0 0;0 0;${dx} ${dy}`, d, { keyTimes: '0;0.45;1', once: true }) + fade('0;0;1;0', d, { keyTimes: '0;0.45;0.55;1', once: true }), ' opacity="0"')
  return body + badge + spark(-14, -10, C.yellow) + spark(14, -10, C.yellow) + spark(-10, 6, C.green) + spark(12, 6, C.green)
}

// бейдж «+N» — сколько агентов ждут места
function crewExtra(n: number): string {
  if (n <= 0) return ''
  const x = 688
  const digit = String(Math.min(n, 9))
  return px(x, 4, 28, 16, C.paperEdge) + px(x + 2, 6, 24, 12, C.white) + glyph('+', x + 3, 7, C.blue) + glyph(digit, x + 14, 7, C.blue)
}

// все помощники: работают на своих местах, выпрыгивают, уходят с галочкой; анимации ухода/прибытия продолжаются
// с того места, где были, если картинку пересобрали посередине
export function crewSvg(v: Crew): string {
  let s = ''
  for (const h of v.slots) {
    if (h.state === 'work') s += helperAt(h.slot)
    else s += shiftTimeline(h.state === 'arrive' ? helperArrive(h.slot) : helperLeave(h.slot), h.age / 1000)
  }
  return s + crewExtra(v.extra)
}
