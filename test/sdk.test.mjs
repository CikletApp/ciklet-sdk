// SDK unit tests — run against the built ESM output (`npm test` builds first).
// The browser surface the SDK touches is faked on globalThis below.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ── Minimal browser fakes ───────────────────────────────────────── */

const HOST_ORIGIN = "https://ciklet.xyz";

function createStyle() {
  const props = new Map();
  return {
    props,
    setProperty: (name, value) => props.set(name, value),
    getPropertyValue: (name) => props.get(name) ?? "",
  };
}

const parent = { sent: [], postMessage(msg, origin) { this.sent.push({ msg, origin }); } };
const listeners = new Set();

function installWindow(search) {
  parent.sent = [];
  listeners.clear();
  globalThis.document = { referrer: `${HOST_ORIGIN}/channels/x`, documentElement: { style: createStyle() } };
  globalThis.window = {
    parent,
    location: { search, protocol: "https:", host: "abcd.cikletimsi.site" },
    addEventListener: (type, fn) => type === "message" && listeners.add(fn),
    removeEventListener: (type, fn) => type === "message" && listeners.delete(fn),
  };
}

function hostSend(data) {
  for (const fn of [...listeners]) fn({ origin: HOST_ORIGIN, source: parent, data });
}

const { CikletSDK, Platform, RPCEvents, attemptRemap, matchAndRewriteURL, patchUrlMappings, SAFE_AREA_CSS_VARIABLES } =
  await import("../dist/esm/index.js");

beforeEach(() => installWindow(""));

/* ── Launch context ──────────────────────────────────────────────── */

test("parses the full launch context from the iframe URL", () => {
  installWindow(
    "?instance_id=i-app-c1&location_id=c1&launch_id=L-1&referrer_id=u-friend&custom_id=room%3D42" +
      "&channel_id=c1&guild_id=s9&frame_id=f1&platform=desktop",
  );
  const sdk = new CikletSDK("cik_app_x");
  assert.equal(sdk.instanceId, "i-app-c1");
  assert.equal(sdk.locationId, "c1");
  assert.equal(sdk.launchId, "L-1");
  assert.equal(sdk.referrerId, "u-friend");
  assert.equal(sdk.customId, "room=42");
  assert.equal(sdk.channelId, "c1");
  assert.equal(sdk.guildId, "s9");
  assert.equal(sdk.frameId, "f1");
  assert.equal(sdk.platform, Platform.DESKTOP);
  assert.deepEqual(sdk.launchContext, {
    instanceId: "i-app-c1",
    locationId: "c1",
    launchId: "L-1",
    channelId: "c1",
    guildId: "s9",
    customId: "room=42",
    referrerId: "u-friend",
    frameId: "f1",
    platform: "desktop",
  });
});

test("missing / empty launch parameters are null and platform falls back to web", () => {
  installWindow("?instance_id=i&custom_id=&platform=toaster");
  const sdk = new CikletSDK("cik_app_x");
  assert.equal(sdk.customId, null);
  assert.equal(sdk.referrerId, null);
  assert.equal(sdk.guildId, null);
  assert.equal(sdk.locationId, null);
  assert.equal(sdk.launchId, null);
  assert.equal(sdk.channelId, null);
  assert.equal(sdk.platform, Platform.WEB);
});

/* ── Aliases ─────────────────────────────────────────────────────── */

test("getActivityInstanceConnectedParticipants is an alias of getInstanceConnectedParticipants", async () => {
  const sdk = new CikletSDK("cik_app_x", { hostOrigin: HOST_ORIGIN });
  const pending = sdk.commands.getActivityInstanceConnectedParticipants();
  const request = parent.sent.at(-1).msg;
  assert.equal(request.cmd, "GET_INSTANCE_CONNECTED_PARTICIPANTS");
  assert.equal(parent.sent.at(-1).origin, HOST_ORIGIN);
  hostSend({ cmd: request.cmd, nonce: request.nonce, evt: null, data: { participants: [{ id: "u1", username: "a" }] } });
  assert.deepEqual(await pending, { participants: [{ id: "u1", username: "a" }] });
  sdk.close();
});

test("setActivity forwards the Discord-shaped activity unchanged", () => {
  const sdk = new CikletSDK("cik_app_x", { hostOrigin: HOST_ORIGIN });
  const activity = {
    type: 0,
    details: "Maçta",
    state: "Dereceli",
    party: { id: "p1", size: [2, 4] },
    timestamps: { start: 1_700_000_000_000 },
    assets: { large_image: "board", large_text: "Tavla" },
  };
  void sdk.commands.setActivity({ activity }).catch(() => {});
  const request = parent.sent.at(-1).msg;
  assert.equal(request.cmd, "SET_ACTIVITY");
  assert.deepEqual(request.args, { activity });
  sdk.close();
});

/* ── Events ──────────────────────────────────────────────────────── */

test("VISIBILITY_UPDATE is a known event and reaches subscribers", () => {
  assert.equal(RPCEvents.VISIBILITY_UPDATE, "VISIBILITY_UPDATE");
  const sdk = new CikletSDK("cik_app_x", { hostOrigin: HOST_ORIGIN });
  const seen = [];
  sdk.subscribe("VISIBILITY_UPDATE", (data) => seen.push(data));
  assert.deepEqual(parent.sent.at(-1).msg.args, { evt: "VISIBILITY_UPDATE" });
  hostSend({ cmd: "DISPATCH", nonce: null, evt: "VISIBILITY_UPDATE", data: { hidden: true } });
  assert.deepEqual(seen, [{ hidden: true }]);
  sdk.close();
});

