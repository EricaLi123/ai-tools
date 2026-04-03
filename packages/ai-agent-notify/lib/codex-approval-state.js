const approvalPending = require("./codex-approval-pending");
const approvalSessionGrants = require("./codex-approval-session-grants");

module.exports = {
  ...approvalPending,
  ...approvalSessionGrants,
};
