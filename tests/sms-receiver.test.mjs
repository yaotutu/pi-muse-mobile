import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-conversation-tests.mjs";
import smsReceiver, {
  isSmsReceiverAvailable,
  checkSmsPermission,
  requestSmsPermission,
  openSmsPermissionSettings,
  getInboxSmsInfo,
  readInboxSmsPage,
  readAllInboxSms,
  readInboxSms,
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

  await openSmsPermissionSettings();

  const info = await getInboxSmsInfo();
  assert.deepEqual(info, { permissionGranted: false, totalCount: 0 });

  const page = await readInboxSmsPage(50, 10);
  assert.deepEqual(page, { items: [], totalCount: 0, scanned: 0, nextOffset: 10, hasMore: false });

  const all = await readAllInboxSms();
  assert.deepEqual(all, []);

  const inbox = await readInboxSms(50);
  assert.deepEqual(inbox, []);

  let called = false;
  const sub = addSmsListener((_event) => {
    called = true;
  });
  assert.equal(typeof sub.remove, "function");
  sub.remove();
  assert.equal(called, false);
});
