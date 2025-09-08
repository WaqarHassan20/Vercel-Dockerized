import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { exec } from "child_process";
import Redis from "ioredis";
import mime from "mime";
import path from "path";
import fs from "fs";

const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const PROJECT_ID = process.env.PROJECT_ID;
const endpoint = process.env.S3_ENDPOINT;
const redis_URL = process.env.REDIS_URL;
const bucket = process.env.BUCKET;

if (!accessKeyId || !secretAccessKey || !bucket || !endpoint || !redis_URL) {
  throw new Error("Missing AWS credentials in environment variables.");
}
console.log(`Project ID : ${PROJECT_ID}`);

const publisher = new Redis(redis_URL);

const PublishLog = (log: unknown) => {
  try {
    publisher.publish(`logs:${PROJECT_ID}`, JSON.stringify({ log }));
  } catch (e) {
    console.error("Failed to publish log:", e);
  }
};

const s3Client = new S3Client({
  region: "auto",
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  endpoint,
});

const init = async () => {
  try {
    console.log("Executing Index.ts");

    // Wait for Redis connection to establish
    console.log("Waiting for Redis connection...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    PublishLog(`Build Started...`);

    const outDirPath = path.join(__dirname, "output");

    // Wait a moment for git clone to complete if needed
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (!fs.existsSync(outDirPath)) {
      throw new Error(
        `Output directory not found: ${outDirPath}. Git clone may have failed.`
      );
    }

    const p = exec(`cd ${outDirPath} && bun install && bun run build`);

    p.stdout?.on("data", (data) => {
      console.log(`Data Section: ${data.toString()}`);
      PublishLog(`Data : ${data.toString()}`);
    });

    p.stderr?.on("data", (data) => {
      console.warn(`Build Warning/Info: ${data.toString()}`);
      PublishLog(`Build Info: ${data.toString()}`);
    });

    p.on("close", async (code) => {
      console.log(`Script running done with exit code: ${code}`);
      PublishLog(`Build complete with exit code: ${code}`);

      if (code !== 0) {
        PublishLog(`Build failed with exit code: ${code}`);
        console.error(`Build failed with exit code: ${code}`);
        process.exit(1);
        return;
      }

      try {
        const distFolderPath = path.join(outDirPath, "dist");

        if (!fs.existsSync(distFolderPath)) {
          throw new Error("Build folder not found: " + distFolderPath);
        }

        const distFolderContent = fs.readdirSync(distFolderPath, {
          recursive: true,
        });

        const files = distFolderContent.filter(
          (file): file is string => typeof file === "string"
        );

        for (const file of files) {
          try {
            PublishLog(`Started to upload file ${file}`);

            const absoluteFilePath = path.join(distFolderPath, file);

            if (fs.lstatSync(absoluteFilePath).isDirectory()) continue;

            const fileStats = fs.statSync(absoluteFilePath);
            const fileBody =
              fileStats.size < 5 * 1024 * 1024
                ? fs.readFileSync(absoluteFilePath)
                : fs.createReadStream(absoluteFilePath);

            PublishLog(`Uploading file ${file}`);

            const command = new PutObjectCommand({
              Bucket: bucket,
              Key: `__outputs/${PROJECT_ID}/${file}`,
              Body: fileBody,
              ContentType: mime.getType(absoluteFilePath) || undefined,
            });

            PublishLog(`Uploaded file ${file}`);

            await s3Client.send(command);
          } catch (uploadError) {
            console.error(`Error uploading file ${file}:`, uploadError);
            PublishLog(`Error uploading file ${file}: ${uploadError}`);
          }
        }
        console.log("Uploading done!");
        PublishLog(`All files uploaded successfully!`);

        // Close Redis connection and exit
        await publisher.quit();
        console.log("Build process completed successfully. Exiting...");
        process.exit(0);
      } catch (distError) {
        console.error("Error processing dist folder:", distError);
        PublishLog(`Error processing dist folder: ${distError}`);
        await publisher.quit();
        process.exit(1);
      }
    });
  } catch (err) {
    console.error("Error in init function:", err);
    PublishLog(`Init function error: ${err}`);
    await publisher.quit();
    process.exit(1);
  }
};

init();