test("safe-area insets become CSS variables, defaulting to 0px", () => {
  const sdk = new CikletSDK("cik_app_x", { hostOrigin: HOST_ORIGIN });
  const style = document.documentElement.style;
  assert.equal(style.getPropertyValue(SAFE_AREA_CSS_VARIABLES.top), "0px");
  assert.equal(style.getPropertyValue("--ciklet-safe-area-inset-bottom"), "0px");
  hostSend({
    cmd: "DISPATCH",
    nonce: null,
    evt: "SAFE_AREA_INSETS_UPDATE",
    data: { top: 0, right: 12, bottom: 34.5, left: -3 },
  });
  assert.equal(style.getPropertyValue("--ciklet-safe-area-inset-right"), "12px");
  assert.equal(style.getPropertyValue("--ciklet-safe-area-inset-bottom"), "34.5px");
  assert.equal(style.getPropertyValue("--ciklet-safe-area-inset-left"), "0px");
  sdk.close();
});

test("messages from another window are ignored", () => {
  const sdk = new CikletSDK("cik_app_x", { hostOrigin: HOST_ORIGIN });
  for (const fn of listeners) {
    fn({ origin: HOST_ORIGIN, source: {}, data: { cmd: "DISPATCH", nonce: null, evt: "SAFE_AREA_INSETS_UPDATE", data: { top: 50 } } });
  }
  assert.equal(document.documentElement.style.getPropertyValue("--ciklet-safe-area-inset-top"), "0px");
  sdk.close();
});

/* ── URL mappings ────────────────────────────────────────────────── */

const LOC = { prefixHost: "abcd.cikletimsi.site", prefixProtocol: "https:" };
const MAPPINGS = [
  { prefix: "/", target: "game.example.com" },
  { prefix: "/api", target: "api.example.com" },
  { prefix: "/cdn", target: "example.com/static/v2" },
  { prefix: "/{region}", target: "{region}.servers.example.com" },
];

const remap = (url) => attemptRemap({ url, mappings: MAPPINGS, ...LOC }).toString();

test("prefix mappings are served under /.proxy/<prefix>", () => {
  assert.equal(remap("https://api.example.com/v1/users?x=1"), "https://abcd.cikletimsi.site/.proxy/api/v1/users?x=1");
});

test("the root mapping is served at the proxy root (Ciklet proxy convention)", () => {
  assert.equal(remap("https://game.example.com/assets/a.png"), "https://abcd.cikletimsi.site/assets/a.png");
});

test("target paths are stripped and must match on a segment boundary", () => {
  assert.equal(remap("https://example.com/static/v2/img/x.png"), "https://abcd.cikletimsi.site/.proxy/cdn/img/x.png");
  assert.equal(remap("https://example.com/static/v22/x.png"), "https://example.com/static/v22/x.png");
});

test("websocket URLs keep their scheme family", () => {
  assert.equal(remap("wss://api.example.com/ws"), "wss://abcd.cikletimsi.site/.proxy/api/ws");
});

test("host placeholders are substituted into the prefix", () => {
  assert.equal(remap("https://eu.servers.example.com/join"), "https://abcd.cikletimsi.site/.proxy/eu/join");
});

test("unmapped and same-origin URLs are left alone", () => {
  assert.equal(remap("https://other.example.org/x"), "https://other.example.org/x");
  assert.equal(remap("https://abcd.cikletimsi.site/.proxy/api/x"), "https://abcd.cikletimsi.site/.proxy/api/x");
  assert.equal(
    matchAndRewriteURL({ originalURL: new URL("https://nope.example.com/"), prefix: "/api", target: "api.example.com", ...LOC }),
    null,
  );
});

test("a target given with a protocol is tolerated", () => {
  const url = attemptRemap({ url: "https://api.example.com/a", mappings: [{ prefix: "api", target: "https://api.example.com/" }], ...LOC });
  assert.equal(url.toString(), "https://abcd.cikletimsi.site/.proxy/api/a");
});

test("patchUrlMappings rewrites fetch, XHR and WebSocket and can be undone", async () => {
  const fetched = [];
  const originalFetch = async (input) => {
    fetched.push(typeof input === "string" ? input : input.toString());
    return "ok";
  };
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = String(url);
    }
  }
  class FakeXHR {
    open(method, url) {
      this.opened = [method, String(url)];
    }
  }
  window.fetch = originalFetch;
  window.WebSocket = FakeWebSocket;
  window.XMLHttpRequest = FakeXHR;

  const unpatch = patchUrlMappings(MAPPINGS);

  await window.fetch("https://api.example.com/v1/me");
  await window.fetch("/relative/path");
  assert.deepEqual(fetched, ["https://abcd.cikletimsi.site/.proxy/api/v1/me", "/relative/path"]);

  const ws = new window.WebSocket("wss://api.example.com/socket");
  assert.equal(ws.url, "wss://abcd.cikletimsi.site/.proxy/api/socket");
  assert.ok(ws instanceof FakeWebSocket);
  assert.equal(window.WebSocket.OPEN, 1);

  const xhr = new window.XMLHttpRequest();
  xhr.open("GET", "https://game.example.com/data.json");
  assert.deepEqual(xhr.opened, ["GET", "https://abcd.cikletimsi.site/data.json"]);

  unpatch();
  assert.equal(window.fetch, originalFetch);
  assert.equal(window.WebSocket, FakeWebSocket);
  const plain = new FakeXHR();
  plain.open("GET", "https://game.example.com/data.json");
  assert.deepEqual(plain.opened, ["GET", "https://game.example.com/data.json"]);
});
