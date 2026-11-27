import "./scrollcraft.js";

const header = document.querySelector("[data-header]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const mobileView = window.matchMedia("(max-width: 860px)");

if (header) {
  const syncHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 14);
  syncHeader();
  window.addEventListener("scroll", syncHeader, { passive: true });
}

const profileGroup = document.querySelector("[data-profile-group]");

if (profileGroup) {
  const profiles = {
    memory: {
      title: "Memory Saver",
      copy:
        "Adds <code>--lowvram</code>, reduces latent dimensions, and surfaces low-VRAM warnings. Best for 8–12 GB cards and smaller image or video jobs.",
      detail: "Image profiles scale automatically. Video may still need smaller dimensions.",
    },
    quality: {
      title: "Balanced and Quality",
      copy:
        "Uses higher resolution targets and high-VRAM retention for 16 GB and above. The validated machine is an RTX 4070 Ti SUPER with 16 GB.",
      detail:
        "Video workflows are checked against the detected GPU before download and before a job.",
    },
  };

  const buttons = Array.from(profileGroup.querySelectorAll("[data-profile]"));
  const title = profileGroup.querySelector("[data-profile-title]");
  const copy = profileGroup.querySelector("[data-profile-copy]");
  const detail = profileGroup.querySelector("[data-profile-detail]");

  function selectProfile(name) {
    const profile = profiles[name];
    if (!profile || !title || !copy || !detail) return;

    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.profile === name));
    }

    title.textContent = profile.title;
    copy.innerHTML = profile.copy;
    detail.textContent = profile.detail;
  }

  for (const button of buttons) {
    button.addEventListener("click", () => selectProfile(button.dataset.profile));
  }
}

const lightbox = document.querySelector("[data-lightbox]");

if (lightbox) {
  const lightboxImage = lightbox.querySelector("[data-lightbox-image]");
  const lightboxCaption = lightbox.querySelector("[data-lightbox-caption]");
  const lightboxClose = lightbox.querySelector("[data-lightbox-close]");

  function closeLightbox() {
    if (lightbox.open) lightbox.close();
  }

  for (const shot of document.querySelectorAll("[data-shot]")) {
    shot.addEventListener("click", () => {
      const image = shot.querySelector("img.is-active") || shot.querySelector("img");
      if (!image || !lightboxImage) return;

      lightboxImage.src = image.currentSrc || image.src;
      lightboxImage.alt = image.alt;
      if (lightboxCaption) lightboxCaption.textContent = shot.dataset.caption || "";
      lightbox.classList.toggle("lightbox--fullscreen", shot.hasAttribute("data-showcase-app"));
      if (!lightbox.open) lightbox.showModal();
      document.body.classList.add("is-locked");
    });
  }

  lightboxClose?.addEventListener("click", closeLightbox);

  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  lightbox.addEventListener("close", () => {
    document.body.classList.remove("is-locked");
    if (lightboxImage) lightboxImage.src = "";
  });
}

const orbitSection = document.querySelector("[data-orrery-section]");

