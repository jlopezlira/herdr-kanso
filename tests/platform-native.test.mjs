import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeFile, appendFile, readFile, realpath, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { fileApi } from "../kanso/mods/kanso-panel/platform-files.js";
import { transcriptApi } from "../kanso/mods/kanso-panel/platform-transcripts.js";
import { processApi } from "../kanso/mods/kanso-panel/platform-processes.js";
import { portApi } from "../kanso/mods/kanso-panel/platform-ports.js";
import { repositoryApi } from "../kanso/mods/kanso-panel/platform-repositories.js";
import { exec, nativePlatform, temporary, load } from "./helpers.mjs";

test("native filesystem services preserve Unicode names, literal quotes and recursion boundaries", async (t) => {
  const root = await temporary(t), files = fileApi(nativePlatform, exec);
  const folder = join(root, "O'Brien ü folder"), source = join(folder, "one.txt"), copied = join(folder, "two.txt"), moved = join(folder, "three.txt");
  assert.equal((await files.mkdir(folder)).code, 0);
  await writeFile(source, "código\n");
  assert.equal((await files.copy(source, copied)).code, 0);
  assert.equal((await files.move(copied, moved)).code, 0);
  assert.equal(await files.read(moved), "código\n");
  assert.equal(await files.test(copied), false);
  assert.deepEqual((await files.existing([source, copied, moved])).sort(), [source, moved].sort());
  await files.mkdir(join(folder, "node_modules"));
  await writeFile(join(folder, "node_modules", "hidden.txt"), "hidden");
  const found = (await files.walk([folder], { skip: ["node_modules"] })).filter((path) => path.endsWith(".txt"));
  const resolved = async (paths) => (await Promise.all(paths.map((path) => realpath(path)))).sort();
  assert.deepEqual(await resolved(found), await resolved([source, moved]));
  assert.equal(await files.recent([source], Date.now() - 60000), true);
  await files.remove([moved]);
  assert.equal(await files.test(moved), false);
});

test("native transcript slices respect UTF-8 byte offsets, CRLF and unfinished lines", async (t) => {
  const root = await temporary(t), file = join(root, "conversation.jsonl"), api = transcriptApi(nativePlatform, exec);
  const first = '{"text":"código"}\r\n', second = '{"text":"next"}\n';
  await writeFile(file, first + second.slice(0, -1));
  const slice = await api.slice(file, 0, 8192, 16000);
  assert.equal(slice.code, 0, slice.stderr);
  assert.equal(slice.stdout.split("\n")[0], `${Buffer.byteLength(first)} ${Buffer.byteLength(first + second) - 1}`);
  assert.equal(slice.stdout.split("\n")[1], first.trim());
  await appendFile(file, "\n");
  assert.match((await api.slice(file, Buffer.byteLength(first), 8192, 16000)).stdout, /next/);
  await writeFile(file, "x".repeat(10000) + "\n" + second);
  const bounded = await api.slice(file, 0, 80, 60);
  assert.equal(bounded.code, 0, bounded.stderr);
  assert.match(bounded.stdout, /next/);
  assert.ok(bounded.stdout.length < 100);
});

test("native transcript scan rejects stale prefixes and resumes after complete lines", async (t) => {
  const root = await temporary(t), file = join(root, "conversation.jsonl"), api = transcriptApi(nativePlatform, exec);
  const scan = (from = 0, mark = "") => api.scan(file, from, mark, "(^|[^A-Za-z0-9@+._~/-])[A-Za-z0-9@+._~/-]*\\.(png)([^A-Za-z0-9]|$)", "png", 2000, 100000);
  await writeFile(file, '{"text":"out/first.png"}\n');
  const first = await scan();
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /first\.png/);
  const [end, , mark] = first.stdout.split("\n");
  assert.equal((await scan(end, mark)).code, 3);
  await appendFile(file, '{"text":"out/second.png"}');
  assert.equal((await scan(end, mark)).code, 3);
  await appendFile(file, "\n");
  assert.match((await scan(end, mark)).stdout, /second\.png/);
  await writeFile(file, '{"text":"out/other.png"}\n');
  const reset = await scan(end, mark);
  assert.equal(reset.stdout.split("\n")[1], "0");
  assert.match(reset.stdout, /other\.png/);
  if (nativePlatform === "windows") {
    await writeFile(file, JSON.stringify({ text: "C:\\My Project\\a b.png" }) + "\n");
    assert.match((await scan()).stdout, /C:\\My Project\\a b\.png/);
  }
});

