import { generateSlug } from "random-word-slugs";
import * as k8s from "@kubernetes/client-node";
import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import Redis from "ioredis";
import "dotenv/config";

const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const endpoint = process.env.S3_ENDPOINT;
const redis_URL = process.env.REDIS_URL;
const API_PORT = process.env.API_PORT || 9001;
const bucket = process.env.BUCKET;

if (
  !accessKeyId ||
  !secretAccessKey ||
  !endpoint ||
  !bucket ||
  !redis_URL ||
  !API_PORT
) {
  throw new Error("Missing AWS credentials in environment variables.");
}

const subscriber = new Redis(redis_URL);

const app = express();
app.use(express.json());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("A connection established");

  socket.on("subscribe", (channel) => {
    console.log(`Client subscribing to channel: ${channel}`);
    socket.join(channel);
    socket.emit("message", `Joined ${channel}`);
  });
});

// API Requests started form here
app.post("/project", async (req, res) => {
  try {
    const { repoUrl, slug } = req.body;

    if (!repoUrl) {
      return res.status(400).json({
        error: "Github URL is required",
      });
    }
    const PROJECT_ID = slug ? slug : generateSlug().toLowerCase();

    console.log(`Repo URL is : ${repoUrl}`);
    console.log(`ProjectId is : ${PROJECT_ID}`);

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    // manifest code for pod in node js with env variables
    const podManifest = {
      metadata: { name: `build-${PROJECT_ID}` },
      spec: {
        containers: [
          {
            name: "build-server",
            image: "waqarhasan/build-server:v1.3",
            env: [
              { name: "GIT_REPOSITORY_URL", value: repoUrl },
              { name: "PROJECT_ID", value: PROJECT_ID },
              { name: "S3_ACCESS_KEY_ID", value: accessKeyId },
              {
                name: "S3_SECRET_ACCESS_KEY",
                value: secretAccessKey,
              },
              { name: "S3_ENDPOINT", value: endpoint },
              { name: "BUCKET", value: bucket },
              { name: "REDIS_URL", value: redis_URL },
              //   { name: "REDIS_URL", value: process.env.REDIS_URL },
            ],
          },
        ],
        restartPolicy: "Never",
      },
    };

    console.log("Creating the pod...");

    const response = await k8sApi.createNamespacedPod({
      namespace: "default",
      body: podManifest,
    });

    console.log("Pod created successfully");

    res.json({
      slug: `${PROJECT_ID}`,
      status: "build started",
      url: `http://${PROJECT_ID}.localhost:8000`,
    });

    // check the pod status while running in the background
    const podName = `build-${PROJECT_ID}`;
    let completed = false;
    let attempts = 0;

    const maxAttempts = 120;

    while (!completed && attempts < maxAttempts) {
      try {
        const podResponse = await k8sApi.readNamespacedPod({
          name: podName,
          namespace: "default",
        });

        const phase = podResponse.status?.phase;
        const containerStatuses = podResponse.status?.containerStatuses;

        console.log(`Pod : ${podName} , status : ${phase}`);

        const buildContainer = containerStatuses?.find(
          (c) => c.name === "build-server"
        );

        const isTerminated = buildContainer?.state?.terminated;
        if (phase === "Succeeded" || phase === "Failed" || isTerminated) {
          completed = true;
          const exitCode = isTerminated?.exitCode;
          const reason = isTerminated?.reason || phase;

          console.log(
            `Pod ${podName} completed - Phase: ${phase}, Exit Code: ${exitCode}, Reason: ${reason}`
          );

          // Deleting the pod now
          try {
            await k8sApi.deleteNamespacedPod({
              name: podName,
              namespace: "default",
            });
            console.log(`Pod ${podName} deleted successfully`);
            console.log("Container spin done!");
          } catch (deleteError) {
            console.error(`Error deleting pod: ${deleteError}`);
          }
        } else {
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (error) {
        console.error(`Error checking pod status: ${error}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
      attempts++;
    }

    if (!completed) {
      console.log(
        `Pod ${podName} did not complete within timeout, attempting cleanup`
      );

      try {
        await k8sApi.deleteNamespacedPod({
          name: podName,
          namespace: "default",
        });
      } catch (error) {
        console.error(`Error cleaning up pod: ${error}`);
      }
    }
  } catch (error) {
    console.error("Error in /project endpoint:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function initRedisSubscriber() {
  console.log("Initializing Redis subscriber...");

  try {
    // Test Redis connection
    subscriber.on("connect", () => {
      console.log("Redis subscriber connected successfully");
    });

    // Subscribe to all channels starting with 'logs:'
    await subscriber.psubscribe("logs:*");
    console.log("Subscribed to logs:* pattern");

    // When a message is published in Redis, forward it to Socket.IO
    subscriber.on("pmessage", (pattern, channel, message) => {
      console.log(`${channel}: ${message}`);
      // Emit to all sockets in the room
      io.to(channel).emit("message", message);
    });

    subscriber.on("error", (err) => {
      console.error("Redis subscriber error:", err);
    });
  } catch (error) {
    console.error("Failed to initialize Redis subscriber:", error);
  }
}

// Initialize Redis subscriber immediately
initRedisSubscriber();

// Start a single server for both API and Socket.IO
httpServer.listen(API_PORT, () => {
  console.log(`API Server + Socket.IO are listening on port ${API_PORT}`);
});
