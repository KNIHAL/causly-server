// Speech to text for meeting recordings, plus reading transcript files.
//
// Engine: Groq's hosted Whisper (OpenAI-compatible API). The audio file is sent to Groq,
// so callers must get the user's consent first (meeting_transcribe requires confirm: true).
// Whisper does not tell speakers apart, so the transcript has timestamps but no names.
//
// Credentials: GROQ_API_KEY (free key at console.groq.com/keys).
// Optional: GROQ_WHISPER_MODEL (default whisper-large-v3-turbo; whisper-large-v3 is a bit
// more accurate), GROQ_MAX_FILE_MB (25 on the free tier, 100 on the dev tier).
//
// Files over the limit, or in a format Groq does not take, are converted with ffmpeg when it
// is installed (mono 16 kHz Opus at 24 kbps: about 11 MB per hour). Without ffmpeg the error
// says what to do.
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";
export const AUDIO_EXTS = ["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"];
export const TRANSCRIPT_EXTS = [".txt", ".md", ".vtt", ".srt"];
const MAX_TRANSCRIPT_FILE = 5 * 1024 * 1024;

// ---------------------------------------------------------------- formatting

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Whisper segments are sentence-sized; group them into lines of about `block` seconds: "[01:30] text". */
export function formatSegments(segments, fallbackText = "", block = 30) {
  if (!Array.isArray(segments) || !segments.length) return String(fallbackText).trim();
  const lines = [];
  let start = null;
  let parts = [];
  const flush = () => {
    if (parts.length) lines.push(`[${formatClock(start)}] ${parts.join(" ").replace(/\s+/g, " ").trim()}`);
    parts = [];
    start = null;
  };
  for (const seg of segments) {
    const text = String(seg.text ?? "").trim();
    if (!text) continue;
    if (start !== null && seg.start - start >= block) flush();
    if (start === null) start = seg.start ?? 0;
    parts.push(text);
  }
  flush();
  return lines.join("\n");
}

const cueTime = (s) => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,]\d+/.exec(s);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};

/** Zoom, Meet, Teams and most tools export .vtt or .srt; turn the cues into "[mm:ss] Speaker: text" lines. */
export function parseSubtitles(raw) {
  const blocks = String(raw).replace(/\r/g, "").replace(/^﻿/, "").split(/\n{2,}/);
  const lines = [];
  for (const block of blocks) {
    const rows = block.split("\n").map((r) => r.trim()).filter(Boolean);
    const at = rows.findIndex((r) => r.includes("-->"));
    if (at === -1) continue; // WEBVTT header, NOTE blocks, style blocks
    const text = rows
      .slice(at + 1)
      .join(" ")
      .replace(/<v\s+([^>]+)>/gi, "$1: ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push(`[${formatClock(cueTime(rows[at]))}] ${text}`);
  }
  return lines.join("\n");
}

/** Read a .txt, .md, .vtt or .srt transcript. */
export function parseTranscriptFile(file) {
  const ext = path.extname(String(file ?? "")).toLowerCase();
  if (!TRANSCRIPT_EXTS.includes(ext)) throw new Error(`Transcript files must be ${TRANSCRIPT_EXTS.join(", ")} (got "${ext || "no extension"}"). For audio use meeting_transcribe.`);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error(`Cannot find the transcript file: ${path.basename(file)}.`);
  }
  if (!stat.isFile()) throw new Error("transcript_file must be a file.");
  if (stat.size > MAX_TRANSCRIPT_FILE) throw new Error("The transcript file is over 5 MB.");
  const raw = fs.readFileSync(file, "utf8");
  const text = ext === ".vtt" || ext === ".srt" ? parseSubtitles(raw) : raw.replace(/\r/g, "").trim();
  if (!text) throw new Error("The transcript file has no text in it.");
  return text;
}

// ---------------------------------------------------------------- ffmpeg

