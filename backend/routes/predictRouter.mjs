import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// Fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.post("/", (req, res) => {
    const inputData = req.body;

    const pythonPath = "python3";
    const scriptPath = path.join(__dirname, "..", "model", "predict.py");

    const py = spawn(pythonPath, [scriptPath]);

    let result = "";
    let errorOutput = "";

    py.stdout.on("data", (data) => {
        result += data.toString();
    });

    py.stderr.on("data", (data) => {
        errorOutput += data.toString();
    });

    py.on("close", (code) => {
        if (code !== 0 || errorOutput) {
            console.error("Python error:", errorOutput);
            return res.status(500).json({ error: "Prediction failed" });
        }

        const prediction = parseFloat(result.trim());
        res.json({ prediction });
    });

    py.stdin.write(JSON.stringify(inputData));
    py.stdin.end();
});

export default router;

