import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createTesseractRecognizer } from "./tesseract-recognizer";

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = () => true;
}

describe("tesseract recognizer", () => {
  it("invokes a local binary with bounded language arguments", async () => {
    const child = new FakeChild();
    let command: readonly string[] = [];
    const recognizer = await createTesseractRecognizer({ binaryPath: "/synthetic/tesseract", timeoutMs: 1_000, spawnProcess: ((_binary: string, args: readonly string[]) => { command = args; return child; }) as never })(["eng"]);
    const result = recognizer.recognize("/synthetic/page.png", ["eng", "chi_sim"]);
    child.stdout.emit("data", Buffer.from("Synthetic 合成\n"));
    child.emit("close", 0);
    await expect(result).resolves.toMatchObject({ text: "Synthetic 合成", confidence: 0.5 });
    expect(command).toEqual(["/synthetic/page.png", "stdout", "-l", "eng+chi_sim", "--psm", "6"]);
    await recognizer.terminate();
  });

  it("maps non-zero engine exits to a stable failure", async () => {
    const child = new FakeChild();
    const recognizer = await createTesseractRecognizer({ timeoutMs: 1_000, spawnProcess: (() => child) as never })(["eng"]);
    const result = recognizer.recognize("/synthetic/page.png", ["eng"]);
    child.emit("close", 1);
    await expect(result).rejects.toThrow("OCR_ENGINE_FAILURE");
  });
});
