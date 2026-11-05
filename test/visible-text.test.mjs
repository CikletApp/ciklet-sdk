// Geliştiriciye görünen yayın içeriğinde (npm paketi: dist + README +
// CHANGELOG; Social SDK'nın Unity/Unreal kaynakları ve README'si) Ciklet'in iç
// altyapısına dair ayrıntı geçmemeli.
//
// İstisna (bilerek serbest): LiveKit — geliştiricinin lobi sesine bağlanmak
// için KENDİSİNİN kullanacağı üçüncü taraf istemci SDK'sı; iç ayrıntı değil.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");

const FORBIDDEN = [
  /NEXT_PUBLIC/,
  /process\.env/,
  /Prisma/i,
  /Drizzle/,
  /Turbopack/i,
  /Vercel/i,
  /Next\.js/i,
  /NextAuth|next-auth/i,
  /Redis/i,
  /Mongo/i,
  /Postgres/i,
  /UploadThing/i,
  /\bVite\b/,
  /efsevi/i,
  /CloudPanel/i,
  /\bpm2\b/,
  /\/opt\//,
  /\/home\//,
  /bid10xyz/,
  /ciklet-(web|infra|activities)\b/,
  /gateway\/src\//,
  /src\/lib\//,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function leaksIn(file) {
  const leaks = [];
  readFileSync(file, "utf8").split("\n").forEach((line, n) => {
    for (const re of FORBIDDEN) if (re.test(line)) leaks.push(`${relative(ROOT, file)}:${n + 1} ${re} → ${line.trim()}`);
  });
  return leaks;
}

test("yayınlanan dosyalarda iç altyapı ayrıntısı yok", () => {
  assert.ok(existsSync(join(ROOT, "dist")), "önce derleyin (npm test derler)");
  const files = [
    ...walk(join(ROOT, "dist")),
    join(ROOT, "README.md"),
    join(ROOT, "CHANGELOG.md"),
    join(ROOT, "package.json"),
    // Social SDK: Unity (UPM) ve Unreal eklentisi kaynak olarak dağıtılır.
    ...walk(join(ROOT, "social")).filter((f) => /\.(cs|h|cpp|md|json|uplugin|asmdef)$/.test(f)),
  ];
  const leaks = files.flatMap(leaksIn);
  assert.deepEqual(leaks, []);
});
