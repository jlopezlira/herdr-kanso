import assert from "node:assert/strict";
import { once } from "node:events";
import { access, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import { exec } from "./helpers.mjs";

export async function httpsFiles(t, root, site = root) {
  const key = join(root, "fixture.key");
  const cert = join(root, "fixture.pem");
  const gitExec = process.platform === "win32" ? (await exec("git", ["--exec-path"])).stdout.trim() : "";
  const bundled = gitExec && resolve(gitExec, "../../bin/openssl.exe");
  const openssl = bundled && await access(bundled).then(() => true, () => false) ? bundled : "openssl";
  const made = await exec(openssl, [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-days", "1", "-keyout", key, "-out", cert,
  ]);
  assert.equal(made.code, 0, made.stderr);
  await writeFile(join(root, ".curlrc"), `cacert = ${JSON.stringify(cert)}\n`);
  const assets = new Map();
  const requested = new Set();
  const server = createServer({ key: await readFile(key), cert: await readFile(cert), maxVersion: "TLSv1.2" }, async (request, response) => {
    requested.add(request.url);
    const file = assets.get(request.url);
    const bytes = file && await readFile(file).catch(() => null);
    if (!bytes) response.writeHead(404);
    response.end(bytes || undefined);
  });
  t.after(() => { server.close(); server.closeAllConnections(); });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const url = (path) => {
    const route = "/" + path;
    assets.set(route, join(site, path));
    return `https://127.0.0.1:${server.address().port}${route}`;
  };
  const env = { CURL_HOME: root, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" };
  return { url, env, requested };
}
