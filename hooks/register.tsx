import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Buddy, BuddyMode } from '../types'
import {
  type CrewEntry, FADE_S, LEAVE_MS, OFFLINE_WAIT_MS, type Placement, STRIP_H, STRIP_W, type SpinnerMode, type ToolKind, type Walk,
  buddyAlt, crewJoin, crewKey, crewLeave, crewPrune, crewView, entryStart, kindFromWord, msToNextIdleChange, nextStage, phaseOf,
  stageSvg,
  pickMode, spinnerOffline, toolKind,
  ultraFromAttachment, ultraMarker,
} from './buddy'

// A pixel Clawd in the band above the prompt: thinks, works at a laptop, edits, searches with a magnifier, browses the web,
// waits for your answer, compacts the conversation, fixes the connection, recalls and memorizes, celebrates the end of a
// turn, takes a walk, drinks coffee, sleeps; mini-Clawds work beside him while the main session's agents run; in ultra
// mode he wears sunglasses. Drawn on surfaces that have Svg (desktop); the terminal has none, so there he is absent.
// The band hook always calls next(e) and draws Clawd above whatever the rest of the chain drew, so other mods that
// draw in the same band keep working (the engine does not guarantee an order between mods).

const buddy = atom(
  { plugin: 'clawd-buddy', key: 'buddy' } as const,
  {
    activity: 'idle', tool: '', flash: '', flashUntil: 0, spinner: '', wordTool: '', compacting: false, compactSince: 0,
    offlineSince: 0, helpers: 0, crewKey: '',
    idleSince: 0, celebrate: false, tick: 0, ultra: false, booted: false,
  } as Buddy,
)

let idleTimer: { cancel: () => void } | null = null
// the main loop's tools running now (parallel ones too), by kind
const toolsInFlight = new Map<ToolKind, number>()
// helpers: agents started by the main session — who sits in which slot, who is leaving (logic: crew* in buddy.ts)
let crew: CrewEntry[] = []
let crewTimer: { cancel: () => void } | null = null
const CREW_SYNC_MS = 15_000
const WF_IDLE_MS = 15 * 60_000 // a workflow agent with no calls for longer is treated as gone (it is not in $.agent.list())
const LIST_GRACE_MS = 10_000 // a just-spawned agent may not be in the agent list yet
// a tool's scene holds TOOL_HOLD_MS after the tool ends (edits and searches take milliseconds — otherwise unseen)
const TOOL_HOLD_MS = 6_000
let toolHoldTimer: { cancel: () => void } | null = null
let flashTimer: { cancel: () => void } | null = null
// waiting for the server: if "requesting" lasts longer than OFFLINE_WAIT_MS — "offline"
let requestTimer: { cancel: () => void } | null = null
// what the spinner said last — state is written only when it changes
let lastSpinner = ''
// What is drawn: the scene and where it is placed, from which second of its cycle, when shown, the walking transition.
// The SVG is rebuilt only on a change — otherwise the picture would restart and the animation would not run on its own
type Stage = { place: Placement; since: number; walk?: Walk; glasses: boolean; crew: string; svg: string }
let stage: Stage | null = null
// when a scene last started from its highlight beat (work — a sip of coffee)
const highlightAt = new Map<string, number>()
// a scene holds for at least MIN_SCENE_MS (no "think <-> work" flicker), except urgent ones
const MIN_SCENE_MS = 2_000
const URGENT = new Set<string>(['ask', 'compact', 'offline'])
let stageTimer: { cancel: () => void } | null = null

// Write to Clawd's state only what changed: every write redraws the band on every surface
// (the change is computed again from the current state inside update — a write never clobbers one made in between).
// true — written or nothing to write; false — failure
async function patchBuddy($: Engine, change: (b: Buddy) => Partial<Buddy> | null): Promise<boolean> {
  try {
    const b = await read($, buddy)
    const patch = change(b)
    if (!patch) return true
    const diff = (Object.keys(patch) as (keyof Buddy)[]).some(k => patch[k] !== b[k])
    if (diff) await update($, buddy, cur => ({ ...cur, ...(change(cur) ?? {}) }))
    return true
  } catch {
    // Clawd is decoration: a drawing failure must never get in the way of the turn
    return false
  }
}

