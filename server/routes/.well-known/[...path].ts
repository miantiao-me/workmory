import { defineHandler } from "nitro/h3";

export default defineHandler(() => new Response(JSON.stringify({
  error: { code: "NOT_FOUND", message: "Route was not found" },
}), {
  status: 404,
  headers: {
    "Content-Type": "application/json;charset=UTF-8",
    "Access-Control-Allow-Origin": "*",
  },
}));
