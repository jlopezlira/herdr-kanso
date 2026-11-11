// Copyright (c) 2026 Robert Soriano
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): the emulator screenshot helper from herdr-sim. Discovery directories are arguments.
// usage: node android-stream.mjs <console port> <listen port> <width> <discovery dir>...
import http from "node:http";
import http2 from "node:http2";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [, , consolePort, listenPort, width = "540", ...dirs] = process.argv;
const IDLE_MS = 3000;
const listing = (folder) => { try { return readdirSync(folder); } catch { return []; } };
const textOf = (path) => { try { return readFileSync(path, "utf8"); } catch { return ""; } };

function discover(folders, port) {
  const hit = folders.flatMap((folder) => listing(folder).filter((name) => name.endsWith(".ini")).flatMap((name) => {
    const ini = textOf(join(folder, name));
    const get = (key) => new RegExp(`^${key}=(.*)$`, "m").exec(ini)?.[1];
    return get("port.serial") === port ? [{ port: get("grpc.port"), token: get("grpc.token") }] : [];
  }));
  if (!hit[0]) throw new Error(`no running emulator on console port ${port}`);
  return hit[0];
}

const varint = (n) => n > 127 ? [(n & 127) | 128, ...varint(n >>> 7)] : [n];

const readVarint = (msg, i, value = 0, shift = 0) => {
  const byte = msg[i];
  const next = value + (byte & 127) * 2 ** shift;
  return byte & 128 ? readVarint(msg, i + 1, next, shift + 7) : { value: next, i: i + 1 };
};

const walk = (msg, i) => {
  if (i >= msg.length) return null;
  const key = readVarint(msg, i);
  const type = key.value & 7;
  if (type === 2) {
    const len = readVarint(msg, key.i);
    if (key.value >> 3 === 4) return msg.subarray(len.i, len.i + len.value);
    return walk(msg, len.i + len.value);
  }
  if (type === 0) return walk(msg, readVarint(msg, key.i).i);
  if (type === 1) return walk(msg, key.i + 8);
  if (type === 5) return walk(msg, key.i + 4);
  return null;
};

const send = (res, png) => {
  res.write(`--frame\r\nContent-Type: image/png\r\nContent-Length: ${png.length}\r\n\r\n`);
  res.write(png);
  res.write("\r\n");
};

class Stream {
  constructor() {
    const found = discover(dirs, consolePort);
    this.viewers = [];
    this.last = null;
    this.idle = null;
    this.pending = Buffer.alloc(0);
    this.grpc = http2.connect(`http://127.0.0.1:${found.port}`);
    this.grpc.on("error", () => process.exit(1));
    const format = [8, 0, 24, ...varint(Number(width)), 32, ...varint(Number(width) * 4)];
    const call = this.grpc.request({
      ":method": "POST",
      ":path": "/android.emulation.control.EmulatorController/streamScreenshot",
      "content-type": "application/grpc",
      te: "trailers",
      ...(found.token ? { authorization: `Bearer ${found.token}` } : {}),
    });
    const prefix = Buffer.alloc(5);
    prefix.writeUInt32BE(format.length, 1);
    call.end(Buffer.concat([prefix, Buffer.from(format)]));
    call.on("error", () => process.exit(1));
    call.on("close", () => process.exit(0));
    call.on("data", (chunk) => this.take(chunk));
  }

  arm() {
    if (this.idle) return;
    this.idle = setTimeout(() => process.exit(0), IDLE_MS);
  }

  open(res) {
    this.viewers = [...this.viewers, res];
    if (this.last) send(res, this.last);
    clearTimeout(this.idle);
    this.idle = null;
  }

  drop(res) {
    this.viewers = this.viewers.filter((item) => item !== res);
    if (!this.viewers.length) this.arm();
  }

  take(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    this.drain();
  }

  drain() {
    if (this.pending.length < 5) return;
    const len = this.pending.readUInt32BE(1);
    if (this.pending.length < 5 + len) return;
    const png = walk(this.pending.subarray(5, 5 + len), 0);
    this.pending = this.pending.subarray(5 + len);
    if (png?.length) {
      this.last = Buffer.from(png);
      this.viewers.forEach((res) => send(res, this.last));
    }
    this.drain();
  }
}

const stream = new Stream();
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store" });
  stream.open(res);
  res.on("close", () => stream.drop(res));
}).listen(Number(listenPort), "127.0.0.1", () => stream.arm());
