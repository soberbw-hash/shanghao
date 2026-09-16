import { UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from "uiohook-napi";

export class PhoneShortcut {
  private down = false;
  constructor(
    readonly keycode: number,
    private modifiers: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
    private trigger: "hold" | "toggle",
    private change: (active?: boolean) => void,
    readonly mouseButton?: number,
  ) {}
  static parse(
    shortcut: string,
    trigger: "hold" | "toggle",
    change: (active?: boolean) => void,
  ): PhoneShortcut {
    const parts = shortcut.split("+").map((part) => part.trim());
    const key = parts.pop() ?? "";
    const mouseButton = /^(Mouse4|XButton1)$/i.test(key)
      ? 4
      : /^(Mouse5|XButton2)$/i.test(key)
        ? 5
        : undefined;
    const name = Object.keys(UiohookKey).find((value) => value.toLowerCase() === key.toLowerCase());
    if (!mouseButton && (!name || /^(Ctrl|Alt|Shift|Meta)(Right)?$/i.test(name)))
      throw new Error("不支持这个电话模式快捷键");
    const modifiers = new Set(parts.map((value) => value.toLowerCase()));
    if (
      [...modifiers].some(
        (value) => !["ctrl", "control", "shift", "alt", "meta", "super", "win"].includes(value),
      )
    )
      throw new Error("不支持这个组合键");
    if (modifiers.has("alt") && name === "F4") throw new Error("请勿使用系统关闭快捷键");
    if (
      (modifiers.has("ctrl") || modifiers.has("control")) &&
      modifiers.has("alt") &&
      name === "Delete"
    )
      throw new Error("不能使用 Windows 安全快捷键");
    if (["meta", "super", "win"].some((value) => modifiers.has(value)) && name === "L")
      throw new Error("不能使用 Windows 锁屏快捷键");
    return new PhoneShortcut(
      mouseButton ? -1 : UiohookKey[name as keyof typeof UiohookKey],
      {
        ctrlKey: modifiers.has("ctrl") || modifiers.has("control"),
        altKey: modifiers.has("alt"),
        shiftKey: modifiers.has("shift"),
        metaKey: ["meta", "super", "win"].some((value) => modifiers.has(value)),
      },
      trigger,
      change,
      mouseButton,
    );
  }
  keyDown = (event: UiohookKeyboardEvent): void => {
    if (this.mouseButton) return;
    if (this.down || event.keycode !== this.keycode) return;
    if (
      Object.entries(this.modifiers).some(
        ([key, value]) => event[key as keyof UiohookKeyboardEvent] !== value,
      )
    )
      return;
    this.down = true;
    this.change(this.trigger === "hold" ? true : undefined);
  };
  keyUp = (event: UiohookKeyboardEvent): void => {
    if (this.mouseButton) return;
    // Modifiers may have been released first; keycode owns this press.
    if (!this.down || event.keycode !== this.keycode) return;
    this.down = false;
    if (this.trigger === "hold") this.change(false);
  };
  mouseDown = (event: UiohookMouseEvent): void => {
    if (!this.mouseButton || this.down || Number(event.button) !== this.mouseButton) return;
    if (
      Object.entries(this.modifiers).some(
        ([key, value]) => event[key as keyof UiohookMouseEvent] !== value,
      )
    )
      return;
    this.down = true;
    this.change(this.trigger === "hold" ? true : undefined);
  };
  mouseUp = (event: UiohookMouseEvent): void => {
    if (!this.mouseButton || !this.down || Number(event.button) !== this.mouseButton) return;
    this.down = false;
    if (this.trigger === "hold") this.change(false);
  };
  reset(): void {
    if (this.down && this.trigger === "hold") this.change(false);
    this.down = false;
  }
}
