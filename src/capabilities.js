export function probeCapabilities() {
  return {
    webgpu: Boolean(navigator.gpu),
    worker: typeof Worker !== 'undefined',
    audioWorklet: Boolean(window.AudioWorkletNode),
    indexedDb: typeof indexedDB !== 'undefined',
    serviceWorker: 'serviceWorker' in navigator,
    pwaStandalone: window.matchMedia('(display-mode: standalone)').matches,
    userAgent: navigator.userAgent
  };
}
