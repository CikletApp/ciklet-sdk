// ─────────────────────────────────────────────────────────────────
// @ciklet/embedded-activities-sdk — URL Mappings
//
// Discord's `patchUrlMappings` equivalent. Activities run behind the
// Ciklet activity proxy (`https://<label>.<proxy-domain>`), which only lets
// the iframe talk to its own origin. Every external API the activity needs
// is registered in the Developer Portal (Activities › URL Mappings) as
// `prefix → target`, and the proxy serves it under the activity's origin:
//
//   prefix "/"     : https://<label>.<proxy>/<path>            → target/<path>
//   prefix "/api"  : https://<label>.<proxy>/.proxy/api/<path> → target/<path>
//
// (same convention as ciklet-activities/proxy/src/mappings.js). This helper
// rewrites absolute URLs that point at a mapped target so that `fetch`,
// `XMLHttpRequest`, `WebSocket` (and optionally `src` attributes) go through
// the proxy instead of being blocked.
// ─────────────────────────────────────────────────────────────────

/** One URL mapping, as entered in the Developer Portal. */
export interface Mapping {
  /** Proxy path prefix, e.g. `"/api"` (or `"/"` for the root mapping). */
  prefix: string;
  /**
   * Target host plus optional path, WITHOUT protocol — e.g.
   * `"api.example.com"` or `"example.com/games/x"`. A protocol is tolerated
   * and ignored. Host labels may use `{name}` placeholders that are
   * substituted into the prefix (`"{region}.example.com"` → `"/{region}"`).
   */
  target: string;
}

export interface PatchUrlMappingsConfig {
  /** Patch `window.fetch`. Default `true`. */
  patchFetch?: boolean;
  /** Patch `window.WebSocket`. Default `true`. */
  patchWebSocket?: boolean;
  /** Patch `XMLHttpRequest.prototype.open`. Default `true`. */
  patchXhr?: boolean;
  /**
   * Rewrite `src` attributes of elements already in / later added to the
   * document (images, scripts, media). Default `false`.
   */
  patchSrcAttributes?: boolean;
}

/** Path every non-root mapping is served under (proxy convention). */
export const PROXY_PATH_PREFIX = "/.proxy";

interface Location {
  protocol: string;
  host: string;
}

const PLACEHOLDER = /\{([a-z0-9_]+)\}/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePrefix(raw: string): string {
  let prefix = String(raw ?? "").trim();
  if (!prefix.startsWith("/")) prefix = `/${prefix}`;
  prefix = prefix.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return prefix === "" ? "/" : prefix;
}

interface ParsedTarget {
  hostPattern: RegExp;
  placeholders: string[];
  /** Target path without trailing slash ("" for the root). */
  path: string;
  /** Length used to prefer the most specific target. */
  specificity: number;
}

