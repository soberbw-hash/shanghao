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

const ipPortraits = import.meta.glob<string>("../../assets/account-avatars/ip-as-logo/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface AccountAvatarPreset {
  id: AccountAvatarPresetId;
  name: string;
  source: string;
}

const allAccountAvatarPresets: AccountAvatarPreset[] = [
  {
    id: "ip-01",
    name: "小狐狸",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-01.webp"]!,
  },
  {
    id: "ip-02",
    name: "小狗",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-02.webp"]!,
  },
  {
    id: "ip-03",
    name: "机器人",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-03.webp"]!,
  },
  {
    id: "ip-04",
    name: "考拉",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-04.webp"]!,
  },
  {
    id: "ip-05",
    name: "橡果",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-05.webp"]!,
  },
  {
    id: "ip-06",
    name: "白熊",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-06.webp"]!,
  },
  {
    id: "ip-07",
    name: "蓝鲸",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-07.webp"]!,
  },
  {
    id: "ip-08",
    name: "仙人掌",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-08.webp"]!,
  },
  {
    id: "ip-09",
    name: "熊猫",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-09.webp"]!,
  },
  {
    id: "ip-10",
    name: "火箭",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-10.webp"]!,
  },
  {
    id: "ip-11",
    name: "蘑菇",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-11.webp"]!,
  },
  {
    id: "ip-12",
    name: "企鹅",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-12.webp"]!,
  },
  {
    id: "ip-13",
    name: "牛仔",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-13.webp"]!,
  },
  {
    id: "ip-14",
    name: "小熊",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-14.webp"]!,
  },
  {
    id: "ip-15",
    name: "微笑鲸",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-15.webp"]!,
  },
  {
    id: "ip-16",
    name: "狮子",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-16.webp"]!,
  },
  {
    id: "ip-17",
    name: "小忍者",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-17.webp"]!,
  },
  {
    id: "ip-18",
    name: "小石头",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-18.webp"]!,
  },
  {
    id: "ip-19",
    name: "蜗牛",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-19.webp"]!,
  },
  {
    id: "ip-20",
    name: "云朵",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-20.webp"]!,
  },
  {
    id: "ip-21",
    name: "青蛙",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-21.webp"]!,
  },
  {
    id: "ip-22",
    name: "蝠鲼",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-22.webp"]!,
  },
  {
    id: "ip-23",
    name: "奶油熊",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-23.webp"]!,
  },
  {
    id: "ip-24",
    name: "小方块",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-24.webp"]!,
  },
  {
    id: "ip-25",
    name: "白鲸",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-25.webp"]!,
  },
  {
    id: "ip-26",
    name: "小茶壶",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-26.webp"]!,
  },
  {
    id: "ip-27",
    name: "白猫",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-27.webp"]!,
  },
  {
    id: "ip-28",
    name: "幽灵",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-28.webp"]!,
  },
  {
    id: "ip-29",
    name: "水母",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-29.webp"]!,
  },
  {
    id: "ip-30",
    name: "小精灵",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-30.webp"]!,
  },
  {
    id: "ip-31",
    name: "猫咪",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-31.webp"]!,
  },
  {
    id: "ip-32",
    name: "小蒙面",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-32.webp"]!,
  },
  {
    id: "ip-33",
    name: "兔子",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-33.webp"]!,
  },
  {
    id: "ip-34",
    name: "六角恐龙",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-34.webp"]!,
  },
  {
    id: "ip-35",
    name: "白犬",
    source: ipPortraits["../../assets/account-avatars/ip-as-logo/ip-35.webp"]!,
  },
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

export const ACCOUNT_AVATAR_PRESETS = allAccountAvatarPresets.filter((preset) =>
  preset.id.startsWith("ip-"),
);

export const accountAvatarPresetSource = (id?: AccountAvatarPresetId): string | undefined =>
  ACCOUNT_AVATAR_PRESETS.find((preset) => preset.id === id)?.source;
export const accountProfileAvatarSource = (profile?: AccountProfile): string | undefined =>
  profile
    ? accountAvatarPresetSource(
        profile.accountAvatarPresetId?.startsWith("ip-")
          ? profile.accountAvatarPresetId
          : accountAvatarPresetForIdentity(profile.userId),
      )
    : undefined;
