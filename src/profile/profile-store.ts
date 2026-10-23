import { ApiError, isRequestCancelled } from '../api/errors';
import type { IdentityInput, Profile } from '../api/contracts';
import type { Identity } from '../api/types';

export const IDENTITY_NAME_LIMIT = 80;
export const PROFILE_TEXT_LIMIT = 20_000;
export const PROFILE_TONES = ['warm', 'concise', 'thoughtful'] as const;
export type ProfileTone = (typeof PROFILE_TONES)[number];

export type ProfileSnapshot = {
  identity?: Identity;
  profile?: Profile;
  draftIdentity: { name: string; tone: string };
  draftProfile: { soul: string; user: string };
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  writing: false | 'identity' | 'profile';
  dirtyIdentity: boolean;
  dirtyProfile: boolean;
  error?: string;
  notice?: string;
};

type ProfileClient = {
  getSnapshot(signal?: AbortSignal): Promise<{ identity: Identity }>;
  saveIdentity(input: IdentityInput, signal?: AbortSignal): Promise<Identity>;
  getProfile(signal?: AbortSignal): Promise<Profile>;
  saveProfile(profile: Profile, signal?: AbortSignal): Promise<Profile>;
};

const initial = (): ProfileSnapshot => ({
  draftIdentity: { name: '', tone: '' },
  draftProfile: { soul: '', user: '' },
  loaded: false,
  loading: false,
  stale: true,
  writing: false,
  dirtyIdentity: false,
  dirtyProfile: false,
});

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function uncertainWrite(error: unknown): boolean {
  return isRequestCancelled(error) || !(error instanceof ApiError) ||
    error.status === 0 || error.status === 408 || error.status >= 500;
}

/**
 * 当前服务连接内的全局身份与人设。身份与文件是两个独立端点，不伪造原子保存；
 * 写入按最后一次成功响应生效，失败或结果未明只保留草稿并提示刷新核对。
 */
export class ProfileStore {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private disposed = false;
  private identityLoaded = false;
  private profileLoaded = false;
  private identity?: Identity;
  private profile?: Profile;
  private readGeneration = 0;
  private writeGeneration = 0;
  private readController?: AbortController;
  private writeController?: AbortController;

  constructor(private readonly client: ProfileClient) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<ProfileSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private cancelRead() {
    this.readGeneration++;
    this.readController?.abort();
    this.readController = undefined;
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    const hadWrite = this.state.writing !== false;
    this.active = active;
    if (!active) {
      this.cancelRead();
      this.writeGeneration++;
      this.writeController?.abort();
      this.writeController = undefined;
      this.publish({
        loading: false,
        stale: true,
        writing: false,
        ...(hadWrite ? { error: '保存结果未明，请刷新核对；不会自动重试。' } : {}),
      });
      return;
    }
    void this.refresh();
  }

  open() {
    if (this.disposed) return;
    this.visible = true;
    if (this.state.loading) return;
    void this.refresh();
  }

  close() {
    this.visible = false;
    this.cancelRead();
    this.publish({ loading: false, stale: true });
  }

  canWrite() {
    return this.active && this.visible && this.state.loaded &&
      !this.state.loading && !this.state.stale && this.state.writing === false;
  }

  setIdentity = (field: 'name' | 'tone', value: string) => {
    if (this.state.writing === 'identity') return;
    if (field === 'name' && value.trim().length > IDENTITY_NAME_LIMIT) {
      this.publish({ error: `助手名字不能超过 ${IDENTITY_NAME_LIMIT} 字符` });
      return;
    }
    if (field === 'tone' && !PROFILE_TONES.includes(value as ProfileTone)) {
      this.publish({ error: '语气仅支持 warm、concise 或 thoughtful' });
      return;
    }
    const draftIdentity = { ...this.state.draftIdentity, [field]: value };
    this.publish({
      draftIdentity,
      dirtyIdentity: !!this.identity && (
        draftIdentity.name !== this.identity.name || draftIdentity.tone !== this.identity.tone
      ),
      error: undefined,
      notice: undefined,
    });
  };

  setProfile = (field: 'soul' | 'user', value: string) => {
    if (this.state.writing === 'profile') return;
    if (value.length > PROFILE_TEXT_LIMIT) {
      this.publish({ error: `${field === 'soul' ? 'SOUL' : 'USER'} 不能超过 ${PROFILE_TEXT_LIMIT} 字符` });
      return;
    }
    const draftProfile = { ...this.state.draftProfile, [field]: value };
    this.publish({
      draftProfile,
      dirtyProfile: !!this.profile && (
        draftProfile.soul !== this.profile.soul || draftProfile.user !== this.profile.user
      ),
      error: undefined,
      notice: undefined,
    });
  };

