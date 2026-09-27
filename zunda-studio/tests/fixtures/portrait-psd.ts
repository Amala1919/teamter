import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCanvas } from '@napi-rs/canvas'
import { initializeCanvas, writePsdBuffer, type Layer } from 'ag-psd'

/**
 * テスト用の立ち絵 PSD。パーツごとに色を変えた矩形で、描画結果を画素の色で確かめられるようにしてある。
 *
 *   からだ(灰)     0,0 - 200,300
 *   影(からだにクリッピング、乗算の黒 50%) 0,250 - 200,300
 *   !目: *開き(緑) *半目(黄) *閉じ(黒)      40,50 - 160,80
 *   !口: あ い う え お ん(それぞれ別の色)     80,150 - 120,170
 *   !眉: 通常(茶) 怒り(紫)                   40,30 - 160,40
 *   ほっぺ(桃、マスクで左半分だけ見える)      20,120 - 60,140
 *   メガネ(青、非表示)                        40,90 - 160,100
 */
export const COLORS = {
  body: [100, 100, 100],
  eyeOpen: [0, 200, 0],
  eyeHalf: [220, 220, 0],
  eyeClosed: [0, 0, 0],
  mouth: {
    a: [255, 0, 0],
    i: [255, 128, 0],
    u: [0, 128, 255],
    e: [128, 0, 255],
    o: [255, 0, 255],
    n: [60, 30, 30]
  },
  browNormal: [120, 70, 20],
  browAngry: [150, 0, 150],
  cheek: [255, 150, 180],
  glasses: [0, 0, 255]
} as const

export const POINTS = {
  eye: [100, 65],
  mouth: [100, 160],
  brow: [100, 35],
  body: [10, 200],
  shadow: [10, 280],
  cheekLeft: [25, 130],
  cheekRight: [55, 130],
  glasses: [100, 95]
} as const

function solid(
  name: string,
  rect: [number, number, number, number],
  color: readonly number[],
  extra: Partial<Layer> = {}
): Layer {
  const [left, top, right, bottom] = rect
  const width = right - left
  const height = bottom - top
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = color[0]!
    data[index * 4 + 1] = color[1]!
    data[index * 4 + 2] = color[2]!
    data[index * 4 + 3] = 255
  }
  return { name, left, top, right, bottom, imageData: { width, height, data }, ...extra }
}

export async function writePortraitPsd(directory: string): Promise<string> {
  type InitArgs = Parameters<typeof initializeCanvas>
  initializeCanvas(
    createCanvas as unknown as InitArgs[0],
    ((width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })) as unknown as InitArgs[1]
  )
  const eyeRect: [number, number, number, number] = [40, 50, 160, 80]
  const mouthRect: [number, number, number, number] = [80, 150, 120, 170]
  const browRect: [number, number, number, number] = [40, 30, 160, 40]
  const maskWidth = 20
  const maskData = new Uint8ClampedArray(maskWidth * 20 * 4).fill(255)

  const psd = {
    width: 200,
    height: 300,
    children: [
      solid('からだ', [0, 0, 200, 300], COLORS.body),
      solid('影', [0, 250, 200, 300], [0, 0, 0], { clipping: true, blendMode: 'multiply', opacity: 0.5 }),
      {
        name: '!目',
        opened: true,
        children: [
          solid('*閉じ', eyeRect, COLORS.eyeClosed, { hidden: true }),
          solid('*半目', eyeRect, COLORS.eyeHalf, { hidden: true }),
          solid('*開き', eyeRect, COLORS.eyeOpen)
        ]
      },
      {
        name: '!口',
        opened: true,
        children: [
          solid('*あ', mouthRect, COLORS.mouth.a, { hidden: true }),
          solid('*い', mouthRect, COLORS.mouth.i, { hidden: true }),
          solid('*う', mouthRect, COLORS.mouth.u, { hidden: true }),
          solid('*え', mouthRect, COLORS.mouth.e, { hidden: true }),
          solid('*お', mouthRect, COLORS.mouth.o, { hidden: true }),
          solid('*ん', mouthRect, COLORS.mouth.n)
        ]
      },
      {
        name: '!眉',
        opened: true,
        children: [solid('*怒り', browRect, COLORS.browAngry, { hidden: true }), solid('*通常', browRect, COLORS.browNormal)]
      },
      solid('ほっぺ', [20, 120, 60, 140], COLORS.cheek, {
        mask: { left: 20, top: 120, right: 40, bottom: 140, defaultColor: 0, imageData: { width: maskWidth, height: 20, data: maskData } }
      }),
      solid('メガネ', [40, 90, 160, 100], COLORS.glasses, { hidden: true })
    ]
  }
  const path = join(directory, 'portrait.psd')
  await writeFile(path, writePsdBuffer(psd as Parameters<typeof writePsdBuffer>[0]))
  return path
}
