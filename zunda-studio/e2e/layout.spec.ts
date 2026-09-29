import { expect, test, type Locator, type Page } from '@playwright/test'

import { openFresh, updateSettings, useFakeAi } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

async function drag(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 })
  await page.mouse.move(x + dx, y + dy, { steps: 3 })
  await page.mouse.up()
}

async function width(locator: Locator): Promise<number> {
  return (await locator.boundingBox())!.width
}

async function height(locator: Locator): Promise<number> {
  return (await locator.boundingBox())!.height
}

test('欄の境界をドラッグして大きさを変え、次に開いても保たれ、元に戻せる', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('/')
  await page.evaluate(() => (globalThis as unknown as { localStorage: { removeItem(key: string): void } }).localStorage.removeItem('zs.layout'))
  await openFresh(page)

  const script = page.locator('.pane--script')
  const side = page.locator('.pane--side')
  const timeline = page.getByTestId('timeline')
  const preview = page.locator('.pane--preview')
  const before = { script: await width(script), side: await width(side), timeline: await height(timeline), preview: await height(preview) }

  // インスペクタは右の欄のタブにあるので、中央はプレビューが縦いっぱいに使う
  await expect(page.getByTestId('splitter-inspector')).toHaveCount(0)
  await expect(page.getByTestId('side-tab-inspector')).toBeVisible()
  expect(before.preview).toBeGreaterThan(before.timeline)

  await drag(page, page.getByTestId('splitter-left'), 120, 0)
  await drag(page, page.getByTestId('splitter-right'), 80, 0)
  await drag(page, page.getByTestId('splitter-timeline'), 0, -90)

  await expect.poll(() => width(script)).toBeGreaterThan(before.script + 100)
  await expect.poll(() => width(side)).toBeLessThan(before.side - 60)
  await expect.poll(() => height(timeline)).toBeGreaterThan(before.timeline + 70)

  // 開き直しても保たれる
  const widened = await width(script)
  await page.reload()
  await openFresh(page)
  await expect.poll(() => width(script)).toBeGreaterThan(widened - 3)

  // 左端の限界より先には広がらない(中央のプレビューが残る)
  await drag(page, page.getByTestId('splitter-left'), 1400, 0)
  await expect.poll(async () => width(page.locator('.pane--preview'))).toBeGreaterThan(300)

  // キーボードでも動かせる
  const splitter = page.getByTestId('splitter-timeline')
  const current = Number(await splitter.getAttribute('aria-valuenow'))
  await splitter.focus()
  await page.keyboard.press('ArrowUp')
  await expect(splitter).toHaveAttribute('aria-valuenow', String(current + 2))

  // ダブルクリックでその境界だけ、右クリックからすべてを元に戻す
  await page.getByTestId('splitter-left').dblclick()
  await expect.poll(() => width(script)).toBeLessThan(before.script + 3)
  await page.getByTestId('splitter-left').click({ button: 'right' })
  await page.getByTestId('context-menu').getByTestId('menu-reset-layout').click()
  await expect.poll(() => height(timeline)).toBeLessThan(before.timeline + 3)
  await expect.poll(() => width(side)).toBeGreaterThan(before.side - 3)
})

test('インスペクタは右の欄のタブ。タイムラインで選ぶと切り替わり、台本の行を選んでも切り替わらない', async ({ page, request }) => {
  await updateSettings(request, {
    voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
  })
  await useFakeAi(request)
  await openFresh(page)
  await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
  await page.getByTestId('add-line').click()
  await expect(page.getByTestId('script-line')).toHaveCount(1)

  // 最初はチャット。書きかけの指示を入れておく
  await expect(page.getByTestId('side-tab-chat')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('chat-input').fill('テンポを上げたい')

  // 台本の行を選んでも、右の欄はチャットのまま
  await page.getByTestId('script-line').first().click({ position: { x: 6, y: 6 } })
  await expect(page.getByTestId('side-tab-chat')).toHaveAttribute('aria-selected', 'true')

  // タイムラインに素材を置いて選ぶと、インスペクタに切り替わる
  await page.getByTestId('add-caption').click()
  await expect(page.getByTestId('side-tab-inspector')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('inspector-type')).toHaveText('テロップ')

  // チャットに戻っても書きかけは残っている
  await page.getByTestId('side-tab-chat').click()
  await expect(page.getByTestId('chat-input')).toHaveValue('テンポを上げたい')

  // タイムラインの素材をクリックすると、またインスペクタ
  await page.locator('[data-item-type="text"]').click()
  await expect(page.getByTestId('side-tab-inspector')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('inspector-start')).toBeVisible()
})
