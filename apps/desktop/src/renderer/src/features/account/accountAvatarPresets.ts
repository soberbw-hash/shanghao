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

export interface AccountAvatarPreset {
  id: string;
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
];
