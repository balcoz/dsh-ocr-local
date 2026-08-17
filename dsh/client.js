// Browser half of dsh-ocr-local: paste-to-path for the dsh web UI.
//
// A capture-phase paste listener runs before the composer's own handler.
// When the clipboard carries image files, the bytes are POSTed to the host
// route (/ocr/paste), land in ~/.dsh/ocr/cache, and the returned path is
// inserted into the composer as plain text. A text-only model then sees a
// file path — the trigger for the ocr_image tool.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), same zero-dependency
// stance as the host half.
window.__ModuleLoader__.load({
  id: 'dsh-ocr-local',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    function imageFilesOf(event) {
      var items = event.clipboardData && event.clipboardData.items
      if (!items) return []
      var files = []
      for (var i = 0; i < items.length; i++) {
        var item = items[i]
        if (item.kind !== 'file') continue
        var file = item.getAsFile()
        if (file && /^image\//.test(file.type)) files.push(file)
      }
      return files
    }

    function insertText(target, text) {
      var el =
        target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
          ? target
          : document.activeElement
      if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) return
      el.focus()
      var inserted = false
      try {
        inserted = document.execCommand('insertText', false, text)
      } catch (e) {
        inserted = false
      }
      if (!inserted) {
        var proto =
          el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(el, el.value + text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }

    function uploadOne(file) {
      return file.arrayBuffer().then((buffer) =>
        fetch('/ocr/paste', { method: 'POST', body: buffer }).then((res) => {
          if (!res.ok) {
            return res
              .json()
              .catch(() => ({}))
              .then((body) => {
                var error = new Error(body.error || 'paste upload failed (' + res.status + ')')
                error.status = res.status
                throw error
              })
          }
          return res.json()
        }),
      )
    }

    // Ask the host whether this plugin should take over image pastes.
    // A 404 (no web profile / route off) makes the client stand down
    // entirely, so pastes stay native.
    var routeAvailable = true
    var takeover = false

    function probeRoute() {
      fetch('/ocr/paste')
        .then((res) => {
          if (res.status === 404) {
            routeAvailable = false
            return null
          }
          if (!res.ok) throw new Error('policy ' + res.status)
          return res.json()
        })
        .then((body) => {
          if (body) takeover = body.takeover === true
        })
        .catch(() => {
          routeAvailable = false
        })
    }

    function onPaste(event) {
      if (!routeAvailable || !takeover) return
      var files = imageFilesOf(event)
      if (files.length === 0) return
      // Take the paste before the composer's own intake starts.
      event.preventDefault()
      event.stopImmediatePropagation()
      var target = event.target
      Promise.all(files.map(uploadOne))
        .then((results) => {
          var text = results
            .map((r) => r.path)
            .filter(Boolean)
            .join(' ')
          if (text) insertText(target, text + ' ')
        })
        .catch((error) => {
          if (error && error.status === 404) {
            routeAvailable = false
          }
          console.error('[dsh-ocr] paste-to-path failed: ' + (error && error.message ? error.message : error))
        })
    }

    function apply(ctx) {
      probeRoute()
      document.addEventListener('paste', onPaste, true)
      if (typeof ctx.effect === 'function') {
        ctx.effect(
          () => () => {
            document.removeEventListener('paste', onPaste, true)
          },
          'dsh-ocr: paste-to-path listener',
        )
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
