import { expect, test } from 'claude-code/testing'

import {
  type BuddyView, CELEBRATE_MS, COMPACT_MAX_MS, ENTRY_HIGHLIGHT, IDLE_CYCLE_MS, MODE_ALT, OFFLINE_HOLD_MS, SLEEP_AFTER_MS,
  WALK_MS, buddyAlt, buddySvg, clawdX, entryStart, helpersSide, idleMode, kindFromWord, memoryKind, modeForTool,
  msToNextIdleChange, nextStage, pickMode, placeScene, shiftTimeline, spinnerOffline, stageSvg, stageX, toolKind,
  type CrewEntry, LEAVE_MS, crewJoin, crewKey, crewLeave, crewPrune, crewView,
  ultraFromAttachment, ultraMarker,
} from './buddy'

// The main loop's tool -> scene
test('Clawd: tool kind', async () => {
  for (const t of ['Grep', 'Glob', 'Read', 'mcp__mail__mail_search', 'mcp__tracker__list_issues'])
    expect(toolKind(t)).toBe('search')
  for (const t of ['WebSearch', 'WebFetch', 'mcp__claude-in-chrome__navigate', 'mcp__playwright__browser_click',
    'mcp__scrapling__fetch', 'mcp__firecrawl__firecrawl_search'])
    expect(toolKind(t)).toBe('web')
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'mcp__sheets__create_spreadsheet', 'mcp__sheets__update_values'])
    expect(toolKind(t)).toBe('edit')
  for (const t of ['AskUserQuestion', 'ExitPlanMode']) expect(toolKind(t)).toBe('ask')
  expect(toolKind('Bash', { command: 'grep -rn foo .' })).toBe('search')
  expect(toolKind('Bash', { command: 'curl -s https://x' })).toBe('web')
  expect(toolKind('Bash', { command: 'git commit -m x' })).toBe('work')
  expect(toolKind('mcp__mail__trash_thread')).toBe('work')
  // the older name: search or not
  expect(modeForTool('Grep')).toBe('search')
  expect(modeForTool('Edit')).toBe('work')
})

// Memory: recalls (searching and reading the memory folder) and memorizes (writing into it)
test('Clawd: memory', async () => {
  const V = '/home/user/.claude/projects/-home-user-app/memory'
  for (const t of ['mcp__memory__search', 'mcp__memory__facts', 'mcp__memory__health', 'mcp__memory__stats'])
    expect(toolKind(t)).toBe('recall')
  expect(toolKind('mcp__memory__write_note')).toBe('memorize')
  // any memory MCP, by the words of its server or tool name
  expect(toolKind('mcp__mem0__add_memory')).toBe('memorize')
  expect(toolKind('mcp__mem0__search_memories')).toBe('recall')
  expect(toolKind('mcp__notes__search_memories')).toBe('recall')
  expect(toolKind('mcp__plugin_kb_memory-bank__get_entry')).toBe('recall')
  expect(toolKind('mcp__plugin_kb_memory-bank__store_entry')).toBe('memorize')
  expect(toolKind('mcp__knowledge__remember_fact')).toBe('memorize')
  expect(memoryKind('mcp__notes__search_notes')).toBe('')
  expect(memoryKind('mcp__memoryless__get')).toBe('')
  expect(toolKind('Read', { file_path: `${V}/MEMORY.md` })).toBe('recall')
  expect(toolKind('Grep', { pattern: 'Clawd', path: `${V}/notes` })).toBe('recall')
  expect(toolKind('Glob', { pattern: '*.md', path: '/home/user/.claude/projects/-home-user-other/memory/topics' })).toBe('recall')
  expect(toolKind('Edit', { file_path: `${V}/topics/clawd.md` })).toBe('memorize')
  expect(toolKind('Write', { file_path: `${V}/notes/2026-10-08_x.md` })).toBe('memorize')
  expect(toolKind('Bash', { command: 'cd /home/user/.claude && git add projects/-home-user-app/memory/MEMORY.md && git commit -m x' }))
    .toBe('memorize')
  expect(toolKind('Bash', { command: `grep -n Clawd ${V}/MEMORY.md` })).toBe('recall')
  // not memory: ordinary files and commands
  expect(memoryKind('Read', { file_path: '/home/user/app/tools/memory_check.py' })).toBe('')
  expect(memoryKind('Edit', { file_path: '/home/user/app/notes/memory.md' })).toBe('')
  expect(memoryKind('Bash', { command: 'free -m' })).toBe('')
  // the step word: the engine's built-in memory
  expect(kindFromWord('Saving memory notes.md')).toBe('memorize')
  expect(kindFromWord('Reading memory')).toBe('recall')
  expect(kindFromWord('Listing memory documents')).toBe('recall')
  // a flash from an engine insertion holds until flashUntil; a running tool wins
  const now = 7_000_000
  const v: BuddyView = { isWorking: true, tool: '', spinner: 'requesting', compacting: false, offlineSince: 0, idleSince: 0, celebrate: false }
  expect(pickMode({ ...v, flash: 'recall', flashUntil: now + 1000 }, now)).toBe('recall')
  expect(pickMode({ ...v, flash: 'recall', flashUntil: now }, now)).toBe('think')
  expect(pickMode({ ...v, flash: 'recall', flashUntil: now + 1000, tool: 'edit' }, now)).toBe('edit')
})

