import { test } from "node:test";
import assert from "node:assert/strict";
import { CikletRest, CikletRestError } from "../dist/esm/index.js";

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(next.status === 204 ? null : JSON.stringify(next.body), { status: next.status });
  };
  return { impl, calls };
}

test("CikletRest lobi ve istatistik yolları Bearer jetonla", async () => {
  const { impl, calls } = fakeFetch([
    { status: 200, body: { id: "1", members: [] } },
    { status: 204 },
    { status: 200, body: { stats: { seviye: 3 }, updated_at: null } },
  ]);
  const rest = new CikletRest({ accessToken: "cik_at_x", baseUrl: "https://ornek.test/", fetch: impl });
  const lobby = await rest.lobbies.createOrJoin({ secret: "mac" });
  assert.equal(lobby.id, "1");
  await rest.lobbies.leave("1");
  await rest.gameStats.put("@me", { seviye: 3 });
  assert.equal(calls[0].url, "https://ornek.test/api/v1/lobbies");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers.authorization, "Bearer cik_at_x");
  assert.equal(calls[1].url, "https://ornek.test/api/v1/lobbies/1/members/@me");
  assert.equal(calls[2].url, "https://ornek.test/api/v1/users/@me/applications/@me/game-stats");
  assert.deepEqual(JSON.parse(calls[2].init.body), { stats: { seviye: 3 } });
});

test("CikletRest hata gövdesini CikletRestError olarak fırlatır", async () => {
  const { impl } = fakeFetch([{ status: 404, body: { code: "unknown_lobby", message: "Lobi bulunamadı." } }]);
  const rest = new CikletRest({ accessToken: "t", fetch: impl });
  await assert.rejects(rest.lobbies.get("x"), (err) => err instanceof CikletRestError && err.status === 404 && err.code === "unknown_lobby");
});
