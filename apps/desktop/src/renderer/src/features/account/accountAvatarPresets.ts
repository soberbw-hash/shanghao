import {
  accountAvatarPresetForIdentity,
  type AccountAvatarPresetId,
  type AccountProfile,
} from "@private-voice/shared";

import skyCat from "../../assets/account-avatars/01-sky-cat.svg";
import mintBear from "../../assets/account-avatars/02-mint-bear.svg";
import peachFox from "../../assets/account-avatars/03-peach-fox.svg";
import moonRabbit from "../../assets/account-avatars/04-moon-rabbit.svg";
import sunDuck from "../../assets/account-avatars/05-sun-duck.svg";
import lilacDeer from "../../assets/account-avatars/06-lilac-deer.svg";
import aquaWhale from "../../assets/account-avatars/07-aqua-whale.svg";
import amberDog from "../../assets/account-avatars/08-amber-dog.svg";
import cloudPanda from "../../assets/account-avatars/09-cloud-panda.svg";
import cometOtter from "../../assets/account-avatars/10-comet-otter.svg";
import portrait11 from "../../assets/account-avatars/11-snow-penguin.svg";
import portrait12 from "../../assets/account-avatars/12-golden-tiger.svg";
import portrait13 from "../../assets/account-avatars/13-moss-frog.svg";
import portrait14 from "../../assets/account-avatars/14-eucalyptus-koala.svg";
import portrait15 from "../../assets/account-avatars/15-dusk-owl.svg";
import portrait16 from "../../assets/account-avatars/16-rust-red-panda.svg";
import portrait17 from "../../assets/account-avatars/17-sand-lion.svg";
import portrait18 from "../../assets/account-avatars/18-oat-hamster.svg";
import portrait19 from "../../assets/account-avatars/19-lagoon-turtle.svg";
import portrait20 from "../../assets/account-avatars/20-chestnut-hedgehog.svg";
import portrait21 from "../../assets/account-avatars/21-ice-seal.svg";
import portrait22 from "../../assets/account-avatars/22-lemon-chick.svg";
import portrait23 from "../../assets/account-avatars/23-cocoa-capybara.svg";
import portrait24 from "../../assets/account-avatars/24-slate-raccoon.svg";
import portrait25 from "../../assets/account-avatars/25-silver-wolf.svg";
import portrait26 from "../../assets/account-avatars/26-jade-dragon.svg";
import portrait27 from "../../assets/account-avatars/27-orbit-robot.svg";
import portrait28 from "../../assets/account-avatars/28-lunar-astronaut.svg";
import portrait29 from "../../assets/account-avatars/29-ring-planet.svg";
import portrait30 from "../../assets/account-avatars/30-coral-mushroom.svg";
import portrait31 from "../../assets/account-avatars/31-linen-ghost.svg";
import portrait32 from "../../assets/account-avatars/32-apricot-squirrel.svg";

export interface AccountAvatarPreset {
  id: AccountAvatarPresetId;
  name: string;
  source: string;
}

export const ACCOUNT_AVATAR_PRESETS: AccountAvatarPreset[] = [
  { id: "sky-cat", name: "晴空猫", source: skyCat },
  { id: "mint-bear", name: "薄荷熊", source: mintBear },
  { id: "peach-fox", name: "蜜桃狐", source: peachFox },
  { id: "moon-rabbit", name: "月兔", source: moonRabbit },
  { id: "sun-duck", name: "太阳鸭", source: sunDuck },
  { id: "lilac-deer", name: "丁香鹿", source: lilacDeer },
  { id: "aqua-whale", name: "海蓝鲸", source: aquaWhale },
  { id: "amber-dog", name: "琥珀犬", source: amberDog },
  { id: "cloud-panda", name: "云朵熊猫", source: cloudPanda },
  { id: "comet-otter", name: "彗星水獭", source: cometOtter },
  { id: "snow-penguin", name: "雪团企鹅", source: portrait11 },
  { id: "golden-tiger", name: "金纹虎", source: portrait12 },
  { id: "moss-frog", name: "苔绿蛙", source: portrait13 },
  { id: "eucalyptus-koala", name: "桉树考拉", source: portrait14 },
  { id: "dusk-owl", name: "暮色猫头鹰", source: portrait15 },
  { id: "rust-red-panda", name: "红豆小熊猫", source: portrait16 },
  { id: "sand-lion", name: "沙丘狮", source: portrait17 },
  { id: "oat-hamster", name: "燕麦仓鼠", source: portrait18 },
  { id: "lagoon-turtle", name: "湖心龟", source: portrait19 },
  { id: "chestnut-hedgehog", name: "栗子刺猬", source: portrait20 },
  { id: "ice-seal", name: "冰川海豹", source: portrait21 },
  { id: "lemon-chick", name: "柠檬小鸡", source: portrait22 },
  { id: "cocoa-capybara", name: "可可水豚", source: portrait23 },
  { id: "slate-raccoon", name: "岩灰浣熊", source: portrait24 },
  { id: "silver-wolf", name: "银月狼", source: portrait25 },
  { id: "jade-dragon", name: "玉色龙", source: portrait26 },
  { id: "orbit-robot", name: "轨道机器人", source: portrait27 },
  { id: "lunar-astronaut", name: "月球宇航员", source: portrait28 },
  { id: "ring-planet", name: "环星", source: portrait29 },
  { id: "coral-mushroom", name: "珊瑚蘑菇", source: portrait30 },
  { id: "linen-ghost", name: "小幽灵", source: portrait31 },
  { id: "apricot-squirrel", name: "杏子松鼠", source: portrait32 },
];

export const accountAvatarPresetSource = (id?: AccountAvatarPresetId): string | undefined =>
  ACCOUNT_AVATAR_PRESETS.find((preset) => preset.id === id)?.source;
export const accountProfileAvatarSource = (profile?: AccountProfile): string | undefined =>
  profile
    ? accountAvatarPresetSource(
        profile.accountAvatarPresetId ?? accountAvatarPresetForIdentity(profile.userId),
      )
    : undefined;
