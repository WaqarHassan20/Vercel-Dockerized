# Vercel-Dockerized Project Overview

This project automates the build and deployment of code from a GitHub repository to a Cloudflare R2 bucket, using a DigitalOcean Kubernetes cluster for container orchestration. It consists of three main components:

## 🚀 Quick Start

### Prerequisites
- DigitalOcean Kubernetes cluster with kubeconfig access
- Cloudflare R2 bucket and credentials
- Redis instance (for real-time logging)
- Node.js/Bun installed locally
- Docker for building images


================================================================
================================================================
## To add the prisma using bun, run these commands steps by step :
- bun add prisma
- bunx prisma init
- add the db url in the file 
- write the schema in your schema.prisma file
- bunx prisma migrate dev --name init
- bunx prisma generate
================================================================
================================================================

### Environment Setup

1. **Copy environment files and configure:**
   ```bash
   # API Server
   cd api-server
   cp .env.example .env
   # Edit .env with your actual values
   
   # Build Server
   cd ../build-server
   cp .env.example .env
   # Edit .env with your actual values
   
   # S3 Reverse Proxy
   cd ../s3-reverse-proxy
   cp .env.example .env
   # Edit .env with your actual values
   ```

2. **Required Environment Variables:**
   - `S3_ACCESS_KEY_ID` - Your Cloudflare R2 access key
   - `S3_SECRET_ACCESS_KEY` - Your Cloudflare R2 secret key
   - `S3_ENDPOINT` - Your R2 endpoint URL
   - `BUCKET` - Your R2 bucket name
   - `REDIS_URL` - Redis connection string
   - `API_PORT` - Port for API server (default: 9001)
   - `BASE_PATH` - R2 public URL for reverse proxy
   - `PORT` - Port for reverse proxy (default: 8000)

## 1. API Server (`api-server/index.ts`)
- **Purpose:** Accepts project creation requests and spins up a build container on your DigitalOcean Kubernetes cluster.
- **Flow:**
  - Receives a POST request at `/project` with a `repoUrl` (GitHub repository URL).
  - Generates a unique project slug.
  - Loads Kubernetes configuration and creates a Pod manifest for the build container (`waqarhasan/build-server:latest`).
  - Passes necessary environment variables (repo URL, S3 credentials, bucket info, etc.) to the container.
  - Deploys the Pod to the cluster, which triggers the build process.
  - Provides real-time build logs via Socket.IO

## 2. Build Server (`build-server/index.ts`)
- **Purpose:** Clones the repository, builds the project, and uploads the build artifacts to Cloudflare R2.
- **Flow:**
  - Reads environment variables for S3 credentials, bucket, endpoint, and project ID.
  - Runs the build process using Bun (`bun install && bun run build`).
  - Iterates through the build output directory, uploading each file to the R2 bucket under a path structured as `__outputs/<PROJECT_ID>/<file>`.
  - Uses AWS SDK for S3-compatible storage to handle uploads efficiently (buffer for small files, stream for large files).
  - Publishes real-time logs to Redis for Socket.IO streaming

## 3. S3 Reverse Proxy (`s3-reverse-proxy/index.ts`)
- **Purpose:** Serves build artifacts from Cloudflare R2 to users via HTTP, acting as a reverse proxy.
- **Flow:**
  - Listens for incoming HTTP requests.
  - Extracts the project ID from the request's hostname.
  - Rewrites the request path (e.g., `/` becomes `/index.html`).
  - Proxies the request to the correct R2 bucket path (`BASE_PATH/<projectId>`), allowing users to access their deployed builds.

---

## 🔄 How It Works Together
1. **User submits a project:**
   - Sends a POST request to the API server with the GitHub repo URL.
2. **API server spins up a build container:**
   - Creates a Kubernetes Pod running the build server, passing all required environment variables.
3. **Build server builds and uploads:**
   - Clones the repo, builds it, and uploads the output to Cloudflare R2.
   - Streams real-time logs via Redis to connected Socket.IO clients.
4. **Reverse proxy serves the build:**
   - Users access their deployed project via a URL, and the reverse proxy fetches files from R2 and serves them over HTTP.

---

## 🛠️ Development

### Running Locally

1. **API Server:**
   ```bash
   cd api-server
   bun install
   bun dev
   ```

2. **Build Server (for testing):**
   ```bash
   cd build-server
   bun install
   bun dev
   ```

3. **S3 Reverse Proxy:**
   ```bash
   cd s3-reverse-proxy
   bun install
   bun dev
   ```

### Building Docker Images

```bash
# Build server image
cd build-server
docker build -t your-registry/build-server:latest .
docker push your-registry/build-server:latest
```

### Socket.IO Real-time Logs

Connect to the API server's Socket.IO endpoint to receive real-time build logs:

```javascript
const socket = io('http://localhost:9001');

// Subscribe to a specific project's logs
socket.emit('subscribe', 'logs:your-project-id');

// Listen for log messages
socket.on('message', (message) => {
  console.log('Build log:', message);
});
```

---

## 📋 API Reference

### POST `/project`
Creates a new build job.

**Request Body:**
```json
{
  "repoUrl": "https://github.com/username/repository"
}
```

**Response:**
```json
{
  "slug": "unique-project-slug",
  "status": "build started",
  "url": "http://unique-project-slug.localhost:8000"
}
```

---

## 🚨 Security Notes

- All sensitive data is stored in environment variables
- Never commit `.env` files to the repository
- Use `.env.example` files as templates
- Kubernetes secrets should be managed separately
- Redis should be secured with authentication in production

---

## 📁 Project Structure
```
vercel-dockerized/
├── api-server/           # Express + Socket.IO + Kubernetes API
├── build-server/         # Docker container for building projects
├── s3-reverse-proxy/     # HTTP proxy for serving builds
├── .gitignore           # Git ignore rules
└── README.md            # This file
```

---

## Example Flow
1. `POST /project` with `{ "repoUrl": "https://github.com/user/repo" }`
2. API server creates a build Pod with the repo URL and credentials.
3. Build server builds and uploads to R2 at `__outputs/<projectId>/...`
4. Real-time logs streamed via Socket.IO to subscribed clients
5. Reverse proxy serves files from R2 at `https://your-proxy/<projectId>/...`

---

For more details, see the code in each component's `index.ts` file.