  refresh = async () => {
    if (!this.active || this.state.writing !== false || this.disposed) return;
    this.cancelRead();
    const generation = ++this.readGeneration;
    const controller = new AbortController();
    this.readController = controller;
    this.publish({ loading: true, error: undefined });
    const [identityResult, profileResult] = await Promise.allSettled([
      this.client.getSnapshot(controller.signal),
      this.client.getProfile(controller.signal),
    ]);
    if (generation !== this.readGeneration || controller.signal.aborted || this.disposed) return;

    const errors: string[] = [];
    if (identityResult.status === 'fulfilled') {
      this.identity = identityResult.value.identity;
      this.identityLoaded = true;
      const draftIdentity = this.state.dirtyIdentity
        ? this.state.draftIdentity
        : { name: this.identity.name, tone: this.identity.tone };
      this.publish({
        identity: this.identity,
        draftIdentity,
        dirtyIdentity: draftIdentity.name !== this.identity.name ||
          draftIdentity.tone !== this.identity.tone,
      });
    } else if (!isRequestCancelled(identityResult.reason)) {
      errors.push(message(identityResult.reason, '身份读取失败'));
    }
    if (profileResult.status === 'fulfilled') {
      this.profile = profileResult.value;
      this.profileLoaded = true;
      const draftProfile = this.state.dirtyProfile
        ? this.state.draftProfile
        : { soul: this.profile.soul, user: this.profile.user };
      this.publish({
        profile: this.profile,
        draftProfile,
        dirtyProfile: draftProfile.soul !== this.profile.soul ||
          draftProfile.user !== this.profile.user,
      });
    } else if (!isRequestCancelled(profileResult.reason)) {
      errors.push(message(profileResult.reason, '人设读取失败'));
    }

    const loaded = this.identityLoaded && this.profileLoaded;
    this.publish({
      loaded,
      stale: errors.length > 0,
      ...(errors.length ? { error: errors.join('；') } : {}),
    });
    if (generation === this.readGeneration) {
      this.readController = undefined;
      this.publish({ loading: false });
    }
  };

  discardIdentity = () => {
    if (!this.canWrite() || !this.identity) return;
    this.publish({
      draftIdentity: { name: this.identity.name, tone: this.identity.tone },
      dirtyIdentity: false,
      error: undefined,
      notice: undefined,
    });
  };

  discardProfile = () => {
    if (!this.canWrite() || !this.profile) return;
    this.publish({
      draftProfile: { soul: this.profile.soul, user: this.profile.user },
      dirtyProfile: false,
      error: undefined,
      notice: undefined,
    });
  };

  saveIdentity = async () => {
    if (!this.canWrite() || !this.identity || !this.state.dirtyIdentity) return false;
    const name = this.state.draftIdentity.name.trim();
    const tone = this.state.draftIdentity.tone;
    if (!name || name.length > IDENTITY_NAME_LIMIT) {
      this.publish({ error: `助手名字须为 1–${IDENTITY_NAME_LIMIT} 个字符，不能只有空白` });
      return false;
    }
    if (!PROFILE_TONES.includes(tone as ProfileTone)) {
      this.publish({ error: '请先选择受支持的语气（warm、concise、thoughtful）' });
      return false;
    }
    return this.write('identity', (signal) => this.client.saveIdentity({ name, tone }, signal), (identity) => {
      this.identity = identity;
      this.identityLoaded = true;
      return {
        identity,
        draftIdentity: { name: identity.name, tone: identity.tone },
        dirtyIdentity: false,
        notice: '身份已保存',
      };
    });
  };

  saveProfile = async () => {
    if (!this.canWrite() || !this.profile || !this.state.dirtyProfile) return false;
    const draft = this.state.draftProfile;
    if (draft.soul.length > PROFILE_TEXT_LIMIT || draft.user.length > PROFILE_TEXT_LIMIT) {
      this.publish({ error: `SOUL/USER 不能超过 ${PROFILE_TEXT_LIMIT} 字符` });
      return false;
    }
    return this.write('profile', (signal) => this.client.saveProfile(draft, signal), (profile) => {
      this.profile = profile;
      this.profileLoaded = true;
      return {
        profile,
        draftProfile: { soul: profile.soul, user: profile.user },
        dirtyProfile: false,
        notice: '人设已保存',
      };
    });
  };

  private async write<T extends Identity | Profile>(
    kind: 'identity' | 'profile',
    action: (signal: AbortSignal) => Promise<T>,
    apply: (result: T) => Partial<ProfileSnapshot>,
  ) {
    this.cancelRead();
    const generation = ++this.writeGeneration;
    const controller = new AbortController();
    this.writeController = controller;
    this.publish({ writing: kind, error: undefined, notice: undefined });
    let success = false;
    try {
      const result = await action(controller.signal);
      if (generation !== this.writeGeneration || controller.signal.aborted || this.disposed) return false;
      success = true;
      this.publish({
        ...apply(result),
        loaded: this.identityLoaded && this.profileLoaded,
        stale: false,
      });
    } catch (error) {
      if (generation !== this.writeGeneration || this.disposed) return false;
      const uncertain = uncertainWrite(error);
      this.publish({
        stale: uncertain,
        error: uncertain
          ? '保存结果未明，请刷新核对；确认后可再次显式保存。'
          : message(error, '保存失败，请修改后重试'),
      });
    } finally {
      if (generation === this.writeGeneration) {
        this.writeController = undefined;
        this.publish({ writing: false });
      }
    }
    return success;
  }

  dispose() {
    this.setActive(false);
    this.disposed = true;
    this.visible = false;
    this.identity = undefined;
    this.profile = undefined;
    this.identityLoaded = false;
    this.profileLoaded = false;
    this.state = initial();
    this.listeners.clear();
  }
}