function initOrrery() {
  if (!orbitSection) return;

  const cards = Array.from(orbitSection.querySelectorAll("[data-world]"));
  const path = orbitSection.querySelector(".orrery__path");
  const titleEl = orbitSection.querySelector("[data-orrery-title]");
  const copyEl = orbitSection.querySelector("[data-orrery-copy]");
  const techEl = orbitSection.querySelector("[data-orrery-tech]");
  const providersEl = orbitSection.querySelector("[data-orrery-providers]");
  const indexEl = orbitSection.querySelector("[data-orrery-index]");
  const plateEl = orbitSection.querySelector("[data-orrery-plate]");
  const count = cards.length;

  if (!count || !path) return;

  let active = -1;
  let inView = true;
  let frame = 0;
  let radiusX = 0;
  let radiusY = 0;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function setMode() {
    const stack = mobileView.matches;
    orbitSection.classList.toggle("is-stack", stack);
    orbitSection.classList.toggle("is-orbit", !stack);
    for (const card of cards) {
      card.style.transform = "";
      card.style.opacity = "";
      card.style.zIndex = "";
    }
    radiusX = (path.offsetWidth / 2) * 1.08;
    radiusY = path.offsetHeight / 2;
  }

  function setActive(index) {
    if (index === active) return;
    active = index;

    const card = cards[index];
    if (!card) return;

    if (titleEl) titleEl.textContent = card.dataset.title || "";
    if (copyEl) copyEl.textContent = card.dataset.copy || "";
    const showProviders = Boolean(providersEl && card.hasAttribute("data-model-hub"));
    if (techEl) {
      techEl.textContent = card.dataset.tech || "";
      techEl.hidden = showProviders;
    }
    if (providersEl) providersEl.hidden = !showProviders;
    if (indexEl) indexEl.textContent = String(index + 1).padStart(2, "0");

    for (const [i, item] of cards.entries()) {
      item.classList.toggle("is-active", i === index);
    }

    if (plateEl) {
      plateEl.classList.remove("is-swapping");
      void plateEl.offsetWidth;
      plateEl.classList.add("is-swapping");
    }
  }

  function update() {
    frame = 0;
    if (!inView) return;

    const raw = Number.parseFloat(orbitSection.style.getPropertyValue("--sc-p"));
    const p = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    const t = p * (count - 1);
    const index = Math.min(count - 1, Math.round(t));

    setActive(index);

    if (orbitSection.classList.contains("is-stack")) {
      for (const card of cards) {
        card.style.transform = "";
      }
      orbitSection.dataset.scVerifyState = `${index}:${Math.round(p * 100)}`;
      return;
    }

    const reduced = reducedMotion.matches;
    const step = Math.min(count - 1, Math.floor(t));
    const fraction = t - step;
    const rotation = reduced ? 0 : step + easeOutCubic(fraction);

    for (let i = 0; i < count; i += 1) {
      const card = cards[i];
      const theta = -Math.PI / 2 + ((i - rotation) * (Math.PI * 2)) / count;
      const x = Math.cos(theta);
      const y = Math.sin(theta);
      const front = (1 - y) / 2;
      const scale = reduced ? (i === index ? 1.06 : 0.92) : 0.64 + 0.36 * front + 0.62 * front ** 4;
      const opacity = reduced ? (i === index ? 1 : 0.55) : 0.3 + 0.7 * front;
      const depth = reduced ? (i === index ? 110 : 30 + Math.round(front * 40)) : 10 + Math.round(front * 100);
      const tilt = x * -12;

      card.style.transform =
        `translate(-50%, -50%) translate3d(${(x * radiusX).toFixed(1)}px, ${(y * radiusY).toFixed(1)}px, 0) ` +
        `perspective(900px) scale(${scale.toFixed(3)}) rotateY(${tilt.toFixed(2)}deg)`;
      card.style.opacity = opacity.toFixed(3);
      card.style.zIndex = String(depth);
    }

    orbitSection.dataset.scVerifyState = `${index}:${Math.round(rotation * 100)}`;
  }

  function request() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  setMode();
  setActive(0);

  const observer = new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      if (inView) request();
    },
    { threshold: 0.01 }
  );

  observer.observe(orbitSection);
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", () => {
    setMode();
    request();
  });
  reducedMotion.addEventListener?.("change", request);
  mobileView.addEventListener?.("change", () => {
    setMode();
    request();
  });

  request();
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const smoothstep = (start, end, value) => {
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};

const staticLayout = () => mobileView.matches || reducedMotion.matches;

/* ---------------------------------------------------- hero transformation -- */

function initHero(acts) {
  const heroAct = acts.find(({ el }) => el.hasAttribute("data-hero"));
  if (!heroAct) return;

  const act = heroAct.el;
  const nextAct = acts.find(({ el }) => el === act.nextElementSibling);
  const video = act.querySelector(".hero__video");
  let frame = 0;
  let shouldPlay = false;

  function syncVideo(visible) {
    if (!video) return;
    const play = visible && !reducedMotion.matches && !document.hidden;
    if (play === shouldPlay) return;
    shouldPlay = play;

    if (play) {
      // Keep the fallback artwork if the browser declines autoplay.
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function update() {
    frame = 0;
    const inView = window.scrollY < heroAct.top + heroAct.height;
    if (staticLayout()) {
      syncVideo(inView);
      return;
    }

    // Finish when the next section reaches 45% down the viewport.
    const nextTop = nextAct?.top ?? heroAct.top + heroAct.height;
    const end = nextTop - window.innerHeight * 0.45;
    const progress = clamp01((window.scrollY - heroAct.top) / Math.max(1, end - heroAct.top));
    const visibility = 1 - smoothstep(0, 1, progress ** 2);

    act.style.setProperty("--hero-art", progress.toFixed(4));
    act.style.setProperty("--hero-visibility", visibility.toFixed(4));
    act.style.setProperty("--hero-stage-visibility", progress === 1 ? "hidden" : "visible");
    act.dataset.scVerifyState = `${Math.round(progress * 100)}:${Math.round(visibility * 100)}`;
    syncVideo(inView && progress < 1);
  }

  function request() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  if (video) {
    video.addEventListener("playing", () => act.classList.add("is-video-ready"));
    video.addEventListener("error", () => act.classList.remove("is-video-ready"));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) syncVideo(false);
      else request();
    });
  }

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request);
  reducedMotion.addEventListener?.("change", request);
  mobileView.addEventListener?.("change", request);
  request();
}

/* ---------------------------------------------------------- product tour -- */

