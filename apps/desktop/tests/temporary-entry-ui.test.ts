import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { TemporaryRoomProfile } from "@private-voice/shared";

type Props = {
  children?: unknown;
  inputMode?: string;
  "aria-label"?: string;
  disabled?: boolean;
  src?: string;
  alt?: string;
  onClick?: () => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  onChange?: (event: { target: { value: string } }) => void;
};
type Node = { type: string; props: Props };
const elements = (node: unknown): Node[] =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(elements)
      : [node as Node, ...elements((node as Node).props?.children)];
const text = (node: unknown): string =>
  node == null
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text((node as Node).props?.children)
        : String(node);

function fixture(component: "TemporaryRoomEntry" | "TemporaryAvatarPicker", props = {}) {
  let index = 0;
  const slots: unknown[] = [],
    pendingEffects: (() => unknown)[] = [];
  const saved: TemporaryRoomProfile[] = [],
    created: unknown[][] = [],
    joined: string[] = [],
    changed: unknown[][] = [];
  const prepared: string[] = [];
  const errors: string[] = [],
    preparing: boolean[] = [],
    cleanups: (() => void)[] = [];
  let releasePreparation: ((value: string) => void) | undefined;
  let rejectPreparation: ((error: Error) => void) | undefined;
  const profile = {
    nickname: "旧临时朋友",
    avatarId: "corgi",
    avatarDataUrl: "data:image/png;base64,OLD",
  };
  const api = {
    getProfile: async () => profile,
    saveProfile: async (value: TemporaryRoomProfile) => {
      saved.push(value);
    },
    create: async (...args: unknown[]) => {
      created.push(args);
      return { contextId: "new" };
    },
    join: async (code: string) => {
      joined.push(code);
      return { contextId: "joined" };
    },
    release: async () => undefined,
    prepareAvatar: (input: string) => {
      prepared.push(input);
      return new Promise<string>((resolve, reject) => {
        releasePreparation = resolve;
        rejectPreparation = reject;
      });
    },
  };
  const exported: Record<string, (props: Record<string, unknown>) => Node> = {};
  const source = ts.transpileModule(
    readFileSync(
      new URL(`../src/renderer/src/components/room/${component}.tsx`, import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const imports: Record<string, unknown> = {
    "react/jsx-runtime": {
      jsx: (type: string, props: Props) => ({ type, props }),
      jsxs: (type: string, props: Props) => ({ type, props }),
    },
    react: {
      useState: (initial: unknown) => {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = initial;
        return [
          slots[slot],
          (value: unknown) => {
            slots[slot] = value;
          },
        ];
      },
      useRef: (initial: unknown) => {
        const slot = index++;
        return (slots[slot] ??= { current: initial });
      },
      useEffect: (effect: () => unknown) => {
        const slot = index++;
        if (!(slot in slots)) {
          slots[slot] = true;
          pendingEffects.push(effect);
        }
      },
    },
    "lucide-react": { UsersRound: "svg" },
    "../../store/settingsStore": { useSettingsStore: { getState: () => ({}) } },
    "../../store/appStore": { useAppStore: { getState: () => ({ currentPage: "room" }) } },
    "../../store/accountStore": {
      useAccountStore: Object.assign(
        (selector: (state: { snapshot: { status: string } }) => unknown) =>
          selector({ snapshot: { status: "signed_out" } }),
        { getState: () => ({ snapshot: { status: "signed_out" } }) },
      ),
    },
    "../../features/room/temporaryRoomMessages": { temporaryRoomMessage: String },
    "../base/Button": { Button: "button" },
    "../base/DialogCloseButton": { DialogCloseButton: "close-button" },
    "./TemporaryAvatarPicker": { TemporaryAvatarPicker: "picker" },
    "../../features/account/prepareAccountAvatar": {
      prepareAccountAvatar: async (source: string) => `data:image/png;base64,${source}`,
    },
  };
  runInNewContext(source, {
    exports: exported,
    window: { desktopApi: { temporaryRooms: api } },
    require: (id: string) => {
      if (id.endsWith(".css")) return {};
      if (id.endsWith(".svg")) return { default: id };
      if (id in imports) return imports[id];
      throw Error(id);
    },
  });
  const render = () => {
    index = 0;
    const tree = exported[component]({
      avatarId: "corgi",
      dataUrl: profile.avatarDataUrl,
      disabled: false,
      onJoin: async () => undefined,
      onPreparing: (value: boolean) => preparing.push(value),
      onError: (message: string) => errors.push(message),
      onChange: (...value: unknown[]) => changed.push(value),
      ...props,
    });
    pendingEffects.splice(0).forEach((effect) => {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup as () => void);
    });
    return tree;
  };
  return {
    render,
    saved,
    created,
    joined,
    changed,
    prepared,
    errors,
    preparing,
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
    rejectPreparation: () => rejectPreparation?.(Error("fixture normalization rejected")),
    releasePreparation: (value: string) => releasePreparation?.(value),
  };
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test("temporary entry separates server-generated creation from joining an existing code and preserves the saved identity", async () => {
  const f = fixture("TemporaryRoomEntry");
  f.render();
  await settle();
  let tree = f.render();
  assert.ok(!text(tree).includes("免登录"));
  assert.ok(
    !elements(tree).some((node) => node.type === "input"),
    "entry stays separate from account login",
  );
  elements(tree).find((node) => node.type === "button")!.props.onClick!();
  tree = f.render();
  const create = elements(tree).find(
    (node) => node.type === "button" && text(node).includes("创建临时房间"),
  )!;
  assert.ok(!create.props.disabled);
  await create.props.onClick!();
  await settle();
  assert.deepEqual(f.created, [[]], "creation never forwards the join code");
  assert.equal(f.saved[0].avatarId, "corgi");
  assert.equal(f.saved[0].avatarDataUrl, "data:image/png;base64,OLD");
  tree = f.render();
  const join = elements(tree).find(
    (node) => node.type === "button" && text(node).includes("加入房间"),
  )!;
  assert.ok(join && !join.props.disabled);
  await join.props.onClick!();
  tree = f.render();
  assert.ok(!text(tree).includes("创建临时房间"));
  const code = elements(tree).find(
    (node) => node.type === "input" && node.props.inputMode === "numeric",
  )!;
  assert.match(code.props["aria-label"]!, /加入.*房间码/);
  code.props.onChange!({ target: { value: "0012 3456" } });
  tree = f.render();
  elements(tree).find((node) => node.type === "form")!.props.onSubmit!({
    preventDefault: () => {},
  });
  await settle();
  assert.deepEqual(f.joined, ["00123456"]);
});

test("temporary preset selection uses channel portraits and saves normalized image bytes while retaining legacy ids", async () => {
  const f = fixture("TemporaryAvatarPicker");
  let tree = f.render();
  const choices = elements(tree).filter((node) => node.type === "button");
  assert.equal(choices.length, 5);
  assert.ok(
    choices.every((node) =>
      elements(node).some((image) => image.type === "img" && image.props.src?.endsWith(".svg")),
    ),
  );
  assert.ok(elements(tree).some((node) => node.props.alt === "自定义临时头像"));
  choices[0].props.onClick!();
  await settle();
  tree = f.render();
  assert.equal(f.changed.length, 0, "preset cannot be persisted before normalization");
  assert.equal(f.prepared.length, 1);
  assert.match(f.prepared[0], /^data:image\/png;base64,/);
  assert.ok(
    elements(tree)
      .filter((node) => node.type === "button")
      .every((node) => node.props.disabled),
  );
  f.releasePreparation("data:image/png;base64,NORMALIZED");
  await settle();
  assert.equal(f.changed[0][0], "fox");
  assert.equal(f.changed[0][1], "data:image/png;base64,NORMALIZED");
});

test("temporary portrait failures keep the old avatar and late completions cannot update an unmounted picker", async () => {
  const failed = fixture("TemporaryAvatarPicker");
  elements(failed.render()).find((node) => node.type === "button")!.props.onClick!();
  await settle();
  failed.rejectPreparation();
  await settle();
  assert.equal(failed.changed.length, 0);
  assert.equal(failed.errors.length, 1);
  assert.deepEqual(failed.preparing, [true, false]);
  assert.ok(elements(failed.render()).some((node) => node.props.alt === "自定义临时头像"));

  const late = fixture("TemporaryAvatarPicker");
  elements(late.render()).find((node) => node.type === "button")!.props.onClick!();
  await settle();
  late.unmount();
  late.releasePreparation("data:image/png;base64,LATE");
  await settle();
  assert.equal(late.changed.length, 0);
  assert.equal(late.errors.length, 0);
});
