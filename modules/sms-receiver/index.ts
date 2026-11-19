import { requireNativeModule, type EventSubscription } from "expo-modules-core";
import { Linking, PermissionsAndroid, Platform } from "react-native";

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

export type InboxSmsInfo = {
  permissionGranted: boolean;
  totalCount: number;
};

export type InboxSmsPage = {
  items: InboxSmsMessage[];
  totalCount: number;
  scanned: number;
  nextOffset: number;
  hasMore: boolean;
};

type SmsNativeModule = {
  isSupported(): boolean;
  getInboxSmsInfo?(): Promise<InboxSmsInfo>;
  readInboxSmsPage?(limit: number, offset: number): Promise<InboxSmsPage>;
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

export async function openSmsPermissionSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Linking.openSettings();
  } catch {
    // 忽略无法打开系统设置页面的设备异常
  }
}

export async function getInboxSmsInfo(): Promise<InboxSmsInfo> {
  if (Platform.OS !== "android" || !SmsReceiverNative?.getInboxSmsInfo) {
    return { permissionGranted: false, totalCount: 0 };
  }
  try {
    const granted = await checkSmsPermission();
    if (!granted) return { permissionGranted: false, totalCount: 0 };
    const info = await SmsReceiverNative.getInboxSmsInfo();
    return {
      permissionGranted: Boolean(info?.permissionGranted),
      totalCount: typeof info?.totalCount === "number" ? Math.max(0, info.totalCount) : 0,
    };
  } catch {
    return { permissionGranted: false, totalCount: 0 };
  }
}

export async function readInboxSmsPage(limit = 200, offset = 0): Promise<InboxSmsPage> {
  const empty: InboxSmsPage = { items: [], totalCount: 0, scanned: 0, nextOffset: offset, hasMore: false };
  if (Platform.OS !== "android" || !SmsReceiverNative?.readInboxSmsPage) return empty;
  try {
    const granted = await checkSmsPermission();
    if (!granted) return empty;
    const page = await SmsReceiverNative.readInboxSmsPage(limit, offset);
    if (!page || !Array.isArray(page.items)) return empty;
    return {
      items: page.items,
      totalCount: typeof page.totalCount === "number" ? page.totalCount : page.items.length,
      scanned: typeof page.scanned === "number" ? page.scanned : page.items.length,
      nextOffset: typeof page.nextOffset === "number" ? page.nextOffset : offset + page.items.length,
      hasMore: Boolean(page.hasMore),
    };
  } catch {
    return empty;
  }
}

export async function readAllInboxSms(
  onProgress?: (loaded: number, total: number) => void,
  pageSize = 200,
): Promise<InboxSmsMessage[]> {
  if (Platform.OS !== "android" || !SmsReceiverNative?.readInboxSmsPage) return [];
  const granted = await checkSmsPermission();
  if (!granted) return [];
  const all: InboxSmsMessage[] = [];
  let offset = 0;
  while (true) {
    const page = await readInboxSmsPage(pageSize, offset);
    all.push(...page.items);
    onProgress?.(Math.min(page.nextOffset, page.totalCount), page.totalCount);
    if (!page.hasMore || page.nextOffset <= offset) break;
    offset = page.nextOffset;
  }
  return all;
}

export async function readInboxSms(limit = 200): Promise<InboxSmsMessage[]> {
  const page = await readInboxSmsPage(limit, 0);
  return page.items;
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
  openPermissionSettings: openSmsPermissionSettings,
  getInboxSmsInfo,
  readInboxSmsPage,
  readAllInboxSms,
  readInboxSms,
  addListener: addSmsListener,
};
