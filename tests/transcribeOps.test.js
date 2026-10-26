import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { formatClock, formatSegments, parseSubtitles, parseTranscriptFile, transcribeAudio } from "../tools/transcribeOps.js";

const KEY = "gsk_SECRET_test_key";

/** fetch stub that records the multipart form and answers with the given Groq-style reply. */
function groq(reply, status = 200, headers = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init, form: init.body });
    if (reply instanceof Error) throw reply;
    return { ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => reply };
  };
  return { deps: { fetch }, calls };
}

describe("transcript formatting", () => {
  it("formats clocks with and without hours", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(90.9)).toBe("01:30");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(undefined)).toBe("00:00");
  });

  it("groups segments into timestamped blocks", () => {
    const segs = [
      { start: 0, text: " Hello there." },
      { start: 10, text: "We start." },
      { start: 31, text: "Second block." },
      { start: 40, text: "   " },
    ];
    expect(formatSegments(segs, "x")).toBe("[00:00] Hello there. We start.\n[00:31] Second block.");
  });

  it("falls back to plain text without segments", () => {
    expect(formatSegments(undefined, "  just text ")).toBe("just text");
    expect(formatSegments([], "just text")).toBe("just text");
  });

  it("parses VTT cues with speaker tags", () => {
    const vtt = "WEBVTT\n\nNOTE hi\n\n1\n00:00:05.000 --> 00:00:08.000\n<v Asha>Hello team</v>\n\n00:01:30.500 --> 00:01:33.000\nSecond <b>line</b>\nacross two rows";
    expect(parseSubtitles(vtt)).toBe("[00:05] Asha: Hello team\n[01:30] Second line across two rows");
  });

  it("parses SRT with comma milliseconds and hours", () => {
    const srt = "1\n01:02:03,400 --> 01:02:05,000\nLate line\r\n";
    expect(parseSubtitles(srt)).toBe("[1:02:03] Late line");
  });
});

describe("parseTranscriptFile", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-tr-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("reads text and subtitle files", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "Line one\r\nLine two\r\n");
    fs.writeFileSync(path.join(dir, "b.vtt"), "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi");
    expect(parseTranscriptFile(path.join(dir, "a.txt"))).toBe("Line one\nLine two");
    expect(parseTranscriptFile(path.join(dir, "b.vtt"))).toBe("[00:01] Hi");
  });

  it("rejects wrong types, missing and empty files", () => {
    fs.writeFileSync(path.join(dir, "c.docx"), "x");
    fs.writeFileSync(path.join(dir, "d.txt"), "  \n");
    expect(() => parseTranscriptFile(path.join(dir, "c.docx"))).toThrow(/must be/);
    expect(() => parseTranscriptFile(path.join(dir, "nope.txt"))).toThrow(/Cannot find/);
    expect(() => parseTranscriptFile(path.join(dir, "d.txt"))).toThrow(/no text/);
  });
});

