import { requireNativeModule, type EventSubscription } from "expo-modules-core";
import { PermissionsAndroid, Platform } from "react-native";

export type SmsEvent = {
  sender: string;
  body: string;
  timestamp: number;
};

export type InboxSmsMessage = {
  id: string;
  sender: string;
  body: string;
  timestamp: number;
};

type SmsNativeModule = {
  isSupported(): boolean;
  readInboxSms?(limit: number): InboxSmsMessage[];
  addListener(eventName: "onSmsReceived", listener: (event: SmsEvent) => void): EventSubscription;
};

let SmsReceiverNative: SmsNativeModule | null = null;

if (Platform.OS === "android") {
  try {
    SmsReceiverNative = requireNativeModule<SmsNativeModule>("SmsReceiver");
  } catch {
    // Native module not available (e.g. running in Expo Go or non-prebuilt env)
  }
}

export function isSmsReceiverAvailable(): boolean {
  return !!SmsReceiverNative;
}

export async function checkSmsPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || !SmsReceiverNative) return false;
  try {
    const [receiveGranted, readGranted] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
    ]);
    return receiveGranted && readGranted;
  } catch {
    return false;
  }
}

export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || !SmsReceiverNative) return false;
  try {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    ]);
    return (
      results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED
    );
  } catch {
    return false;
  }
}

export async function readInboxSms(limit = 200): Promise<InboxSmsMessage[]> {
  if (Platform.OS !== "android" || !SmsReceiverNative?.readInboxSms) return [];
  try {
    const granted = await checkSmsPermission();
    if (!granted) return [];
    const rows = SmsReceiverNative.readInboxSms(limit);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function addSmsListener(listener: (event: SmsEvent) => void): EventSubscription {
  if (!SmsReceiverNative) {
    return { remove: () => {} };
  }
  return SmsReceiverNative.addListener("onSmsReceived", listener);
}

export default {
  isAvailable: isSmsReceiverAvailable,
  checkPermission: checkSmsPermission,
  requestPermission: requestSmsPermission,
  readInboxSms,
  addListener: addSmsListener,
};