// A turn started: Clawd gets to work, the connection is considered restored, no celebration
async function setBusy($: Engine) {
  idleTimer?.cancel()
  await patchBuddy($, b => ({
    activity: 'busy', offlineSince: 0, celebrate: false,
    ...(b.activity === 'idle' ? { tool: '' as const, wordTool: '' as const, spinner: '' as const } : {}),
  }))
}

// A turn ended (or the session process started): resting from now on; celebrate — celebrate first
async function setIdle($: Engine, celebrate: boolean, offline = false) {
  try {
    const now = await $.clock.now()
    toolsInFlight.clear()
    lastSpinner = ''
    toolHoldTimer?.cancel()
    requestTimer?.cancel()
    await patchBuddy($, b => ({
      activity: 'idle',
      idleSince: b.activity === 'idle' && b.idleSince ? b.idleSince : now,
      celebrate: b.activity === 'idle' ? b.celebrate : celebrate,
      tool: '',
      flash: '',
      flashUntil: 0,
      wordTool: '',
      spinner: '',
      compacting: false, // the turn ended — so did a compaction inside it; guards against a stuck flag
      offlineSince: offline ? now : celebrate ? 0 : b.offlineSince,
    }))
    await scheduleIdle($)
  } catch {
    // see above
  }
}

// While idle the activity changes with time (celebrate -> walk -> coffee -> ... -> sleep): redraw exactly at the boundary
async function scheduleIdle($: Engine) {
  idleTimer?.cancel()
  const b = await read($, buddy)
  if (b.activity !== 'idle') return
  const wait = msToNextIdleChange(await $.clock.now(), b.idleSince, b.celebrate)
  idleTimer = $.clock.after(wait + 100, () => void bumpIdle($).catch(() => {}))
}

async function bumpIdle($: Engine) {
  const b = await read($, buddy)
  if (b.activity !== 'idle') return
  await update($, buddy, cur => ({ ...cur, tick: (cur.tick ?? 0) + 1 }))
  await scheduleIdle($)
}

// Which of the main loop's tools is "on show": a question to the user beats everything, then memory, edit, web, search
const TOOL_PRIORITY: ToolKind[] = ['ask', 'memorize', 'recall', 'edit', 'web', 'search', 'work']
function currentTool(): '' | ToolKind {
  for (const k of TOOL_PRIORITY) if ((toolsInFlight.get(k) ?? 0) > 0) return k
  return ''
}

// Helpers changed: remember, remove the dissolved ones after LEAVE_MS (and seat the waiting ones), write for a redraw
async function crewChanged($: Engine, next: CrewEntry[]) {
  try {
    crew = next
    const now = await $.clock.now()
    const v = crewView(crew, now)
    const due = crew.filter(c => c.leaving).map(c => c.leaving! + LEAVE_MS)
    crewTimer?.cancel()
    crewTimer = due.length ? $.clock.after(Math.max(0, Math.min(...due) - now) + 50, () => void crewTick($)) : null
    const leaving = crew.filter(c => c.leaving && c.slot !== null).length
    await patchBuddy($, () => ({ helpers: v.active + leaving, crewKey: crewKey(v) }))
  } catch {
    // see above
  }
}

async function crewTick($: Engine) {
  await crewChanged($, crewPrune(crew, await $.clock.now()))
}

// Reconcile with the engine's agent list (every 15 s while there are helpers, and at start): add the missing ones,
// see off the finished (or vanished) ones. Workflow agents are not in the list — turn.complete sees them off
async function crewSync($: Engine) {
  try {
    const list = await $.agent.list()
    const now = await $.clock.now()
    let next = crew
    const byId = new Map(list.map(a => [a.id, a]))
    for (const a of list)
      if (!a.parentId && (a.status === 'running' || a.status === 'pending' || a.status === 'waiting')) next = crewJoin(next, a.id, now)
    for (const c of next) {
      if (c.leaving) continue
      const a = byId.get(c.id)
      const done = a ? a.status === 'completed' || a.status === 'failed' || a.status === 'killed' : !c.wf && now - c.since > LIST_GRACE_MS
      if (done || (c.wf && now - c.seen > WF_IDLE_MS)) next = crewLeave(next, c.id, now)
    }
    if (next !== crew) await crewChanged($, next)
  } catch {
    // no list — wait for events
  }
}

