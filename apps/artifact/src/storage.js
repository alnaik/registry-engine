export class WindowStorageCache {
  constructor() {
    this._mem = new Map();
  }
  get(key) {
    try {
      const raw = window.storage?.getItem?.(key);
      if (raw != null) return JSON.parse(raw);
    } catch {}
    return this._mem.get(key);
  }
  set(key, value) {
    this._mem.set(key, value);
    try {
      window.storage?.setItem?.(key, JSON.stringify(value));
    } catch {}
  }
}
