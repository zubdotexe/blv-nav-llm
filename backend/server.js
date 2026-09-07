import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// const execFileAsync = promisify(execFile);

const app = express();
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const piperExecutable =
    process.env.PIPER_COMMAND ||
    path.join(serverDirectory, ".venv", "Scripts", "piper.exe");
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

function buildBanglaSummaryPrompt(structure) {
    const compact = {
        title: structure.title,
        viewport: structure.viewport,
        elementCount: structure.elementCount,
        elements: structure.elements,
    };

    return `You are summarizing a webpage for a blind or low-vision user who wants a quick mental map before using a screen reader.

Describe the page's layout spatially and semantically. Start with the overall page structure, then mention important regions from top to bottom and left to right. Mention only the most useful headings, links, buttons, forms, tables, and other interactive elements. Explain where things are when the supplied region data supports it.

Write the summary in natural Bengali (Bangla) for speech. Use short natural sentences. Do not use markdown, bullets, symbols, URLs, or decorative punctuation. Do not claim details that are not present in the supplied structure. Keep the result concise, roughly 100 to 180 Bengali words.

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

function removeInvalidSurrogates(text) {
    let sanitized = "";
    let removedCount = 0;

    for (let index = 0; index < text.length; index += 1) {
        const codeUnit = text.charCodeAt(index);

        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            const nextCodeUnit = text.charCodeAt(index + 1);

            if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
                sanitized += text[index] + text[index + 1];
                index += 1;
            } else {
                removedCount += 1;
            }
        } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            removedCount += 1;
        } else {
            sanitized += text[index];
        }
    }

    return { sanitized, removedCount };
}

async function generateSummary(structure, language = "en") {
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
                    language === "bn"
                        ? "You create concise spoken webpage orientation summaries in natural Bengali (Bangla) for blind and low-vision users."
                        : "You create concise spoken webpage orientation summaries for blind and low-vision users.",
            },
            {
                role: "user",
                content:
                    language === "bn"
                        ? buildBanglaSummaryPrompt(structure)
                        : buildSummaryPrompt(structure),
            },
        ],
    });

    return cleanForSpeech(completion.choices?.[0]?.message?.content || "");
}

async function generateTts(summary, modelOverride) {
    const configuredModel =
        modelOverride || process.env.PIPER_MODEL || "en_US-amy-medium";
    const model = path.isAbsolute(configuredModel)
        ? configuredModel
        : path.join(serverDirectory, `${configuredModel}.onnx`);

    const inputFile = path.join(os.tmpdir(), `blv-${crypto.randomUUID()}.txt`);
    const outputFile = path.join(os.tmpdir(), `blv-${crypto.randomUUID()}.wav`);
    const shouldSanitizeInput = modelOverride != null;
    const { sanitized: safeSummary, removedCount } = shouldSanitizeInput
        ? removeInvalidSurrogates(String(summary))
        : { sanitized: summary, removedCount: 0 };
    const piperInput = safeSummary;

    console.log(`Generating TTS with Piper (${model})...`);
    console.log(
        `[Piper] Invalid surrogate characters found: ${removedCount > 0}. Removed: ${removedCount}`,
    );

    try {
        const piperArgs = ["--model", model];

        if (shouldSanitizeInput) {
            const piperInputBytes = Buffer.from(piperInput, "utf8");
            const firstCodeUnits = Array.from(
                { length: Math.min(piperInput.length, 20) },
                (_, index) =>
                    `U+${piperInput.charCodeAt(index).toString(16).padStart(4, "0")}`,
            );
            const firstCodePoints = Array.from(piperInput.slice(0, 20)).map(
                (character) =>
                    `U+${character.codePointAt(0).toString(16).padStart(4, "0")}`,
            );
            const containsSurrogate = /[\uD800-\uDFFF]/.test(piperInput);

            console.log("[Piper] Text immediately before input file write:", piperInput);
            console.log("[Piper] Input length:", piperInput.length);
            console.log("[Piper] First UTF-16 code units:", firstCodeUnits);
            console.log("[Piper] First Unicode code points:", firstCodePoints);
            console.log(
                "[Piper] Contains \\udc8f:",
                piperInput.includes("\udc8f"),
                "Contains any surrogate:",
                containsSurrogate,
            );
            console.log(
                "[Piper] Exact sanitized string written to input file:",
                piperInput === safeSummary,
            );
            console.log(
                "[Piper] UTF-8 bytes written to input file:",
                piperInputBytes.subarray(0, 80).toString("hex"),
            );

            await fs.writeFile(inputFile, piperInput, "utf8");
            piperArgs.push("--input_file", inputFile);
        }

        piperArgs.push("--output_file", outputFile);

        await new Promise((resolve, reject) => {
            const piper = spawn(
                piperExecutable,
                piperArgs,
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

            if (!shouldSanitizeInput) {
                console.log("[Piper] Text immediately before stdin.write:", piperInput);
                piper.stdin.write(piperInput);
                piper.stdin.end();
            }
        });

        const audioBuffer = await fs.readFile(outputFile);

        console.log(
            `Piper generated ${(audioBuffer.length / 1024).toFixed(1)} KB of audio.`,
        );

        return `data:audio/wav;base64,${audioBuffer.toString("base64")}`;
    } finally {
        await Promise.all([
            fs.rm(inputFile, { force: true }),
            fs.rm(outputFile, { force: true }),
        ]);
    }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/summarize", async (req, res) => {
    try {
        const { structure, language = "en" } = req.body || {};

        console.log("[BLV Backend] Received summary language:", language);

        if (!structure || !Array.isArray(structure.elements)) {
            return res.status(400).json({
                error: "structure.elements must be an array",
            });
        }

        if (language !== "en" && language !== "bn") {
            return res.status(400).json({
                error: 'language must be "en" or "bn"',
            });
        }

        // 1. Generate the requested language with the LLM.
        // const summary = await generateSummary(structure, language);
        const summary = language === 'bn' ? 'এই পেজের শিরোনাম হলো "BERT教授讲解 DeepSeek"। পেজের মাঝখানে BERT নিয়ে একটি প্রফেসরের লেকচারের মূল কন্টেন্ট আছে। উপর থেকে নিচে আটটি বড় হেডিং আছে, যেগুলো ক্রমান্বয়ে বার্টের মূল ধারণা, আর্কিটেকচার, দুই পর্যায়ের জীবনচক্র, ব্যবহার পদ্ধতি, গবেষণাপত্রের গভীর বিশ্লেষণ, গুরুত্বপূর্ণ সতর্কতা এবং চূড়ান্ত সিদ্ধান্ত নিয়ে আলোচনা করে। মাঝখানে বেশ কিছু টেবিল আছে—BERT বেস ও বেট লার্জের প্যারামিটার, ফাইন টিউনিংয়ের সময় কখন কোন পদ্ধতি ব্যবহার করতে হয়, এবং প্রি ট্রেনিং ও ফাইন টিউনিং এর তুলনা। বাম দিকে অনেক লিংকের একটি লিস্ট আছে যেখানে বিভিন্ন বিষয়যুক্ত পেজের লিংক দেওয়া আছে। নিচের মাঝখানে একটি টেক্সট এরিয়া আছে। মূল বিষয়বস্তু কেন্দ্রীয় অংশে সাজানো আছে।' : 'This page is a lecture about BERT, titled "BERT" The main content runs down the center of the page, structured as a series of numbered sections. At the top, you will find a table comparing BERT base and BERT large models with their encoder, attention head, hidden size, and parameter counts. Below that, the content flows through eight major sections: what BERT is, its architecture, its two phase life of pre training and fine tuning, how to use it, deeper insights from the original paper, critical caveats, takeaways for practitioners, and a closing word. Along the way, there are tables comparing pre training and fine tuning, self supervised and supervised learning, and lists explaining masked language modeling, next sentence prediction, input representations, and fine tuning hyperparameters. A sidebar on the left contains many navigation links to various unrelated topics. At the bottom center is a text area for user input.';

        console.log(summary);

        if (!summary) {
            throw new Error("LLM returned an empty summary");
        }

        console.log("\n========== LLM SUMMARY ==========");
        console.log(summary);
        console.log("==================================\n");

        // 2. Send that exact summary to Piper
        const audio =
            language === "bn"
                ? await generateTts(
                      summary,
                      process.env.PIPER_BN_MODEL || "bn_BD-google-medium",
                  )
                : await generateTts(summary);

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
