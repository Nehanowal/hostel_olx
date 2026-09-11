import { spawn } from "node:child_process";
const children = ["server_side", "client_side"].map((dir) =>
  spawn("npm", ["--prefix", dir, "run", "dev"], { stdio: "inherit" }),
);
const stop = () => children.forEach((child) => child.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((child) =>
  child.on("exit", (code) => {
    stop();
    process.exitCode = code || 0;
  }),
);
