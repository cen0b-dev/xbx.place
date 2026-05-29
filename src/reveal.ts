let observer: IntersectionObserver | null = null;
let reducedMotion = false;

function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (observer) return observer;

  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: "15% 0px 15% 0px", threshold: 0.01 }
  );
  return observer;
}

export function observeReveal(element: HTMLElement, delayMs = 0): void {
  if (reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.classList.add("reveal", "is-visible");
    return;
  }

  element.classList.add("reveal");
  if (delayMs > 0) {
    element.style.setProperty("--reveal-delay", `${delayMs}ms`);
  }

  const io = ensureObserver();
  if (!io) {
    element.classList.add("is-visible");
    return;
  }
  io.observe(element);
}

export function observeRevealChildren(container: HTMLElement, selector: string, staggerMs = 45): void {
  container.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
    observeReveal(element, index * staggerMs);
  });
}

export function observeRevealFirstRow(
  container: HTMLElement,
  selector: string,
  columnCount: number,
  staggerMs = 35
): void {
  container.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
    if (index < columnCount) observeReveal(element, index * staggerMs);
    else markVisible([element]);
  });
}

function markVisible(elements: Iterable<HTMLElement>): void {
  for (const element of elements) {
    element.classList.add("reveal", "is-visible");
  }
}
