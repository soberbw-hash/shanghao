/** Windows virtual keys with unambiguous physical state; other keys retain the hook path. */
export const phoneVirtualKey = (name: string): number | undefined => {
  if (/^[A-Z0-9]$/i.test(name)) return name.toUpperCase().charCodeAt(0);
  const functionKey = /^F([1-9]|1\d|2[0-4])$/.exec(name);
  if (functionKey) return 0x6f + Number(functionKey[1]);
  const numpad = /^Numpad([0-9])$/.exec(name);
  if (numpad) return 0x60 + Number(numpad[1]);
  return (
    {
      Backspace: 8,
      Tab: 9,
      Enter: 13,
      Escape: 27,
      Space: 32,
      PageUp: 33,
      PageDown: 34,
      End: 35,
      Home: 36,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
      PrintScreen: 44,
      Insert: 45,
      Delete: 46,
      NumpadMultiply: 106,
      NumpadAdd: 107,
      NumpadSubtract: 109,
      NumpadDecimal: 110,
      NumpadDivide: 111,
      Semicolon: 186,
      Equal: 187,
      Comma: 188,
      Minus: 189,
      Period: 190,
      Slash: 191,
      Backquote: 192,
      BracketLeft: 219,
      Backslash: 220,
      BracketRight: 221,
      Quote: 222,
      Mouse4: 5,
      XButton1: 5,
      Mouse5: 6,
      XButton2: 6,
    } as Record<string, number>
  )[name];
};
