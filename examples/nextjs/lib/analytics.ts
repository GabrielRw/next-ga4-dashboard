export function track(eventName: string, properties?: Record<string, unknown>) {
  window.gtag?.("event", eventName, properties);
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}
