const crypto = require("crypto");

module.exports = function runCompletionFallbackTests(h) {
  const { assert, fs, notifyRuntime, path, ROOT, section, test } = h;
  const completionReceipts = require(path.join(
    ROOT,
    "lib",
    "codex-completion-receipts.js"
  ));
  const receiptsDir = path.join(notifyRuntime.LOG_DIR, "completion-receipts");

  function getReceiptPathForKey(key) {
    const fileName = `${crypto.createHash("sha1").update(key).digest("hex")}.json`;
    return path.join(receiptsDir, fileName);
  }

  function deleteReceiptByKey(key) {
    if (!key) {
      return;
    }

    const receiptPath = getReceiptPathForKey(key);
    if (!fs.existsSync(receiptPath)) {
      return;
    }

    try {
      fs.unlinkSync(receiptPath);
    } catch {}
  }

  section("Completion fallback");

  test("writeCodexCompletionReceiptForNotification writes a Stop receipt keyed by session + turn", () => {
    const sessionId = `completion-session-${process.pid}-${Date.now()}`;
    const turnId = `turn-${process.hrtime.bigint().toString()}`;
    const key = completionReceipts.buildCodexCompletionReceiptKey({
      sessionId,
      turnId,
      eventName: "Stop",
    });
    const receiptPath = getReceiptPathForKey(key);

    deleteReceiptByKey(key);

    try {
      completionReceipts.writeCodexCompletionReceiptForNotification({
        sourceId: "codex-legacy-notify",
        eventName: "Stop",
        sessionId,
        turnId,
      });

      assert(fs.existsSync(receiptPath), "expected Stop completion receipt file to exist");
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));

      assert(receipt.key === key, "receipt key mismatch");
      assert(receipt.sessionId === sessionId, "receipt sessionId mismatch");
      assert(receipt.turnId === turnId, "receipt turnId mismatch");
      assert(receipt.eventName === "Stop", "receipt eventName mismatch");
      assert(
        typeof receipt.expiresAtMs === "number" && receipt.expiresAtMs > Date.now(),
        "receipt expiresAtMs should be in the future"
      );
      assert(
        completionReceipts.hasCodexCompletionReceipt({
          sessionId,
          turnId,
          eventName: "Stop",
        }),
        "expected Stop receipt lookup to succeed"
      );
    } finally {
      deleteReceiptByKey(key);
    }
  });

  test("writeCodexCompletionReceiptForNotification ignores non-Stop payloads and missing turn ids", () => {
    const nonStopSessionId = `completion-nonstop-${process.pid}-${Date.now()}`;
    const nonStopTurnId = `turn-${process.hrtime.bigint().toString()}`;
    const nonStopKey = completionReceipts.buildCodexCompletionReceiptKey({
      sessionId: nonStopSessionId,
      turnId: nonStopTurnId,
      eventName: "Stop",
    });
    const nonStopReceiptPath = getReceiptPathForKey(nonStopKey);

    deleteReceiptByKey(nonStopKey);

    try {
      const nonStopResult = completionReceipts.writeCodexCompletionReceiptForNotification({
        sourceId: "codex-legacy-notify",
        eventName: "PermissionRequest",
        sessionId: nonStopSessionId,
        turnId: nonStopTurnId,
      });
      const missingTurnResult =
        completionReceipts.writeCodexCompletionReceiptForNotification({
          sourceId: "codex-legacy-notify",
          eventName: "Stop",
          sessionId: `completion-missing-turn-${process.pid}-${Date.now()}`,
          turnId: "",
        });

      assert(!nonStopResult, "non-Stop payload should not write a receipt");
      assert(!missingTurnResult, "missing turn id should not write a receipt");
      assert(
        completionReceipts.buildCodexCompletionReceiptKey({
          sessionId: "completion-missing-turn",
          turnId: "",
          eventName: "Stop",
        }) === "",
        "missing turn ids should produce an empty receipt key"
      );
      assert(
        !fs.existsSync(nonStopReceiptPath),
        "non-Stop payload should not create a completion receipt file"
      );
      assert(
        !completionReceipts.hasCodexCompletionReceipt({
          sessionId: nonStopSessionId,
          turnId: nonStopTurnId,
          eventName: "Stop",
        }),
        "non-Stop payload should not create a readable receipt"
      );
    } finally {
      deleteReceiptByKey(nonStopKey);
    }
  });
};
