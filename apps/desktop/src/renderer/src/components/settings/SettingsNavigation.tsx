import {
  Activity,
  Headphones,
  Info,
  Library,
  MonitorCog,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import { motionCurve, motionDuration } from "../../features/motion/motionSystem";
import type { SettingsSectionId } from "../../features/settings/settingsSectionState";

const sectionGroups = [
  {
    label: "常用",
    sections: [
      { id: "account", label: "账号", icon: UserRound },
      { id: "general", label: "通用", icon: MonitorCog },
      { id: "audio", label: "语音", icon: Headphones },
      { id: "quickMessages", label: "快捷消息", icon: Zap },
      { id: "recordings", label: "录音库", icon: Library },
    ],
  },
  {
    label: "进阶与支持",
    sections: [
      { id: "ai", label: "AI 功能", icon: Sparkles },
      { id: "diagnostics", label: "诊断", icon: Activity },
      { id: "about", label: "关于上号", icon: Info },
    ],
  },
] satisfies Array<{
  label: string;
  sections: Array<{ id: SettingsSectionId; label: string; icon: typeof Headphones }>;
}>;

export const settingsSections = sectionGroups.flatMap<{
  id: SettingsSectionId;
  label: string;
  icon: typeof Headphones;
}>((group) => group.sections);

export const SettingsNavigation = ({
  activeSection,
  onSelect,
}: {
  activeSection: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}) => (
  <nav
    data-gsap-settings="nav"
    aria-label="设置栏目"
    className="settings-nav glass-panel h-fit rounded-[22px] p-2"
  >
    <LayoutGroup id="settings-section-navigation">
      {sectionGroups.map((group) => (
        <div className="settings-nav-group" role="group" aria-label={group.label} key={group.label}>
          <p className="settings-nav-group-label" aria-hidden="true">
            {group.label}
          </p>
          {group.sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-ui-sound="handled"
              aria-current={activeSection === id ? "page" : undefined}
              onClick={() => onSelect(id)}
              className={`settings-nav-item relative isolate flex w-full items-center gap-3 whitespace-nowrap rounded-[14px] px-3 py-2.5 text-left text-sm font-semibold transition-colors duration-100 ${
                activeSection === id ? "text-[#3f6ed7]" : "text-[#718096] hover:bg-white/70"
              }`}
            >
              {activeSection === id ? (
                <motion.span
                  className="settings-nav-active-pill"
                  layoutId="settings-active-section"
                  transition={{ duration: motionDuration.normal, ease: motionCurve.spatial }}
                />
              ) : null}
              <Icon className="relative z-[1] h-4 w-4" aria-hidden="true" />
              <span className="relative z-[1]">{label}</span>
            </button>
          ))}
        </div>
      ))}
    </LayoutGroup>
  </nav>
);
