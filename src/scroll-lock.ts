let savedScrollY = 0;

export function updateScrollLock(): void {
  const locked = document.querySelector(".overlay.show") !== null;
  const body = document.body;

  if (locked && !body.classList.contains("scroll-locked")) {
    savedScrollY = window.scrollY;
    body.classList.add("scroll-locked");
    body.style.top = `-${savedScrollY}px`;
    return;
  }

  if (!locked && body.classList.contains("scroll-locked")) {
    body.classList.remove("scroll-locked");
    body.style.top = "";
    window.scrollTo(0, savedScrollY);
  }
}

export function initScrollLock(): void {
  const sync = (): void => updateScrollLock();
  document.querySelectorAll(".overlay").forEach((el) => {
    new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ["class"] });
  });
  sync();
}