// What the main loop's spinner said: the model's mode, the kind of work from the step word, and "offline / retrying".
// The server's answer did not start within OFFLINE_WAIT_MS ("requesting" all along) — also "offline". false — write failed
async function noteSpinner($: Engine, mode: SpinnerMode, wordTool: '' | ToolKind, offline: boolean): Promise<boolean> {
  try {
    const now = await $.clock.now()
    requestTimer?.cancel()
    requestTimer = null
    if (mode === 'requesting' && !offline)
      requestTimer = $.clock.after(OFFLINE_WAIT_MS, () =>
        void patchBuddy($, b => (b.activity === 'busy' && b.spinner === 'requesting' && !b.offlineSince ? { offlineSince: now + OFFLINE_WAIT_MS } : null)))
    return await patchBuddy($, b => ({
      spinner: mode,
      wordTool,
      offlineSince: offline ? b.offlineSince || now : mode === 'requesting' ? b.offlineSince : 0,
    }))
  } catch {
    return false
  }
}

// End of a main-loop tool: its scene holds TOOL_HOLD_MS more (and while the model waits for the server or thinks),
// unless another tool started; the end of the turn drops it at once
async function holdTool($: Engine) {
  toolHoldTimer?.cancel()
  const cur = currentTool()
  if (cur !== '') return void (await patchBuddy($, b => (b.activity === 'busy' ? { tool: cur } : null)))
  toolHoldTimer = $.clock.after(TOOL_HOLD_MS, () =>
    void patchBuddy($, b => (b.activity === 'busy' && currentTool() === '' ? { tool: '' } : null)))
}

// An engine insertion with no tool (memories attached to the prompt, memory saved): the scene for TOOL_HOLD_MS
async function flash($: Engine, kind: ToolKind) {
  try {
    const until = (await $.clock.now()) + TOOL_HOLD_MS
    flashTimer?.cancel()
    await patchBuddy($, () => ({ flash: kind, flashUntil: until }))
    flashTimer = $.clock.after(TOOL_HOLD_MS, () =>
      void patchBuddy($, b => (b.flash && (b.flashUntil ?? 0) <= until ? { flash: '' as const, flashUntil: 0 } : null)))
  } catch {
    // see above
  }
}

async function bumpTick($: Engine) {
  try {
    await update($, buddy, cur => ({ ...cur, tick: (cur.tick ?? 0) + 1 }))
  } catch {
    // see above
  }
}

// Which second of the cycle to enter a scene at: its highlight beat if it has not been shown for a while
// (work — a sip of coffee), otherwise from the start
function enterAt(mode: BuddyMode, now: number): number {
  const startAt = entryStart(mode, now, highlightAt.get(mode))
  if (startAt) highlightAt.set(mode, now)
  return startAt
}

// The scene to show: the same while Clawd keeps doing the same thing; a change is a smooth transition from where he
// stands now. Called while drawing: writes only module variables, state is written later (a redraw on a timer)
function stageFor($: Engine, want: BuddyMode, now: number, glasses: boolean): Stage {
  const gear = { glasses }
  const crewNow = crewView(crew, now)
  const key = crewKey(crewNow)
  const cur = stage && now >= stage.since ? stage : null // the clock went back (a test with a new clock) — start over
  if (!cur) {
    const { place } = nextStage(null, want, now, enterAt(want, now))
    return (stage = { place, since: now, glasses, crew: key, svg: stageSvg({ to: place, gear, crew: crewNow }) })
  }
  const el = (now - cur.since) / 1000
  const settled = el >= (cur.walk?.dur ?? 0) + FADE_S
  if (want !== cur.place.mode) {
    if (now - cur.since < MIN_SCENE_MS && !URGENT.has(want)) {
      stageTimer?.cancel()
      stageTimer = $.clock.after(cur.since + MIN_SCENE_MS - now + 20, () => void bumpTick($))
      return cur
    }
    const { place, walk, from } = nextStage(cur, want, now, enterAt(want, now))
    return (stage = { place, since: now, walk, glasses, crew: key, svg: stageSvg({ to: place, gear, crew: crewNow, from, walk }) })
  }
  if (cur.glasses !== glasses || cur.crew !== key) {
    if (!settled) {
      // a transition is running — rebuild once it ends
      stageTimer?.cancel()
      stageTimer = $.clock.after(((cur.walk?.dur ?? 0) + FADE_S) * 1000 - (now - cur.since) + 20, () => void bumpTick($))
      return cur
    }
    // same scene, different glasses or helpers — rebuild from the current second of its cycle, no transition
    const place = { ...cur.place, startAt: phaseOf(cur.place.mode, cur.place.startAt, el - (cur.walk?.dur ?? 0)) }
    return (stage = { place, since: now, glasses, crew: key, svg: stageSvg({ to: place, gear, crew: crewNow }) })
  }
  return cur
}

