/**
 * Client half of the screenshot bundle.
 *
 * The whole editing surface lives in the native window (shot.exe): it freezes
 * the desktop, the user drags a region, annotates it in place and presses 完成.
 * The page only receives the finished PNG and hands it to the composer.
 */
window.__ModuleLoader__.load({
  id: '@sfunction-guo/dsh-screenshot',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState } = React

    const CAPTURE_URL = '/shot/capture'

    let busy = false

    /**
     * A paste event is the one public door into the composer's attachment
     * pipeline: the draft mints its own attachment ids during that flow, so no
     * plugin can inject one from outside.
     */
    function pasteIntoComposer(blob) {
      const target = document.querySelector('[contenteditable="true"]')
      if (!target) return false
      const file = new File([blob], `shot-${Date.now()}.png`, { type: 'image/png' })
      const transfer = new DataTransfer()
      transfer.items.add(file)
      target.focus()
      target.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }))
      return true
    }

    async function captureAndInsert() {
      if (busy) return
      busy = true
      const previousCursor = document.documentElement.style.cursor
      document.documentElement.style.cursor = 'progress'
      let blob = null
      try {
        const response = await fetch(CAPTURE_URL, { headers: { 'x-dsh-shot': '1' }, cache: 'no-store' })
        if (response.status === 204) return
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.dataUrl) {
          throw new Error(payload.error || `抓屏失败 HTTP ${response.status}`)
        }
        blob = await (await fetch(payload.dataUrl)).blob()
        if (!pasteIntoComposer(blob)) throw new Error('找不到输入框')
      } catch (error) {
        let note = ''
        try {
          if (blob && navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
            note = '（已复制到剪贴板，可按 Ctrl+V 粘贴）'
          }
        } catch {
          /* clipboard is a courtesy, not the transport */
        }
        window.alert(`截图插入失败：${String((error && error.message) || error)}${note}`)
      } finally {
        document.documentElement.style.cursor = previousCursor
        busy = false
      }
    }

    function ShotButton() {
      const [hover, setHover] = useState(false)
      return h('button', {
        type: 'button',
        title: '截图标注',
        'aria-label': '截图标注',
        onClick: () => void captureAndInsert(),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          display: 'grid', placeItems: 'center',
          width: 28, height: 28, padding: 0, border: 0, borderRadius: 6,
          background: hover ? 'var(--dsh-surface-raised, rgba(127,127,127,0.18))' : 'transparent',
          color: 'inherit', cursor: 'pointer',
        },
      }, h('svg', {
        viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M4 8V6a2 2 0 0 1 2-2h2' }),
        h('path', { d: 'M16 4h2a2 2 0 0 1 2 2v2' }),
        h('path', { d: 'M20 16v2a2 2 0 0 1-2 2h-2' }),
        h('path', { d: 'M8 20H6a2 2 0 0 1-2-2v-2' }),
        h('circle', { cx: 12, cy: 12, r: 3 }),
      ))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'dsh-screenshot', order: 0,
        }, ShotButton))
      },
    }
  },
})
