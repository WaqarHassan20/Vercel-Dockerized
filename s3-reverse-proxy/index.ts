import express from "express";
import httpProxy from "http-proxy";

const app = express();
const proxy = httpProxy.createProxyServer();

// I am not sure about this link , so have to test it later on
const BASE_PATH = process.env.BASE_PATH;
const PORT = process.env.PORT;

if (!PORT) {
  throw new Error("PORT is not provided");
}
if (!BASE_PATH) {
  throw new Error("BASE PATH is not provided");
}

app.use((req, res) => {
  const hostname = req.host;
  const projectId = hostname.split(".")[0];

  // console.log("Project Id : ", projectId);

  // If the request is for root, rewrite to /index.html
  if (req.path === "/") {
    // req.path  // It is a readonly property
    req.url = "/index.html";
  }

  const resolvesTo = `${BASE_PATH}/${projectId}`;

  //  req.url is writeable, so you can rewrite the request path before proxying it.
  //  req.path is derived from req.url, so Express makes it read-only.

  // console.log("Full path : ", resolvesTo);

  return proxy.web(req, res, { target: resolvesTo, changeOrigin: true });
});

app.listen(PORT, () => {
  console.log(`Reverse proxy is running on port ${PORT}`);
});