// Coffee at work: entering the work scene starts right at the sip if there was none for 40 s
test('Clawd: coffee at work', async () => {
  const t0 = 1_000_000
  const at = ENTRY_HIGHLIGHT.work!.at
  expect(entryStart('work', t0, undefined)).toBe(at)
  expect(entryStart('work', t0 + 10_000, t0)).toBe(0)
  expect(entryStart('work', t0 + 40_000, t0)).toBe(at)
  expect(entryStart('think', t0, undefined)).toBe(0)
  const svg = '<g><animate attributeName="opacity" values="0;1" dur="10s" repeatCount="indefinite"/>' +
    '<set attributeName="x" to="1" begin="1.2s" dur="1s"/><animate attributeName="y" begin="a.end" dur="1s"/></g>'
  const s = shiftTimeline(svg, 5.3)
  expect(s).toContain('repeatCount="indefinite" begin="-5.3s"/>')
  expect(s).toContain('begin="-4.1s"')
  expect(s).toContain('begin="a.end"')
  expect(shiftTimeline(svg, 0)).toBe(svg)
  // a shifted work scene is the same valid SVG with all its animations shifted
  const w = buddySvg('work', { glasses: false }, 0, at)
  expect(w.startsWith('<svg')).toBe(true)
  expect((w.match(/begin="-/g) ?? []).length).toBe((buddySvg('work', { glasses: false }).match(/<(animate|set)/g) ?? []).length)
})

// Clawd stays put: a new scene is placed under him, mirrored near an edge; no steps, the old one fades
test('Clawd: smooth transitions', async () => {
  for (const x of [80, 200, 360, 520, 650]) {
    for (const m of ['think', 'work', 'edit', 'search', 'web', 'ask', 'recall', 'memorize', 'coffee'] as const) {
      const p = placeScene(m, 0, x)
      expect(`${m} at ${x}: ${Math.abs(stageX(p, undefined, 0) - x) < 1}`).toBe(`${m} at ${x}: true`)
    }
  }
  // near the right edge — mirrored (laptop on Clawd's left), in the middle — as drawn
  expect(placeScene('work', 0, 650).flip).toBe(true)
  expect(placeScene('work', 0, 200).flip).toBe(false)
  // a walk continues from where Clawd stands
  const r = placeScene('walk', 0, 300)
  expect(Math.abs(clawdX('walk', r.startAt) - 300)).toBeLessThan(12)
  // searched with the magnifier and moved right -> started working: the laptop appears right there, no steps back
  const sp = placeScene('search', 0, 200)
  const step = nextStage({ place: sp, since: 0 }, 'work', 5_000, 0)
  expect(step.walk).toBe(undefined)
  expect(Math.abs(stageX(step.place, undefined, 0) - stageX(sp, undefined, 5))).toBeLessThan(1)
  // helpers go to the free side
  expect(helpersSide(placeScene('work', 0, 120))).toBe('right')
  expect(helpersSide(placeScene('work', 0, 600))).toBe('left')
  const svg = stageSvg({ to: step.place, gear: { glasses: false }, from: step.from, helperCount: 2 })
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('<!--stage to=work')
  expect(svg).toContain('from=search')
  expect(svg.length).toBeLessThan(131072)
  expect(svg).not.toContain('<script')
})

// Helpers are the main session's agents: each in its own slot, extra ones queued, a finished one gets a check mark and dissolves
test('Clawd: helpers per agent', async () => {
  let c: CrewEntry[] = []
  for (const id of ['a', 'b', 'c', 'd', 'e']) c = crewJoin(c, id, 0)
  expect(c.map(x => x.slot).join(',')).toBe('0,1,2,3,')
  expect(crewView(c, 1_000).extra).toBe(1)
  expect(crewView(c, 1_000).active).toBe(5)
  expect(crewView(c, 100).slots[0]!.state).toBe('arrive')
  c = crewLeave(c, 'b', 2_000)
  const v = crewView(c, 2_100)
  expect(v.slots.find(s => s.slot === 1)!.state).toBe('leave')
  expect(v.active).toBe(4)
  expect(crewKey(v)).toBe('0w,1l,2w,3w+1')
  // after LEAVE_MS the slot is free — the waiting one takes it
  c = crewPrune(c, 2_000 + LEAVE_MS)
  expect(c.find(x => x.id === 'e')!.slot).toBe(1)
  expect(crewView(c, 2_000 + LEAVE_MS).extra).toBe(0)
  // left from the queue — no animation
  c = crewJoin(c, 'f', 5_000)
  c = crewLeave(c, 'f', 5_100)
  expect(c.some(x => x.id === 'f')).toBe(false)
  // a strip with a leaving helper and waiting ones is valid SVG
  const svg = stageSvg({ to: placeScene('work', 0), gear: { glasses: false }, crew: crewView(crewLeave(c, 'a', 6_000), 6_200) })
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.length).toBeLessThan(131072)
})

// Idle: celebrate 4 s after an answer, then a 24 s walk and 16 s of coffee in a loop; after 20 min — sleep
test('Clawd: idle phases', async () => {
  const t0 = 1_000_000
  expect(idleMode(t0, t0, true)).toBe('celebrate')
  expect(idleMode(t0 + CELEBRATE_MS, t0, true)).toBe('walk')
  expect(idleMode(t0 + CELEBRATE_MS + WALK_MS, t0, true)).toBe('coffee')
  expect(idleMode(t0 + CELEBRATE_MS + IDLE_CYCLE_MS, t0, true)).toBe('walk')
  expect(idleMode(t0, t0, false)).toBe('walk') // session start — no celebration
  expect(idleMode(t0 + WALK_MS, t0)).toBe('coffee')
  expect(idleMode(t0 + SLEEP_AFTER_MS, t0, true)).toBe('sleep')
  expect(msToNextIdleChange(t0, t0, true)).toBe(CELEBRATE_MS)
  expect(msToNextIdleChange(t0 + CELEBRATE_MS, t0, true)).toBe(WALK_MS)
  expect(msToNextIdleChange(t0, t0)).toBe(WALK_MS)
  expect(msToNextIdleChange(t0 + SLEEP_AFTER_MS - 1000, t0)).toBe(1000)
})

// Scene by state: compact beats everything, then offline, then the tool, thinking, work, idle
test('Clawd: scene choice', async () => {
  const now = 5_000_000
  const v: BuddyView = { isWorking: true, tool: '', spinner: '', compacting: false, offlineSince: 0, idleSince: 0, celebrate: false }
  expect(pickMode(v, now)).toBe('work')
  expect(pickMode({ ...v, spinner: 'thinking' }, now)).toBe('think')
  expect(pickMode({ ...v, spinner: 'requesting' }, now)).toBe('think')
  expect(pickMode({ ...v, spinner: 'responding' }, now)).toBe('work')
  expect(pickMode({ ...v, spinner: 'thinking', tool: 'search' }, now)).toBe('search')
  expect(pickMode({ ...v, tool: 'ask' }, now)).toBe('ask')
  expect(pickMode({ ...v, offlineSince: now - 1000, tool: 'edit' }, now)).toBe('offline')
  expect(pickMode({ ...v, compacting: true, offlineSince: now - 1000 }, now)).toBe('compact')
  // a compact flag stuck for longer than 15 min (the compaction broke off) does not hold the scene
  expect(pickMode({ ...v, compacting: true, compactSince: now - 1000 }, now)).toBe('compact')
  expect(pickMode({ ...v, compacting: true, compactSince: now - COMPACT_MAX_MS }, now)).toBe('work')
  // the desktop step word: an edit shows while the model writes the file; thinking beats the word
  expect(pickMode({ ...v, spinner: 'tool-use', wordTool: 'edit' }, now)).toBe('edit')
  expect(pickMode({ ...v, spinner: 'thinking', wordTool: 'search' }, now)).toBe('think')
  // offline after an error while only helpers work — at most 3 min; while the main session works — as long as it works
  expect(pickMode({ ...v, mainWorking: false, offlineSince: now - OFFLINE_HOLD_MS }, now)).toBe('work')
  expect(pickMode({ ...v, mainWorking: true, offlineSince: now - OFFLINE_HOLD_MS }, now)).toBe('offline')
  // after a turn broken by an error: offline holds 3 min, then ordinary idling
  const idle = { ...v, isWorking: false, idleSince: now - 1000, offlineSince: now - 1000 }
  expect(pickMode(idle, now)).toBe('offline')
  expect(pickMode(idle, now + OFFLINE_HOLD_MS)).toBe('walk')
  expect(spinnerOffline('Retrying in 5s…')).toBe(true)
  expect(spinnerOffline('Reconnecting…')).toBe(true)
  expect(spinnerOffline('Переподключение…')).toBe(true)
  expect(spinnerOffline('Creating notes.md')).toBe(false)
  expect(spinnerOffline(null)).toBe(false)
})

// The spinner's step word (desktop) -> kind of work; the terminal's random one-word verb is not parsed
test('Clawd: step word', async () => {
  for (const w of ['Editing notes.md', 'Writing src/app.ts', 'Creating notes.md', 'Editing notebook a.ipynb'])
    expect(kindFromWord(w)).toBe('edit')
  for (const w of ['Reading app.py', 'Searching for TODO', 'Finding **/*.ts'])
    expect(kindFromWord(w)).toBe('search')
  for (const w of ['Fetching https://example.com', 'Searching the web']) expect(kindFromWord(w)).toBe('web')
  for (const w of ['Running npm test', 'Running task', 'Working', 'Creating', 'Sauteing', 'Размышление', ''])
    expect(kindFromWord(w)).toBe('')
  expect(kindFromWord(null)).toBe('')
})

// Sunglasses — in ultra mode only
test('Clawd: sunglasses in ultra mode', async () => {
  expect(ultraFromAttachment('ultra_effort_enter')).toBe(true)
  expect(ultraFromAttachment('ultra_effort_exit')).toBe(false)
  expect(ultraFromAttachment('invoked_skills')).toBe(null)
  expect(ultraMarker('<system-reminder>\nUltracode is on: optimize\n</system-reminder>')).toBe(true)
  expect(ultraMarker('<system-reminder>\nUltracode is still on — use the Workflow tool\n</system-reminder>')).toBe(true)
  expect(ultraMarker('<system-reminder>\nUltracode is off — the standard opt-in rule applies again.\n</system-reminder>')).toBe(false)
  expect(ultraMarker('<system-reminder>\nThe following skills were invoked… confirms ultracode is on… If ultracode is off, revert\n</system-reminder>')).toBe(null)
  expect(buddyAlt('walk', { glasses: true })).toBe('Clawd is taking a walk, in sunglasses')
  expect(buddyAlt('work', { glasses: false }, 3)).toBe('Clawd is working at the laptop; helpers: 3')
})

// Every scene is valid SVG with nothing forbidden, within the engine's size limit
test('Clawd: every scene builds', async () => {
  for (const m of Object.keys(MODE_ALT) as (keyof typeof MODE_ALT)[]) {
    for (const glasses of [false, true]) {
      const svg = buddySvg(m, { glasses }, 3)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.length).toBeLessThan(131072)
      expect(svg).not.toContain('<script')
      expect(svg).not.toContain('<style')
    }
  }
})
