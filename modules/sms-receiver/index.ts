import { requireNativeModule, type EventSubscription } from "expo-modules-core";
import { Platform } from "react-native";

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

export function addSmsListener(listener: (event: SmsEvent) => void): EventSubscription {
  if (!SmsReceiverNative) {
    return { remove: () => {} };
  }
  return SmsReceiverNative.addListener("onSmsReceived", listener);
}

export default {
  isAvailable: isSmsReceiverAvailable,
  addListener: addSmsListener,
};
