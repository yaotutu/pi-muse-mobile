import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-conversation-tests.mjs";
import smsReceiver, {
  isSmsReceiverAvailable,
  checkSmsPermission,
  requestSmsPermission,
  addSmsListener,
} from "../modules/sms-receiver/index.ts";

test("sms-receiver fallback in non-native environment", async () => {
  assert.equal(typeof isSmsReceiverAvailable(), "boolean");
  assert.equal(isSmsReceiverAvailable(), false);
  assert.equal(typeof smsReceiver.isAvailable(), "boolean");

  const hasPerm = await checkSmsPermission();
  assert.equal(hasPerm, false);

  const reqPerm = await requestSmsPermission();
  assert.equal(reqPerm, false);

  let called = false;
  const sub = addSmsListener((_event) => {
    called = true;
  });
  assert.equal(typeof sub.remove, "function");
  sub.remove();
  assert.equal(called, false);
});