function parseTarget(raw: string): ParsedTarget | null {
  const withoutProtocol = String(raw ?? "")
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  if (!withoutProtocol) return null;
  const slash = withoutProtocol.indexOf("/");
  const host = (slash === -1 ? withoutProtocol : withoutProtocol.slice(0, slash)).toLowerCase();
  const path = (slash === -1 ? "" : withoutProtocol.slice(slash)).split(/[?#]/)[0].replace(/\/+$/, "");
  if (!host) return null;

  const placeholders: string[] = [];
  let pattern = "";
  let last = 0;
  for (const match of host.matchAll(PLACEHOLDER)) {
    pattern += escapeRegExp(host.slice(last, match.index));
    pattern += "([^./:]+)";
    placeholders.push(match[1]);
    last = (match.index ?? 0) + match[0].length;
  }
  pattern += escapeRegExp(host.slice(last));
  return {
    hostPattern: new RegExp(`^${pattern}$`, "i"),
    placeholders,
    path,
    specificity: host.length + path.length,
  };
}

/** Same-scheme-family protocol on the proxy origin (https→https, wss→wss). */
function proxiedProtocol(original: string, location: Location): string {
  const secure = location.protocol === "https:";
  if (original === "ws:" || original === "wss:") return secure ? "wss:" : "ws:";
  return location.protocol;
}

/**
 * Rewrites ONE absolute URL against ONE mapping. Returns `null` when the URL
 * does not point at the mapping's target.
 */
export function matchAndRewriteURL(input: {
  originalURL: URL;
  prefix: string;
  target: string;
  /** Host (with port) of the proxy origin; defaults to `window.location.host`. */
  prefixHost?: string;
  /** Protocol of the proxy origin; defaults to `window.location.protocol`. */
  prefixProtocol?: string;
}): URL | null {
  const target = parseTarget(input.target);
  if (!target) return null;
  const location = currentLocation(input.prefixHost, input.prefixProtocol);
  const original = input.originalURL;
  if (!/^(https?|wss?):$/.test(original.protocol)) return null;

  const hostMatch = target.hostPattern.exec(original.host) ?? target.hostPattern.exec(original.hostname);
  if (!hostMatch) return null;

  const path = original.pathname;
  if (target.path && path !== target.path && !path.startsWith(`${target.path}/`)) return null;
  const remainder = target.path ? path.slice(target.path.length) : path;

  let prefix = normalizePrefix(input.prefix);
  target.placeholders.forEach((name, i) => {
    prefix = prefix.split(`{${name}}`).join(hostMatch[i + 1]);
  });
  const mountPoint = prefix === "/" ? "" : `${PROXY_PATH_PREFIX}${prefix}`;

  const rewritten = new URL(original.toString());
  rewritten.protocol = proxiedProtocol(original.protocol, location);
  rewritten.host = location.host;
  rewritten.username = "";
  rewritten.password = "";
  rewritten.pathname = `${mountPoint}${remainder.startsWith("/") ? remainder : `/${remainder}`}`;
  return rewritten;
}

/**
 * Rewrites `url` with the most specific matching mapping; returns the URL
 * unchanged (as a `URL`) when no mapping applies or it is already same-origin.
 */
export function attemptRemap(input: {
  url: URL | string;
  mappings: readonly Mapping[];
  prefixHost?: string;
  prefixProtocol?: string;
}): URL {
  const location = currentLocation(input.prefixHost, input.prefixProtocol);
  const base = `${location.protocol}//${location.host}`;
  const url = typeof input.url === "string" ? new URL(input.url, base) : new URL(input.url.toString());
  if (url.host === location.host) return url;

  const ordered = [...input.mappings]
    .map((mapping) => ({ mapping, parsed: parseTarget(mapping.target) }))
    .filter((entry): entry is { mapping: Mapping; parsed: ParsedTarget } => entry.parsed !== null)
    .sort((a, b) => b.parsed.specificity - a.parsed.specificity);

  for (const { mapping } of ordered) {
    const rewritten = matchAndRewriteURL({
      originalURL: url,
      prefix: mapping.prefix,
      target: mapping.target,
      prefixHost: location.host,
      prefixProtocol: location.protocol,
    });
    if (rewritten) return rewritten;
  }
  return url;
}

function currentLocation(host?: string, protocol?: string): Location {
  const win = typeof window !== "undefined" ? window : undefined;
  return {
    host: host ?? win?.location.host ?? "",
    protocol: protocol ?? win?.location.protocol ?? "https:",
  };
}

/** Remaps only absolute http(s)/ws(s) strings; relative URLs are already same-origin. */
function remapString(value: string, mappings: readonly Mapping[]): string {
  if (!/^(https?|wss?):\/\//i.test(value)) return value;
  try {
    const remapped = attemptRemap({ url: value, mappings });
    return remapped.toString() === new URL(value).toString() ? value : remapped.toString();
  } catch {
    return value;
  }
}

function remapAny(value: unknown, mappings: readonly Mapping[]): unknown {
  if (typeof value === "string") return remapString(value, mappings);
  if (typeof URL !== "undefined" && value instanceof URL) {
    const next = remapString(value.toString(), mappings);
    return next === value.toString() ? value : new URL(next);
  }
  return value;
}

/**
 * Patches the global network APIs so requests to mapped targets go through
 * the Ciklet activity proxy — the equivalent of Discord's
 * `patchUrlMappings(mappings, config)`.
 *
 * Call it ONCE, early (before your app issues requests), and only when the
 * activity is running inside Ciklet. Returns a function that restores the
 * original APIs (a Ciklet extension; Discord's version returns nothing).
 *
 * ```typescript
 * import { patchUrlMappings } from '@ciklet/embedded-activities-sdk';
 * patchUrlMappings([{ prefix: '/api', target: 'api.example.com' }]);
 * // fetch('https://api.example.com/v1/x') → fetch('https://<you>.<proxy>/.proxy/api/v1/x')
 * ```
 */
export function patchUrlMappings(
  mappings: readonly Mapping[],
  {
    patchFetch = true,
    patchWebSocket = true,
    patchXhr = true,
    patchSrcAttributes = false,
  }: PatchUrlMappingsConfig = {},
): () => void {
  if (typeof window === "undefined") return () => {};
  const list = [...mappings];
  const restores: Array<() => void> = [];
  const win = window as Window & typeof globalThis;

  if (patchFetch && typeof win.fetch === "function") {
    const originalFetch = win.fetch;
    const patchedFetch: typeof fetch = (input, init) => {
      if (typeof Request !== "undefined" && input instanceof Request) {
        const next = remapString(input.url, list);
        return originalFetch.call(win, next === input.url ? input : new Request(next, input), init);
      }
      return originalFetch.call(win, remapAny(input, list) as RequestInfo | URL, init);
    };
    win.fetch = patchedFetch;
    restores.push(() => {
      if (win.fetch === patchedFetch) win.fetch = originalFetch;
    });
  }

  if (patchWebSocket && typeof win.WebSocket === "function") {
    const OriginalWebSocket = win.WebSocket;
    const PatchedWebSocket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
      return new OriginalWebSocket(remapAny(url, list) as string | URL, protocols);
    } as unknown as typeof WebSocket;
    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const) {
      Object.defineProperty(PatchedWebSocket, key, { value: OriginalWebSocket[key] });
    }
    win.WebSocket = PatchedWebSocket;
    restores.push(() => {
      if (win.WebSocket === PatchedWebSocket) win.WebSocket = OriginalWebSocket;
    });
  }

  if (patchXhr && typeof win.XMLHttpRequest === "function") {
    const proto = win.XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const patchedOpen = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      return (originalOpen as (...args: unknown[]) => void).call(this, method, remapAny(url, list), ...rest);
    } as typeof proto.open;
    proto.open = patchedOpen;
    restores.push(() => {
      if (proto.open === patchedOpen) proto.open = originalOpen;
    });
  }

  if (patchSrcAttributes && typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
    const rewrite = (element: Element) => {
      const src = element.getAttribute("src");
      if (!src) return;
      const next = remapString(src, list);
      if (next !== src) element.setAttribute("src", next);
    };
    const scan = (root: ParentNode) => root.querySelectorAll?.("[src]").forEach(rewrite);
    scan(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) rewrite(record.target);
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            rewrite(node);
            scan(node);
          }
        });
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src"],
    });
    restores.push(() => observer.disconnect());
  }

  return () => {
    for (const restore of restores.splice(0).reverse()) restore();
  };
}