function initShowcase() {
  const act = document.querySelector("[data-showcase]");
  if (!act) return;

  const tabs = Array.from(act.querySelectorAll("[data-showcase-tab]"));
  const images = new Map(
    Array.from(act.querySelectorAll("[data-showcase-image]")).map((image) => [
      image.dataset.showcaseImage,
      image,
    ])
  );
  const app = act.querySelector("[data-showcase-app]");
  const copy = act.querySelector("[data-showcase-copy]");
  const panel = act.querySelector("#showcase-panel");
  const total = tabs.length;

  if (!total) return;

  let active = -1;
  let frame = 0;

  function setScreen(next) {
    if (next === active) return;
    active = next;

    const tab = tabs[next];
    if (!tab) return;

    for (const [i, item] of tabs.entries()) {
      const selected = i === next;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    }

    for (const [key, image] of images) {
      const selected = key === tab.dataset.showcaseTab;
      image.classList.toggle("is-active", selected);
      if (selected) image.removeAttribute("aria-hidden");
      else image.setAttribute("aria-hidden", "true");
    }

    if (copy) copy.textContent = tab.dataset.copy || "";
    if (panel) panel.setAttribute("aria-labelledby", tab.id);
    if (app) {
      app.setAttribute("aria-label", `Open the ${tab.textContent.trim()} screenshot full size`);
      app.dataset.caption = tab.dataset.caption || "";
    }
  }

  function targetFor(next) {
    const top = act.getBoundingClientRect().top + window.scrollY;
    const span = Math.max(0, act.offsetHeight - window.innerHeight);
    return top + span * ((next + 0.5) / total);
  }

  function update() {
    frame = 0;
    if (staticLayout()) return;

    const p = clamp01(Number.parseFloat(act.style.getPropertyValue("--sc-p")) || 0);
    const next = Math.min(total - 1, Math.floor(p * total));
    setScreen(next);
  }

  function request() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  function selectScreen(next) {
    if (!staticLayout()) {
      window.scrollTo({ top: targetFor(next), behavior: "instant" });
    }
    setScreen(next);
  }

  for (const [i, tab] of tabs.entries()) {
    tab.addEventListener("click", () => selectScreen(i));

    tab.addEventListener("keydown", (event) => {
      let next = null;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (i + 1) % total;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (i - 1 + total) % total;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = total - 1;

      if (next === null) return;

      event.preventDefault();
      selectScreen(next);
      tabs[next].focus({ preventScroll: true });
    });
  }

  setScreen(0);

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request);
  reducedMotion.addEventListener?.("change", request);
  mobileView.addEventListener?.("change", request);
  request();
}

/* ------------------------------------------------------------- navigation -- */

function initLocalTilt() {
  const frame = document.querySelector(".local__frame");
  if (!frame) return;

  let currentTilt = 0;
  let targetTilt = 0;
  let tiltFrame = 0;
  let tiltRequest = 0;

  function animateTilt() {
    currentTilt += (targetTilt - currentTilt) * 0.14;
    frame.style.setProperty("--local-tilt", `${currentTilt.toFixed(2)}deg`);

    if (Math.abs(targetTilt - currentTilt) > 0.02) {
      tiltFrame = window.requestAnimationFrame(animateTilt);
      return;
    }

    currentTilt = targetTilt;
    frame.style.setProperty("--local-tilt", `${currentTilt.toFixed(2)}deg`);
    tiltFrame = 0;
  }

  function updateTilt() {
    tiltRequest = 0;
    if (reducedMotion.matches || mobileView.matches) {
      currentTilt = 0;
      targetTilt = 0;
      frame.style.setProperty("--local-tilt", "0deg");
      if (tiltFrame) window.cancelAnimationFrame(tiltFrame);
      tiltFrame = 0;
      return;
    }

    const rect = frame.getBoundingClientRect();
    const start = window.innerHeight * 0.9;
    const finish = window.innerHeight * 0.3;
    const progress = clamp01((start - rect.top) / (start - finish));
    targetTilt = (1 - progress) * 12;
    if (!tiltFrame) tiltFrame = window.requestAnimationFrame(animateTilt);
  }

  function requestTilt() {
    if (!tiltRequest) tiltRequest = window.requestAnimationFrame(updateTilt);
  }

  window.addEventListener("scroll", requestTilt, { passive: true });
  window.addEventListener("resize", requestTilt);
  reducedMotion.addEventListener?.("change", requestTilt);
  mobileView.addEventListener?.("change", requestTilt);
  updateTilt();
}

function initNavigation() {
  const progress = document.querySelector("[data-progress]");
  const backToTop = document.querySelector(".back-to-top");

  function updateNav() {
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? clamp01(window.scrollY / max) : 0;
      progress.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }

    backToTop?.classList.toggle("is-visible", window.scrollY > 600);
  }

  let navFrame = 0;

  function requestNav() {
    if (!navFrame) {
      navFrame = window.requestAnimationFrame(() => {
        navFrame = 0;
        updateNav();
      });
    }
  }

  window.addEventListener("scroll", requestNav, { passive: true });
  window.addEventListener("resize", requestNav);
  updateNav();
}

const scrollCraft = window.ScrollCraft;

if (scrollCraft) {
  try {
    const scrollEngine = scrollCraft.mount(document.body);
    reducedMotion.addEventListener?.("change", scrollEngine.layout);
    initOrrery();
    initHero(scrollEngine.acts);
    initShowcase();
    initLocalTilt();
    initNavigation();
  } catch (error) {
    console.error("[kirea] scroll engine failed to mount", error);
    document.documentElement.classList.add("no-js");
  }
} else {
  document.documentElement.classList.add("no-js");
}