test("Windows CI inspects its own process and an actual listening port", { skip: nativePlatform !== "windows" && "Windows CIM and TCP integration" }, async (t) => {
  const processes = processApi(nativePlatform, exec);
  assert.equal(await processes.exists(process.pid), true);
  assert.ok(Number.isFinite(await processes.startTime(process.pid)));
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.ok((await portApi(nativePlatform, exec).listen()).get(process.pid)?.ports.includes(server.address().port));
});

test("native repository service creates, discovers and probes a worktree without losing a recent checkout", async (t) => {
  const root = await temporary(t), folder = join(root, "repo"), files = fileApi(nativePlatform, exec), api = repositoryApi(nativePlatform, exec);
  await files.mkdir(folder);
  const git = async (...args) => {
    const result = await exec("git", ["-C", folder, "-c", "core.autocrlf=false", "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args]);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout;
  };
  await git("init", "-b", "main");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(folder, "one.txt"), "one\n");
  await git("add", "."); await git("commit", "-m", "Initial");
  const made = await api.createWorktree(folder, "feature", join(root, "trees"), root);
  assert.equal(made.code, 0, made.stderr);
  const path = made.stdout.trim().split("\t")[1];
  assert.equal(await readFile(join(path, "one.txt"), "utf8"), "one\n");
  assert.match((await api.createWorktree(folder, "feature", join(root, "trees"), root)).stdout, /^there\t/);
  assert.match((await api.discover([root])).stdout, /^R\t/m);
  assert.match((await api.probe(path, 60, ["main"])).stdout, /^recent$/m);
  assert.match((await api.probe(path, 0, ["main"])).stdout, /^merged$/m);
  assert.match((await api.bases(folder)).stdout, /^main$/m);
});

test("a file copied in slices matches its bytes, including an empty file and one slice", async (t) => {
  const { CHUNK, slices } = await load("kanso-panel/remote-file.js", ["CHUNK", "slices"], { appHome: () => "/app" });
  const root = await temporary(t);
  const files = fileApi(nativePlatform, exec);
  const copy = async (name, bytes) => {
    const source = join(root, name), dest = join(root, `${name}.out`);
    await writeFile(source, bytes);
    const parts = slices(bytes.length);
    const temp = `${dest}.b64`;
    if (!parts.length) await writeFile(dest, "");
    else {
      for (let index = 0; index < parts.length; index += 1) {
        const encoded = await files.encode(source, parts.length === 1 ? undefined : parts[index]);
        assert.equal(encoded.code, 0, encoded.stderr);
        const text = String(encoded.stdout ?? "");
        if (index < parts.length - 1) assert.equal(text.includes("="), false);
        if (index === 0) await writeFile(temp, text);
        else {
          const part = `${temp}.${index}`;
          await writeFile(part, text);
          await files.decodeBase64File(temp, null, { append: part });
          await unlink(part);
        }
      }
      await files.decodeBase64File(temp, dest);
      await unlink(temp);
    }
    assert.ok((await readFile(dest)).equals(bytes));
  };
  assert.ok(slices(5 * 1024 * 1024).length > 1);
  await copy("empty.bin", Buffer.alloc(0));
  await copy("one.bin", randomBytes(CHUNK));
  await copy("O'Brien picture.bin", randomBytes(5 * 1024 * 1024));
});
