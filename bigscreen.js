(() => {
  const KEY = "__videoFullscreenHelper";
  const TARGET_CLASS = "__vfhFullscreenTarget";

  // Remove a previously installed version.
  window[KEY]?.destroy?.();

  const controller = new AbortController();
  const { signal } = controller;

  let currentCandidate = null;
  let frameRequest = 0;
  let destroyed = false;

  const style = document.createElement("style");
  style.id = "__vfhFullscreenStyles";
  style.textContent = `
    .${TARGET_CLASS}:fullscreen,
    .${TARGET_CLASS}:-webkit-full-screen {
      width: 100vw !important;
      height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: #000 !important;
      object-fit: contain !important;
    }
  `;

  document.documentElement.appendChild(style);

  const host = document.createElement("div");
  host.id = "__vfhButtonHost";

  for (const [name, value] of Object.entries({
    position: "fixed",
    top: "8px",
    left: "8px",
    width: "42px",
    height: "42px",
    zIndex: "2147483647",
    pointerEvents: "none",
    display: "none"
  })) {
    host.style.setProperty(
      name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),
      value,
      "important"
    );
  }

  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      button {
        all: initial;
        box-sizing: border-box;
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        pointer-events: auto;
        cursor: pointer;
        border: 1px solid rgba(255, 255, 255, 0.55);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.78);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
        opacity: 0.86;
      }

      button:hover,
      button:focus-visible {
        opacity: 1;
        outline: 2px solid white;
        outline-offset: 2px;
      }

      svg {
        width: 25px;
        height: 25px;
        fill: white;
        pointer-events: none;
      }
    </style>

    <button
      type="button"
      title="Fullscreen video or embedded player (F)"
      aria-label="Fullscreen video or embedded player"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"></path>
      </svg>
    </button>
  `;

  const button = shadow.querySelector("button");
  document.documentElement.appendChild(host);

  function getOpenRoots(root) {
    const roots = [root];
    const elements = root.querySelectorAll?.("*") || [];

    for (const element of elements) {
      if (element.shadowRoot) {
        roots.push(...getOpenRoots(element.shadowRoot));
      }
    }

    return roots;
  }

  function getVisibleArea(element) {
    if (!element?.isConnected) {
      return 0;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width <= 1 || rect.height <= 1) {
      return 0;
    }

    const css = getComputedStyle(element);

    if (
      css.display === "none" ||
      css.visibility === "hidden" ||
      Number(css.opacity) === 0
    ) {
      return 0;
    }

    const width = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) -
        Math.max(rect.left, 0)
    );

    const height = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) -
        Math.max(rect.top, 0)
    );

    return width * height;
  }

  function getIframeBonus(iframe) {
    const text = [
      iframe.src || "",
      iframe.id || "",
      iframe.className || ""
    ].join(" ").toLowerCase();

    return /video|player|stream|watch|live|media|performgroup|visualisation|sport/.test(
      text
    )
      ? 3
      : 1;
  }

  function addCandidate(
    candidates,
    element,
    kind,
    multiplier = 1,
    innerVideo = null
  ) {
    const area = getVisibleArea(element);

    if (area < 1000) {
      return;
    }

    let score = area * multiplier;

    if (kind === "video") {
      if (!element.paused && !element.ended) {
        score *= 1.7;
      }

      if (element.readyState >= 2) {
        score *= 1.15;
      }

      if (element.currentSrc || element.src) {
        score *= 1.1;
      }
    }

    const previous = candidates.get(element);

    if (!previous || score > previous.score) {
      candidates.set(element, {
        element,
        kind,
        score,
        innerVideo
      });
    }
  }

  function scanDocument(
    documentToScan,
    outerFrame,
    candidates,
    visitedDocuments
  ) {
    if (
      !documentToScan ||
      visitedDocuments.has(documentToScan)
    ) {
      return;
    }

    visitedDocuments.add(documentToScan);

    for (const root of getOpenRoots(documentToScan)) {
      const videos = root.querySelectorAll?.("video") || [];

      for (const video of videos) {
        if (outerFrame) {
          addCandidate(
            candidates,
            outerFrame,
            "iframe-with-video",
            getIframeBonus(outerFrame) *
              2 *
              (!video.paused && !video.ended ? 1.7 : 1),
            video
          );
        } else {
          addCandidate(
            candidates,
            video,
            "video",
            2,
            video
          );
        }
      }

      const iframes = root.querySelectorAll?.("iframe") || [];

      for (const iframe of iframes) {
        const topFrame = outerFrame || iframe;

        // Cross-origin frames cannot be inspected, but the iframe
        // element itself can still be used as the fullscreen target.
        addCandidate(
          candidates,
          topFrame,
          "iframe",
          getIframeBonus(iframe)
        );

        try {
          const childDocument = iframe.contentDocument;

          if (childDocument) {
            scanDocument(
              childDocument,
              topFrame,
              candidates,
              visitedDocuments
            );
          }
        } catch {
          // Expected for cross-origin embedded players.
        }
      }
    }
  }

  function findBestCandidate() {
    const candidates = new Map();

    scanDocument(
      document,
      null,
      candidates,
      new WeakSet()
    );

    return (
      [...candidates.values()].sort(
        (a, b) => b.score - a.score
      )[0] || null
    );
  }

  function getFullscreenElement() {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      null
    );
  }

  function updateButton() {
    frameRequest = 0;

    if (destroyed || getFullscreenElement()) {
      host.style.setProperty(
        "display",
        "none",
        "important"
      );
      return;
    }

    currentCandidate = findBestCandidate();

    if (!currentCandidate) {
      host.style.setProperty(
        "display",
        "none",
        "important"
      );
      return;
    }

    const rect =
      currentCandidate.element.getBoundingClientRect();

    const size = 42;
    const gap = 8;

    const visibleRight = Math.min(
      rect.right,
      window.innerWidth
    );

    const visibleBottom = Math.min(
      rect.bottom,
      window.innerHeight
    );

    const left = Math.max(
      8,
      Math.min(
        window.innerWidth - size - 8,
        visibleRight - size - gap
      )
    );

    const top = Math.max(
      8,
      Math.min(
        window.innerHeight - size - 8,
        visibleBottom - size - gap
      )
    );

    host.style.setProperty(
      "left",
      `${Math.round(left)}px`,
      "important"
    );

    host.style.setProperty(
      "top",
      `${Math.round(top)}px`,
      "important"
    );

    host.style.setProperty(
      "display",
      "block",
      "important"
    );

    button.title =
      currentCandidate.kind.startsWith("iframe")
        ? "Fullscreen embedded player (F)"
        : "Fullscreen video (F)";
  }

  function scheduleUpdate() {
    if (!frameRequest && !destroyed) {
      frameRequest =
        requestAnimationFrame(updateButton);
    }
  }

  async function exitFullscreen() {
    if (
      document.fullscreenElement &&
      document.exitFullscreen
    ) {
      await document.exitFullscreen();
      return;
    }

    if (
      document.webkitFullscreenElement &&
      document.webkitExitFullscreen
    ) {
      document.webkitExitFullscreen();
    }
  }

  async function enterFullscreen(element) {
    element.classList.add(TARGET_CLASS);

    if (element instanceof HTMLIFrameElement) {
      element.setAttribute("allowfullscreen", "");
      element.setAttribute(
        "webkitallowfullscreen",
        ""
      );

      const allow =
        element.getAttribute("allow") || "";

      if (
        !/(^|[;\s])fullscreen(?:\s|;|$)/i.test(
          allow
        )
      ) {
        element.setAttribute(
          "allow",
          `${allow}${allow.trim() ? "; " : ""}fullscreen *`
        );
      }
    }

    try {
      if (
        typeof element.requestFullscreen ===
        "function"
      ) {
        try {
          await element.requestFullscreen({
            navigationUI: "hide"
          });
        } catch {
          await element.requestFullscreen();
        }

        return;
      }

      if (
        typeof element.webkitRequestFullscreen ===
        "function"
      ) {
        element.webkitRequestFullscreen();
        return;
      }

      if (
        element instanceof HTMLVideoElement &&
        typeof element.webkitEnterFullscreen ===
          "function"
      ) {
        element.webkitEnterFullscreen();
        return;
      }

      throw new Error(
        "No fullscreen method is available for the selected player."
      );
    } catch (error) {
      element.classList.remove(TARGET_CLASS);
      throw error;
    }
  }

  async function toggleFullscreen() {
    try {
      if (getFullscreenElement()) {
        await exitFullscreen();
        return;
      }

      currentCandidate = findBestCandidate();

      if (!currentCandidate) {
        console.warn(
          "[Fullscreen helper] No video or visible embedded player found."
        );
        return;
      }

      console.info(
        "[Fullscreen helper] Fullscreening:",
        currentCandidate.kind,
        currentCandidate.element
      );

      await enterFullscreen(
        currentCandidate.element
      );
    } catch (error) {
      console.error(
        "[Fullscreen helper] Fullscreen failed:",
        error
      );
    }
  }

  button.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();
      void toggleFullscreen();
    },
    { signal }
  );

  window.addEventListener(
    "keydown",
    event => {
      const target = event.target;

      const isTyping =
        target instanceof Element &&
        (
          target.matches(
            "input, textarea, select"
          ) ||
          target.isContentEditable
        );

      if (
        isTyping ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void toggleFullscreen();
    },
    {
      capture: true,
      signal
    }
  );

  window.addEventListener(
    "resize",
    scheduleUpdate,
    {
      passive: true,
      signal
    }
  );

  window.addEventListener(
    "scroll",
    scheduleUpdate,
    {
      capture: true,
      passive: true,
      signal
    }
  );

  document.addEventListener(
    "fullscreenchange",
    () => {
      document
        .querySelectorAll(`.${TARGET_CLASS}`)
        .forEach(element => {
          if (element !== getFullscreenElement()) {
            element.classList.remove(
              TARGET_CLASS
            );
          }
        });

      scheduleUpdate();
    },
    { signal }
  );

  document.addEventListener(
    "webkitfullscreenchange",
    scheduleUpdate,
    { signal }
  );

  const observer =
    new MutationObserver(scheduleUpdate);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  const interval = setInterval(
    scheduleUpdate,
    1000
  );

  window[KEY] = {
    toggle: toggleFullscreen,
    refresh: scheduleUpdate,

    getTarget() {
      return findBestCandidate();
    },

    destroy() {
      destroyed = true;

      controller.abort();
      observer.disconnect();
      clearInterval(interval);
      cancelAnimationFrame(frameRequest);

      host.remove();
      style.remove();

      document
        .querySelectorAll(`.${TARGET_CLASS}`)
        .forEach(element => {
          element.classList.remove(
            TARGET_CLASS
          );
        });

      delete window[KEY];

      console.info(
        "[Fullscreen helper] Removed."
      );
    }
  };

  scheduleUpdate();

  console.info(
    "[Fullscreen helper] Installed. Press F or use the floating button."
  );
})();
