import { spawn } from "node:child_process";

const workers = ["market-intelligence-worker.ts", "market-snapshot-worker.ts"];
const children = workers.map((script) => spawn(process.execPath, [
  "--conditions=react-server", "--import", "tsx", "--import", "./scripts/load-env.mjs", `scripts/${script}`,
], { stdio: "inherit", env: process.env }));
let stopping = false;
let exitCode = 0;
let killTimer;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  killTimer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 30_000);
  killTimer.unref();
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
for (const child of children) {
  child.once("error", (error) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), service: "mira-market-workers", event: "worker_spawn_error", message: error.message }));
    exitCode = 1;
    stop();
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(JSON.stringify({ at: new Date().toISOString(), service: "mira-market-workers", event: "worker_exited", code, signal }));
      exitCode = code && code !== 0 ? code : 1;
      stop();
    } else if (code && code !== 0) exitCode = code;
  });
}
await Promise.all(children.map((child) => new Promise((resolve) => child.once("close", resolve))));
if (killTimer) clearTimeout(killTimer);
process.exitCode = exitCode;
