import { createRecipe, renderRecipe } from "uisfx";

// The exact UISFX recipe is retained; only its synchronous sample loop moves
// off the renderer that is committing the room and starting microphone DSP.
self.onmessage = (event: MessageEvent<{ sampleRate: number }>) => {
  const recipe = createRecipe("soft", "wake");
  const rendered = renderRecipe(recipe, event.data.sampleRate);
  self.postMessage(
    { left: rendered.left, right: rendered.right },
    { transfer: [rendered.left.buffer, rendered.right.buffer] },
  );
};
