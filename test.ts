// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// import { exec } from "child_process";
// import {Kafka} from "kafkajs"
// import mime from "mime";
// import path from "path";
// import fs from "fs";

// const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID;
// const PROJECT_ID = process.env.PROJECT_ID;
// const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
// const accessKeyId = process.env.S3_ACCESS_KEY_ID;
// const endpoint = process.env.S3_ENDPOINT;
// const bucket = process.env.BUCKET;
// const kafka_USERNAME = process.env.KAFKA_USERNAME;
// const kafka_PASSWORD = process.env.KAFKA_PASSWORD;
// const kafka_BROKERS = process.env.KAFKA_BROKERS;

// if (!accessKeyId || !secretAccessKey || !bucket || !endpoint || !kafka_BROKERS || !kafka_USERNAME || !kafka_PASSWORD || !DEPLOYMENT_ID) {
//   throw new Error("Missing required environment variables.");
// }
// console.log(`Project ID : ${PROJECT_ID}`);
// console.log(`DeploymentID : ${DEPLOYMENT_ID}`);

// const kafka = new Kafka({
//   clientId: `build-server-${PROJECT_ID}`,
//   brokers: kafka_BROKERS.split(","),
//   ssl: {
//     ca: [fs.readFileSync(path.join(__dirname, "./kafka.pem"), "utf-8")],
//   },
//   sasl: {
//     username: kafka_USERNAME,
//     password: kafka_PASSWORD,
//     mechanism: "plain",
//   },
// });

// const producer = kafka.producer();

// const PublishLog =async (log: unknown) => {
//   try {
//     await producer.send({
//       topic: "container-logs",
//       messages: [
//         {
//           key: "log",
//           value: JSON.stringify({ PROJECT_ID, DEPLOYMENT_ID, log }),
//         },
//       ],
//     });
  
//   } catch (e) {
//     console.error("Failed to publish log:", e);
//   }
// };

// const s3Client = new S3Client({
//   region: "auto",
//   credentials: {
//     accessKeyId,
//     secretAccessKey,
//   },
//   endpoint,
// });

// const init = async () => {
//   try {
//     console.log("Executing Index.ts");

//     // Connect to Kafka producer
//     console.log("Connecting to Kafka...");
//     await producer.connect();
//     console.log("Kafka producer connected successfully");

//     await PublishLog(`Build Started...`);

//     const outDirPath = path.join(__dirname, "output");

//     // Wait a moment for git clone to complete if needed
//     await new Promise((resolve) => setTimeout(resolve, 2000));

//     if (!fs.existsSync(outDirPath)) {
//       throw new Error(
//         `Output directory not found: ${outDirPath}. Git clone may have failed.`
//       );
//     }

//     const p = exec(`cd ${outDirPath} && bun install && bun run build`);

//     p.stdout?.on("data", async(data) => {
//       console.log(`Data Section: ${data.toString()}`);
//       await PublishLog(`Data : ${data.toString()}`);
//     });

//     p.stderr?.on("data", async (data) => {
//       console.warn(`Build Warning/Info: ${data.toString()}`);
//       await PublishLog(`Build Info: ${data.toString()}`);
//     });

//     p.on("close", async (code) => {
//       console.log(`Script running done with exit code: ${code}`);
//       await PublishLog(`Build complete with exit code: ${code}`);

//       if (code !== 0) {
//         await PublishLog(`Build failed with exit code: ${code}`);
//         console.error(`Build failed with exit code: ${code}`);
//         process.exit(1);
//         return;
//       }

//       try {
//         const distFolderPath = path.join(outDirPath, "dist");

//         if (!fs.existsSync(distFolderPath)) {
//           throw new Error("Build folder not found: " + distFolderPath);
//         }

//         const distFolderContent = fs.readdirSync(distFolderPath, {
//           recursive: true,
//         });

//         const files = distFolderContent.filter(
//           (file): file is string => typeof file === "string"
//         );

//         for (const file of files) {
//           try {
//             await PublishLog(`Started to upload file ${file}`);

//             const absoluteFilePath = path.join(distFolderPath, file);

//             if (fs.lstatSync(absoluteFilePath).isDirectory()) continue;

//             const fileStats = fs.statSync(absoluteFilePath);
//             const fileBody =
//               fileStats.size < 5 * 1024 * 1024
//                 ? fs.readFileSync(absoluteFilePath)
//                 : fs.createReadStream(absoluteFilePath);

//             await PublishLog(`Uploading file ${file}`);

//             const command = new PutObjectCommand({
//               Bucket: bucket,
//               Key: `__outputs/${PROJECT_ID}/${file}`,
//               Body: fileBody,
//               ContentType: mime.getType(absoluteFilePath) || undefined,
//             });

//             await PublishLog(`Uploaded file ${file}`);

//             await s3Client.send(command);
//           } catch (uploadError) {
//             console.error(`Error uploading file ${file}:`, uploadError);
//             await PublishLog(`Error uploading file ${file}: ${uploadError}`);
//           }
//         }
//         console.log("Uploading done!");
//         await PublishLog(`All files uploaded successfully!`);

//         // Close Kafka connection and exit
//         await producer.disconnect();
//         console.log("Build process completed successfully. Exiting...");
//         process.exit(0);
//       } catch (distError) {
//         console.error("Error processing dist folder:", distError);
//         await PublishLog(`Error processing dist folder: ${distError}`);
//         await producer.disconnect();
//         process.exit(1);
//       }
//     });
//   } catch (err) {
//     console.error("Error in init function:", err);
//     await PublishLog(`Init function error: ${err}`);
//     await producer.disconnect();
//     process.exit(1);
//   }
// };

// init();
