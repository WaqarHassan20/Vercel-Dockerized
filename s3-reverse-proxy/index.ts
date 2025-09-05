import express from "express";
import httpProxy from "http-proxy";

const PORT = 8000;
const app = express();
const proxy = httpProxy.createProxyServer();

// I am not sure about this link , so have to test it later on 
const BASE_PATH ="https://pub-c7d0a525478f4e4abe807b76eb8253ce.r2.dev/vercel/__outputs/"
  
app.use((req, res) => {
  const hostname = req.host;
  const projectId = hostname.split(".")[0];

  // When request is only / , make this /index.html
  if (req.path === "/") {
    req.url = "/index.html";
  }

  //  req.url is writeable, so you can rewrite the request path before proxying it.
  //  req.path is derived from req.url, so Express makes it read-only.

  const resolveTo = `${BASE_PATH}/${projectId}`;

  return proxy.web(req, res, { target: resolveTo, changeOrigin: true });
});

app.listen(PORT, () => {
  console.log(`Reverse proxy is running on port ${PORT}`);
});