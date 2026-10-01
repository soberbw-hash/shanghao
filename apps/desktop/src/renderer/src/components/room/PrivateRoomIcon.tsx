import {
  Gamepad2,
  Headphones,
  Mic,
  Keyboard,
  Mouse,
  Monitor,
  Zap,
  Flame,
  Star,
  Moon,
  Sun,
  Cloud,
  Rocket,
  Ghost,
  Cat,
  Dog,
  Coffee,
  Dice5,
  Layers3,
  Crown,
  type LucideIcon,
} from "lucide-react";
import type { RoomIconId } from "@private-voice/shared";
const icons: Record<RoomIconId, LucideIcon> = {
  gamepad: Gamepad2,
  headphones: Headphones,
  microphone: Mic,
  keyboard: Keyboard,
  mouse: Mouse,
  monitor: Monitor,
  bolt: Zap,
  flame: Flame,
  star: Star,
  moon: Moon,
  sun: Sun,
  cloud: Cloud,
  rocket: Rocket,
  ghost: Ghost,
  cat: Cat,
  dog: Dog,
  coffee: Coffee,
  dice: Dice5,
  cards: Layers3,
  crown: Crown,
};
export const roomIconLabels: Record<RoomIconId, string> = {
  gamepad: "手柄",
  headphones: "耳机",
  microphone: "麦克风",
  keyboard: "键盘",
  mouse: "鼠标",
  monitor: "显示器",
  bolt: "闪电",
  flame: "火焰",
  star: "星星",
  moon: "月亮",
  sun: "太阳",
  cloud: "云朵",
  rocket: "火箭",
  ghost: "幽灵",
  cat: "猫",
  dog: "狗",
  coffee: "咖啡",
  dice: "骰子",
  cards: "卡牌",
  crown: "皇冠",
};
export const PrivateRoomIcon = ({
  icon,
  className = "size-5",
}: {
  icon: RoomIconId;
  className?: string;
}) => {
  const Icon = icons[icon];
  return <Icon className={className} strokeWidth={1.8} aria-hidden="true" />;
};
