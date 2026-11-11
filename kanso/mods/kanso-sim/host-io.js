// Sockets and binary frame writes, isolated so they can be swapped. Not in herdr.d.ts or AGENTS.md.
import net from "net";
import { mkdir, writeFile } from "fs/promises";
import { WebSocket } from "websocket";

export const connectTcp = (host, port) => net.connect(host, port);
export const connectSocket = (url) => WebSocket.connect(url);
export const writeBytes = (path, bytes) => writeFile(path, bytes);
export const makeDir = (path) => mkdir(path, { recursive: true });

export async function portOpen(port) {
  try {
    const socket = await net.connect("127.0.0.1", port);
    socket.close();
    return true;
  } catch {
    return false;
  }
}
