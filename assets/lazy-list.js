/* ============================================================
 * assets/lazy-list.js  ->  window.GAIC_LAZY
 * ------------------------------------------------------------
 * Incremental / chunked rendering for large lists so ~300 rows
 * stay fast. Renders the first CHUNK items immediately, then
 * appends more as a sentinel scrolls into view (IntersectionObserver)
 * with a "Show more" button fallback when IO is unavailable.
 *
 * Design notes:
 *  - No dependencies, ES5, never throws to the page.
 *  - Works for <tbody> (tr rows) and card grids alike: caller supplies
 *    `renderItem(item, index) -> HTML string`.
 *  - Click handling should be DELEGATED on the container by the caller
 *    (appended nodes won't have per-node listeners), or pass onAppend.
 *  - render() is idempotent: calling it again with new data resets.
 *
 * Public API:
 *   var ctrl = GAIC_LAZY.create({
 *     mount:      Element,              // container to append into (tbody/grid)
 *     items:      Array,                // full data set
 *     renderItem: fn(item,i)->string,   // HTML for one item
 *     chunk:      Number (default 50),  // items per batch
 *     sentinel:   Element (optional),   // where "show more" attaches; defaults after mount
 *     onAppend:   fn(fromIdx,toIdx),    // optional, after each batch
 *     status:     Element (optional),   // "showing X of Y" text sink
 *     noun:       String (default 'items')
 *   });
 *   ctrl.setItems(newArray)  // reset + re-render first chunk
 *   ctrl.rendered()          // count currently in DOM
 *   ctrl.total()             // full length
 *   ctrl.showMore()          // force-render next batch
 *   ctrl.destroy()           // disconnect observer, remove sentinel button
 * ============================================================ */
(function () {
  "use strict";

  var DEFAULT_CHUNK = 50;

  function esc(s) { return s == null ? '' : String(s); }

  function create(opts) {
    opts = opts || {};
    var mount = opts.mount;
    var renderItem = typeof opts.renderItem === 'function' ? opts.renderItem : function () { return ''; };
    // renderItem can be swapped between renders (e.g. when the row builder
    // closes over a per-render scale). Read through curRenderItem everywhere.
    var curRenderItem = renderItem;
    var chunk = opts.chunk > 0 ? opts.chunk : DEFAULT_CHUNK;
    var noun = opts.noun || 'items';

    var items = Array.isArray(opts.items) ? opts.items.slice() : [];
    var count = 0;          // how many are currently rendered
    var io = null;          // IntersectionObserver
    var moreBtn = null;     // fallback button
    var sentinel = null;    // element observed / button host

    // Guard: if there's no mount we degrade to a no-op controller.
    var alive = !!(mount && mount.appendChild);

    return _wire();

    function _wire() {
      function updateStatus() {
        if (!opts.status) return;
        opts.status.textContent = count >= items.length
          ? (items.length + ' ' + noun)
          : ('showing ' + count + ' of ' + items.length + ' ' + noun);
      }

      function ensureSentinel() {
        if (!alive) return;
        // A button the user can click; also the element we observe.
        if (!sentinel) {
          sentinel = opts.sentinel || null;
          if (!sentinel) {
            sentinel = mount.ownerDocument.createElement('div');
            sentinel.className = 'lazy-sentinel';
            // place it right after the mount in the DOM
            if (mount.parentNode) {
              if (mount.nextSibling) mount.parentNode.insertBefore(sentinel, mount.nextSibling);
              else mount.parentNode.appendChild(sentinel);
            }
          }
        }
        if (!moreBtn) {
          moreBtn = mount.ownerDocument.createElement('button');
          moreBtn.type = 'button';
          moreBtn.className = 'lazy-more';
          moreBtn.addEventListener('click', function () { renderNext(); });
          sentinel.appendChild(moreBtn);
        }
      }

      function syncSentinel() {
        if (!sentinel || !moreBtn) return;
        var remaining = items.length - count;
        if (remaining > 0) {
          sentinel.style.display = '';
          moreBtn.textContent = 'Show ' + Math.min(chunk, remaining) + ' more (' + remaining + ' remaining)';
          moreBtn.disabled = false;
        } else {
          sentinel.style.display = 'none';
        }
      }

      // -- internal render of the next batch --
      function renderNext() {
        if (!alive) return;
        var from = count;
        var to = Math.min(items.length, from + chunk);
        if (to <= from) { syncSentinel(); return; }
        var html = '';
        for (var i = from; i < to; i++) html += curRenderItem(items[i], i);
        // Append without wiping existing nodes.
        var frag = mount.ownerDocument.createElement(mount.tagName === 'TBODY' ? 'tbody' : 'div');
        frag.innerHTML = html;
        while (frag.firstChild) mount.appendChild(frag.firstChild);
        count = to;
        updateStatus();
        syncSentinel();
        if (typeof opts.onAppend === 'function') { try { opts.onAppend(from, to); } catch (e) {} }
      }

      function reset() {
        count = 0;
        if (alive) mount.innerHTML = '';
        ensureSentinel();
        renderNext();          // first batch
        setupObserver();
      }

      function setupObserver() {
        if (io) { io.disconnect(); io = null; }
        if (!alive || !sentinel) return;
        var IO = mount.ownerDocument.defaultView && mount.ownerDocument.defaultView.IntersectionObserver;
        if (!IO) return;       // button fallback remains
        io = new IO(function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) { renderNext(); }
          }
        }, { root: null, rootMargin: '400px 0px' });
        io.observe(sentinel);
      }

      var controller = {
        setItems: function (arr) {
          items = Array.isArray(arr) ? arr.slice() : [];
          reset();
          return controller;
        },
        // Swap the per-item renderer (used when the builder closes over a
        // per-render scale). Does NOT re-render on its own — call setItems after.
        setRenderItem: function (fn) {
          if (typeof fn === 'function') curRenderItem = fn;
          return controller;
        },
        showMore: function () { renderNext(); return controller; },
        rendered: function () { return count; },
        total: function () { return items.length; },
        destroy: function () {
          if (io) { io.disconnect(); io = null; }
          if (moreBtn && moreBtn.parentNode) moreBtn.parentNode.removeChild(moreBtn);
          if (sentinel && !opts.sentinel && sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
          moreBtn = null; sentinel = null;
        }
      };

      // initial paint
      reset();
      return controller;
    }
  }

  window.GAIC_LAZY = { create: create, DEFAULT_CHUNK: DEFAULT_CHUNK };
})();
