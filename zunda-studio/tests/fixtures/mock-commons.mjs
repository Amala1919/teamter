// Wikimedia Commons の模擬(E2E 用)。検索の API は言葉に応じた画像を1枚返し、画像は言葉ごとに色を変えた PNG を配る。
// node tests/fixtures/mock-commons.mjs --port 50151
import { createServer } from 'node:http'

import { createCanvas } from '@napi-rs/canvas'

const index = process.argv.indexOf('--port')
const port = index >= 0 ? Number(process.argv[index + 1]) : 50151
const base = `http://127.0.0.1:${port}`

/** 言葉に「見つからない」を含むときは何も返さない。 */
function pagesFor(search) {
  if (search.includes('nothing')) return []
  const name = search.replace(/\s*filetype:bitmap$/, '').replace(/[^\w\- ]/g, '').trim() || 'image'
  return [
    {
      title: `File:${name}.png`,
      index: 1,
      imageinfo: [
        {
          thumburl: `${base}/img/${encodeURIComponent(name)}.png`,
          thumbwidth: 320,
          thumbheight: 200,
          mime: 'image/png',
          descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}.png`,
          extmetadata: { Artist: { value: '<a href="#">Test Author</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } }
        }
      ]
    }
  ]
}

function png() {
  const canvas = createCanvas(320, 200)
  const context = canvas.getContext('2d')
  // 真ん中に出たかを画素で確かめられるよう、はっきりした色(マゼンタ)にする。
  context.fillStyle = '#ff00ff'
  context.fillRect(0, 0, 320, 200)
  return canvas.toBuffer('image/png')
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', base)
  if (url.pathname.endsWith('/api.php')) {
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    response.end(JSON.stringify({ query: { pages: pagesFor(url.searchParams.get('gsrsearch') ?? '') } }))
    return
  }
  if (url.pathname.startsWith('/img/')) {
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(png())
    return
  }
  if (url.pathname === '/health') {
    response.writeHead(200)
    response.end('ok')
    return
  }
  response.writeHead(404)
  response.end()
}).listen(port, '127.0.0.1')
