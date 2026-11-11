import type { CompanionPack } from './types';

/** 开源默认包随应用打包；离线和下载失败时始终有完整八状态兜底。 */
export const builtinPenguin: CompanionPack = {
  key: 'builtin:penguin', name: '冰蓝企鹅', description: '与 Pi Muse 品牌一致的默认企鹅',
  images: {
    idle: require('../../assets/images/avatar/idle.png'),
    thinking: require('../../assets/images/avatar/thinking.png'),
    responding: require('../../assets/images/avatar/responding.png'),
    working: require('../../assets/images/avatar/working.png'),
    'waiting-approval': require('../../assets/images/avatar/waiting-approval.png'),
    success: require('../../assets/images/avatar/success.png'),
    error: require('../../assets/images/avatar/error.png'),
    stopped: require('../../assets/images/avatar/stopped.png'),
  },
};
export const builtinPacks = [builtinPenguin] as const;
