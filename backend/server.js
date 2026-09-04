import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// const execFileAsync = promisify(execFile);

const app = express();
const port = Number(process.env.PORT || 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

app.use(
    cors({
        origin(origin, callback) {
            // Browser extension requests have an Origin header. Local health checks may not.
            if (!origin || allowedOrigins.includes(origin))
                return callback(null, true);
            return callback(new Error("CORS origin not allowed"));
        },
    }),
);
app.use(express.json({ limit: "1mb" }));

console.log(
    "OPENROUTER_API_KEY loaded:",
    Boolean(process.env.OPENROUTER_API_KEY),
);
console.log("OPENROUTER_MODEL:", process.env.OPENROUTER_MODEL);

if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing. Check backend/.env");
}

if (!process.env.OPENROUTER_MODEL) {
    throw new Error("OPENROUTER_MODEL is missing. Check backend/.env");
}

const openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

function buildSummaryPrompt(structure) {
    const compact = {
        title: structure.title,
        viewport: structure.viewport,
        elementCount: structure.elementCount,
        elements: structure.elements,
    };

    return `You are summarizing a webpage for a blind or low-vision user who wants a quick mental map before using a screen reader.

Describe the page's layout spatially and semantically. Start with the overall page structure, then mention important regions from top to bottom and left to right. Mention only the most useful headings, links, buttons, forms, tables, and other interactive elements. Explain where things are when the supplied region data supports it.

Write for speech. Use short natural sentences. No markdown, bullets, symbols, URLs, or decorative punctuation. Do not claim details that are not present in the supplied structure. Keep the result concise, roughly 100 to 180 words.

Page structure JSON:
${JSON.stringify(compact)}`;
}

function cleanForSpeech(text) {
    return String(text || "")
        .replace(/[*_`#>-]+/g, " ")
        .replace(/https?:\/\/\S+/g, "web link")
        .replace(/\s+/g, " ")
        .trim();
}

async function generateSummary(structure) {
    if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL) {
        throw new Error("OpenRouter environment variables are not configured");
    }

    const completion = await openrouter.chat.completions.create({
        model: process.env.OPENROUTER_MODEL,
        temperature: 0.2,
        messages: [
            {
                role: "system",
                content:
                    "You create concise spoken webpage orientation summaries for blind and low-vision users.",
            },
            { role: "user", content: buildSummaryPrompt(structure) },
        ],
    });

    return cleanForSpeech(completion.choices?.[0]?.message?.content || "");
}

async function generateTts(summary) {
    const model = process.env.PIPER_MODEL || "en_US-amy-medium";

    const outputFile = path.join(os.tmpdir(), `blv-${crypto.randomUUID()}.wav`);

    console.log(`Generating TTS with Piper (${model})...`);

    try {
        await new Promise((resolve, reject) => {
            const piper = spawn(
                "piper",
                ["--model", model, "--output_file", outputFile],
                {
                    windowsHide: true,
                },
            );

            let stderr = "";

            piper.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            piper.on("error", reject);

            piper.on("close", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(
                        new Error(`Piper exited with code ${code}: ${stderr}`),
                    );
                }
            });

            piper.stdin.write(summary);
            piper.stdin.end();
        });

        const audioBuffer = await fs.readFile(outputFile);

        console.log(
            `Piper generated ${(audioBuffer.length / 1024).toFixed(1)} KB of audio.`,
        );

        return `data:audio/wav;base64,${audioBuffer.toString("base64")}`;
    } finally {
        console.log("[Piper] Keeping WAV for testing:", outputFile);
    }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/summarize", async (req, res) => {
    try {
        const { structure } = req.body || {};

        if (!structure || !Array.isArray(structure.elements)) {
            return res.status(400).json({
                error: "structure.elements must be an array",
            });
        }

        // 1. Generate summary using the LLM
        const summary = await generateSummary(structure);
        // const summary = 'This is a GitHub repository page for BLV Page Navigator, a Chrome extension. The top region holds the global navigation bar with repository tabs: Code, Issues, Pull requests, Agents, Actions, Projects, Wiki, Security, Insights, and Settings. There is a quick search button labeled Type slash to search, plus repository actions including Pin, Watch, Fork, and Star. Below that, the main content area displays a repository files table listing backend, extension, README.md, and package lock.json. The central article begins with the heading BLV Page Navigator and contains sections on project structure, starting the backend, loading the extension, testing extraction, keyboard controls, the popup, study logs, implementation notes, and open questions. A right sidebar shows repository statistics and links to About, Releases, Packages, Contributors, and Languages. The bottom footer contains Terms, Privacy, Security, Status, Community, Docs, Contact, and cookie management links.'

        if (!summary) {
            throw new Error("LLM returned an empty summary");
        }

        console.log("\n========== LLM SUMMARY ==========");
        console.log(summary);
        console.log("==================================\n");

        // 2. Send that exact summary to Piper
        const audio = await generateTts(summary);

        console.log("TTS generation completed.");

        return res.json({
            summary,
            audio,
        });
    } catch (error) {
        console.error("Summarization failed:", error);

        return res.status(500).json({
            error: error.message || "Summarization failed",
        });
    }
});

app.get("/test-tts", async (_req, res) => {
    try {
        const summary =
            "This is a test of the Piper text to speech system. " +
            "The audio should be generated by Piper running locally on the backend.";

        console.log("\n========== TTS TEST ==========");
        console.log("Sending text to Piper:");
        console.log(summary);

        const audio = await generateTts(summary);

        console.log("Piper returned audio successfully.");
        console.log("Audio data length:", audio.length);
        console.log("==============================\n");

        return res.json({
            success: true,
            message: "Piper generated audio successfully",
            audioLength: audio.length,
        });
    } catch (error) {
        console.error("\n========== TTS TEST FAILED ==========");
        console.error(error);
        console.error("=====================================\n");

        return res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

app.listen(port, () =>
    console.log(`BLV backend listening on http://localhost:${port}`),
);
