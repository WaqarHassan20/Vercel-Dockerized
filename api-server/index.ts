import { PrismaClient } from "./generated/prisma";
import { generateSlug } from "random-word-slugs";
import { createClient } from "@clickhouse/client";
import * as k8s from "@kubernetes/client-node";
import { v4 as uuidv4 } from "uuid";
import { Kafka } from "kafkajs";
import express from "express";
import { z } from "zod";
import path from "path";
import cors from "cors";
import "dotenv/config";
import fs, { stat } from "fs";

const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const endpoint = process.env.S3_ENDPOINT;
const clickhouse_URL = process.env.CLICKHOUSE_URL;
const kafka_USERNAME = process.env.KAFKA_USERNAME;
const kafka_PASSWORD = process.env.KAFKA_PASSWORD;
const kafka_BROKERS_URL = process.env.KAFKA_BROKERS;
const API_PORT = process.env.API_PORT || 9001;
const bucket = process.env.BUCKET;

if (
  !clickhouse_URL ||
  !kafka_USERNAME ||
  !kafka_PASSWORD ||
  !kafka_BROKERS_URL ||
  !secretAccessKey ||
  !accessKeyId ||
  !endpoint ||
  !bucket ||
  !API_PORT
) {
  throw new Error("Missing required environment variables.");
}

const prismaClient = new PrismaClient();
const app = express();
app.use(express.json());
app.use(cors());


const kafka = new Kafka({
  clientId: "api-server",
  brokers: [kafka_BROKERS_URL],
  ssl: {
    ca: [fs.readFileSync(path.join(__dirname, "./kafka.pem"), "utf-8")],
  },

  sasl: {
    username: kafka_USERNAME,
    password: kafka_PASSWORD,
    mechanism: "plain",
  },
  retry: {
    retries: 5, // Retry up to 5 times
    initialRetryTime: 300, // Start with 300ms retry delay
    maxRetryTime: 10000, // Maximum retry with a delay of 10 seconds
  },
  requestTimeout: 30000, // 30s time for requests
});


const consumer = kafka.consumer({ groupId: "api-server-logs-consumer" });

const clickHouseClient = createClient({
  url: clickhouse_URL,
  database: "default",
});


async function initKafkaConsumer() {
  console.log("Initializing Kafka consumer...");
  try {
    await consumer.connect();
    console.log("Kafka consumer connected successfully");

    await consumer.subscribe({ topics: ["container-logs"] });
    console.log("Subscribed to container-logs topic");

    await consumer.run({
      autoCommit: false,
      eachBatch: async ({
        batch,
        heartbeat,
        commitOffsetsIfNecessary,
        resolveOffset,
      }) => {
        try {
          const messages = batch.messages;
          console.log(`Recv. ${messages.length} messages`);

          for (const message of messages) {
            const stringMessage = message.value?.toString();

            if (stringMessage) {
              try {
                // value: JSON.stringify({ PROJECT_ID, DEPLOYMENT_ID, log }),
                // since puslisher is puslishing  data in that above format so,
                // we are parsing it back in the object notation

                const { PROJECT_ID, DEPLOYMENT_ID, log } =
                  JSON.parse(stringMessage);

                const { query_id } = await clickHouseClient.insert({
                  table: "log_events", // the name of table on aiven ck service
                  values: [
                    {
                      event_id: uuidv4(),
                      deployment_id: DEPLOYMENT_ID,
                      log,
                    },
                  ],
                  format: "JSONEachRow",
                });

                console.log(query_id);
                resolveOffset(message.offset);
                await commitOffsetsIfNecessary(message.offset as any);
                await heartbeat();

              } catch (parseError) {
                console.error("Error parsing message:", parseError);
              }
            }
          }
        } catch (err) {
          console.error("Error while processing batch:", err);
        }
      },
    });
  } catch (error) {
    console.error("Failed to initialize Kafka consumer:", error);
    // Retry connection after 5 seconds
    setTimeout(() => {
      console.log("Retrying Kafka connection...");
      initKafkaConsumer();
    }, 5000);
  }
}

