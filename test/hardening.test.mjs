// Güvenlik testleri: host origin kilidi, gelen mesaj doğrulama, komut
// sızıntıları ve CikletRest (zaman aşımı, yol parçası, jeton görünürlüğü).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

const HOST = "https://ciklet.xyz";
const OWN = "https://abcd.cikletimsi.site";
const EVIL = "https://kotu.example";

const parent = { sent: [], postMessage(msg, origin) { this.sent.push({ msg, origin }); } };
const listeners = new Set();
const warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));

function install({ referrer = "" } = {}) {
  parent.sent = [];
  parent.postMessage = function (msg, origin) { this.sent.push({ msg, origin }); };
  listeners.clear();
  const style = new Map();
  globalThis.document = {
    referrer,
    documentElement: { style: { setProperty: (k, v) => style.set(k, v), getPropertyValue: (k) => style.get(k) ?? "" } },
  };
  globalThis.window = {
    parent,
    location: { search: "", protocol: "https:", host: "abcd.cikletimsi.site", origin: OWN },
    addEventListener: (type, fn) => type === "message" && listeners.add(fn),
    removeEventListener: (type, fn) => type === "message" && listeners.delete(fn),
  };
}

function deliver(data, { origin = HOST, source = parent } = {}) {
  for (const fn of [...listeners]) fn({ origin, source, data });
}

const ready = (extra = {}) => ({ cmd: "DISPATCH", nonce: null, evt: "READY", data: { v: 1 }, ...extra });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const { CikletSDK, CikletRest, CikletRestError, RPCError } = await import("../dist/esm/index.js");

/* ── Host origin ────────────────────────────────────────────────── */

test("referrer yoksa: yalnızca el sıkışma '*' ile gider, READY origin'i kilitler", async () => {
  install({ referrer: "" });
  const sdk = new CikletSDK("cik_app_x");
  assert.equal(sdk.hostOrigin, "*");
  assert.equal(parent.sent.length, 1);
  assert.deepEqual(parent.sent[0].msg.args, { v: 1, client_id: "cik_app_x" }, "el sıkışmada yalnızca herkese açık kimlik var");

  // READY'den önce jeton taşıyan komut '*' hedefine GÖNDERİLMEZ.
  const auth = sdk.commands.authenticate({ access_token: "cik_at_gizli" });
  await tick();
  assert.equal(parent.sent.length, 1, "origin bilinmeden komut gönderilmedi");

  deliver(ready());
  await sdk.ready();
  await tick();
  assert.equal(sdk.hostOrigin, HOST);
  const sent = parent.sent[1];
  assert.equal(sent.msg.cmd, "AUTHENTICATE");
  assert.equal(sent.origin, HOST, "jeton yalnızca kilitlenen origin'e gider");
  assert.ok(parent.sent.every((m, i) => i === 0 || m.origin !== "*"));

  deliver({ cmd: "AUTHENTICATE", nonce: sent.msg.nonce, evt: null, data: { user: { id: "u" } } });
  assert.deepEqual(await auth, { user: { id: "u" } });
});

test("kilitlendikten sonra başka origin'den gelen mesaj yok sayılır", async () => {
  install({ referrer: "" });
  const sdk = new CikletSDK("cik_app_x");
  deliver(ready());
  await sdk.ready();
  const seen = [];
  sdk.subscribe("CURRENT_USER_UPDATE", (u) => seen.push(u));
  deliver({ cmd: "DISPATCH", nonce: null, evt: "CURRENT_USER_UPDATE", data: { id: "sahte" } }, { origin: EVIL });
  deliver({ cmd: "DISPATCH", nonce: null, evt: "CURRENT_USER_UPDATE", data: { id: "gercek" } });
  assert.deepEqual(seen, [{ id: "gercek" }]);
});

test("origin bilinmezken READY dışındaki mesajlar ve yabancı pencere kabul edilmez", async () => {
  install({ referrer: "" });
  const sdk = new CikletSDK("cik_app_x");
  const seen = [];
  sdk.subscribe("CURRENT_USER_UPDATE", (u) => seen.push(u));
  deliver({ cmd: "DISPATCH", nonce: null, evt: "CURRENT_USER_UPDATE", data: { id: "erken" } }, { origin: EVIL });
  deliver(ready(), { origin: EVIL, source: {} }); // window.parent değil
  assert.equal(sdk.isReady, false);
  assert.equal(sdk.hostOrigin, "*");
  assert.deepEqual(seen, []);
});

test("referrer aktivitenin kendi origin'iyse (iframe içi gezinme) host sayılmaz", async () => {
  install({ referrer: `${OWN}/lobi` });
  const sdk = new CikletSDK("cik_app_x");
  assert.equal(sdk.hostOrigin, "*", "kendi origin'ine postMessage bütün komutları sessizce düşürürdü");
  deliver(ready());
  await sdk.ready();
  assert.equal(sdk.hostOrigin, HOST);
});