async function setUltra($: Engine, ultra: boolean) {
  await patchBuddy($, () => ({ ultra }))
}

const blockTexts = (content: readonly { type: string; [k: string]: unknown }[]) =>
  content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string)

// Ultra mode at the session process's start: the last "Ultracode is on/still on/off" insertion in the conversation (one pass)
async function scanUltra($: Engine) {
  try {
    const msgs = await $.session.messages({ as: 'api' })
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!
      if (m.role !== 'user') continue
      const texts = blockTexts(m.content)
      for (let j = texts.length - 1; j >= 0; j--) {
        const ultra = ultraMarker(texts[j]!)
        if (ultra !== null) return void (await setUltra($, ultra))
      }
    }
  } catch {
    // no conversation — stay without sunglasses
  }
}

// The process's first start (not a hot reload: state survives that) — idle without a celebration, one pass over the conversation
async function bootBuddy($: Engine) {
  const b = await read($, buddy)
  if (b.booted) return void (await scheduleIdle($))
  await update($, buddy, cur => ({ ...cur, booted: true, compacting: false }))
  await setIdle($, false)
  await scanUltra($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    bootBuddy($).catch(() => {})
    void crewSync($)
    $.clock.every(CREW_SYNC_MS, () => {
      if (crew.length) void crewSync($)
    })
    return next(e)
  })

  // to work — only if the prompt reached a turn (a dropped one starts no turn and gets no turn.complete)
  on('prompt.submit', async ($, e, next) => {
    const res = await next(e)
    if (res.drop === undefined) setBusy($).catch(() => {})
    return res
  })

  // the main loop's tool picks the scene (question, edit, web, search, shell); calls of subagents and workflow
  // agents do not touch the scene — they only count as helpers
  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      // the helper is alive (for workflow agents the only sign)
      const id = e.agentId
      void $.clock.now().then(now => {
        crew = crew.map(c => (c.id === id ? { ...c, seen: now } : c))
      }).catch(() => {})
      return next(e)
    }
    const kind = toolKind(e.tool, e as unknown as Record<string, unknown>)
    toolsInFlight.set(kind, (toolsInFlight.get(kind) ?? 0) + 1)
    toolHoldTimer?.cancel()
    // the kind as of the call: the write may land after the tool already ended (an edit takes milliseconds)
    const shown = currentTool()
    const started = patchBuddy($, () => ({ activity: 'busy', tool: shown })).catch(() => {})
    try {
      return await next(e)
    } finally {
      toolsInFlight.set(kind, Math.max(0, (toolsInFlight.get(kind) ?? 0) - 1))
      void started.then(() => holdTool($)).catch(() => {})
    }
  })

  // the main loop's turn started (a queued turn too: its prompt.submit came during the previous turn)
  on('turn.start', ($, e, next) => {
    setBusy($).catch(() => {})
    return next(e)
  })

  // an agent started by the main session (not by an agent) — a helper hops onto a free slot right at spawn
  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    try {
      const id = res && !res.deny ? res.agentId : undefined
      if (id && !e.parentAgentId) {
        const wf = Boolean((e as unknown as { workflow?: unknown }).workflow)
        void $.clock.now().then(now => crewChanged($, crewJoin(crew, id, now, wf))).catch(() => {})
      }
    } catch {
      // see above
    }
    return res
  })

  // compaction of the main loop (manual, auto or by a plugin — not the background precompute): a long scene for its duration
  on('session.compact', async ($, e, next) => {
    if (e.agentId || e.trigger === 'precompute') return next(e)
    const since = await $.clock.now()
    await patchBuddy($, () => ({ compacting: true, compactSince: since }))
    try {
      return await next(e)
    } finally {
      void patchBuddy($, () => ({ compacting: false }))
    }
  })

  // The spinner says what the model is busy with: thinking / waiting for the server / writing / a tool, and retries.
  // Drawing writes nothing (not allowed) — the write is deferred to a timer; the engine draws the spinner as usual.
  // A subagent's spinner (requestId is its id; the main loop's is "main") does not touch the scene.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    try {
      if (!e.requestId || e.requestId === 'main') {
        const mode = (e.props.mode ?? '') as SpinnerMode
        const offline = spinnerOffline(e.props.message)
        // while a status message covers the spinner, the step word is not shown — do not parse it
        const wordTool = e.props.message ? '' : kindFromWord(e.props.word)
        const key = `${mode}|${wordTool}|${offline}`
        if (key !== lastSpinner) {
          lastSpinner = key
          $.clock.after(0, () =>
            void noteSpinner($, mode, wordTool, offline).then(ok => {
              if (!ok && lastSpinner === key) lastSpinner = '' // not written — retry on the next draw
            }))
        }
      }
    } catch {
      // failed — Clawd just won't know about "thinking"
    }
    return next(e)
  })

  // ultra mode is switched on and off by an engine insertion of its own type — the sunglasses follow it;
  // a relevant_memories insertion — the engine attached memories to the prompt: Clawd recalls
  on('session.append', { door: 'attachment' }, ($, e, next) => {
    try {
      const ultra = e.agentId ? null : ultraFromAttachment(e.message.name)
      if (ultra !== null) setUltra($, ultra).catch(() => {})
      if (!e.agentId && e.message.name === 'relevant_memories') flash($, 'recall').catch(() => {})
    } catch {
      // parsing an insertion must never get in the way of storing it
    }
    return next(e)
  })

  // the engine's memory notices: saved — memorizes, recalled — recalls
  on('session.append', { door: 'notice' }, ($, e, next) => {
    try {
      const name = e.agentId ? '' : e.message.name
      if (name === 'memory_saved') flash($, 'memorize').catch(() => {})
      else if (name === 'memory_recall') flash($, 'recall').catch(() => {})
    } catch {
      // see above
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      // an agent finished — its helper gets a check mark and dissolves
      const id = e.agentId
      if (crew.some(c => c.id === id && !c.leaving))
        void $.clock.now().then(now => crewChanged($, crewLeave(crew, id, now))).catch(() => {})
      return next(e)
    }
    // an answer — celebrate; an API error broke the turn — "offline" for 3 more minutes or until the next prompt
    setIdle($, e.reason === 'answer', e.reason === 'error').catch(() => {})
    return next(e)
  })

  // The band above the prompt: Clawd on top, then whatever the rest of the chain draws (other mods, the engine).
  // next(e) is always called, so a mod below this one is never silenced
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // the terminal has no Svg — nothing to draw there (the band is raised on the terminal and desktop only)
    if (e.surface === 'terminal') return next(e)
    const surface = $.ui.resolve(e)
    if (!('Svg' in surface)) return next(e)
    const b = await read($, buddy)
    const now = await $.clock.now()
    const helpers = b.helpers ?? 0
    // background agents while the main session is free — Clawd "supervises": a working scene with helpers
    const busy = e.props.isWorking || helpers > 0
    const mode = pickMode({
      isWorking: busy,
      mainWorking: e.props.isWorking,
      tool: e.props.isWorking ? b.tool ?? '' : '',
      flash: e.props.isWorking ? b.flash ?? '' : '',
      flashUntil: b.flashUntil ?? 0,
      spinner: e.props.isWorking ? b.spinner ?? '' : '',
      wordTool: e.props.isWorking ? b.wordTool ?? '' : '',
      compacting: b.compacting === true,
      compactSince: b.compactSince ?? 0,
      offlineSince: b.offlineSince ?? 0,
      idleSince: b.idleSince,
      celebrate: b.celebrate === true,
    }, now)
    const gear = { glasses: b.ultra === true }
    const st = stageFor($, mode, now, gear.glasses)
    const below = await next(e)
    const { Box } = surface
    return (
      <Box flexDirection="column">
        {/* explicit size: without it the desktop's interactive-picture frame picks its own height and leaves a gap */}
        <surface.Svg
          source={st.svg}
          alt={buddyAlt(st.place.mode, gear, crewView(crew, now).active)}
          width={STRIP_W}
          height={STRIP_H}
          isInteractive
        />
        {below}
      </Box>
    )
  })
}
