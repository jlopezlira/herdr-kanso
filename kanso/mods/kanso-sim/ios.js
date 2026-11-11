// Copyright (c) 2026 Robert Soriano
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): serve-sim session from herdr-sim. Herdr's exec cannot set SERVE_SIM_DISABLE_DEVICE_HUB_KEYBOARD.
import { exec } from "herdr";
import { connectSocket } from "./host-io.js";
import { commandError, SERVE_OFFLINE } from "./sim-register.js";
import { TAG, frameBytes, lastJson, nextOrientation, parseSimctl } from "./model.js";

const serveSim = async (args) => {
  const result = await exec("npx", [...SERVE_OFFLINE, ...args], { timeout: 60000 });
  const error = commandError(result, "serve-sim failed");
  if (error) throw error;
  return result.stdout ?? "";
};

export async function listSimulators() {
  const result = await exec("xcrun", ["simctl", "list", "devices", "available", "-j"]);
  const error = commandError(result, "xcrun simctl failed");
  if (error) throw error;
  return parseSimctl(result.stdout);
}

export async function bootIos(id) {
  const result = await exec("xcrun", ["simctl", "boot", id]);
  const error = commandError(result, "simctl boot failed");
  if (error) throw error;
}

export const killIos = (id) => serveSim(["--kill", id]);

export async function openIos(device, onError, onOk) {
  const listed = lastJson(await serveSim(["--list", "-q", device.id]));
  const running = listed.running ? (listed.streams ?? [listed]).find((stream) => stream.device === device.id) : null;
  const helper = running ?? lastJson(await serveSim(["--detach", "-q", device.id]));
  if (!helper.streamUrl) throw new Error("serve-sim returned no stream");
  const url = new URL(helper.streamUrl);
  const base = helper.streamUrl.replace(/\/stream\.mjpeg$/, "");
  return { device, host: url.hostname, port: Number(url.port), path: url.pathname, input: new Input(base, onError, onOk) };
}

export class Input {
  constructor(base, onError, onOk) {
    this.base = base;
    this.onError = onError;
    this.onOk = onOk;
    this.socket = null;
    this.closed = false;
    this.queue = Promise.resolve();
    this.send(null);
  }

  send(tag, body) {
    const job = this.queue.then(() => this.write(tag == null ? null : frameBytes(tag, body), true)).catch((error) => this.onError?.(String(error?.message ?? error)));
    this.queue = job;
    return job;
  }

  async write(bytes, retry) {
    if (this.closed) return;
    try {
      if (!this.socket) {
        const socket = await connectSocket(`${this.base.replace(/^http/, "ws")}/ws`);
        if (this.closed) return void socket.close();
        this.socket = socket;
      }
      if (bytes) {
        await this.socket.write(bytes);
        this.onOk?.();
      }
    } catch (error) {
      this.socket = null;
      if (!retry) throw error;
      await this.write(bytes, false);
    }
  }

  close() {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  touch(type, point, edge = 0) {
    return this.send(TAG.touch, edge ? { type, x: point.x, y: point.y, edge } : { type, x: point.x, y: point.y });
  }

  button(name) { return this.send(TAG.button, { button: name }); }
  hid(page, usage) { return this.send(TAG.button, { button: "hid", page, usage, phase: "press" }); }
  key(type, usage) { return this.send(TAG.key, { type, usage }); }
  scroll(dx, dy, point) { return this.send(TAG.scroll, { dx, dy, x: point.x, y: point.y }); }
  softwareKeyboard() { return this.send(TAG.keyboard); }

  async rotate() {
    const config = await (await fetch(`${this.base}/config`)).json();
    return this.send(TAG.rotate, { orientation: nextOrientation(config?.orientation) });
  }
}
