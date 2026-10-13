// Umami is injected by Netlify (with data-auto-track="false": its own history
// tracking would log a pageview per time-slider tick), so it's absent in dev,
// tests and behind ad blockers — every call is a silent no-op there.
// Never put location or compass data in here; the About text promises it
// stays in the browser.

type EventData = Record<string, string | number | boolean>;

interface UmamiPayload {
  url: string;
  title: string;
  name?: string;
  data?: EventData;
}

declare global {
  interface Window {
    umami?: { track(build: (props: object) => object): void };
  }
}

// The injected script can run after this module, so anything sent before the
// page has loaded waits for it. The payload is captured now: by the time it's
// sent, the URL may already belong to another view.
function send(payload: UmamiPayload) {
  const flush = () => window.umami?.track((props) => ({ ...props, ...payload }));
  if (document.readyState === "complete") flush();
  else window.addEventListener("load", flush, { once: true });
}

function snapshot(): UmamiPayload {
  return { url: window.location.pathname + window.location.search, title: document.title };
}

export function trackPageview(): void {
  send(snapshot());
}

export function track(name: string, data?: EventData): void {
  send({ ...snapshot(), name, data });
}
