import { useEffect, useState } from "react";
import { Camera } from "lucide-react";

import { APP_NAME, APP_SLOGAN } from "@private-voice/shared";

import { AvatarPlaceholder } from "../components/base/AvatarPlaceholder";
import { BrandMark } from "../components/brand/BrandMark";
import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { GlassPanel } from "../components/layout/GlassPanel";
import { PageContainer } from "../components/layout/PageContainer";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";

export const ProfileSetupPage = () => {
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const pickAvatar = useSettingsStore((state) => state.pickAvatar);
  const clearAvatar = useSettingsStore((state) => state.clearAvatar);
  const pushToast = useAppStore((state) => state.pushToast);
  const [nickname, setNickname] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setNickname(settings?.nickname ?? "");
  }, [settings?.nickname]);

  const handleSubmit = async () => {
    const trimmedNickname = nickname.trim();

    if (!trimmedNickname) {
      pushToast({
        tone: "warning",
        title: "先填一个昵称",
        description: "这样朋友进房时才能认出你。",
      });
      return;
    }

    if (!settings?.avatarPath || !avatarDataUrl) {
      pushToast({
        tone: "warning",
        title: "先选一个头像",
        description: "头像会保存在本机，只用于房间显示。",
      });
      return;
    }

    setIsSaving(true);

    try {
      await saveSettings({
        nickname: trimmedNickname,
        hasCompletedProfileSetup: true,
      });
      pushToast({
        tone: "success",
        title: "资料已保存",
        description: "现在可以直接开房或加入房间了。",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageContainer className="items-center justify-center">
      <GlassPanel className="w-full max-w-[720px] p-6 md:p-8">
        <div className="mb-8 flex items-center gap-4">
          <BrandMark size="lg" />
          <div>
            <div className="text-[28px] font-semibold text-[#111827]">{APP_NAME}</div>
            <div className="text-sm text-[#667085]">{APP_SLOGAN}</div>
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-[220px_1fr] md:items-center">
          <div className="flex flex-col items-center gap-4 rounded-[20px] border border-[#E7ECF2] bg-[#F8FAFC] p-5">
            <AvatarPlaceholder
              name={nickname || "上号"}
              src={avatarDataUrl}
              size="lg"
              className="h-24 w-24 text-2xl"
            />
            <div className="text-center">
              <div className="text-sm font-medium text-[#111827]">先定好你的资料</div>
              <div className="mt-1 text-sm text-[#667085]">只要昵称和头像，两步就够。</div>
            </div>
            <Button variant="secondary" onClick={() => void pickAvatar()}>
              <Camera className="h-4 w-4" />
              选择头像
            </Button>
            <Button variant="ghost" onClick={() => void clearAvatar()} disabled={!settings?.avatarPath}>
              重置头像
            </Button>
          </div>
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-[#111827]">昵称</div>
              <div className="mt-1 text-sm text-[#667085]">
                房间里别人看到的就是这个名字。
              </div>
            </div>
            <Input
              value={nickname}
              placeholder="输入你的昵称"
              onChange={(event) => setNickname(event.target.value)}
            />
            <div className="rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] px-4 py-3 text-sm text-[#667085]">
              打开后只做三件事：开房、粘贴地址加入、静音自己。
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void handleSubmit()} disabled={isSaving}>
                {isSaving ? "保存中…" : "进入上号"}
              </Button>
              <Button variant="secondary" onClick={() => void pickAvatar()}>
                再选一张头像
              </Button>
            </div>
          </div>
        </div>
      </GlassPanel>
    </PageContainer>
  );
};
