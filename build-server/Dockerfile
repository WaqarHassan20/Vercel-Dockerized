# Use Bun's official Alpine image
FROM oven/bun:alpine

# Set working directory inside the container
WORKDIR /home/app

# Install git + CA certificates (needed for GitHub HTTPS)
RUN apk add --no-cache git ca-certificates && update-ca-certificates

# Copy package.json and install dependencies
COPY package.json ./
COPY kafka.pem kafka.pem 

RUN bun install

# Copy all remaining files into the container
COPY . .

# Ensure script is executable
RUN chmod +x main.sh

# Start the script
ENTRYPOINT ["./main.sh"]