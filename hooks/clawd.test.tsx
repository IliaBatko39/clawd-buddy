import { expect, mock, test } from 'claude-code/testing'

// The band above the prompt: Clawd is drawn as a picture where the surface has Svg (desktop), and whatever the rest of
// the chain draws below him stays (next(e) is always called); on the terminal the band is left to the chain untouched
test('Clawd: drawn above the rest of the band, never silences it', async ($, on) => {
  mock.clock(on)
  // beneath the mod another mod (or the engine) draws its own row
  on('ui.render', async ($$, e) => {
    const { Box, Text } = $$.ui.resolve(e)
    return (
      <Box>
        <Text>row from below</Text>
      </Box>
    )
  })
  on('session.start', async () => ({ cwd: '/tmp/project' }))
  await $.session.start({ cwd: '/tmp/project', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'clawd-buddy', surface, component: 'AbovePrompt',
      // the hook reads only hasSurvey and isWorking; the surface sets the rest (sizes, scrolling)
      props: { hasSurvey: false, isWorking: false } as never,
    })
    expect(`${surface}: ${Boolean(await ui.find({ type: 'Text', text: /row from below/ }))}`).toBe(`${surface}: true`)
    // on the terminal the band is exactly what the chain below drew
    if (surface === 'terminal') expect(JSON.stringify(await ui.drawn())).toBe('{"type":"Box","children":[{"type":"Text","children":["row from below"]}]}')
    const clawd = (await ui.find({ type: 'Svg' } as never)) as { props?: { alt?: string; width?: number; height?: number } } | undefined
    if (surface === 'desktop') {
      expect(clawd?.props?.alt ?? '').toContain('Clawd')
      expect(`${clawd?.props?.width}x${clawd?.props?.height}`).toBe('720x58')
    } else expect(clawd).toBeUndefined()
    await ui.unmount()
  }
  // a survey holds the band — Clawd steps aside
  const survey = await $.ui.mount({
    plugin: 'clawd-buddy', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: true, isWorking: false } as never,
  })
  expect(await survey.find({ type: 'Svg' } as never)).toBeUndefined()
  await survey.unmount()
})

