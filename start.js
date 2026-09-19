"use strict";

const app = require("./server/app");

app
  .start()
  .then((server) => {
    const shutdown = () => {
      app.stop(server).finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error) => {
    console.error(`Failed to start: ${error.message}`);
    process.exit(1);
  });
