/**
 * OS の色選びの画面を開き、選んだ色(#rrggbb)を渡す。右クリックメニューのように入力欄を置けない場所から使う。
 * 利用者の操作(クリック)の中から呼ぶ必要がある。
 */
export function pickColor(initial: string, onPick: (color: string) => void): void {
  const input = document.createElement('input')
  input.type = 'color'
  input.value = initial
  input.style.position = 'fixed'
  input.style.opacity = '0'
  input.style.pointerEvents = 'none'
  input.setAttribute('data-testid', 'color-picker')
  document.body.appendChild(input)
  const done = (): void => input.remove()
  input.addEventListener('change', () => {
    onPick(input.value)
    done()
  })
  input.addEventListener('blur', () => setTimeout(done, 1000))
  input.click()
}