// Clawd learns the session's state from the spinner and the tools; scenes change smoothly and at most once in 2 s
test('Clawd: spinner and tools -> scene', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  on('session.start', async () => ({ cwd: '/tmp/project' }))
  await $.session.start({ cwd: '/tmp/project', surface: 'desktop', isInteractive: true })
  await clock.advance(0)

  // what is drawn above the prompt: the picture's alt and the scene tag in the SVG (<!--stage to=... start=... from=...-->);
  // the whole SVG is not needed in a failure's output
  const clawd = async () => {
    const ui = await $.ui.mount({
      plugin: 'clawd-buddy', surface: 'desktop', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true } as never,
    })
    const node = (await ui.find({ type: 'Svg' } as never)) as { props?: { alt?: string; source?: string } } | undefined
    await ui.unmount()
    const tag = /<!--stage ([^>]*)-->/.exec(node?.props?.source ?? '')?.[1] ?? ''
    const kv = Object.fromEntries(tag.split(' ').filter(Boolean).map(p => p.split('=') as [string, string]))
    return { alt: node?.props?.alt ?? '', start: Number(kv.start ?? 0), from: kv.from ?? '' }
  }
  const alt = async () => (await clawd()).alt
  const settle = () => clock.advance(2_100) // a scene holds for at least 2 s

  // the spinner says "thinking" — Clawd thinks
  const spinner = await $.ui.mount({
    plugin: 'clawd-buddy', surface: 'desktop', component: 'Spinner', requestId: 'main',
    props: { word: 'Pondering', message: null, suffix: '…', mode: 'thinking' } as never,
  })
  await clock.advance(10)
  expect(await alt()).toBe('Clawd is thinking')

  // a subagent's spinner (requestId is the agent's id) does not touch the main loop's scene
  const sub = await $.ui.mount({
    plugin: 'clawd-buddy', surface: 'desktop', component: 'Spinner', requestId: 'agent-7',
    props: { word: 'Editing notes.md', message: null, suffix: '…', mode: 'tool-use' } as never,
  })
  await settle()
  expect(await alt()).toBe('Clawd is thinking')
  await sub.unmount()

  // the desktop spells the step out: "Editing notes.md" — the edit shows while the model still writes the file; smooth change
  await spinner.redraw({ word: 'Editing notes.md', message: null, suffix: '…', mode: 'tool-use' } as never)
  await clock.advance(10)
  const edit = await clawd()
  expect(`step word: ${edit.alt}`).toBe('step word: Clawd is editing a file')
  expect(`fading out: ${edit.from}`).toBe('fading out: think')
  // back to "thinking" at once — the edit holds its 2 s, then the scene changes
  await spinner.redraw({ word: 'Pondering', message: null, suffix: '…', mode: 'thinking' } as never)
  await clock.advance(10)
  expect(`holds: ${await alt()}`).toBe('holds: Clawd is editing a file')
  await settle()
  expect(`after 2 s: ${await alt()}`).toBe('after 2 s: Clawd is thinking')

  // the edit itself takes milliseconds — its scene holds 6 s (and while the model waits for the server), then "thinking"
  await spinner.redraw({ word: 'Working', message: null, suffix: '…', mode: 'requesting' } as never)
  // the test engine has no tools: the call is refused at the bottom of the chain, but the mod's hook saw it — an instant edit
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/x.md', old_string: 'a', new_string: 'b' } as never).catch(() => {})
  await settle()
  expect(`after the edit: ${await alt()}`).toBe('after the edit: Clawd is editing a file')
  await clock.advance(6_500)
  expect(`after 6.5 s: ${await alt()}`).toBe('after 6.5 s: Clawd is thinking')

  // a memory search — recalls; writing a note into the memory folder — memorizes
  await $.tool.call({ tool: 'mcp__memory__search', q: 'Clawd' } as never).catch(() => {})
  await settle()
  expect(`memory search: ${await alt()}`).toBe('memory search: Clawd is recalling')
  await $.tool.call({ tool: 'Write', file_path: '/tmp/clawd-test/.claude/projects/-tmp-project/memory/x.md', content: 'x' } as never)
    .catch(() => {})
  await settle()
  expect(`memory write: ${await alt()}`).toBe('memory write: Clawd is memorizing')

  // work: the first entry starts with a sip of coffee; back to work after 10 s — from the start; after 40 s — coffee again
  await clock.advance(6_500)
  await spinner.redraw({ word: 'Working', message: null, suffix: '…', mode: 'responding' } as never)
  await settle()
  const work = await clawd()
  expect(`work: ${work.alt}`).toBe('work: Clawd is working at the laptop')
  expect(`with coffee: ${work.start > 0}`).toBe('with coffee: true')
  await spinner.redraw({ word: 'Pondering', message: null, suffix: '…', mode: 'thinking' } as never)
  await settle()
  expect(await alt()).toBe('Clawd is thinking')
  await clock.advance(8_000)
  await spinner.redraw({ word: 'Working', message: null, suffix: '…', mode: 'responding' } as never)
  await settle()
  expect(`after 10 s: ${(await clawd()).start}`).toBe('after 10 s: 0')
  await spinner.redraw({ word: 'Pondering', message: null, suffix: '…', mode: 'thinking' } as never)
  await settle()
  expect(await alt()).toBe('Clawd is thinking')
  await clock.advance(30_000)
  await spinner.redraw({ word: 'Working', message: null, suffix: '…', mode: 'responding' } as never)
  await settle()
  expect(`after 40 s: ${(await clawd()).start > 0}`).toBe('after 40 s: true')
  await spinner.unmount()

  // compaction is not checked here: the test engine's $.session.compact() runs without a conversation and the engine
  // skips the hook; the scene choice during compaction is covered by the pickMode test in buddy.test.ts
})
