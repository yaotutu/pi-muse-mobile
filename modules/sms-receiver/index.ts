import { requireNativeModule, type EventSubscription } from "expo-modules-core";
import { PermissionsAndroid, Platform } from "react-native";

export type SmsEvent = {
  sender: string;
  body: string;
  timestamp: number;
};

type SmsNativeModule = {
  isSupported(): boolean;
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
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
  } catch {
    return false;
  }
}

export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || !SmsReceiverNative) return false;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      {
        title: "短信自动整理权限",
        message: "Pi Muse 需要短信读取与接收权限，以自动整理快递码、验证码与账单等重要信息。",
        buttonPositive: "允许",
        buttonNegative: "拒绝",
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
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
  addListener: addSmsListener,
};
