const watchFiles = require("./codex-session-watch-files");
const watchStreams = require("./codex-session-watch-streams");

module.exports = {
  ...watchFiles,
  ...watchStreams,
};