test("açık hostOrigin: başka bir sayfa gömerse el sıkışma tamamlanmaz", async () => {
  install({ referrer: `${EVIL}/sayfa` });
  const sdk = new CikletSDK("cik_app_x", { hostOrigin: HOST });
  assert.equal(parent.sent[0].origin, HOST);
  deliver(ready(), { origin: EVIL });
  assert.equal(sdk.isReady, false);
  assert.equal(sdk.hostOrigin, HOST);
});

test("referrer host ise davranış değişmedi", () => {
  install({ referrer: `${HOST}/channels/x` });
  const sdk = new CikletSDK("cik_app_x");
  assert.equal(sdk.hostOrigin, HOST);
  assert.equal(parent.sent[0].origin, HOST);
  sdk.commands.getChannel().catch(() => {});
  assert.equal(parent.sent[1].origin, HOST);
  sdk.close();
});

/* ── Gelen mesaj doğrulama ──────────────────────────────────────── */

test("bozuk biçimli mesajlar ve hata yükleri güvenle işlenir", async () => {
  install({ referrer: `${HOST}/` });
  const sdk = new CikletSDK("cik_app_x");
  deliver(ready());
  await sdk.ready();

  for (const junk of [null, 42, "metin", [], { cmd: 5 }, { cmd: "DISPATCH", nonce: 7 }, { cmd: "DISPATCH", nonce: null, evt: { toString: () => "READY" } }]) {
    assert.doesNotThrow(() => deliver(junk));
  }

  const pending = sdk.commands.getChannel();
  const nonce = parent.sent.at(-1).msg.nonce;
  deliver({ cmd: "GET_CHANNEL", nonce, evt: null, data: { error: { code: "4005", message: { x: 1 } } } });
  await assert.rejects(pending, (err) => err instanceof RPCError && err.code === 0 && err.message.includes("Unknown RPC error"));

  // Aynı nonce ikinci kez yanıtlanamaz.
  assert.doesNotThrow(() => deliver({ cmd: "GET_CHANNEL", nonce, evt: null, data: { id: "c" } }));
});

test("gönderilemeyen komut bekleyen kayıt ve zamanlayıcı bırakmaz", async () => {
  install({ referrer: `${HOST}/` });
  const sdk = new CikletSDK("cik_app_x", { commandTimeoutMs: 60_000 });
  deliver(ready());
  await sdk.ready();
  parent.postMessage = () => { throw new Error("DataCloneError"); };
  await assert.rejects(sdk.commands.setConfig({ fn: () => {} }), /DataCloneError/);
  assert.equal(sdk["_pendingRequests"].size, 0);
});

/* ── CikletRest ─────────────────────────────────────────────────── */

test("CikletRest: yanıt vermeyen sunucuda zaman aşımı", async () => {
  const fetch = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const rest = new CikletRest({ accessToken: "t", fetch, timeoutMs: 30 });
  await assert.rejects(rest.lobbies.get("1"), (err) => err instanceof CikletRestError && err.code === "timeout" && err.status === 0);
});

test("CikletRest: JSON olmayan hata gövdesi HTTP durumunu gizlemez", async () => {
  const rest = new CikletRest({ accessToken: "t", fetch: async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }) });
  await assert.rejects(rest.lobbies.get("1"), (err) => err instanceof CikletRestError && err.status === 502 && err.code === "http_error");
  const odd = new CikletRest({ accessToken: "t", fetch: async () => new Response("tamam", { status: 200 }) });
  await assert.rejects(odd.lobbies.get("1"), (err) => err instanceof CikletRestError && err.code === "invalid_json");
});

test("CikletRest: '.', '..' ve boş kimlik reddedilir; eğik çizgi kodlanır", async () => {
  const calls = [];
  const rest = new CikletRest({ accessToken: "t", baseUrl: "https://ornek.test", fetch: async (url) => { calls.push(url); return new Response("{}", { status: 200 }); } });
  assert.throws(() => rest.lobbies.get(".."), TypeError);
  assert.throws(() => rest.lobbies.leave("."), TypeError);
  assert.throws(() => rest.lobbies.sendMessage("", "x"), TypeError);
  assert.throws(() => rest.gameStats.get(".."), TypeError);
  assert.equal(calls.length, 0);
  await rest.lobbies.get("a/../../users/@me");
  assert.equal(new URL(calls[0]).pathname, "/api/v1/lobbies/a%2F..%2F..%2Fusers%2F%40me");
  await rest.gameStats.get();
  assert.equal(new URL(calls[1]).pathname, "/api/v1/users/@me/applications/@me/game-stats");
});

test("CikletRest: erişim jetonu console.log / JSON.stringify ile yazılmaz", async () => {
  const calls = [];
  const rest = new CikletRest({ accessToken: "cik_at_cok_gizli", fetch: async (url, init) => { calls.push(init); return new Response(null, { status: 204 }); } });
  assert.ok(!inspect(rest, { depth: 5 }).includes("cik_at_cok_gizli"));
  assert.ok(!JSON.stringify(rest).includes("cik_at_cok_gizli"));
  await rest.lobbies.leave("1");
  assert.equal(calls[0].headers.authorization, "Bearer cik_at_cok_gizli");
});
