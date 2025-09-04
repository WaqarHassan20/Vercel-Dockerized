#!/bin/sh

# Use the environment variable, with a default if not set
GIT_REPOSITORY_URL="${GIT_REPOSITORY_URL:-https://github.com/WaqarHassan20/ReactBoilerCode-Deploy-Testing}"

# Clone the repo
git clone "$GIT_REPOSITORY_URL" /home/app/output

# Run the main TypeScript entrypoint using Bun
exec bun index.ts