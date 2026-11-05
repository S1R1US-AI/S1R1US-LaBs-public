/*!
 * Meet Shiva logo rings (/blast-off/), 2026-10-26.
 * - The three outer rings are CSS layers (.bo-shiva-ring). They turn only while
 *   .bo-shiva-rings has data-state="playing"; otherwise animation-play-state stays paused.
 * - Pause / Play button (WCAG 2.2.2), the same one the avatar loops use (avatar-loops.js):
 *   .s1-loop-toggle, placed next to the link (a button can't live inside <a>), pinned to the
 *   logo's top-right corner. Its label offers the next action: "Pause animation" / "Play animation".
 * - A pause by the user sticks. Reduced motion: no rings, no button, the still logo stays.
 * - No JS: the rings never start, so the still logo shows.
 */
(function () {
  'use strict';

  var rings = document.querySelector('.bo-shiva .bo-shiva-rings');
  var link = rings && rings.closest ? rings.closest('a') : null;
  var host = link ? link.parentNode : null;
  if (!rings || !host) return;

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(mq && mq.matches); }
  var userPaused = false;

  if (host.classList) host.classList.add('s1-loop-host');
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 's1-loop-toggle';
  host.insertBefore(b, link.nextSibling);

  function place() {
    if (b.hidden) return;
    var hr = host.getBoundingClientRect();
    var lr = link.getBoundingClientRect();
    var size = b.offsetWidth || 32;
    b.style.left = Math.round(lr.right - hr.left - size - 6) + 'px';
    b.style.top = Math.round(lr.top - hr.top + 6) + 'px';
  }

  function sync() {
    var label = userPaused ? 'Play animation' : 'Pause animation';
    rings.setAttribute('data-state', userPaused || reduced() ? 'paused' : 'playing');
    b.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
    b.setAttribute('aria-label', label);
    b.title = label;
    b.setAttribute('data-state', userPaused ? 'paused' : 'playing');
    b.hidden = reduced();
    place();
  }

  b.addEventListener('click', function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    userPaused = !userPaused;
    sync();
  });

  sync();
  window.addEventListener('resize', place);
  window.addEventListener('load', place);
  if (mq) {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', sync);
    else if (typeof mq.addListener === 'function') mq.addListener(sync);
  }
})();
