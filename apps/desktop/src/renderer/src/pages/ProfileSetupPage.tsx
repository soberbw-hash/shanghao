import { useEffect, useState } from "react";
import { Dices } from "lucide-react";

import { APP_NAME, APP_SLOGAN, type BuiltInAvatarId } from "@private-voice/shared";

import { AvatarPlaceholder } from "../components/base/AvatarPlaceholder";
import { BrandMark } from "../components/brand/BrandMark";
import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { GlassPanel } from "../components/layout/GlassPanel";
import { PageContainer } from "../components/layout/PageContainer";
import { AvatarPicker } from "../components/profile/AvatarPicker";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { getAvatarSrc, randomAvatarId, randomNickname } from "../utils/profile";

export const ProfileSetupPage = () => {
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const pushToast = useAppStore((state) => state.pushToast);
  const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState<BuiltInAvatarId>("fox");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setNickname(settings?.nickname || randomNickname());
    setAvatarId(settings?.avatarId || randomAvatarId());
  }, [settings?.avatarId, settings?.nickname]);

  const handleSubmit = async () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      pushToast({ tone: "warning", title: "先填一个昵称", description: "这样朋友能一眼认出你。" });
      return;
    }

    setIsSaving(true);
    try {
      await saveSettings({
        nickname: trimmedNickname.slice(0, 24),
        avatarId,
        avatarPath: undefined,
        hasCompletedProfileSetup: true,
      });
      pushToast({ tone: "success", title: "资料已保存", description: "现在可以进入开黑频道了。" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageContainer className="items-center justify-center">
      <GlassPanel className="w-full max-w-[760px] p-6 md:p-8">
        <div className="mb-7 flex items-center gap-4">
          <BrandMark size="lg" />
          <div>
            <div className="text-[28px] font-semibold text-[#111827]">{APP_NAME}</div>
            <div className="text-sm text-[#667085]">{APP_SLOGAN}</div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[210px_1fr] md:items-center">
          <div className="flex flex-col items-center gap-3 rounded-[20px] border border-[#E7ECF2] bg-[#F8FAFC] p-5">
            <AvatarPlaceholder name={nickname || "上号"} src={getAvatarSrc(avatarId)} size="lg" className="h-24 w-24" />
            <div className="text-center">
              <div className="text-sm font-medium text-[#111827]">{nickname || "等你上号"}</div>
              <div className="mt-1 text-xs text-[#98A2B3]">资料只用来让好友认出你</div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-[#111827]">选一个头像</div>
              <div className="mt-1 text-sm text-[#667085]">内置头像很轻，不会拖慢频道连接。</div>
            </div>
            <AvatarPicker value={avatarId} onChange={setAvatarId} />
            <div className="flex gap-2">
              <Input value={nickname} placeholder="输入你的昵称" maxLength={24} onChange={(event) => setNickname(event.target.value)} />
              <Button variant="secondary" className="shrink-0" onClick={() => setNickname(randomNickname())}>
                <Dices className="h-4 w-4" />
                随机
              </Button>
            </div>
            <Button isFullWidth onClick={() => void handleSubmit()} disabled={isSaving}>
              {isSaving ? "保存中…" : "保存并进入上号"}
            </Button>
          </div>
        </div>
      </GlassPanel>
    </PageContainer>
  );
};
