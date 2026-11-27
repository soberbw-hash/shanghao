import { createRecipe, renderRecipe, type CueName, type PackName } from "uisfx";

// The exact UISFX recipe is retained; only its synchronous sample loop moves
// off the renderer that is handling the interaction.
self.onmessage = (event: MessageEvent<{ sampleRate: number; pack?: PackName; cue?: CueName }>) => {
  const { sampleRate, pack = "soft", cue = "wake" } = event.data;
  const rendered = renderRecipe(createRecipe(pack, cue), sampleRate);
  self.postMessage(
    { left: rendered.left, right: rendered.right },
    { transfer: [rendered.left.buffer, rendered.right.buffer] },
  );
};
