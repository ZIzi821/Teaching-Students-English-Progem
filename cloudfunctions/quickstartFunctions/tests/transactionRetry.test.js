const assert = require("assert");
const {
  isTransactionBusyError,
  runTransactionWithRetry,
} = require("../transactionRetry");

const makeBusyError = () => {
  const err = new Error("document.get:fail -501001 Transaction Busy. Transaction is busy.");
  err.errCode = -501001;
  return err;
};

const main = async () => {
  assert.strictEqual(isTransactionBusyError(makeBusyError()), true);
  assert.strictEqual(isTransactionBusyError(new Error("permission denied")), false);

  let transientAttempts = 0;
  const retryEvents = [];
  const value = await runTransactionWithRetry(() => {
    transientAttempts += 1;
    if (transientAttempts < 3) throw makeBusyError();
    return "saved";
  }, {
    retryDelaysMs: [0, 0],
    onRetry: (event) => retryEvents.push(event),
  });
  assert.strictEqual(value, "saved");
  assert.strictEqual(transientAttempts, 3);
  assert.deepStrictEqual(retryEvents.map((event) => event.attempt), [1, 2]);

  let permanentAttempts = 0;
  await assert.rejects(
    () => runTransactionWithRetry(() => {
      permanentAttempts += 1;
      throw makeBusyError();
    }, { retryDelaysMs: [0, 0] }),
    /Transaction Busy/
  );
  assert.strictEqual(permanentAttempts, 3);

  let nonBusyAttempts = 0;
  await assert.rejects(
    () => runTransactionWithRetry(() => {
      nonBusyAttempts += 1;
      throw new Error("permission denied");
    }, { retryDelaysMs: [0] }),
    /permission denied/
  );
  assert.strictEqual(nonBusyAttempts, 1);
  console.log("transaction retry tests passed");
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
