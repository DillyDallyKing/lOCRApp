import Fastify from "fastify";
import multipart from "@fastify/multipart";
import path from "path";
import fs from "fs";
import { createWorker } from "tesseract.js";
import sharp from "sharp";

const fastify = Fastify({ logger: true });

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

fastify.register(multipart);

async function preprocessImage(inputPath: string, outputPath: string) {
  await sharp(inputPath)
    .grayscale() // Convert to grayscale
    .threshold(150) // Apply binary thresholding
    .sharpen() // Enhance text clarity
    .toFile(outputPath);
}

function correctOCRNumber(number: string): string {
  const corrections: Record<string, string> = {
    "O": "0", "o": "0", "D": "0", "I": "1", "l": "1", "S": "5", "G": "6", "B": "8", "a": "4"
  };
  return number.split("").map(char => corrections[char] || char).join("");
}

function validateAndCorrectNumbers(numbers: string[]): number[] {
  return numbers
    .map(num => correctOCRNumber(num)) // Fix misreads
    .map(num => parseInt(num, 10)) // Convert to integer
    .filter(num => num >= 1 && num <= 49); // Ensure it's a valid lottery number
}

fastify.post("/upload", async (request, reply) => {
  const data = await request.file();

  if (!data) {
    return reply.status(400).send({ message: "No file uploaded" });
  }

  const filePath = path.join(uploadDir, data.filename);
  const processedPath = path.join(uploadDir, `processed_${data.filename}`);
  await new Promise<void>((resolve, reject) => {
    const fileStream = fs.createWriteStream(filePath);
    data.file.pipe(fileStream);
    fileStream.on("finish", () => resolve());
    fileStream.on("error", reject);
  });

  try {
    // Preprocess image for better OCR accuracy
    await preprocessImage(filePath, processedPath);

    // Initialize Tesseract worker
    const worker = await createWorker("eng");

    await worker.setParameters({
      tessedit_char_whitelist: "0123456789", // Only recognize numbers
      user_defined_dpi: "300", // Higher DPI improves accuracy
    });

    worker.reinitialize();

    const { data: { text } } = await worker.recognize(processedPath);
    await worker.terminate();

    // Process OCR text to determine entry grouping
    const lines = text.split("\n").map(line => line.trim()).filter(line => line !== "");
    let entrySize = 6; // Default to 6 numbers per entry
    let extractedEntries = [];
    let currentGroup = [];
    let skipNextLine = false;
    let processingEntries = false;
    let recordId = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      console.log(line);

      // Detect "Bet Receipt" and extract the next line as record ID
      if (!processingEntries) {
        if (line.toLowerCase().includes("bet receipt")) {
          if (i + 1 < lines.length) {
            recordId = lines[i + 1]; // Store the record ID
          }
          processingEntries = true; // Start processing entries after these two lines
        }
        continue;
      }

      if (line.toLowerCase().includes("board")) {
        continue;
      }

      if (skipNextLine) {
        skipNextLine = false; // Skip this line after detecting System X or Board(S)
        continue;
      }

      const systemMatch = line.match(/system (\d+)/i);
      if (systemMatch) {
        const systemNumber = parseInt(systemMatch[1], 10);
        if (systemNumber >= 7 && systemNumber <= 12) {
          entrySize = systemNumber;
          skipNextLine = true; // Skip the next line
        }
        continue;
      }

      const numbers = line.match(/\b\d{1,2}\b/g);
      if (numbers) {
        const validNumbers = validateAndCorrectNumbers(numbers);
        currentGroup.push(...validNumbers);
        while (currentGroup.length >= entrySize) {
          extractedEntries.push(currentGroup.splice(0, entrySize));
        }
      }
    }

    console.log(extractedEntries);

    reply.send({
      message: "File uploaded and OCR processed successfully",
      filename: data.filename,
      extractedEntries,
    });
  } catch (error) {
    console.error("OCR Processing Error:", error);
    reply.status(500).send({ message: "OCR processing failed" });
  }
});

fastify.register(require("@fastify/static"), {
  root: uploadDir,
  prefix: "/uploads/",
});

const start = async () => {
  try {
    await fastify.listen({ port: 8000, host: "0.0.0.0" });
    console.log("🚀 Server ready at http://localhost:8000");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();