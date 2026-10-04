import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { makeTestAudio, makeTestVideo } from '../tests/fixtures/media'
import { openFresh, queuePick } from './helpers'

/** タイムラインのアイテムを右クリックして、メニューの項目(サブメニューならたどって)を押す。 */
async function itemMenu(page: Page, type: string, path: string[], index = 0): Promise<void> {
  await page.locator(`[data-item-type="${type}"]`).nth(index).click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  for (const label of path.slice(0, -1)) await menu.getByText(label, { exact: true }).hover()
  await menu.getByText(path.at(-1)!, { exact: true }).click()
}

async function importFile(page: Page, request: Parameters<typeof queuePick>[0], path: string, type: string): Promise<void> {
  const before = await page.locator(`[data-item-type="${type}"]`).count()
  await queuePick(request, [path])
  await page.getByTestId('add-media').click()
  await expect(page.locator(`[data-item-type="${type}"]`)).toHaveCount(before + 1)
}

test.describe('動画をリッチにする編集', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-rich-'))
  let video: string
  let still: string
  let bgm: string
  let pon: string

  test.beforeAll(() => {
    video = makeTestVideo(directory, { seconds: 4 })
    bgm = makeTestAudio(directory, { seconds: 4, name: 'bgm.wav' })
    pon = makeTestAudio(directory, { seconds: 0.5, name: 'pon.wav', frequency: 880 })
    // 0〜3秒は動く、3〜9秒は止まっている録画(待ち時間)。
    still = join(directory, 'wait.mp4')
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'color=c=blue:size=320x180:rate=30:duration=6',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]',
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', still
    ])
  })

  test('装飾のひな形を選ぶと、吹き出しとテロップがグループで置かれ、インスペクタで形や縁取りを変えられる', async ({ page }) => {
    await openFresh(page)
    await page.getByTestId('open-decorations').click()
    await page.getByTestId('decoration-category-bubble').check()
    await page.getByTestId('decoration-bubble-white').click()
    await expect(page.locator('[data-item-type="shape"]')).toHaveCount(1)
    await expect(page.locator('[data-item-type="text"]')).toHaveCount(1)
    // 吹き出しと文字は一緒に動くグループになる。
    const groups = await page.locator('[data-testid="timeline-item"][data-group-id]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-group-id')))
    expect(groups).toHaveLength(2)
    expect(groups[0]).toBe(groups[1])
    // 「装飾」と「装飾の文字」のレイヤーができる。
    await expect(page.locator('.timeline__layerName', { hasText: '装飾の文字' })).toHaveCount(1)

    await page.getByTestId('side-tab-inspector').click()
    await expect(page.getByTestId('shape-inspector')).toBeVisible()
    await page.getByTestId('shape-kind').selectOption('shout')
    await expect(page.locator('[data-item-type="shape"]')).toHaveAttribute('title', /叫び吹き出し/)
    await page.getByTestId('shape-outer-stroke').check()
    await page.getByTestId('shape-shadow').selectOption('glow')
    // 取り消すと、光らせる前(ひな形の影)に戻る。
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByTestId('shape-shadow')).toHaveValue('drop')
  })

  test('動画を切り抜き、小窓にし、色を調整し、前の動画から重ねて切り替えられる', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, video, 'video')
    await page.locator('[data-item-type="video"]').first().click()
    await page.getByTestId('side-tab-inspector').click()
    // 数字で左を 25% 切り抜く。
    const left = page.getByTestId('crop-left')
    await left.fill('25')
    await left.press('Enter')
    await expect(page.getByTestId('crop-reset')).toBeVisible()
    // プレビューで切り抜きの枠を出し、右の辺をドラッグする。
    await page.getByTestId('crop-edit').click()
    const frame = page.getByTestId('crop-frame')
    await expect(frame).toHaveAttribute('data-crop', '0.25,0,0,0')
    const handle = (await page.getByTestId('crop-handle-e').boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x - 40, handle.y + handle.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect(frame).not.toHaveAttribute('data-crop', '0.25,0,0,0')
    await frame.dblclick()
    await expect(frame).toHaveCount(0)

    // 小窓(右下)と白黒。
    await itemMenu(page, 'video', ['小窓(ワイプ)', '右下の小窓にする'])
    await expect(page.getByTestId('frame-inspector')).toBeVisible()
    await page.getByTestId('adjust-preset-mono').click()
    await expect(page.getByTestId('adjust-saturation')).toHaveValue('0')

    // もう1つ動画を後ろにつなげて、前の動画からクロスフェードで切り替える。
    await page.getByTestId('playhead').click()
    await page.keyboard.press('End')
    await importFile(page, request, video, 'video')
    await itemMenu(page, 'video', ['動き・切り替え', '前の素材から切り替える(重ねる)', 'クロスフェード(0.5秒)'], 1)
    // どちらも素材の端まで使っていて重ねられないので、前の動画を消していってから後の動画を出す。
    await page.locator('[data-item-type="video"][title*="0:04.000 –"]').click()
    await expect(page.getByTestId('effects-inspector')).toContainText('登場・退場の切り替え')
    await expect(page.getByTestId('transition-in')).toHaveValue('fade')
  })

  test('目印を置いてメモを書き、一覧から移動できる', async ({ page }) => {
    await openFresh(page)
    await page.getByTestId('add-caption').click()
    await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } })
    await page.keyboard.press('m')
    const marker = page.getByTestId('timeline-marker')
    await expect(marker).toHaveCount(1)
    await marker.dblclick()
    await page.getByTestId('marker-text').fill('ボス登場')
    await page.getByTestId('marker-save').click()
    await expect(marker).toContainText('ボス登場')
    // 先頭へ戻ってから、一覧で目印を選ぶと、その時刻へ移る。
    await page.keyboard.press('Home')
    await page.getByTestId('open-markers').click()
    await page.getByTestId('menu-marker-item').click()
    await expect(page.getByTestId('playhead')).not.toHaveText(/^0:00\.000/)
    // Shift+M はメモの画面も開く。
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+M')
    await expect(page.getByTestId('marker-text')).toBeVisible()
    await page.getByTestId('marker-remove').click()
    await expect(marker).toHaveCount(1)
  })

  test('BGM に音量の点を置いて動かせ、効果音をパレットに登録して数字キーで置ける', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, bgm, 'audio')
    const item = page.locator('[data-item-type="audio"]').first()
    await item.click()
    const line = page.getByTestId('volume-line')
    await expect(line).toBeVisible()
    const box = (await line.boundingBox())!
    // Alt+クリックで点を足す(線の高さの真ん中 = 100%)。
    await page.keyboard.down('Alt')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.up('Alt')
    await expect(page.getByTestId('volume-point')).toHaveCount(1)
    // 右クリックの「前後1秒だけ下げる」で、下げる区間の前後に点が入る(区間の中にあった点は外れる)。
    await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } })
    await itemMenu(page, 'audio', ['音量の点(時間で音量を変える)', '再生位置の前後1秒だけ下げる(30%)'])
    await item.click()
    await expect(page.getByTestId('volume-point')).toHaveCount(4)

    // 効果音のパレット。
    await page.getByTestId('open-sounds').click()
    await queuePick(request, [pon])
    await page.getByTestId('sound-register').click()
    await expect(page.getByTestId('sound-entry')).toHaveCount(1)
    await page.getByRole('button', { name: '閉じる' }).last().click()
    await page.keyboard.press('Home')
    await page.keyboard.press('1')
    await expect(page.locator('[data-item-type="audio"]')).toHaveCount(2)
    await expect(page.locator('.timeline__layerName', { hasText: '効果音' })).toHaveCount(1)
  })

  test('止まっている区間を探して早送りにし、「▶▶ ×4」が出て、1回で元に戻せる', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, still, 'video')
    await itemMenu(page, 'video', ['待ち時間を探して詰める・早送り…'])
    await expect(page.getByTestId('lull-item')).toHaveCount(1, { timeout: 30_000 })
    await page.getByTestId('lull-apply').click()
    await expect(page.locator('[data-item-type="text"]')).toHaveText(/▶▶ ×4/)
    await expect(page.locator('[data-item-type="video"]')).toHaveCount(3)
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.locator('[data-item-type="video"]')).toHaveCount(1)
    await expect(page.locator('[data-item-type="text"]')).toHaveCount(0)
  })

  test('選んだものをひな形にして、新しいプロジェクトの先頭に入れられる', async ({ page }) => {
    // 「新規」で保存していない変更を捨ててよいか聞かれるので、はいと答える。
    page.on('dialog', (dialog) => void dialog.accept())
    await openFresh(page)
    await page.getByTestId('add-caption').click()
    await page.getByTestId('open-templates').click()
    await page.getByTestId('menu-template-save').click()
    await page.getByTestId('template-name').fill('毎回のあいさつ')
    await page.getByTestId('template-save').click()
    await page.getByRole('button', { name: '新規' }).click()
    await page.getByTestId('add-caption').click()
    await expect(page.locator('[data-item-type="text"]')).toHaveCount(1)
    await page.getByTestId('open-templates').click()
    const menu = page.getByTestId('context-menu')
    await menu.getByText(/毎回のあいさつ/).hover()
    await menu.getByTestId('menu-template-start').click()
    await expect(page.locator('[data-item-type="text"]')).toHaveCount(2)
    // 元からあったテロップは、ひな形の長さ(3秒)だけ後ろへずれる。
    await expect(page.locator('[data-item-type="text"]').nth(1)).toHaveAttribute('title', /0:03\.000/)
  })

  test('動画の大きさを変え、一部から縦型のショートを作って開ける', async ({ page, request }) => {
    page.on('dialog', (dialog) => void dialog.accept())
    await openFresh(page)
    await importFile(page, request, video, 'video')
    await page.getByTestId('open-canvas').click()
    await page.getByTestId('canvas-preset').selectOption('720p')
    await page.getByTestId('canvas-apply').click()
    await expect(page.getByTestId('open-canvas')).toHaveText(/1280×720/)

    await page.getByTestId('open-short').click()
    const short = join(directory, 'short.zsproj')
    await queuePick(request, [short])
    await page.getByTestId('short-create').click()
    await expect(page.getByTestId('open-canvas')).toHaveText(/1080×1920/)
    await expect(page.getByLabel('プロジェクト名')).toHaveValue(/ショート/)
    // 後ろにぼかした映像を敷くので、動画は2つになる。
    await expect(page.locator('[data-item-type="video"]')).toHaveCount(2)
  })
})
