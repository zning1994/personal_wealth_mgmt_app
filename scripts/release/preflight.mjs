/* global console */

import process from "node:process";

const GATES = [
  ["lint", "pnpm lint"],
  ["typecheck", "pnpm typecheck"],
  ["test", "pnpm test"],
  ["privacy", "pnpm test:privacy"],
  ["integration", "pnpm test:integration"],
  ["build", "pnpm build"],
];

export function createProcessRunner({ spawn = globalThis.process } = {}) {
  return {
    async run(gate, command) {
      const { execFile } = await import("node:child_process");
      return await new Promise((resolve) => {
        execFile("sh", ["-lc", command], { env: spawn.env, cwd: process.cwd() }, (error) => {
          resolve({ gate, command, exitCode: error?.code === undefined ? 0 : Number(error.code) || 1 });
        });
      });
    },
  };
}

export async function preflight(runner) {
  const failures = [];
  const commands = [];
  for (const [gate, command] of GATES) {
    commands.push(command);
    const result = await runner.run(gate, command);
    if (result.exitCode !== 0) failures.push({ gate, command, exitCode: result.exitCode });
  }
  return { failures, commands, packageAllowed: failures.length === 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await preflight(createProcessRunner());
  console.log(JSON.stringify(result, null, 2));
  if (!result.packageAllowed) process.exitCode = 1;
}