describe("transcribeAudio", () => {
  let dir;
  let audio;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-audio-"));
    audio = path.join(dir, "call.mp3");
    fs.writeFileSync(audio, Buffer.alloc(2048, 1));
    process.env.GROQ_API_KEY = KEY;
    delete process.env.GROQ_WHISPER_MODEL;
    delete process.env.GROQ_MAX_FILE_MB;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MAX_FILE_MB;
  });

  it("explains a missing key before touching the file", async () => {
    delete process.env.GROQ_API_KEY;
    await expect(transcribeAudio({ path: audio }, groq({}).deps)).rejects.toThrow(/GROQ_API_KEY/);
  });

  it("sends the file with auth, model and verbose_json, and shapes the result", async () => {
    const { deps, calls } = groq({ text: " Hi all. ", duration: 75.5, language: "English", segments: [{ start: 0, text: "Hi all." }] });
    const r = await transcribeAudio({ path: audio, language: "EN", vocabulary: "Causly, Asha" }, deps);
    expect(calls[0].url).toContain("api.groq.com/openai/v1/audio/transcriptions");
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${KEY}`);
    const form = calls[0].form;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("language")).toBe("en");
    expect(form.get("prompt")).toBe("Causly, Asha");
    expect(form.get("file").name).toBe("call.mp3");
    expect(r).toMatchObject({ transcript: "[00:00] Hi all.", text: "Hi all.", duration_seconds: 75.5, language: "English", file: "call.mp3", converted: false });
    expect(r.recorded_at_ms).toBeGreaterThan(0);
  });

  it("honours GROQ_WHISPER_MODEL", async () => {
    process.env.GROQ_WHISPER_MODEL = "whisper-large-v3";
    const { deps, calls } = groq({ text: "ok", duration: 1 });
    await transcribeAudio({ path: audio }, deps);
    expect(calls[0].form.get("model")).toBe("whisper-large-v3");
    delete process.env.GROQ_WHISPER_MODEL;
  });

  it("validates the language code and the file", async () => {
    const { deps } = groq({ text: "x" });
    await expect(transcribeAudio({ path: audio, language: "english" }, deps)).rejects.toThrow(/2-letter/);
    await expect(transcribeAudio({ path: path.join(dir, "none.mp3") }, deps)).rejects.toThrow(/Cannot find/);
    await expect(transcribeAudio({}, deps)).rejects.toThrow(/path is required/);
    fs.writeFileSync(path.join(dir, "empty.mp3"), "");
    await expect(transcribeAudio({ path: path.join(dir, "empty.mp3") }, deps)).rejects.toThrow(/empty/);
  });

  it("maps Groq errors to plain messages", async () => {
    await expect(transcribeAudio({ path: audio }, groq({ error: { message: "bad" } }, 401).deps)).rejects.toThrow(/rejected the API key/);
    await expect(transcribeAudio({ path: audio }, groq({ error: { message: "big" } }, 413).deps)).rejects.toThrow(/too large/);
    await expect(transcribeAudio({ path: audio }, groq({}, 429, { "retry-after": "42" }).deps)).rejects.toThrow(/retry in 42s/);
    await expect(transcribeAudio({ path: audio }, groq({ error: { message: "boom" } }, 500).deps)).rejects.toThrow(/Groq error: boom/);
  });

  it("scrubs the key from network errors and errors on silence", async () => {
    await expect(transcribeAudio({ path: audio }, groq(new Error(`fail ${KEY}`)).deps)).rejects.toThrow(/\[REDACTED\]/);
    await expect(transcribeAudio({ path: audio }, groq({ text: "  " }).deps)).rejects.toThrow(/No speech/);
    try {
      await transcribeAudio({ path: audio }, groq(new Error(`fail ${KEY}`)).deps);
    } catch (e) {
      expect(e.message).not.toContain(KEY);
    }
  });

  it("without ffmpeg, explains how to handle an unsupported or oversized file", async () => {
    const noFfmpeg = { exec: (_c, _a, _o, cb) => cb(new Error("ENOENT")) };
    const odd = path.join(dir, "call.aac");
    fs.writeFileSync(odd, Buffer.alloc(100, 1));
    await expect(transcribeAudio({ path: odd }, { ...groq({}).deps, ...noFfmpeg })).rejects.toThrow(/Install ffmpeg/);
    process.env.GROQ_MAX_FILE_MB = "0.001"; // ~1 KB, below the 2 KB test file
    await expect(transcribeAudio({ path: audio }, { ...groq({}).deps, ...noFfmpeg })).rejects.toThrow(/the limit is|limit/);
  });

  it("converts with ffmpeg when available and cleans up the temp file", async () => {
    const odd = path.join(dir, "call.aac");
    fs.writeFileSync(odd, Buffer.alloc(100, 1));
    let tempFile;
    const exec = (cmd, args, _o, cb) => {
      if (args[0] === "-version") return cb(null, "ffmpeg", "");
      tempFile = args[args.length - 1];
      fs.writeFileSync(tempFile, Buffer.alloc(50, 2));
      cb(null, "", "");
    };
    const { deps, calls } = groq({ text: "converted ok", duration: 5 });
    const r = await transcribeAudio({ path: odd }, { ...deps, exec });
    expect(r.converted).toBe(true);
    expect(calls[0].form.get("file").name).toMatch(/\.ogg$/);
    expect(fs.existsSync(tempFile)).toBe(false);
  });

  it("reports ffmpeg conversion failures and still cleans up", async () => {
    const odd = path.join(dir, "call.aac");
    fs.writeFileSync(odd, Buffer.alloc(100, 1));
    const exec = (cmd, args, _o, cb) => (args[0] === "-version" ? cb(null, "ffmpeg", "") : cb(new Error("x"), "", "Invalid data found"));
    await expect(transcribeAudio({ path: odd }, { ...groq({}).deps, exec })).rejects.toThrow(/ffmpeg could not convert.*Invalid data/);
  });
});
