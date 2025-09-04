import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import mime from "mime";

const accessKeyId = process.env.S3_ACCESS_KEY_ID ;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const PROJECT_ID = process.env.PROJECT_ID;
const bucket = process.env.BUCKET;
const endpoint = process.env.S3_ENDPOINT;
// const gitUrl = process.env.GIT_REPOSITORY_URL;
// const publisher = new Redis("redis://localhost:2739");

if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
  throw new Error("Missing AWS credentials in environment variables.");
}

console.log(`Project ID : ${PROJECT_ID} `);

const s3Client = new S3Client({
  region: "auto",
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
  endpoint: endpoint,
});

const init = async () => {
  console.log("Executing Index.ts");
  const outDirPath = path.join(__dirname, "output");

  const p = exec(`cd ${outDirPath} && bun install && bun run build`);

  p.stdout?.on("data", (data) => {
    console.log(`Data Section : ${data.toString()}`);
  });

  p.stdout?.on("error", (err) => {
    console.log(`Error : ${err}`);
  });

  p.stdout?.on("close", async () => {
    console.log("Script running done");

    const distFolderPath = path.join(__dirname, "output", "dist");
    const distFolderContent = fs.readdirSync(distFolderPath, {
      recursive: true,
    });

    // Ensure all entries are strings
    const files = distFolderContent.filter((file): file is string => typeof file === "string");

    for (const file of files) {
      const absoluteFilePath = path.join(distFolderPath, file);

      if (fs.lstatSync(absoluteFilePath).isDirectory()) continue;

      console.log("Uploading ... ", file);

      // Get file stats to determine size
      const fileStats = fs.statSync(absoluteFilePath);
      const fileSizeInBytes = fileStats.size;

      // Use Buffer for small files (< 5MB) to avoid multipart upload issues
      // Use stream for larger files to be memory efficient
      const fileBody = fileSizeInBytes < 5 * 1024 * 1024 
        ? fs.readFileSync(absoluteFilePath) 
        : fs.createReadStream(absoluteFilePath);

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: `__outputs/${PROJECT_ID}/${file}`,
        Body: fileBody,
        ContentType: mime.getType(absoluteFilePath) || undefined,
      });

      await s3Client.send(command);

      console.log("Uploading done!... ", file);
    }

  });
};

init();