initKafkaConsumer();


app.post("/project", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    gitUrl: z.string(),
  });

  const parsedData = schema.safeParse(req.body);

  if (!parsedData.success) {
    res.status(400).send({
      message: "Invalid Input Data",
      Error: parsedData.error.format(),
    });
    return;
  }

  try {
    const { name, gitUrl } = parsedData.data;

    const project = await prismaClient.project.create({
      data: {
        name: name,
        gitUrl: gitUrl,
        subDomain: generateSlug(),
      },
    });

    if (project) {
      res.status(200).json({
        message: "success",
        data: project,
      });
    }

    console.log("Project route success");
  } catch (error) {
    res.status(500).send({
      message: "Some Error Occured",
      Error: error,
    });
    return;
  }
});

// API Requests started form here
app.post("/deploy", async (req, res) => {
  const schema = z.object({
    projectId: z.string(),
  });

  const parsedData = schema.safeParse(req.body);
  if (!parsedData.success) {
    res.status(400).send({
      message: "Invalid Input Data",
      Error: parsedData.error.format(),
    });
    return;
  }

  try {
    const { projectId } = parsedData.data;

    const project = await prismaClient.project.findUnique({
      where: {
        id: projectId,
      },
    });

    if (!project) {
      res.status(400).send({
        message: "Project not found",
      });
      return;
    }

    const deployment = await prismaClient.deployment.create({
      data: {
        project: { connect: { id: projectId } },
        status: "QUEUED",
      },
    });

    if (!deployment) {
      res.status(400).send({
        message: "Error creating deployment",
      });
      return;
    }

    // Update deployment status to IN_PROGRESS
    await prismaClient.deployment.update({
      where: { id: deployment.id },
      data: { status: "IN_PROGRESS" },
    });


    res.status(200).json({
      status: "queued",
      data: {
        projectId,
        deploymentId: deployment.id,
      },
    });

    // Continue with pod creation in background
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    // manifest code for pod in node js with env variables
    const podManifest = {
      metadata: { name: `build-${projectId}` },
      spec: {
        containers: [
          {
            name: "build-server",
            image: "waqarhasan/build-server:v1.8",
            env: [
              { name: "GIT_REPOSITORY_URL", value: project.gitUrl },
              { name: "PROJECT_ID", value: projectId },
              { name: "DEPLOYMENT_ID", value: deployment.id },
              { name: "S3_ACCESS_KEY_ID", value: accessKeyId }, // recently added
              {
                name: "S3_SECRET_ACCESS_KEY",
                value: secretAccessKey,
              },
              { name: "S3_ENDPOINT", value: endpoint },
              { name: "BUCKET", value: bucket },
              { name: "KAFKA_BROKERS", value: kafka_BROKERS_URL },
              { name: "KAFKA_USERNAME", value: kafka_USERNAME },
              { name: "KAFKA_PASSWORD", value: kafka_PASSWORD },
              { name: "KAFKAJS_NO_PARTITIONER_WARNING", value: "1" },
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

    // check the pod status while running in the background
    const podName = `build-${projectId}`;
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

          // Update deployment status based on exit code
          const finalStatus = exitCode === 0 ? "READY" : "FAIL";
          await prismaClient.deployment.update({
            where: { id: deployment.id },
            data: { status: finalStatus },
          });

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

app.get("/logs/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const logs = await clickHouseClient.query({
      query: `
        SELECT event_id, deployment_id, log, timestamp
        FROM log_events
        WHERE deployment_id = {deployment_id:String}
      `,
      query_params: {
        deployment_id: id,
      },
      format: "JSON",
    });

    const objectLogs = await logs.json();

    res.status(200).json({
      logs: objectLogs.data,
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

app.listen(API_PORT, () => {
  console.log(`API Server is listening on port ${API_PORT}`);
});
