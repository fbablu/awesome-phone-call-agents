import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import type { SttInput, SttResult } from "./index.js";

/**
 * Local, private path: whisper.cpp's `whisper-cli` on the same machine.
 * Install: `brew install whisper-cpp` then download a ggml model, e.g.
 * https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
 * Set TETHER_WHISPER_MODEL to that path.
 */
export async function transcribeWithWhisper(input: SttInput): Promise<SttResult> {
  if (!config.stt.whisperModel) throw new Error("TETHER_WHISPER_MODEL (path to ggml model) is not set");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tether-whisper-"));
  const src = path.join(dir, "in.bin");
  const wav = path.join(dir, "in.wav");
  fs.writeFileSync(src, input.audio);
  await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  const out = await run(config.stt.whisperBin, ["-m", config.stt.whisperModel, "-l", "bn", "-nt", "-np", "-f", wav]);
  fs.rmSync(dir, { recursive: true, force: true });
  return { text: out.trim(), provider: "whisper.cpp", language: "bn" };
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err}`))));
  });
}
