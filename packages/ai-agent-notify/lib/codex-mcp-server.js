function handleMcpServerMessage(message, log, packageVersion = "0.0.0") {
  if (!message || typeof message.method !== "string") {
    return;
  }

  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  if (typeof log === "function") {
    log(`mcp method received method=${message.method} hasId=${hasId ? "1" : "0"}`);
  }
  if (!hasId) {
    return;
  }

  switch (message.method) {
    case "initialize":
      writeMcpResult(message.id, {
        protocolVersion:
          message &&
          message.params &&
          typeof message.params.protocolVersion === "string" &&
          message.params.protocolVersion
            ? message.params.protocolVersion
            : "2025-03-26",
        capabilities: {
          prompts: {},
          resources: {},
          tools: {},
        },
        serverInfo: {
          name: "ai-agent-notify",
          version: packageVersion,
        },
      });
      return;
    case "ping":
      writeMcpResult(message.id, {});
      return;
    case "tools/list":
      writeMcpResult(message.id, { tools: [] });
      return;
    case "resources/list":
      writeMcpResult(message.id, { resources: [] });
      return;
    case "resources/templates/list":
      writeMcpResult(message.id, { resourceTemplates: [] });
      return;
    case "prompts/list":
      writeMcpResult(message.id, { prompts: [] });
      return;
    default:
      if (typeof log === "function") {
        log(`mcp unsupported method=${message.method}`);
      }
      writeMcpError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

function writeMcpResult(id, result) {
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      result,
    })}\n`
  );
}

function writeMcpError(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    })}\n`
  );
}

module.exports = {
  handleMcpServerMessage,
};
