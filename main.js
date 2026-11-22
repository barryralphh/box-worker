// Deno Deploy entry point: runs worker.js unchanged. Set BOX_TOKEN and PATH_KEY as environment variables (secrets).
import worker from "./worker.js";

Deno.serve((request) =>
  worker.fetch(request, {
    BOX_TOKEN: Deno.env.get("BOX_TOKEN"),
    PATH_KEY: Deno.env.get("PATH_KEY"),
  })
);
