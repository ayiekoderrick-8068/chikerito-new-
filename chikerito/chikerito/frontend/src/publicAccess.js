// Session-scoped passcode cache for public event pages, keyed by slug, so a visitor
// only has to enter a passcode once per browser tab per event.
const KEY_PREFIX = "chikerito_passcode_";

export function getStoredPasscode(slug) {
  return sessionStorage.getItem(KEY_PREFIX + slug) || "";
}

export function storePasscode(slug, passcode) {
  sessionStorage.setItem(KEY_PREFIX + slug, passcode);
}
