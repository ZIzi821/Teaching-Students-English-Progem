const assert = require("assert");
const { withoutDocumentId } = require("../databasePayload");

const source = { _id: "fixed-id", title: "保留内容", version: 2 };
const payload = withoutDocumentId(source);

assert.deepStrictEqual(payload, { title: "保留内容", version: 2 });
assert.strictEqual(source._id, "fixed-id", "payload conversion must not mutate query results");
assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, "_id"), false);

console.log("database payload tests passed");
