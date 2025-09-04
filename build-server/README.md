# build-server

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.15. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

Till now the three, files DockerFile, index.ts and main.sh are created.

What they do that the docker images run the main.sh which clone the git repo and then run the index.ts which is the main
file for the logics to run the bun install and build commands and then push them on the cloudflare R2 bucket.