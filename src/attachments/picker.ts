import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import {
  MAX_MESSAGE_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  createAttachmentDraftsFromBytes,
  imageMimeOf,
  pickedMimeType,
} from './validation';
import type { AttachmentDraft, PickMessageAttachmentsResult } from './types';

let pickedSequence = 0;

function isLocalDocumentUri(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('content://');
}

const knownSizeOf = (asset: { size?: number }) =>
  typeof asset.size === 'number' && Number.isSafeInteger(asset.size) && asset.size > 0 ? asset.size : 0;

/**
 * 打开一次系统文件选择器并完整读入用户显式选择的图片/文本。
 * 不复制文件、不访问远程 URI；取消或读取失败都不修改调用方已有草稿。
 */
export async function pickMessageAttachments(): Promise<PickMessageAttachmentsResult> {
  if (Platform.OS === 'web') {
    return { status: 'error', message: '当前平台不支持系统文件选择器，请在 Android 客户端选择附件' };
  }

  let result: Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>;
  try {
    result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: true,
      copyToCacheDirectory: false,
    });
  } catch (error) {
    return { status: 'error', message: `无法打开文件选择器：${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.canceled) return { status: 'cancelled' };

  try {
    if (result.assets.length > MAX_MESSAGE_ATTACHMENTS) {
      return { status: 'error', message: `最多只能发送 ${MAX_MESSAGE_ATTACHMENTS} 个附件` };
    }
    const declaredTotal = result.assets.reduce((total, asset) => total + knownSizeOf(asset), 0);
    if (declaredTotal > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { status: 'error', message: `附件总大小不能超过 ${MAX_TOTAL_ATTACHMENT_BYTES} 字节` };
    }

    const inputs: { id: string; name: string; mimeType: string; data: Uint8Array }[] = [];
    let readBytes = 0;
    for (const asset of result.assets) {
      if (!asset || typeof asset.uri !== 'string' || !isLocalDocumentUri(asset.uri)) {
        return { status: 'error', message: '只能读取本机选择器返回的本地文件' };
      }
      if (typeof asset.name !== 'string' || !asset.name) {
        return { status: 'error', message: '选择器没有返回可展示的文件名' };
      }
      const data = await new File(asset.uri).bytes();
      readBytes += data.byteLength;
      if (readBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        return { status: 'error', message: `附件总大小不能超过 ${MAX_TOTAL_ATTACHMENT_BYTES} 字节` };
      }
      pickedSequence += 1;
      inputs.push({
        id: `att-${Date.now()}-${pickedSequence}`,
        name: asset.name,
        mimeType: pickedMimeType(asset.name, asset.mimeType, imageMimeOf(data)),
        data,
      });
    }
    const validated = createAttachmentDraftsFromBytes(inputs);
    if (!validated.ok) return { status: 'error', message: validated.error };
    const attachments: AttachmentDraft[] = validated.attachments;
    return { status: 'selected', attachments };
  } catch (error) {
    return { status: 'error', message: `读取附件失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