function run(exec, cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    exec(cmd, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

async function hasFfmpeg(exec) {
  try {
    await run(exec, "ffmpeg", ["-version"], 8000);
    return true;
  } catch {
    return false;
  }
}

async function compress(exec, input) {
  const out = path.join(os.tmpdir(), `causly-${crypto.randomUUID()}.ogg`);
  try {
    await run(exec, "ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", out], 15 * 60_000);
  } catch (err) {
    fs.rmSync(out, { force: true });
    throw new Error(`ffmpeg could not convert this file: ${String(err.stderr || err.message).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300)}`);
  }
  return out;
}

// ---------------------------------------------------------------- Groq

function groqKey() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Transcription is not set up. Missing: GROQ_API_KEY (free key at https://console.groq.com/keys, add it to .env).");
  return key;
}

const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/**
 * Transcribe an audio or video file with Groq Whisper.
 * Returns { transcript (timestamped lines), text, duration_seconds, language, model, file, recorded_at_ms, converted }.
 */
export async function transcribeAudio({ path: file, language, vocabulary } = {}, deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const exec = deps.exec ?? execFile;
  if (!file || typeof file !== "string") throw new Error("path is required: the recording to transcribe.");
  if (language !== undefined && !/^[a-z]{2,3}$/i.test(String(language))) throw new Error("language must be a 2-letter code like en or hi (leave it out to detect it).");
  const key = groqKey();

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error(`Cannot find the recording: ${path.basename(file)}.`);
  }
  if (!stat.isFile()) throw new Error("path must be a file.");
  if (!stat.size) throw new Error("The recording is empty.");

  const limit = (Number(process.env.GROQ_MAX_FILE_MB) > 0 ? Number(process.env.GROQ_MAX_FILE_MB) : 25) * 1024 * 1024;
  const ext = path.extname(file).slice(1).toLowerCase();
  let upload = file;
  let converted = false;
  let temp = null;
  try {
    if (!AUDIO_EXTS.includes(ext) || stat.size > limit) {
      const why = !AUDIO_EXTS.includes(ext) ? `".${ext || "?"}" is not a format Groq accepts (${AUDIO_EXTS.join(", ")})` : `the file is ${mb(stat.size)} MB and the limit is ${mb(limit)} MB`;
      if (!(await hasFfmpeg(exec))) {
        throw new Error(`Cannot send this file: ${why}. Install ffmpeg (Windows: winget install ffmpeg) and the server will convert it automatically, or convert it yourself to mp3/m4a under ${mb(limit)} MB.`);
      }
      temp = await compress(exec, file);
      upload = temp;
      converted = true;
      const size = fs.statSync(temp).size;
      if (size > limit) throw new Error(`Even after compressing, the recording is ${mb(size)} MB (limit ${mb(limit)} MB). Split it into shorter parts, or set GROQ_MAX_FILE_MB=100 if your Groq account is on the dev tier.`);
    }

    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(upload)]), path.basename(upload));
    const model = process.env.GROQ_WHISPER_MODEL || DEFAULT_MODEL;
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (language) form.append("language", String(language).toLowerCase());
    if (vocabulary && String(vocabulary).trim()) form.append("prompt", String(vocabulary).trim().slice(0, 800));

    let res;
    try {
      res = await fetchFn(GROQ_URL, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(10 * 60_000) });
    } catch (err) {
      throw new Error(`Could not reach Groq: ${String(err.message).split(key).join("[REDACTED]")}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = String(data?.error?.message || `HTTP ${res.status}`).split(key).join("[REDACTED]");
      if (res.status === 401) throw new Error("Groq rejected the API key. Check GROQ_API_KEY.");
      if (res.status === 413) throw new Error(`Groq says the file is too large (${why}).`);
      if (res.status === 429) {
        const wait = res.headers?.get?.("retry-after");
        throw new Error(`Groq rate limit hit${wait ? `; retry in ${wait}s` : ""}. The free tier limits audio minutes per hour and per day.`);
      }
      throw new Error(`Groq error: ${why}`);
    }
    const text = String(data.text ?? "").trim();
    if (!text) throw new Error("No speech was found in the recording.");
    return {
      transcript: formatSegments(data.segments, text),
      text,
      duration_seconds: Number(data.duration) || stat.size / 16_000,
      language: data.language ?? null,
      model,
      file: path.basename(file),
      recorded_at_ms: stat.mtimeMs,
      converted,
    };
  } finally {
    if (temp) fs.rmSync(temp, { force: true });
  }
}
