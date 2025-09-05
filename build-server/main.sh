#!/bin/sh

# Ensure environment variable is set
if [ -z "$GIT_REPOSITORY_URL" ]; then
  echo "Error: GIT_REPOSITORY_URL is not set"
  exit 1
fi

# Clone the repo from the environment variable
git clone "$GIT_REPOSITORY_URL" /home/app/output

# Run the main TypeScript entrypoint using Bun
exec bun index.ts
