import { spawn } from "node:child_process";
import net from "node:net";

const HOST = "127.0.0.1";
const PORT = 1420;

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(450);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    socket.connect(port, host);
  });
}

async function main() {
  const occupied = await isPortOpen(HOST, PORT);

  if (occupied) {
    console.log(`[web:dev] Port ${PORT} already in use, reusing existing Vite dev server.`);

    const keepAlive = setInterval(() => {}, 60_000);
    const shutdown = () => {
      clearInterval(keepAlive);
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  const command = "npm run web:dev:raw";
  const child = spawn(command, {
    stdio: "inherit",
    shell: true
  });

  child.once("error", (error) => {
    console.error(`[web:dev] Failed to spawn dev server command: ${error.message}`);
    process.exit(1);
  });

  const forwardSignal = () => {
    if (!child.killed) {
      child.kill();
    }
  };

  process.once("SIGINT", () => forwardSignal());
  process.once("SIGTERM", () => forwardSignal());

  child.once("exit", (code, signal) => {
    if (signal) {
      process.exit(0);
      return;
    }

    process.exit(code ?? 0);
  });
}

void main();
